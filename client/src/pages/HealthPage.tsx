import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { useCurrentUser } from "../api/currentUser";
import { useConfirm } from "../hooks/useConfirm";
import { OrphanBrowserModal } from "../components/health/OrphanBrowserModal";

interface LegacyEntry {
  type: string;
  id: number;
  label: string;
  table: string;
  column: string;
  hostId: number;
  hostRoute: string | null;
  hostLabel: string | null;
  resolvable: boolean;
  preview: string;
}

interface DeadCandidate {
  id: number;
  name: string;
  uid: string;
  prefix: string;
  source: string;
  tier: "exact" | "likely" | "doubtful";
  via: string;
}

interface DeadGroup {
  type: string;
  uid: string;
  code: string;
  label: string;
  count: number;
  samples: { type: string; uid: string; code: string; label: string; table: string; column: string; id: number; hostRoute: string | null; hostLabel: string | null }[];
  candidates: DeadCandidate[];
}

interface ScanResult {
  brokenPaths: { table: string; column: string; id: number; path: string }[];
  brokenPathsCount: number;
  brokenPathsShown?: number;
  brokenPathsTruncated?: boolean;
  missingFiles: { resource_id: number; name: string; file_path: string; file_name: string }[];
  missingFilesCount: number;
  orphans: Record<string, number>;
  orphansTotal: number;
  seq: { table: string; seq: number; maxId: number | null; drift: number }[];
  seqWorst: { table: string; seq: number; maxId: number | null; drift: number } | null;
  brokenLinks: { count: number; samples: { type: string; label: string }[] };
  brokenLinksCount: number;
  legacy: { entries: LegacyEntry[]; count: number; total?: number; resolvable: number; broken: number; truncated?: boolean };
  legacyCount: number;
  legacyResolvable: number;
  legacyBroken: number;
  legacyShown?: number;
  legacyTruncated?: boolean;
  danglingModules: { code: string; label: string; count: number; samples: { type: string; uid: string; code: string; label: string; table: string; column: string; id: number; hostRoute: string | null; hostLabel: string | null }[] }[];
  danglingModulesCount: number;
  deadUidMentions: { type: string; uid: string; code: string; label: string; table: string; column: string; id: number; hostRoute: string | null; hostLabel: string | null }[];
  deadUidMentionsCount: number;
  orphanFiles: { path: string; size: number }[];
  orphanFilesCount: number;
  relinkCandidates: { resource_id: number; name: string; old_path: string; new_path: string; match: string }[];
  relinkCandidatesCount: number;
  bracketNames: { table: string; count: number; sample: string }[];
  bracketNamesCount: number;
}

type TabId = "seq" | "paths" | "uids" | "names" | "orphanFiles";

const TABS: { id: TabId; label: string }[] = [
  { id: "seq", label: "Автоинкрементация" },
  { id: "paths", label: "Битые пути" },
  { id: "uids", label: "Пропавшие UID" },
  { id: "names", label: "Имена" },
  { id: "orphanFiles", label: "Файлы-сироты" },
];

const TAB_HINTS: Record<TabId, string> = {
  seq: "Норма — drift 0..4. Большой drift = кто-то плодит строки в цикле (см. П0.4).",
  paths: "Пути *_path указывают на файл, которого нет на диске. Починка — вручную: перепривязать файл или очистить поле.",
  uids: "Ссылки [[type@uid|code|label]] на несуществующие записи: модуль не установлен, uid удалён, или ссылка в старом формате [[type:id|label]]. Клик ведёт на запись-владельца.",
  names: "Имена с хвостом [Original] — наследство П2.6. Миграция режет хвост в name_original; перезапустите приложение — db.ts:2382 добьёт остатки.",
  orphanFiles: "Файлы на диске, которых нет ни в одной *_path-колонке. Отметь и перенеси в архив, создай ресурсы или пришей точечно.",
};

