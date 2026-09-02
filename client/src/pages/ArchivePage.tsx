import { useEffect, useMemo, useState } from "react";
import { api, getAuthToken } from "../api/client";
import { refreshMentionIndex } from "../mentions";
import { NavIcon } from "../components/NavIcons";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import type { ArchiveItem, ArchivedFile } from "../types";

const RESTORE_ENDPOINTS: Record<string, string> = {
  campaign: "/campaigns",
  system: "/systems",
  setting: "/settings",
  player: "/players",
  character: "/characters",
  session: "/sessions",
  resource: "/resources",
  mastering: "/mastering",
  location: "/setting-locations",
  being: "/setting-beings",
  artifact: "/artifacts",
  community: "/setting-communities",
  canvas_board: "/canvas/free-boards",
};

// Тип в строке архива подписан по-русски. До этого печатался идентификатор
// (`setting`, `mastering`), и добавление доски дало бы в этом столбце ещё одну
// английскую строку — `canvas_board`. Запасной вариант — сам идентификатор:
// новый тип лучше показать сырым, чем не показать вовсе.
const TYPE_LABELS: Record<string, string> = {
  campaign: "кампания",
  system: "система",
  setting: "сеттинг",
  player: "игрок",
  character: "персонаж",
  session: "сессия",
  resource: "ресурс",
  mastering: "мастерение",
  location: "локация",
  being: "существо",
  artifact: "артефакт",
  community: "сообщество",
  canvas_board: "доска",
};

const TABS = ["Сущности", "Файлы"] as const;

