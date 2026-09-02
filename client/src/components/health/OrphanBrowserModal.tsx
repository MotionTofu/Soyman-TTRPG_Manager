import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { Modal } from "../Modal";
import { useAuthenticatedFileUrl } from "../../utils/fileUrl";

type OrphanFile = { path: string; size: number };

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
function isImage(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXT.has(ext);
}

function OrphanThumb({ path }: { path: string }) {
  const isImg = isImage(path);
  const clean = isImg ? `/files/${path.split("\\").join("/").replace(/^\/+/, "")}` : null;
  const url = useAuthenticatedFileUrl(clean);
  if (isImg) {
    return (
      <div style={{ width: 56, height: 56, border: "1px solid var(--line)", overflow: "hidden", background: "var(--paper-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>…</span>}
      </div>
    );
  }
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase() || "?";
  return (
    <div style={{ width: 56, height: 56, border: "1px solid var(--line)", background: "var(--paper-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--muted)" }}>
      {ext}
    </div>
  );
}

// --- Attach wizard (per-file) ---

const ATTACH_COLUMNS: Record<string, { table: string; columns: { value: string; label: string }[] }> = {
  campaign: { table: "campaigns", columns: [{ value: "background_image_path", label: "Фон" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  setting: { table: "settings", columns: [{ value: "background_image_path", label: "Фон" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "avatar_image_path", label: "Аватар" }, { value: "folder_path", label: "Папка" }] },
  system: { table: "systems", columns: [{ value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  player: { table: "players", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  character: { table: "characters", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  location: { table: "setting_locations", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "map_image_path", label: "Карта" }, { value: "folder_path", label: "Папка" }] },
  being: { table: "setting_beings", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  community: { table: "setting_communities", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "thumbnail_image_path", label: "Миниатюра" }, { value: "folder_path", label: "Папка" }] },
  artifact: { table: "artifacts", columns: [{ value: "avatar_image_path", label: "Аватар" }, { value: "file_path", label: "Файл" }, { value: "folder_path", label: "Папка" }] },
  resource: { table: "resources", columns: [{ value: "file_path", label: "Файл" }] },
  compendium_entry: { table: "compendium_entries", columns: [{ value: "avatar_image_path", label: "Портрет Бестиария" }, { value: "statblock_avatar", label: "Портрет статблока" }] },
};

function autoColumnFor(orphanPath: string, type: string): string {
  const ext = orphanPath.slice(orphanPath.lastIndexOf(".")).toLowerCase();
  const img = IMAGE_EXT.has(ext);
  const cols = ATTACH_COLUMNS[type]?.columns.map((c) => c.value) ?? [];
  if (img) {
    if (type === "compendium_entry" && cols.includes("statblock_avatar") && orphanPath.toLowerCase().includes("statblock")) return "statblock_avatar";
    if (cols.includes("avatar_image_path")) return "avatar_image_path";
    if (cols.includes("thumbnail_image_path")) return "thumbnail_image_path";
    if (cols.includes("map_image_path")) return "map_image_path";
  } else {
    if (cols.includes("file_path")) return "file_path";
  }
  return cols[0] ?? "avatar_image_path";
}

interface SearchResult { type: string; id: number; title: string; subtitle?: string; context?: string; }

function OrphanAttachWizard({ orphanPath, index, total, onClose, onDone, onSkip }: { orphanPath: string; index?: number; total?: number; onClose: () => void; onDone: () => void; onSkip?: () => void }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("compendium_entry");
  const [systemId, setSystemId] = useState<string>("");
  const [systems, setSystems] = useState<{ id: number; name: string }[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [column, setColumn] = useState<string>(() => autoColumnFor(orphanPath, "compendium_entry"));
  const [msg, setMsg] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [entryStatblocks, setEntryStatblocks] = useState<{ id: number; kind: string; note: string | null }[]>([]);
  const [selectedStatblockId, setSelectedStatblockId] = useState<string>("");
  const [occupiedColumns, setOccupiedColumns] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeFilter === "compendium_entry" && systems.length === 0) {
      api.get<{ id: number; name: string }[]>("/systems").then((r) => setSystems(Array.isArray(r) ? r : [])).catch(() => {});
    }
  }, [typeFilter, systems.length]);

  useEffect(() => {
    setColumn(autoColumnFor(orphanPath, typeFilter));
    setSelected(null);
    setResults([]);
    setQ("");
    setEntryStatblocks([]);
    setSelectedStatblockId("");
    if (typeFilter !== "compendium_entry") setSystemId("");
  }, [orphanPath, typeFilter]);

  useEffect(() => {
    if (selected?.type === "compendium_entry" && selected.id) {
      api.get<{ id: number; kind: string; note: string | null }[]>(`/statblocks?owner_type=compendium_entry&owner_id=${selected.id}`)
        .then((r) => {
          const list = Array.isArray(r) ? r : [];
          setEntryStatblocks(list);
          if (list.length === 1) setSelectedStatblockId(String(list[0].id));
          else setSelectedStatblockId("");
        })
        .catch(() => setEntryStatblocks([]));
    } else {
      setEntryStatblocks([]);
      setSelectedStatblockId("");
    }
  }, [selected?.type, selected?.id]);

  useEffect(() => {
    if (column !== "statblock_avatar") setSelectedStatblockId("");
    else if (entryStatblocks.length === 1 && !selectedStatblockId) setSelectedStatblockId(String(entryStatblocks[0].id));
  }, [column, entryStatblocks]);

  // Fetch entity data to detect occupied fields
  useEffect(() => {
    if (!selected) { setOccupiedColumns(new Set()); return; }
    const endpointMap: Record<string, string> = {
      being: "beings", location: "locations", community: "communities",
      artifact: "artifacts", compendium_entry: "compendium-entries",
      character: "characters", setting: "settings", campaign: "campaigns",
      system: "systems", player: "players",
    };
    const ep = endpointMap[selected.type];
    if (!ep) { setOccupiedColumns(new Set()); return; }
    const ac = new AbortController();
    api.get<Record<string, unknown>>(`/${ep}/${selected.id}`, { signal: ac.signal })
      .then((data) => {
        if (ac.signal.aborted) return;
        const cols = ATTACH_COLUMNS[selected.type]?.columns.map((c) => c.value) ?? [];
        const occupied = new Set<string>();
        for (const col of cols) {
          const val = data[col];
          if (typeof val === "string" && val.trim()) occupied.add(col);
        }
        // For compendium_entry + statblock_avatar: mark occupied if any statblock has an avatar
        if (selected.type === "compendium_entry" && entryStatblocks.length > 0) {
          const hasAvatar = entryStatblocks.some((sb) => {
            // We don't have statblock data here directly, but the statblocks endpoint was already called
            // We'll rely on the user seeing the statblock list; mark it occupied if there's only 1 statblock
            // (simplification: if statblocks exist, the field is potentially occupied)
            return false; // can't know without extra fetch — leave unoccupied, user decides
          });
          if (hasAvatar) occupied.add("statblock_avatar");
        }
        setOccupiedColumns(occupied);
      })
      .catch(() => { if (!ac.signal.aborted) setOccupiedColumns(new Set()); });
    return () => ac.abort();
  }, [selected?.type, selected?.id, entryStatblocks]);

  useEffect(() => {
    setSelected(null);
    if (q.trim().length < 2) { setResults([]); return; }
    const ac = new AbortController();
    setBusy(true);
    let url = `/search?q=${encodeURIComponent(q.trim())}&types=${typeFilter}`;
    if (typeFilter === "compendium_entry" && systemId) url += `&system_id=${systemId}`;
    api.get<SearchResult[]>(url, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setResults(Array.isArray(r) ? r.slice(0, 20) : []); })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setBusy(false); });
    return () => ac.abort();
  }, [q, typeFilter, systemId]);

  async function doAttach() {
    if (!selected) return;
    if (selected.type === "compendium_entry" && column === "statblock_avatar") {
      if (!selectedStatblockId) { setMsg("Выбери статблок"); return; }
      setAttaching(true);
      setMsg("");
      try {
        await api.post("/health/orphan/attach", { orphanPath, table: "statblocks", column: "avatar_image_path", id: Number(selectedStatblockId) });
        setMsg("Пришито к статблоку");
        onDone();
      } catch (e) {
        setMsg(String(e instanceof Error ? e.message : e));
      } finally {
        setAttaching(false);
      }
      return;
    }
    const target = ATTACH_COLUMNS[selected.type] ?? ATTACH_COLUMNS[typeFilter];
    const table = target?.table ?? (typeFilter === "being" ? "setting_beings" : typeFilter);
    setAttaching(true);
    setMsg("");
    try {
      await api.post("/health/orphan/attach", { orphanPath, table, column, id: selected.id });
      setMsg("Пришито");
      onDone();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setAttaching(false);
    }
  }

  const isImg = isImage(orphanPath);
  const clean = `/files/${orphanPath.split("\\").join("/").replace(/^\/+/, "")}`;
  const previewUrl = useAuthenticatedFileUrl(isImg ? clean : null);
  const cols = ATTACH_COLUMNS[selected?.type ?? typeFilter]?.columns ?? ATTACH_COLUMNS[typeFilter].columns;
  const progressLabel = (index != null && total != null && total > 1) ? ` (${index + 1} из ${total})` : "";

  return (
    <Modal onClose={onClose}>
      <div className="orphan-attach-wizard">
        <div className="orphan-attach-wizard__preview">
          {isImg ? (
            previewUrl ? <img src={previewUrl} alt={orphanPath} style={{ width: "100%", height: "100%", objectFit: "contain", maxHeight: 450 }} /> : <span className="muted" style={{ padding: 12 }}>Загрузка превью…</span>
          ) : (
            <div className="stack" style={{ alignItems: "center", padding: 16 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-h2)" }}>{orphanPath.slice(orphanPath.lastIndexOf(".")).toLowerCase() || "?"}</span>
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", wordBreak: "break-all", textAlign: "center" }}>{orphanPath}</span>
            </div>
          )}
        </div>
        <div className="stack" style={{ flex: "1 1 280px", minWidth: 260 }}>
          <strong className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", wordBreak: "break-all" }}>{orphanPath}{progressLabel}</strong>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".08em", textTransform: "uppercase" }}>Тип владельца</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>
              <option value="compendium_entry">Бестиарий (система)</option>
              <option value="being">Существо</option>
              <option value="location">Локация</option>
              <option value="community">Сообщество</option>
              <option value="artifact">Артефакт</option>
              <option value="character">Персонаж</option>
              <option value="setting">Сеттинг</option>
              <option value="campaign">Кампания</option>
              <option value="system">Система</option>
              <option value="player">Игрок</option>
            </select>
          </label>
          {typeFilter === "compendium_entry" && (
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".08em", textTransform: "uppercase" }}>Система (фильтр Бестиария)</span>
              <select value={systemId} onChange={(e) => setSystemId(e.target.value)} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>
                <option value="">Все системы</option>
                {systems.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name} #{s.id}</option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>ДнД 5.5 — выбери систему чтобы искать «Гоблин» только в ней.</span>
            </label>
          )}
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".08em", textTransform: "uppercase" }}>К кому пришить</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Введи ≥2 символа, напр. Мирт" aria-label="Поиск владельца" />
            {!selected ? (
              (busy || q.trim().length >= 2) ? (
                <div className="stack" style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", background: "var(--paper)", padding: 4, gap: 2 }}>
                  {busy && <span className="muted" style={{ fontSize: "var(--fs-meta)", padding: 4 }}>Ищу…</span>}
                  {!busy && results.length === 0 && <span className="muted" style={{ fontSize: "var(--fs-meta)", padding: 4 }}>Ничего не найдено</span>}
                  {results.map((r) => (
                    <button
                      key={`${r.type}:${r.id}`}
                      onClick={() => { setSelected(r); setResults([]); }}
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        border: "1px solid transparent",
                        background: "transparent",
                        fontFamily: "var(--font-body)",
                        fontSize: "var(--fs-meta)",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{r.context ?? r.subtitle ?? r.type}</div>
                    </button>
                  ))}
                </div>
              ) : null
            ) : (
              <div className="row" style={{ alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid var(--ink)", background: "var(--paper-2)" }}>
                <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", flex: "1 1 auto" }}>Выбрано: {selected.title} ({selected.type} #{selected.id})</span>
                <button onClick={() => { setSelected(null); setQ(""); setResults([]); }} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", padding: "4px 8px", border: "1px solid var(--line)", background: "var(--paper)" }}>Сменить</button>
              </div>
            )}
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".08em", textTransform: "uppercase" }}>Поле</span>
            <select value={column} onChange={(e) => setColumn(e.target.value)} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>
              {cols.map((c) => (
                <option key={c.value} value={c.value} className={occupiedColumns.has(c.value) ? "orphan-occupied" : ""}>{c.label} — {c.value}{occupiedColumns.has(c.value) ? " ●" : ""}</option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Авто: {autoColumnFor(orphanPath, selected?.type ?? typeFilter)} — можно поменять перед «Пришить».</span>
          </label>
          {selected?.type === "compendium_entry" && column === "statblock_avatar" && (
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", letterSpacing: ".08em", textTransform: "uppercase" }}>Статблок</span>
              {entryStatblocks.length === 0 ? (
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>У записи нет статблоков — сначала создай его в карточке записи.</span>
              ) : (
                <select value={selectedStatblockId} onChange={(e) => setSelectedStatblockId(e.target.value)} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>
                  <option value="">— выбери статблок —</option>
                  {entryStatblocks.map((sb) => (
                    <option key={sb.id} value={String(sb.id)}>{sb.kind === "short" ? "Краткий" : "Полный"} #{sb.id} {sb.note ? `— ${sb.note.slice(0, 40)}` : ""}</option>
                  ))}
                </select>
              )}
            </label>
          )}
          {msg && <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: msg === "Пришито" || msg === "Пришито к статблоку" ? "var(--accent)" : undefined }}>{msg}</span>}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onClose}>Отмена</button>
            {total != null && total > 1 && onSkip && <button onClick={onSkip}>Пропустить</button>}
            <button className="primary" onClick={doAttach} disabled={!selected || attaching || (selected?.type === "compendium_entry" && column === "statblock_avatar" && !selectedStatblockId)}>{attaching ? "Пришиваю…" : "Пришить"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function OrphanBrowserModal({ files, onClose, onDone }: { files: OrphanFile[]; onClose: () => void; onDone: () => void }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<null | "archive" | "resources">(null);
  const [msg, setMsg] = useState("");
  const [wizardCurrent, setWizardCurrent] = useState<string | null>(null);
  const [wizardQueue, setWizardQueue] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((f) => f.path.toLowerCase().includes(needle));
  }, [files, filter]);

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((f) => f.path)));
  }

  function openWizard(paths: string[]) {
    if (paths.length === 0) return;
    setWizardCurrent(paths[0]);
    setWizardQueue(paths.slice(1));
    setMsg("");
  }

  function handleWizardDone() {
    onDone();
    if (wizardQueue.length > 0) {
      const [next, ...rest] = wizardQueue;
      setWizardCurrent(next);
      setWizardQueue(rest);
    } else {
      setWizardCurrent(null);
      setWizardQueue([]);
    }
  }

  function handleWizardClose() {
    setWizardCurrent(null);
    setWizardQueue([]);
  }

  function handleWizardSkip() {
    if (wizardQueue.length > 0) {
      const [next, ...rest] = wizardQueue;
      setWizardCurrent(next);
      setWizardQueue(rest);
    } else {
      setWizardCurrent(null);
      setWizardQueue([]);
    }
  }

  async function doArchive() {
    const paths = [...selected];
    if (paths.length === 0) return;
    setBusy("archive");
    setMsg("");
    try {
      const r = await api.post<{ moved: number }>("/health/orphan/archive", { paths });
      setMsg(`В архив: ${r.moved}`);
      setSelected(new Set());
      onDone();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }
  async function doCreateResources() {
    const paths = [...selected];
    if (paths.length === 0) return;
    setBusy("resources");
    setMsg("");
    try {
      const r = await api.post<{ created: number }>("/health/orphan/create-resources", { paths });
      setMsg(`Создано ресурсов: ${r.created}`);
      setSelected(new Set());
      onDone();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const totalInCycle = (wizardCurrent ? 1 : 0) + wizardQueue.length;
  const currentIndex = wizardCurrent ? totalInCycle - wizardQueue.length : 0;

  return (
    <>
      <Modal onClose={onClose}>
        <div className="orphan-browser">
          <div className="orphan-browser__head">
            <strong style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", letterSpacing: ".08em", textTransform: "uppercase" }}>Файлы-сироты — браузер ({files.length})</strong>
            <button onClick={onClose} aria-label="Закрыть" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "4px 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)" }}>✕</button>
          </div>
          <div className="orphan-browser__body stack">
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)" }}>Отметь файлы и выбери действие. Превью — без дуотона (§1.13), до 100 файлов.</p>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input placeholder="Фильтр по пути…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: "1 1 200px", minWidth: 140 }} aria-label="Фильтр сирот" />
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>{filtered.length} / {files.length}</span>
              {filter && <button onClick={() => setFilter("")} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>Сброс</button>}
              <button onClick={toggleAll} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)" }}>{selected.size === filtered.length && filtered.length > 0 ? "Снять все" : "Выбрать все"}</button>
            </div>
            <div className="stack" style={{ maxHeight: "50vh", overflowY: "auto", overflowX: "hidden", border: "1px solid var(--line)", padding: 6, gap: 6, background: "var(--paper)" }}>
              {filtered.length === 0 && <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", padding: 8 }}>Ничего не найдено по «{filter}»</span>}
              {filtered.map((f) => (
                <label key={f.path} className="row" style={{ alignItems: "center", gap: 10, flexWrap: "nowrap", border: selected.has(f.path) ? "1px solid var(--ink)" : "1px solid var(--line)", padding: 6, background: selected.has(f.path) ? "var(--paper-2)" : "var(--paper)", cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} style={{ flexShrink: 0 }} />
                  <OrphanThumb path={f.path} />
                  <span style={{ flex: "1 1 auto", minWidth: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", wordBreak: "break-all" }}>
                    <div style={{ fontWeight: 600 }}>{f.path.split(/[/\\]/).pop()}</div>
                    <div className="muted" style={{ fontSize: "var(--fs-micro)" }}>{f.path} · {(f.size / 1024).toFixed(1)} КБ</div>
                  </span>
                  <button
                    onClick={(e) => { e.preventDefault(); openWizard([f.path]); }}
                    style={{ flex: "0 0 auto", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", padding: "4px 8px", border: "1px solid var(--line)", background: "var(--paper)" }}
                  >
                    Пришить…
                  </button>
                </label>
              ))}
            </div>
          </div>
          <div className="orphan-browser__foot">
            <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Отмечено: {selected.size} {msg && `· ${msg}`}</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button onClick={doArchive} disabled={selected.size === 0 || !!busy}>{busy === "archive" ? "…" : `В архив (${selected.size})`}</button>
              <button onClick={doCreateResources} disabled={selected.size === 0 || !!busy}>{busy === "resources" ? "…" : `Создать ресурсы (${selected.size})`}</button>
              <button className="primary" onClick={() => openWizard([...selected])} disabled={selected.size === 0}>Пришить выбранный…</button>
              <button onClick={onClose}>Закрыть</button>
            </div>
          </div>
        </div>
      </Modal>
      {wizardCurrent && (
        <OrphanAttachWizard
          orphanPath={wizardCurrent}
          index={currentIndex}
          total={totalInCycle}
          onClose={handleWizardClose}
          onDone={handleWizardDone}
          onSkip={handleWizardSkip}
        />
      )}
    </>
  );
}