export function HealthPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [scanError, setScanError] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("seq");
  const [deadGroups, setDeadGroups] = useState<DeadGroup[] | null>(null);
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadChoices, setDeadChoices] = useState<Record<string, number | null | undefined>>({});
  const [deadBusy, setDeadBusy] = useState(false);
  const [deadFilter, setDeadFilter] = useState("");
  const [manualQ, setManualQ] = useState<Record<string, string>>({});
  const [manualResults, setManualResults] = useState<Record<string, DeadCandidate[]>>({});
  const [manualBusy, setManualBusy] = useState<Record<string, boolean>>({});
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const scanAbortRef = useRef<AbortController | null>(null);
  const [pathFilter, setPathFilter] = useState("");
  const [orphanUndo, setOrphanUndo] = useState(false);
  const [selectedSeqTables, setSelectedSeqTables] = useState<Set<string>>(new Set());

  useEffect(() => {
    return () => { scanAbortRef.current?.abort(); };
  }, []);

  async function runScan() {
    scanAbortRef.current?.abort();
    const ac = new AbortController();
    scanAbortRef.current = ac;
    setLoading(true);
    setMsg("");
    setScanError("");
    try {
      const r = await api.get<ScanResult>("/health/scan", { signal: ac.signal, timeoutMs: 30000 });
      if (!ac.signal.aborted) setScan(r);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const text = String(e instanceof Error ? e.message : e);
      setScanError(text);
      setMsg(text);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
      if (scanAbortRef.current === ac) scanAbortRef.current = null;
    }
  }

  async function cleanOrphans() {
    const ok = await confirm({ title: "Убрать сироты", message: "Убрать все сироты (статблоки, ссылки, доски). Можно отменить в течение сессии.", confirmLabel: "Убрать", danger: true });
    if (!ok) return;
    try {
      const r = await api.post<{ removed: number; canUndo?: boolean }>("/health/orphans/clean");
      setMsg(`Убрано сирот: ${r.removed}`);
      setOrphanUndo(!!r.canUndo);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }
  async function undoOrphans() {
    try {
      const r = await api.post<{ restored: number }>("/health/orphans/undo");
      setMsg(`Восстановлено сирот: ${r.restored}`);
      setOrphanUndo(false);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function resetSeq(table: string) {
    const ok = await confirm({ title: "Сбросить счётчик", message: `Сбросить счётчик ${table} до max(id)?`, confirmLabel: "Сбросить" });
    if (!ok) return;
    try {
      const r = await api.post<{ table: string; maxId: number | null; seq: number }>("/health/seq/reset", { table });
      setMsg(`Счётчик ${r.table} → ${r.seq} (max ${r.maxId})`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function resetSelectedSeq() {
    if (selectedSeqTables.size === 0) return;
    const tables = Array.from(selectedSeqTables);
    const ok = await confirm({ title: "Сбросить счётчики", message: `Сбросить ${tables.length} счётчик(ов) до max(id)?`, confirmLabel: `Сбросить (${tables.length})` });
    if (!ok) return;
    try {
      for (const table of tables) {
        await api.post<{ table: string; maxId: number | null; seq: number }>("/health/seq/reset", { table });
      }
      setMsg(`Сброшено ${tables.length} счётчик(ов)`);
      setSelectedSeqTables(new Set());
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function stripBroken() {
    const ok = await confirm({ title: "Убрать битые ссылки", message: "Убрать битые ссылки? Подписи останутся обычным текстом.", confirmLabel: "Убрать" });
    if (!ok) return;
    try {
      const r = await api.post<{ removed: number }>("/health/links/strip");
      setMsg(`Убрано битых ссылок: ${r.removed}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function fixDeadUidLinks() {
    const ok = await confirm({ title: "Починить мёртвые UID", message: "Починить мёртвые UID-ссылки? Ссылки будут заменены на актуальные, если цель найдена по имени. Неизвестные схлопнутся в текст.", confirmLabel: "Починить" });
    if (!ok) return;
    try {
      const r = await api.post<{ fixed: number; unresolved: number }>("/health/uid-links/fix");
      setMsg(`Починено: ${r.fixed}, неизвестных (схлопнуто в текст): ${r.unresolved}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function fixLegacy() {
    if (!scan || scan.legacyCount === 0) return;
    const ok = await confirm({ title: "Перевести наследие", message: `Перевести ${scan.legacyResolvable} legacy-ссылок на uid и схлопнуть ${scan.legacyBroken} битых?`, confirmLabel: "Перевести", danger: scan.legacyBroken > 0 });
    if (!ok) return;
    try {
      const r = await api.post<{ fixed: number; stripped: number; changed: number }>("/health/legacy-fix");
      setMsg(`Legacy: переведено ${r.fixed}, снято ${r.stripped} в ${r.changed} полях`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  const isSafeTier = (t: DeadCandidate["tier"]) => t === "exact" || t === "likely";

  async function openDeadModal() {
    setDeadBusy(true);
    try {
      const r = await api.get<{ groups: DeadGroup[] }>("/health/dead-uid-details");
      setDeadGroups(r.groups);
      const init: Record<string, number | null | undefined> = {};
      for (const g of r.groups) {
        const key = `${g.type}:${g.uid}`;
        if (g.candidates.length === 1 && isSafeTier(g.candidates[0].tier)) init[key] = g.candidates[0].id;
        else if (g.candidates.length === 0) init[key] = null;
        else init[key] = undefined;
      }
      setDeadChoices(init);
      setDeadFilter("");
      setManualQ({});
      setManualResults({});
      setManualBusy({});
      setDeadOpen(true);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setDeadBusy(false);
    }
  }

  async function handleCloseDeadModal() {
    const dirty = deadGroups ? Object.values(deadChoices).some((v) => v !== undefined) : false;
    if (dirty) {
      const ok = await confirm({ title: "Закрыть без сохранения?", message: "Выбор не сохранён. Закрыть модалку и потерять отмеченные замены?", confirmLabel: "Закрыть", danger: false });
      if (!ok) return;
    }
    setDeadOpen(false);
  }

  async function searchManual(groupKey: string, type: string, q: string) {
    const qq = q.trim();
    if (qq.length < 2) { setManualResults((p) => ({ ...p, [groupKey]: [] })); return; }
    setManualBusy((p) => ({ ...p, [groupKey]: true }));
    try {
      const r = await api.get<{ results: DeadCandidate[] }>(`/health/dead-uid-search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(qq)}&limit=20`);
      setManualResults((p) => ({ ...p, [groupKey]: r.results }));
      setDeadGroups((prev) => prev ? prev.map((g) => {
        const k = `${g.type}:${g.uid}`;
        if (k !== groupKey) return g;
        const existing = new Set(g.candidates.map((c) => c.id));
        const extra = r.results.filter((c) => !existing.has(c.id));
        if (extra.length === 0) return g;
        return { ...g, candidates: [...g.candidates, ...extra] };
      }) : prev);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setManualBusy((p) => ({ ...p, [groupKey]: false }));
    }
  }

  async function copyUid(type: string, uid: string) {
    const text = `${type}@${uid}`;
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`Скопировано: ${text.slice(0, 24)}…`);
      setTimeout(() => setMsg(""), 2000);
    } catch { setMsg(text); }
  }

  function exportDeadCsv(groups: DeadGroup[]) {
    const rows = [["type","uid","label","code","count","samples"]];
    for (const g of groups) {
      const samples = g.samples.map((s) => `${s.table}.${s.column}#${s.id} ${s.hostLabel ?? ""} ${s.hostRoute ?? ""}`.trim()).join(" | ");
      rows.push([g.type, g.uid, g.label, g.code, String(g.count), samples]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dead-uid-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`CSV выгружен: ${groups.length} групп`);
  }

  async function applyDeadFix() {
    if (!deadGroups) return;
    const fixes = deadGroups
      .map((g) => {
        const key = `${g.type}:${g.uid}`;
        const choice = deadChoices[key];
        if (choice === undefined) return null;
        return { type: g.type, uid: g.uid, newId: choice };
      })
      .filter(Boolean) as { type: string; uid: string; newId: number | null }[];
    if (fixes.length === 0) { setMsg("Ничего не выбрано"); return; }
    const needFix = fixes.filter((f) => f.newId !== null).length;
    const needStrip = fixes.filter((f) => f.newId === null).length;
    const backupHint = " Рекомендуется сделать бэкап БД перед записью (раздел «Хранилища» → «Создать бэкап»).";
    if (needStrip > 0 && needFix > 0) {
      const ok = await confirm({ title: "Применить замены?", message: `Починить ${needFix} и схлопнуть ${needStrip} ссылок в ${fixes.length} группах?${backupHint}`, confirmLabel: `Применить (${fixes.length})`, danger: needStrip > 0 });
      if (!ok) return;
    } else if (needStrip > 0) {
      const ok = await confirm({ title: "Схлопнуть в текст", message: `Схлопнуть ${needStrip} ссылок в текст (цель не выбрана)?${backupHint}`, confirmLabel: "Схлопнуть", danger: true });
      if (!ok) return;
    } else {
      const ok = await confirm({ title: "Починить ссылки", message: `Починить ${needFix} ссылок в ${fixes.length} группах?${backupHint}`, confirmLabel: `Починить (${needFix})` });
      if (!ok) return;
    }
    setDeadBusy(true);
    try {
      const r = await api.post<{ fixed: number; stripped: number; changedFields: number }>("/health/dead-uid-fix", { fixes });
      setMsg(`Мёртвые uid: починено ${r.fixed}, снято ${r.stripped} в ${r.changedFields} полях`);
      setDeadOpen(false);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setDeadBusy(false);
    }
  }

  async function relink(c: { resource_id: number; new_path: string }) {
    try {
      await api.post("/health/relink", { resource_id: c.resource_id, new_path: c.new_path });
      setMsg(`Перепривязан ${c.resource_id} → ${c.new_path}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  async function clearPath(table: string, column: string, id: number) {
    const ok = await confirm({ title: "Убрать путь", message: `Очистить ${table}.${column} #${id}? Поле станет пустым (NULL).`, confirmLabel: "Очистить" });
    if (!ok) return;
    try {
      await api.post("/health/path/clear", { table, column, id });
      setMsg(`Очищено ${table}.${column} #${id}`);
      runScan();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  const filteredPaths = useMemo(() => {
    if (!scan) return [];
    const needle = pathFilter.trim().toLowerCase();
    if (!needle) return scan.brokenPaths;
    return scan.brokenPaths.filter((b) => `${b.table}.${b.column} ${b.path}`.toLowerCase().includes(needle));
  }, [scan, pathFilter]);

  if (!userLoading && isPlayer) {
    return (
      <div className="stack health-page">
        <SectionHeading section="health">Здоровье</SectionHeading>
        <EmptyState kind="search" title="Только для мастера" hint="Этот раздел меняет базу и файлы — доступен только мастеру. Игрок видит его только как гость." />
      </div>
    );
  }

  return (
    <div className="stack health-page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <SectionHeading section="health" compact>Здоровье</SectionHeading>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button className={scan && !scanError ? "" : "primary"} onClick={runScan} disabled={loading}>
            {loading ? "Проверяю…" : "Проверить здоровье"}
          </button>
          <Link to="/storages" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--muted)", textDecoration: "underline" }}>Бэкап</Link>
          {scan && (
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(scan, null, 2));
                  setMsg("Отчёт скопирован в буфер");
                  setTimeout(() => setMsg(""), 2000);
                } catch { setMsg("Не удалось скопировать"); }
              }}
              title="Скопировать JSON-отчёт текущего скана"
            >
              Копировать отчёт
            </button>
          )}
          {msg && <span className="muted health-value" role="status" aria-live="polite">{msg}</span>}
        </div>
      </div>

      {scanError && !loading && (
        <div className="card" style={{ borderColor: "var(--danger-bg)", background: "var(--paper)" }}>
          <strong style={{ color: "var(--danger-bg)" }}>Ошибка проверки</strong>
          <p className="muted" style={{ margin: "6px 0 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{scanError}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={runScan}>Повторить</button>
          </div>
        </div>
      )}

      {/* Таббар */}
      <div className="tabs" role="tablist" aria-label="Разделы здоровья">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={activeTab === t.id ? "active" : ""}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Контент таба */}
      <div className="stack" style={{ minHeight: 120 }}>
        {/* === Автоинкрементация === */}
        {activeTab === "seq" && (
          <div className="stack">
            <p className="muted health-hint">{TAB_HINTS.seq}</p>
            {scan && scan.seq.some((r) => r.drift > 0) ? (
              <div className="stack">
                <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <label className="row" style={{ gap: 4, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={scan.seq.filter((r) => r.drift > 0).every((r) => selectedSeqTables.has(r.table))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSeqTables(new Set(scan.seq.filter((r) => r.drift > 0).map((r) => r.table)));
                        } else {
                          setSelectedSeqTables(new Set());
                        }
                      }}
                    />
                    <span style={{ fontSize: "var(--fs-meta)", fontFamily: "var(--font-ui)" }}>Выбрать всё</span>
                  </label>
                  {selectedSeqTables.size > 0 && (
                    <button onClick={resetSelectedSeq} style={{ marginLeft: 8 }}>
                      Сбросить выбранные ({selectedSeqTables.size})
                    </button>
                  )}
                </div>
                {scan.seq.filter((r) => r.drift > 0).map((r) => (
                  <div key={r.table} className="health-row">
                    <label className="row" style={{ gap: 6, alignItems: "center", cursor: "pointer", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={selectedSeqTables.has(r.table)}
                        onChange={(e) => {
                          const next = new Set(selectedSeqTables);
                          if (e.target.checked) {
                            next.add(r.table);
                          } else {
                            next.delete(r.table);
                          }
                          setSelectedSeqTables(next);
                        }}
                      />
                      <span className="health-row--mono"><span className={r.drift > 20 ? "badge tag" : "muted"}>{r.table}</span> <span className="health-value">seq {r.seq} / max {r.maxId ?? "—"} / drift {r.drift}</span></span>
                    </label>
                    <button onClick={() => resetSeq(r.table)}>Сбросить</button>
                  </div>
                ))}
              </div>
            ) : scan ? (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Дрифта нет — всё в норме.</span>
            ) : null}
          </div>
        )}

        {/* === Битые пути === */}
        {activeTab === "paths" && (
          <div className="stack">
            <p className="muted health-hint">{TAB_HINTS.paths}</p>
            {scan && scan.brokenPathsCount > 0 ? (
              <div className="stack">
                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input placeholder="Фильтр: таблица, колонка, путь…" value={pathFilter} onChange={(e) => setPathFilter(e.target.value)} style={{ flex: "1 1 220px", minWidth: 140 }} aria-label="Фильтр битых путей" />
                  <span className="muted health-value">{filteredPaths.length} / {scan.brokenPaths.length}</span>
                  {pathFilter && <button onClick={() => setPathFilter("")} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>Сброс</button>}
                </div>
                <div className="stack health-mono" style={{ maxHeight: 400, overflowY: "auto", overflowX: "hidden" }}>
                  {filteredPaths.map((b, i) => (
                    <div key={`${b.table}:${b.column}:${b.id}:${i}`} className="muted health-row">
                      <span title={b.path} className="health-path" style={{ flex: "1 1 200px", minWidth: 0 }}>{b.table}.{b.column} #{b.id}: {b.path}</span>
                      <button onClick={() => clearPath(b.table, b.column, b.id)} style={{ flex: "0 0 auto", fontSize: "var(--fs-meta)", padding: "2px 8px" }}>Очистить</button>
                    </div>
                  ))}
                  {filteredPaths.length === 0 && <span className="muted health-value">Ничего не найдено по «{pathFilter}»</span>}
                </div>
                {scan.missingFilesCount > 0 && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Пропавшие файлы ресурсов ({scan.missingFilesCount}):</strong>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {scan.missingFiles.slice(0, 50).map((f) => (
                        <li key={f.resource_id}>{f.name} — {f.file_path}</li>
                      ))}
                    </ul>
                    {scan.missingFilesCount > 50 && <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>…и ещё {scan.missingFilesCount - 50}</span>}
                    {scan.relinkCandidatesCount > 0 && (
                      <div className="stack">
                        <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Кандидаты автоперепривязки:</strong>
                        {scan.relinkCandidates.map((c) => (
                          <div key={c.resource_id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                            <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", wordBreak: "break-word", overflowWrap: "anywhere" }}>{c.name}: {c.old_path} → {c.new_path}</span>
                            <button onClick={() => relink(c)}>Перепривязать</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="muted health-hint">Если кандидата нет — перепривяжите вручную в карточке ресурса.</p>
                  </div>
                )}
              </div>
            ) : scan ? (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Битых путей нет.</span>
            ) : null}
          </div>
        )}

        {/* === Пропавшие UID === */}
        {activeTab === "uids" && (
          <div className="stack">
            <p className="muted health-hint">{TAB_HINTS.uids}</p>
            {scan ? (
              <div className="stack" style={{ gap: 16 }}>
                {/* Модули не хватает */}
                {scan.danglingModulesCount > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Модули не установлены ({scan.danglingModulesCount} ссылок):</strong>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px" }}>Поставьте модуль с этим code — ссылки оживут сами.</p>
                    <div className="stack" style={{ gap: 8 }}>
                      {scan.danglingModules.map((m) => (
                        <div key={m.code} className="stack health-group" style={{ padding: "6px 0" }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}><strong>{m.code}</strong> — «{m.label}» ×{m.count}</div>
                          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                            {(m.samples ?? []).map((s, i) => (
                              <li key={`${s.table}:${s.column}:${s.id}:${s.uid}:${i}`}>
                                {s.hostRoute ? (
                                  <Link to={s.hostRoute} style={{ color: "var(--accent)" }}>{s.hostLabel ?? `#${s.id}`}</Link>
                                ) : (
                                  <span>{s.table} #{s.id}</span>
                                )}
                                <span className="muted"> · {s.table}.{s.column} · «{s.label}» ({s.type}:{s.uid.slice(0, 8)}…)</span>
                              </li>
                            ))}
                            {m.count > (m.samples?.length ?? 0) && (
                              <li className="muted">…и ещё {m.count - (m.samples?.length ?? 0)} в этом модуле</li>
                            )}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Мёртвые UID внутри модулей */}
                {scan.deadUidMentionsCount > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>UID не найден в базе ({scan.deadUidMentionsCount} ссылок):</strong>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px" }}>Можно починить автоматически по имени.</p>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {scan.deadUidMentions.slice(0, 20).map((m, i) => (
                        <li key={i}>
                          {m.hostRoute ? (
                            <Link to={m.hostRoute} style={{ color: "var(--accent)" }}>{m.hostLabel ?? `#${m.id}`}</Link>
                          ) : (
                            <span>{m.table} #{m.id}</span>
                          )}
                          <span> · {m.table}.{m.column} — «{m.label}» ({m.code}: {m.uid.slice(0, 8)}…)</span>
                        </li>
                      ))}
                    </ul>
                    {scan.deadUidMentionsCount > 20 && <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>…и ещё {scan.deadUidMentionsCount - 20}</span>}
                    <div className="row" style={{ gap: 8 }}>
                      <button onClick={fixDeadUidLinks}>Авто-починка ({scan.deadUidMentionsCount})</button>
                      <button onClick={openDeadModal} disabled={deadBusy}>{deadBusy ? "Загружаю…" : `Проверить вручную (${scan.deadUidMentionsCount})`}</button>
                    </div>
                  </div>
                )}

                {/* Битые ссылки */}
                {scan.brokenLinksCount > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Битые ссылки в текстах ({scan.brokenLinks.count}):</strong>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px" }}>Зачёркнутая ждёт модуля и оживает сама; битая — цель удалена навсегда. Уборка схлопывает в текст.</p>
                    <p className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {scan.brokenLinks.samples.map((s) => `${s.type} «${s.label}»`).join(", ")}{scan.brokenLinks.count > scan.brokenLinks.samples.length ? " и другие" : ""}
                    </p>
                    <div className="row">
                      <button onClick={stripBroken}>Убрать, оставить текст ({scan.brokenLinks.count})</button>
                    </div>
                  </div>
                )}

                {/* Legacy */}
                {scan.legacyCount > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Наследие id→uid ({scan.legacyCount}):</strong>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px" }}>Детерминированная конвертация: id ищется в своей таблице. Resolvable → uid, иначе — схлопнется в текст.{scan.legacyTruncated ? ` Показано 100 из ${scan.legacyCount}.` : ""}</p>
                    <p className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      На uid: {scan.legacyResolvable} · битых: {scan.legacyBroken}
                    </p>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {scan.legacy.entries.slice(0, 12).map((e, i) => (
                        <li key={`${e.table}:${e.column}:${e.hostId}:${e.type}:${e.id}:${i}`}>
                          {e.hostRoute ? <Link to={e.hostRoute} style={{ color: "var(--accent)" }}>{e.hostLabel ?? `#${e.hostId}`}</Link> : <span>{e.table} #{e.hostId}</span>}
                          <span> · {e.table}.{e.column} — [[{e.type}:{e.id}|{e.label}]] → {e.resolvable ? e.preview : `«${e.label}» (битая)`}</span>
                        </li>
                      ))}
                    </ul>
                    {scan.legacyCount > 12 && <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>…и ещё {scan.legacyCount - 12}</span>}
                    <div className="row">
                      <button onClick={fixLegacy}>Перевести на uid ({scan.legacyResolvable}) / снять битые ({scan.legacyBroken})</button>
                    </div>
                  </div>
                )}

                {scan.danglingModulesCount === 0 && scan.deadUidMentionsCount === 0 && scan.brokenLinksCount === 0 && scan.legacyCount === 0 && (
                  <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Потерь нет — все ссылки в порядке.</span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* === Имена === */}
        {activeTab === "names" && (
          <div className="stack">
            <p className="muted health-hint">{TAB_HINTS.names}</p>
            {scan && scan.bracketNamesCount > 0 ? (
              <div className="stack">
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                  {scan.bracketNames.map((b) => (
                    <li key={b.table}>{b.table}: {b.count} — напр. «{b.sample}»</li>
                  ))}
                </ul>
              </div>
            ) : scan ? (
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Имена чистые.</span>
            ) : null}
          </div>
        )}

        {/* === Файлы-сироты === */}
        {activeTab === "orphanFiles" && (
          <div className="stack">
            <p className="muted health-hint">{TAB_HINTS.orphanFiles}</p>
            {scan ? (
              <div className="stack" style={{ gap: 16 }}>
                {/* Сироты-строки */}
                {scan.orphansTotal > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Сироты в БД ({scan.orphansTotal}):</strong>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px" }}>statblocks / generic_links / entity_relations / canvas_boards. Считаются без удаления; чистка — кнопкой.</p>
                    <p className="muted health-hint" style={{ margin: "2px 0 4px", fontSize: "var(--fs-meta)" }}>Перед удалением: <Link to="/storages" style={{ color: "var(--accent)" }}>сделайте бэкап</Link> — можно отменить в этой сессии.</p>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {Object.entries(scan.orphans).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
                    </ul>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <button className="danger" onClick={cleanOrphans}>Убрать сирот ({scan.orphansTotal})</button>
                      {orphanUndo && <button onClick={undoOrphans}>Отменить удаление</button>}
                    </div>
                  </div>
                )}

                {/* Файлы-сироты на диске */}
                {scan.orphanFilesCount > 0 && (
                  <div className="stack">
                    <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Файлы на диске без записи в БД ({scan.orphanFilesCount}) · {(scan.orphanFiles.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} КБ:</strong>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                      {scan.orphanFiles.slice(0, 8).map((f) => (
                        <li key={f.path}>{f.path.split(/[/\\]/).pop()} — {(f.size / 1024).toFixed(1)} КБ</li>
                      ))}
                    </ul>
                    {scan.orphanFiles.length > 8 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>…и ещё {scan.orphanFiles.length - 8}</span>}
                    <div className="row">
                      <button className="primary" onClick={() => setOrphanOpen(true)}>Переназначить вручную ({scan.orphanFiles.length})</button>
                    </div>
                  </div>
                )}

                {scan.orphansTotal === 0 && scan.orphanFilesCount === 0 && (
                  <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сирот нет.</span>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {confirmDialog}
      {deadOpen && deadGroups && (() => {
        const needle = deadFilter.trim().toLowerCase();
        const filtered = !needle ? deadGroups : deadGroups.filter((g) => `${g.type} ${g.label} ${g.code} ${g.uid}`.toLowerCase().includes(needle));
        const total = deadGroups.reduce((a, g) => a + g.count, 0);
        const selCount = Object.values(deadChoices).filter((v) => v !== undefined).length;
        const fixCount = Object.values(deadChoices).filter((v) => v !== undefined && v !== null).length;
        const stripCount = Object.values(deadChoices).filter((v) => v === null).length;
        return (
        <Modal onClose={handleCloseDeadModal} closeOnBackdropClick={false}>
          <div className="dead-uid-modal">
            <div className="dead-uid-modal__head">
              <span className="dead-uid-modal__title">Мёртвые UID — ручная проверка<span className="dead-uid-modal__title-count">{deadGroups.length} групп · {total} ссылок</span></span>
              <button onClick={handleCloseDeadModal} aria-label="Закрыть" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "4px 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: "0.06em", textTransform: "uppercase" }}>✕</button>
            </div>
            <p className="dead-uid-modal__hint">«— пропустить —» не трогает, «схлопнуть» оставляет текст «label». Авто-выбор — только единственный <span style={{ color: "#15803d", fontWeight: 600 }}>exact</span>/<span style={{ color: "#a16207", fontWeight: 600 }}>likely</span>; <span style={{ color: "#dc2626", fontWeight: 600 }}>doubtful</span> требует ручной проверки.</p>
            <div className="dead-uid-modal__filter">
              <input placeholder="Фильтр: тип, имя, код, uid…" value={deadFilter} onChange={(e) => setDeadFilter(e.target.value)} aria-label="Фильтр групп" />
              <span className="dead-uid-modal__filter-count">{filtered.length} / {deadGroups.length}</span>
              {deadFilter && <button onClick={() => setDeadFilter("")} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>Сброс</button>}
              <button onClick={() => exportDeadCsv(filtered)} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", marginLeft: "auto" }}>CSV</button>
            </div>
            <div className="dead-uid-modal__body">
              {filtered.length === 0 && <div className="muted" style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", padding: "12px 0" }}>Ничего не найдено по «{deadFilter}».</div>}
              {filtered.map((g) => {
                const key = `${g.type}:${g.uid}`;
                const choice = deadChoices[key];
                const chosen = choice != null ? g.candidates.find((c) => c.id === choice) ?? (manualResults[key] ?? []).find((c) => c.id === choice) : null;
                const showSamples = g.samples;
                return (
                  <div key={key} className="health-group health-group--pad12">
                    <div className="dead-uid-group__head">
                      <span className="dead-uid-group__type">{g.type}@{g.uid.slice(0, 8)}…</span>
                      <span className="dead-uid-group__label">«{g.label}»</span>
                      <span className="dead-uid-group__meta">({g.code || "unknown"})</span>
                      <span className="dead-uid-group__count">×{g.count}</span>
                      <button onClick={() => copyUid(g.type, g.uid)} title="Копировать type@uid" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", padding: "2px 6px", border: "1px solid var(--line)", background: "var(--paper)", marginLeft: 4 }}>копировать</button>
                    </div>
                    <div className="dead-uid-group__samples">
                      Встречается ({showSamples.length}{g.count > showSamples.length ? ` из ${g.count}` : ""}):
                      <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
                        {showSamples.map((s, idx) => (
                          <li key={`${s.table}:${s.column}:${s.id}:${idx}`}>
                            {s.hostRoute ? <Link to={s.hostRoute} style={{ color: "var(--accent)" }}>{s.hostLabel ?? `#${s.id}`}</Link> : <span>{s.table} #{s.id}</span>}
                            <span className="muted"> · {s.table}.{s.column}</span>
                          </li>
                        ))}
                      </ul>
                      {g.count > showSamples.length && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>…и ещё {g.count - showSamples.length} вхождений</span>}
                    </div>
                    <label className="dead-uid-group__controls">
                      <span className="dead-uid-group__label-cap">Заменить на:</span>
                      <select
                        className="dead-uid-group__select"
                        value={choice === null ? "__strip" : choice === undefined ? "__skip" : String(choice)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDeadChoices((prev) => ({ ...prev, [key]: v === "__skip" ? undefined : v === "__strip" ? null : Number(v) }));
                        }}
                        aria-label={`Заменить ${g.label} на`}
                      >
                        <option value="__skip">— пропустить —</option>
                        <option value="__strip">схлопнуть в текст «{g.label}»</option>
                        {g.candidates.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name} [{c.tier}/{c.via}] — {c.source || "—"} · {c.prefix}
                          </option>
                        ))}
                      </select>
                    </label>
                    {g.candidates.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {g.candidates.slice(0, 3).map((c) => (
                          <span key={c.id} className={`dead-uid-tier__badge dead-uid-tier__badge--${c.tier}`} title={`${c.tier}: ${c.via}`}>{c.tier}/{c.via}</span>
                        ))}
                      </div>
                    )}
                    {chosen && (
                      <div className="dead-uid-diff">→ [[{g.type}@{chosen.prefix}|{chosen.source}|{g.label}]] <span className="muted">· {chosen.name}</span></div>
                    )}
                    {choice === null && (
                      <div className="dead-uid-diff">→ {g.label} <span className="muted">(схлопнется в текст)</span></div>
                    )}
                    {g.candidates.length === 0 && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Кандидатов не найдено — предлагается схлопнуть или найти вручную ниже</span>}
                    <div className="dead-uid-search">
                      <input
                        placeholder="Найти вручную (≥2 символа)…"
                        value={manualQ[key] ?? ""}
                        onChange={(e) => setManualQ((p) => ({ ...p, [key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") searchManual(key, g.type, manualQ[key] ?? ""); }}
                        aria-label={`Поиск для ${g.label}`}
                      />
                      <button onClick={() => searchManual(key, g.type, manualQ[key] ?? "")} disabled={manualBusy[key] || (manualQ[key] ?? "").trim().length < 2}>
                        {manualBusy[key] ? "…" : "Найти"}
                      </button>
                    </div>
                    {(manualResults[key]?.length ?? 0) > 0 && (
                      <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>Найдено: {manualResults[key]!.length} — уже в списке</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="dead-uid-modal__foot">
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    const all: Record<string, number | null | undefined> = {};
                    for (const g of deadGroups) {
                      const key = `${g.type}:${g.uid}`;
                      if (g.candidates.length === 1 && isSafeTier(g.candidates[0].tier)) all[key] = g.candidates[0].id;
                      else all[key] = undefined;
                    }
                    setDeadChoices(all);
                  }}
                >
                  Только однозначные
                </button>
                <button
                  onClick={() => {
                    const all: Record<string, number | null | undefined> = {};
                    for (const g of deadGroups) {
                      const key = `${g.type}:${g.uid}`;
                      const safe = g.candidates.find((c) => isSafeTier(c.tier));
                      if (safe) all[key] = safe.id;
                      else if (g.candidates.length === 0) all[key] = null;
                      else all[key] = undefined;
                    }
                    setDeadChoices(all);
                  }}
                >
                  Все безопасные
                </button>
                <button
                  onClick={() => {
                    const all: Record<string, number | null | undefined> = {};
                    for (const g of deadGroups) all[`${g.type}:${g.uid}`] = undefined;
                    setDeadChoices(all);
                  }}
                >
                  Сбросить
                </button>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={handleCloseDeadModal}>Отмена</button>
                <button className="primary" onClick={applyDeadFix} disabled={deadBusy || selCount===0}>
                  {deadBusy ? "Записываю…" : `Применить (${selCount}${selCount ? ` · ${fixCount}→uid + ${stripCount}→текст` : ""})`}
                </button>
              </div>
            </div>
          </div>
        </Modal>
        );
      })()}
      {orphanOpen && scan && <OrphanBrowserModal files={scan.orphanFiles} onClose={() => setOrphanOpen(false)} onDone={runScan} />}
    </div>
  );
}