// Что необратимо оборвётся вместе с сущностью (server/src/routes/archive.ts).
// Кампании перечисляются поимённо: сводное «5 кампаний» не даёт понять, что
// среди них та, которую ведут в эту субботу.
interface PurgeImpact {
  detachedCampaigns: string[];
  compendiumLinks: number;
  baseMonsters: number;
  resources: number;
  characters: number;
  masteringNotes: number;
  modules: number;
  settingChildren?: { locations: number; beings: number; communities: number; artifacts: number; arcs: number; scenes: number };
  campaignChildren?: { sessions: number; characters: number; roster: number };
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  if (mod10 === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

function impactLines(impact: PurgeImpact | null): string[] {
  if (!impact) return [];
  const lines: string[] = [];
  if (impact.detachedCampaigns.length > 0) {
    lines.push(
      `Останутся без системы: ${impact.detachedCampaigns.join(", ")}. Систему им придётся выбрать заново.`
    );
  }
  const severed: string[] = [];
  if (impact.compendiumLinks > 0)
    severed.push(plural(impact.compendiumLinks, "связь", "связи", "связей") + " со справочником и бестиарием");
  if (impact.baseMonsters > 0)
    severed.push(plural(impact.baseMonsters, "досье", "досье", "досье") + " существ потеряют базовый статблок");
  if (impact.characters > 0)
    severed.push(plural(impact.characters, "персонаж", "персонажа", "персонажей") + " останутся без системы");
  if (impact.resources > 0)
    severed.push(plural(impact.resources, "ресурс", "ресурса", "ресурсов") + " потеряют привязку");
  if (impact.masteringNotes > 0)
    severed.push(plural(impact.masteringNotes, "заметка", "заметки", "заметок") + " мастерения потеряют привязку");
  if (impact.modules > 0)
    severed.push(plural(impact.modules, "модуль", "модуля", "модулей") + " будет удалён");
  if (severed.length > 0) lines.push(`Будет разорвано: ${severed.join("; ")}.`);
  if (impact.settingChildren) {
    const sc = impact.settingChildren;
    const parts: string[] = [];
    if (sc.locations) parts.push(plural(sc.locations, "локация", "локации", "локаций"));
    if (sc.beings) parts.push(plural(sc.beings, "существо", "существа", "существ"));
    if (sc.communities) parts.push(plural(sc.communities, "сообщество", "сообщества", "сообществ"));
    if (sc.artifacts) parts.push(plural(sc.artifacts, "артефакт", "артефакта", "артефактов"));
    if (sc.arcs) parts.push(plural(sc.arcs, "приключение", "приключения", "приключений"));
    if (sc.scenes) parts.push(plural(sc.scenes, "сцена", "сцены", "сцен"));
    if (parts.length) lines.push(`Уйдёт каскадом вместе с сеттингом: ${parts.join(", ")}.`);
  }
  if (impact.campaignChildren) {
    const cc = impact.campaignChildren;
    const parts: string[] = [];
    if (cc.sessions) parts.push(plural(cc.sessions, "сессия", "сессии", "сессий"));
    if (cc.characters) parts.push(plural(cc.characters, "персонаж", "персонажа", "персонажей"));
    if (cc.roster) parts.push(plural(cc.roster, "участник", "участника", "участников") + " ростера");
    if (parts.length) lines.push(`Уйдёт каскадом вместе с кампанией: ${parts.join(", ")}.`);
  }
  return lines;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatArchivedAt(iso: string): string {
  const norm = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function timeAgo(iso: string): string {
  const norm = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} дн назад`;
  if (days < 30) return `${Math.floor(days / 7)} нед назад`;
  if (days < 365) return `${Math.floor(days / 30)} мес назад`;
  return `${Math.floor(days / 365)} г назад`;
}

function isImageName(name: string): boolean {
  return /\.(jpe?g|png|gif|webp)$/i.test(name.split("?")[0]);
}

function archivedFileUrl(file: ArchivedFile): string {
  const rel = file.archive_path.replace(/\\/g, "/");
  const base = `/files/${rel.replace(/^\/+/, "")}`;
  const token = getAuthToken();
  if (!token) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

type SortKey = "date" | "name" | "type";

function itemKey(it: ArchiveItem): string {
  return `${it.type}-${it.id}`;
}
function fileKey(f: ArchivedFile): string {
  return `file-${f.id}`;
}

export function ArchivePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Сущности");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [files, setFiles] = useState<ArchivedFile[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState<null | "entities" | "files">(null);
  const [purgeTarget, setPurgeTarget] = useState<{ item: ArchiveItem; impact: PurgeImpact | null } | null>(null);
  const [purgeImpactLoading, setPurgeImpactLoading] = useState(false);
  const [filePurgeTarget, setFilePurgeTarget] = useState<ArchivedFile | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<null | { kind: "restore" | "purge-entities" | "purge-files" }>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<ArchiveItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);
  const [visible, setVisible] = useState(50);
  const [visibleFiles, setVisibleFiles] = useState(50);

  // Фокус — на первый чекбокс/кнопку после удаления/восстановления, чтобы Tab не терялся в body
  function focusFirstRow() {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(".archive-row__check, .archive-card__head-check input, .archive-bulk-bar button");
      el?.focus();
    });
  }

  function showToast(msg: string, onUndo?: () => void) {
    setToast({ msg, onUndo });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 5000);
  }

  function refresh() {
    setLoading(true);
    setLoadError(null);
    Promise.all([api.get<ArchiveItem[]>("/archive"), api.get<ArchivedFile[]>("/archived-files")])
      .then(([a, f]) => { setItems(a); setFiles(f); })
      .catch((e) => setLoadError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }
  useEffect(refresh, []);

  const filtered = useMemo(() => {
    let out = [...items];
    if (typeFilter !== "all") out = out.filter((it) => it.type === typeFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter((it) => {
        const hay = `${TYPE_LABELS[it.type] ?? it.type} ${it.title} ${it.subtitle ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    out.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.title.localeCompare(b.title, "ru");
      else if (sortBy === "type") cmp = (TYPE_LABELS[a.type] ?? a.type).localeCompare(TYPE_LABELS[b.type] ?? b.type, "ru");
      else cmp = a.archived_at < b.archived_at ? -1 : a.archived_at > b.archived_at ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [items, q, typeFilter, sortBy, sortDir]);

  const filteredFiles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((f) => `${TYPE_LABELS[f.original_owner_type] ?? f.original_owner_type} ${f.original_name}`.toLowerCase().includes(needle));
  }, [files, q]);

  // Сброс выбора при смене таба/фильтра — иначе в наборе повиснут скрытые
  useEffect(() => {
    setSelected(new Set());
  }, [tab, q, typeFilter]);

  // Пагинация — виртуализация без зависимостей: показываем по 50, «ещё» догружает. Сброс при смене фильтра.
  useEffect(() => { setVisible(50); }, [q, typeFilter, sortBy, sortDir, tab]);
  useEffect(() => { setVisibleFiles(50); }, [q, tab]);
  const visibleItems = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const visibleFilesList = useMemo(() => filteredFiles.slice(0, visibleFiles), [filteredFiles, visibleFiles]);

  const selectedFilteredItems = useMemo(() => filtered.filter((it) => selected.has(itemKey(it))), [filtered, selected]);
  const selectedFilteredFiles = useMemo(() => filteredFiles.filter((f) => selected.has(fileKey(f))), [filteredFiles, selected]);
  const allFilteredSelected = tab === "Сущности"
    ? filtered.length > 0 && filtered.every((it) => selected.has(itemKey(it)))
    : filteredFiles.length > 0 && filteredFiles.every((f) => selected.has(fileKey(f)));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAllFiltered() {
    if (tab === "Сущности") {
      if (allFilteredSelected) {
        setSelected((prev) => {
          const next = new Set(prev);
          filtered.forEach((it) => next.delete(itemKey(it)));
          return next;
        });
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          filtered.forEach((it) => next.add(itemKey(it)));
          return next;
        });
      }
    } else {
      if (allFilteredSelected) {
        setSelected((prev) => {
          const next = new Set(prev);
          filteredFiles.forEach((f) => next.delete(fileKey(f)));
          return next;
        });
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          filteredFiles.forEach((f) => next.add(fileKey(f)));
          return next;
        });
      }
    }
  }

  async function archiveAgain(item: ArchiveItem) {
    const base = RESTORE_ENDPOINTS[item.type];
    if (!base) return;
    try {
      await api.del(`${base}/${item.id}`);
    } catch (e) {
      setErrorMsg(`Не удалось вернуть в архив: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    refresh();
  }

  async function restore(item: ArchiveItem) {
    const base = RESTORE_ENDPOINTS[item.type];
    if (!base) { setErrorMsg(`Нет маршрута восстановления для ${item.type}`); return; }
    try {
      await api.put(`${base}/${item.id}/restore`);
    } catch (e) {
      setErrorMsg(`Не удалось восстановить: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    showToast(`Восстановлено «${item.title}»`, () => void archiveAgain(item));
    focusFirstRow();
    refresh();
  }

  function openPurge(item: ArchiveItem) {
    setPurgeTarget({ item, impact: null });
    setPurgeImpactLoading(true);
    api.get<PurgeImpact>(`/archive/${item.type}/${item.id}/impact`)
      .then((imp) => setPurgeTarget((prev) => (prev && prev.item === item ? { item, impact: imp } : prev)))
      .catch(() => setPurgeTarget({ item, impact: null }))
      .finally(() => setPurgeImpactLoading(false));
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await api.del(`/archive/${purgeTarget.item.type}/${purgeTarget.item.id}`);
    } catch (e) {
      setErrorMsg(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      return;
    }
    setBusy(false);
    setPurgeTarget(null);
    showToast(`Удалено «${purgeTarget.item.title}»`);
    focusFirstRow();
    void refreshMentionIndex();
    refresh();
  }

  function openFilePurge(file: ArchivedFile) {
    setFilePurgeTarget(file);
  }

  async function confirmFilePurge() {
    if (!filePurgeTarget) return;
    setBusy(true);
    try {
      await api.del(`/archived-files/${filePurgeTarget.id}`);
    } catch (e) {
      setErrorMsg(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      return;
    }
    setBusy(false);
    setFilePurgeTarget(null);
    showToast(`Файл «${filePurgeTarget.original_name}» удалён`);
    focusFirstRow();
    refresh();
  }

  async function bulkRestore() {
    if (selectedFilteredItems.length === 0) return;
    const snapshot = [...selectedFilteredItems];
    setBusy(true);
    const results = await Promise.allSettled(snapshot.map((it) => {
      const base = RESTORE_ENDPOINTS[it.type];
      if (!base) return Promise.reject(new Error(`нет маршрута для ${it.type}`));
      return api.put(`${base}/${it.id}/restore`);
    }));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) setErrorMsg(`Не удалось восстановить ${fails.length} из ${results.length}: ${String(fails[0].reason)}`);
    else showToast(`Восстановлено ${snapshot.length} записей`, () => {
      void Promise.allSettled(snapshot.map((it) => {
        const base = RESTORE_ENDPOINTS[it.type];
        if (!base) return Promise.resolve();
        return api.del(`${base}/${it.id}`).catch(() => {});
      })).then(() => refresh());
    });
    setBulkConfirm(null);
    setSelected(new Set());
    focusFirstRow();
    refresh();
  }

  async function bulkPurge() {
    if (selectedFilteredItems.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(selectedFilteredItems.map((it) => api.del(`/archive/${it.type}/${it.id}`)));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) setErrorMsg(`Не удалось удалить ${fails.length} из ${results.length}: ${String(fails[0].reason)}`);
    else showToast(`Удалено ${selectedFilteredItems.length} записей`);
    setBulkConfirm(null);
    setSelected(new Set());
    focusFirstRow();
    void refreshMentionIndex();
    refresh();
  }

  async function bulkPurgeFiles() {
    if (selectedFilteredFiles.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(selectedFilteredFiles.map((f) => api.del(`/archived-files/${f.id}`)));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) setErrorMsg(`Не удалось удалить ${fails.length}: ${String(fails[0].reason)}`);
    else showToast(`Удалено ${selectedFilteredFiles.length} файлов`);
    setBulkConfirm(null);
    setSelected(new Set());
    focusFirstRow();
    refresh();
  }

  async function clearAll() {
    if (clearOpen === "entities") {
      const targets = filtered.length > 0 ? filtered : items;
      if (targets.length === 0) { setClearOpen(null); return; }
      setBusy(true);
      await Promise.allSettled(targets.map((it) => api.del(`/archive/${it.type}/${it.id}`)));
      setBusy(false);
      showToast(`Очищено ${targets.length} записей`);
      focusFirstRow();
      void refreshMentionIndex();
      setClearOpen(null);
      setSelected(new Set());
      refresh();
    } else if (clearOpen === "files") {
      const targets = filteredFiles.length > 0 ? filteredFiles : files;
      if (targets.length === 0) { setClearOpen(null); return; }
      setBusy(true);
      await Promise.allSettled(targets.map((f) => api.del(`/archived-files/${f.id}`)));
      setBusy(false);
      showToast(`Очищено ${targets.length} файлов`);
      focusFirstRow();
      setClearOpen(null);
      setSelected(new Set());
      refresh();
    }
  }

  async function openArchiveFolder() {
    await api.get("/archived-files/open-folder");
  }

  return (
    <div className="stack">
      <SectionHeading section="archive" compact>Архив</SectionHeading>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
            <span className="archive-tab-count">{t === "Сущности" ? items.length : files.length}</span>
          </button>
        ))}
      </div>

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--danger-bg)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить архив: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}
      {errorMsg && (
        <div className="card" style={{ borderLeft: "3px solid var(--danger-bg)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ whiteSpace: "pre-wrap" }}>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)}>×</button>
        </div>
      )}
      {loading && items.length === 0 && files.length === 0 && !loadError && (
        <div className="card" style={{ padding: 16, opacity: 0.6 }} aria-busy="true">Загрузка архива…</div>
      )}

      {tab === "Сущности" && (
        <>
          {items.length === 0 ? (
            <EmptyState
              icon="barcode"
              title="АРХИВ ПУСТ"
              hint="Архивированные сущности появятся здесь — они не видны в основных разделах, но вернутся одной кнопкой «Восстановить»."
            />
          ) : (
            <>
              <div className="archive-toolbar">
                <div className="archive-toolbar__search">
                  <input
                    type="search"
                    placeholder="Поиск по имени…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="archive-toolbar__select"
                  aria-label="Фильтр по типу"
                >
                  <option value="all">Все типы</option>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <div className="seg archive-toolbar__seg" role="group" aria-label="Сортировка">
                  <button className={sortBy === "date" ? "is-active" : ""} onClick={() => { setSortBy("date"); setSortDir((d) => (sortBy === "date" ? (d === "desc" ? "asc" : "desc") : "desc")); }}>
                    Дата {sortBy === "date" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                  </button>
                  <button className={sortBy === "name" ? "is-active" : ""} onClick={() => { setSortBy("name"); setSortDir((d) => (sortBy === "name" && d === "asc" ? "desc" : "asc")); }}>
                    Имя {sortBy === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button className={sortBy === "type" ? "is-active" : ""} onClick={() => { setSortBy("type"); setSortDir((d) => (sortBy === "type" && d === "asc" ? "desc" : "asc")); }}>
                    Тип {sortBy === "type" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </div>
                <button className="danger" onClick={() => setClearOpen("entities")} title="Удалить все отфильтрованные сущности навсегда">
                  Очистить
                </button>
              </div>
              {filtered.length === 0 ? (
                <div className="card" style={{ padding: 16 }}>
                  <p className="muted">Ничего не найдено по запросу «{q}»{typeFilter !== "all" ? ` в типе «${TYPE_LABELS[typeFilter] ?? typeFilter}»` : ""}.</p>
                  <button onClick={() => { setQ(""); setTypeFilter("all"); }}>Сбросить фильтры</button>
                </div>
              ) : (
                <div className="card archive-card">
                  <div className="archive-card__head">
                    <label className="archive-card__head-check">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                      <span>Выбрать все</span>
                    </label>
                    <span className="archive-card__head-title">Сущности в архиве</span>
                    <span className="archive-card__head-count">
                      {filtered.length === items.length ? `${items.length} шт.` : `${filtered.length} из ${items.length}`}
                    </span>
                  </div>
                  <div className="archive-list">
                    {visibleItems.map((item) => {
                      const key = itemKey(item);
                      const checked = selected.has(key);
                      return (
                        <div key={key} className={`archive-row2 ${checked ? "is-selected" : ""}`} onClick={() => setPreviewItem(item)} style={{ cursor: "pointer" }} title="Нажмите для предпросмотра">
                          <input type="checkbox" className="archive-row__check" checked={checked} onChange={(e) => { e.stopPropagation(); toggle(key); }} onClick={(e) => e.stopPropagation()} aria-label={`Выбрать ${item.title}`} />
                          <span className="archive-row__type">{TYPE_LABELS[item.type] ?? item.type}</span>
                          <span className="archive-row__title">
                            {item.title}
                            {item.subtitle && <span className="archive-row__subtitle"> · {item.subtitle}</span>}
                          </span>
                          <span className="archive-row__meta" title={timeAgo(item.archived_at)}>
                            {formatArchivedAt(item.archived_at)}
                          </span>
                          <div className="archive-row__actions" onClick={(e) => e.stopPropagation()}>
                            <button className="archive-row__act archive-row__act--restore" onClick={() => restore(item)} disabled={busy}>
                              Восстановить
                            </button>
                            <button className="danger archive-row__act archive-row__act--danger" onClick={() => openPurge(item)} disabled={busy}>
                              Удалить навсегда
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {filtered.length > visible && (
                    <div className="archive-more">
                      <button onClick={() => setVisible((v) => v + 50)}>
                        Показать ещё {Math.min(50, filtered.length - visible)} из {filtered.length - visible}
                      </button>
                      <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Показано {visible} из {filtered.length}</span>
                    </div>
                  )}
                </div>
              )}
              {selectedFilteredItems.length > 0 && (
                <div className="archive-bulk-bar">
                  <span className="archive-bulk-bar__count">Выбрано {selectedFilteredItems.length}</span>
                  <div className="archive-bulk-bar__actions">
                    <button className="primary" onClick={() => setBulkConfirm({ kind: "restore" })} disabled={busy}>
                      Восстановить выбранные
                    </button>
                    <button className="danger" onClick={() => setBulkConfirm({ kind: "purge-entities" })} disabled={busy}>
                      Удалить выбранные
                    </button>
                    <button onClick={() => setSelected(new Set())}>Снять выбор</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "Файлы" && (
        <>
          <div className="row">
            <button onClick={openArchiveFolder}>
              <NavIcon name="folder" /> Открыть папку архива
            </button>
            {files.length > 0 && (
              <button className="danger" onClick={() => setClearOpen("files")}>Очистить файлы</button>
            )}
          </div>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            Отдельные файлы, удалённые из последнего места использования с выбором «отправить в
            архив» вместо «удалить навсегда».
          </p>
          {files.length > 0 && (
            <div className="archive-toolbar">
              <div className="archive-toolbar__search">
                <input type="search" placeholder="Поиск по имени файла…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          )}
          {files.length === 0 ? (
            <EmptyState
              icon="barcode"
              title="ФАЙЛОВ В АРХИВЕ НЕТ"
              hint="Сюда попадают только файлы, у которых вы выбрали «отправить в архив» при удалении последней копии."
            />
          ) : filteredFiles.length === 0 ? (
            <div className="card" style={{ padding: 16 }}>
              <p className="muted">Ничего не найдено по запросу «{q}».</p>
              <button onClick={() => setQ("")}>Сбросить</button>
            </div>
          ) : (
            <>
              <div className="card archive-card">
                <div className="archive-card__head">
                  <label className="archive-card__head-check">
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                    <span>Выбрать все</span>
                  </label>
                  <span className="archive-card__head-title">Файлы в архиве</span>
                  <span className="archive-card__head-count">
                    {filteredFiles.length === files.length ? `${files.length} шт.` : `${filteredFiles.length} из ${files.length}`}
                  </span>
                </div>
                <div className="archive-list">
                  {visibleFilesList.map((file) => {
                    const key = fileKey(file);
                    const checked = selected.has(key);
                    const img = isImageName(file.original_name);
                    return (
                      <div key={file.id} className={`archive-row2 ${checked ? "is-selected" : ""}`}>
                        <input type="checkbox" className="archive-row__check" checked={checked} onChange={() => toggle(key)} aria-label={`Выбрать ${file.original_name}`} />
                        <span className="archive-row__thumb">
                          {img ? (
                            <img src={archivedFileUrl(file)} alt="" className="archive-row__thumb-img" loading="lazy" />
                          ) : (
                            <NavIcon name={file.original_name.endsWith(".pdf") ? "document" : "image"} />
                          )}
                        </span>
                        <span className="archive-row__type">{TYPE_LABELS[file.original_owner_type] ?? file.original_owner_type}</span>
                        <span className="archive-row__title" title={file.archive_path}>{file.original_name}</span>
                        <span className="archive-row__meta">{formatSize(file.size)}</span>
                        <span className="archive-row__meta" title={timeAgo(file.archived_at)}>
                          {formatArchivedAt(file.archived_at)}
                        </span>
                        <div className="archive-row__actions">
                          <a className="archive-row__act" href={archivedFileUrl(file)} target="_blank" rel="noreferrer" download={file.original_name}>
                            Скачать
                          </a>
                          <button onClick={() => { navigator.clipboard?.writeText(file.archive_path).catch(() => {}); }} title={file.archive_path}>
                            Копировать путь
                          </button>
                          <button className="danger archive-row__act archive-row__act--danger" onClick={() => openFilePurge(file)} disabled={busy}>
                            Удалить навсегда
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                  {filteredFiles.length > visibleFiles && (
                    <div className="archive-more">
                      <button onClick={() => setVisibleFiles((v) => v + 50)}>Показать ещё {Math.min(50, filteredFiles.length - visibleFiles)}</button>
                      <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Показано {visibleFiles} из {filteredFiles.length}</span>
                    </div>
                  )}
              </div>
              {selectedFilteredFiles.length > 0 && (
                <div className="archive-bulk-bar">
                  <span className="archive-bulk-bar__count">Выбрано {selectedFilteredFiles.length}</span>
                  <div className="archive-bulk-bar__actions">
                    <button className="danger" onClick={() => setBulkConfirm({ kind: "purge-files" })} disabled={busy}>
                      Удалить выбранные
                    </button>
                    <button onClick={() => setSelected(new Set())}>Снять выбор</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {clearOpen && (
        <Modal onClose={() => setClearOpen(null)}>
          <div className="stack" style={{ minWidth: 360 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
              {clearOpen === "entities" ? "Очистить архив сущностей?" : "Очистить архив файлов?"}
            </h2>
            <p className="muted" style={{ maxWidth: "52ch" }}>
              {clearOpen === "entities"
                ? `Будет удалено ${filtered.length > 0 ? filtered.length : items.length} записей навсегда вместе с вложенными данными. Это необратимо.`
                : `Будет удалено ${filteredFiles.length > 0 ? filteredFiles.length : files.length} файлов навсегда.`}
            </p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setClearOpen(null)}>Отмена</button>
              <button className="danger" onClick={clearAll} disabled={busy}>
                Да, удалить навсегда
              </button>
            </div>
          </div>
        </Modal>
      )}

      {purgeTarget && (
        <Modal onClose={() => setPurgeTarget(null)}>
          <div className="stack" style={{ minWidth: 380, maxWidth: 520 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>Удалить «{purgeTarget.item.title}» навсегда?</h2>
            <p className="muted" style={{ maxWidth: "52ch" }}>
              Это необратимо — запись и все её вложенные данные (разделы, записи, вложения) будут стёрты без
              возможности восстановления.
            </p>
            {purgeImpactLoading ? (
              <p className="muted">Считаю последствия…</p>
            ) : purgeTarget.impact ? (
              <div className="stack" style={{ gap: 8 }}>
                {impactLines(purgeTarget.impact).map((ln, i) => (
                  <p key={i} className="muted" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "var(--fs-meta)" }}>
                    {ln}
                  </p>
                ))}
                {impactLines(purgeTarget.impact).length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>Дополнительных разрывов не найдено.</p>
                )}
              </div>
            ) : null}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setPurgeTarget(null)}>Отмена</button>
              <button className="danger" onClick={confirmPurge} disabled={busy || purgeImpactLoading}>
                Да, удалить навсегда
              </button>
            </div>
          </div>
        </Modal>
      )}

      {filePurgeTarget && (
        <Modal onClose={() => setFilePurgeTarget(null)}>
          <div className="stack" style={{ minWidth: 360 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>Удалить файл «{filePurgeTarget.original_name}»?</h2>
            <p className="muted">Файл в `_Archive` будет стёрт без возможности восстановления.</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setFilePurgeTarget(null)}>Отмена</button>
              <button className="danger" onClick={confirmFilePurge} disabled={busy}>
                Да, удалить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bulkConfirm && (
        <Modal onClose={() => setBulkConfirm(null)}>
          <div className="stack" style={{ minWidth: 360 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
              {bulkConfirm.kind === "restore" ? `Восстановить ${selectedFilteredItems.length} записей?` : bulkConfirm.kind === "purge-entities" ? `Удалить ${selectedFilteredItems.length} записей навсегда?` : `Удалить ${selectedFilteredFiles.length} файлов навсегда?`}
            </h2>
            <p className="muted" style={{ maxWidth: "52ch" }}>
              {bulkConfirm.kind === "restore"
                ? "Выбранные сущности вернутся в основные разделы."
                : "Это необратимо — вложенные данные будут стёрты."}
            </p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setBulkConfirm(null)}>Отмена</button>
              <button
                className={bulkConfirm.kind === "restore" ? "primary" : "danger"}
                onClick={() => {
                  if (bulkConfirm.kind === "restore") void bulkRestore();
                  else if (bulkConfirm.kind === "purge-entities") void bulkPurge();
                  else void bulkPurgeFiles();
                }}
                disabled={busy}
              >
                {bulkConfirm.kind === "restore" ? "Восстановить" : "Удалить навсегда"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {previewItem && (
        <Modal onClose={() => setPreviewItem(null)}>
          <div className="stack" style={{ minWidth: 360, maxWidth: 480 }}>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="archive-card__head">
                <span className="archive-row__type">{TYPE_LABELS[previewItem.type] ?? previewItem.type}</span>
                <span className="archive-card__head-title">{previewItem.title}</span>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {previewItem.subtitle && <p style={{ margin: 0 }}><span className="muted">Контекст:</span> {previewItem.subtitle}</p>}
                <p style={{ margin: 0 }}><span className="muted">Тип:</span> {TYPE_LABELS[previewItem.type] ?? previewItem.type}</p>
                <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}><span className="muted">В архиве с:</span> {formatArchivedAt(previewItem.archived_at)} · {timeAgo(previewItem.archived_at)}</p>
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setPreviewItem(null)}>Закрыть</button>
              <button className="primary" onClick={() => { const it = previewItem; setPreviewItem(null); void restore(it); }}>
                Восстановить
              </button>
              <button className="danger" onClick={() => { const it = previewItem; setPreviewItem(null); openPurge(it); }}>
                Удалить навсегда
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{toast.msg}</span>
          <div className="archive-toast__actions">
            {toast.onUndo && (
              <button className="archive-toast__undo" onClick={() => { const cb = toast.onUndo; setToast(null); cb?.(); }}>
                Отменить
              </button>
            )}
            <button className="archive-toast__close" onClick={() => setToast(null)} aria-label="Закрыть">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
