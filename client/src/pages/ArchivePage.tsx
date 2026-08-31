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

  function refresh() {
    api.get<ArchiveItem[]>("/archive").then(setItems);
    api.get<ArchivedFile[]>("/archived-files").then(setFiles);
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

  async function restore(item: ArchiveItem) {
    const base = RESTORE_ENDPOINTS[item.type];
    if (!base) return;
    await api.put(`${base}/${item.id}/restore`);
    refresh();
  }

  async function purge(item: ArchiveItem) {
    let impact: PurgeImpact | null = null;
    try {
      impact = await api.get<PurgeImpact>(`/archive/${item.type}/${item.id}/impact`);
    } catch {
      // Сводка — не условие удаления: если её не удалось получить, спрашиваем
      // общим текстом, а не отказываем в действии.
    }
    const warning = [
      `Удалить «${item.title}» НАВСЕГДА? Это необратимо — запись и все её вложенные данные (разделы, записи, вложения) будут стёрты без возможности восстановления.`,
      ...impactLines(impact),
    ].join("\n\n");
    if (!confirm(warning)) return;
    try {
      await api.del(`/archive/${item.type}/${item.id}`);
    } catch (e) {
      alert(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    void refreshMentionIndex();
    refresh();
  }

  async function purgeFile(file: ArchivedFile) {
    if (!confirm(`Удалить файл «${file.original_name}» из архива навсегда?`)) return;
    try {
      await api.del(`/archived-files/${file.id}`);
    } catch (e) {
      alert(`Не удалось удалить: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    refresh();
  }

  async function bulkRestore() {
    if (selectedFilteredItems.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(selectedFilteredItems.map((it) => {
      const base = RESTORE_ENDPOINTS[it.type];
      if (!base) return Promise.reject(new Error(`нет маршрута для ${it.type}`));
      return api.put(`${base}/${it.id}/restore`);
    }));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) alert(`Не удалось восстановить ${fails.length} из ${results.length}: ${String(fails[0].reason)}`);
    setSelected(new Set());
    refresh();
  }

  async function bulkPurge() {
    if (selectedFilteredItems.length === 0) return;
    const names = selectedFilteredItems.map((it) => `«${it.title}»`).join(", ");
    if (!confirm(`Удалить ${selectedFilteredItems.length} записей НАВСЕГДА? ${names}\n\nЭто необратимо — вложенные данные будут стёрты.`)) return;
    setBusy(true);
    const results = await Promise.allSettled(selectedFilteredItems.map((it) => api.del(`/archive/${it.type}/${it.id}`)));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) alert(`Не удалось удалить ${fails.length} из ${results.length}: ${String(fails[0].reason)}`);
    else void refreshMentionIndex();
    setSelected(new Set());
    refresh();
  }

  async function bulkPurgeFiles() {
    if (selectedFilteredFiles.length === 0) return;
    if (!confirm(`Удалить ${selectedFilteredFiles.length} файлов НАВСЕГДА без возможности восстановления?`)) return;
    setBusy(true);
    const results = await Promise.allSettled(selectedFilteredFiles.map((f) => api.del(`/archived-files/${f.id}`)));
    const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    setBusy(false);
    if (fails.length > 0) alert(`Не удалось удалить ${fails.length}: ${String(fails[0].reason)}`);
    setSelected(new Set());
    refresh();
  }

  async function clearAll() {
    if (clearOpen === "entities") {
      const targets = filtered.length > 0 ? filtered : items;
      if (targets.length === 0) { setClearOpen(null); return; }
      if (!confirm(`Очистить архив — удалить ${targets.length} сущностей НАВСЕГДА? Это необратимо.`)) return;
      setBusy(true);
      await Promise.allSettled(targets.map((it) => api.del(`/archive/${it.type}/${it.id}`)));
      setBusy(false);
      void refreshMentionIndex();
      setClearOpen(null);
      setSelected(new Set());
      refresh();
    } else if (clearOpen === "files") {
      const targets = filteredFiles.length > 0 ? filteredFiles : files;
      if (targets.length === 0) { setClearOpen(null); return; }
      if (!confirm(`Очистить архив файлов — удалить ${targets.length} файлов НАВСЕГДА?`)) return;
      setBusy(true);
      await Promise.allSettled(targets.map((f) => api.del(`/archived-files/${f.id}`)));
      setBusy(false);
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
      <SectionHeading section="archive">Архив</SectionHeading>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Архивированные сущности хранятся здесь и не отображаются в основных разделах. Архив — это
        мягкое удаление: запись вернётся со всеми вложенными данными одной кнопкой «Восстановить».
      </p>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
            <span className="archive-tab-count">{t === "Сущности" ? items.length : files.length}</span>
          </button>
        ))}
      </div>

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
                    {filtered.map((item) => {
                      const key = itemKey(item);
                      const checked = selected.has(key);
                      return (
                        <div key={key} className={`archive-row2 ${checked ? "is-selected" : ""}`}>
                          <input type="checkbox" className="archive-row__check" checked={checked} onChange={() => toggle(key)} aria-label={`Выбрать ${item.title}`} />
                          <span className="archive-row__type">{TYPE_LABELS[item.type] ?? item.type}</span>
                          <span className="archive-row__title">
                            {item.title}
                            {item.subtitle && <span className="archive-row__subtitle"> · {item.subtitle}</span>}
                          </span>
                          <span className="archive-row__meta" title={timeAgo(item.archived_at)}>
                            {formatArchivedAt(item.archived_at)}
                          </span>
                          <div className="archive-row__actions">
                            <button className="archive-row__act archive-row__act--restore" onClick={() => restore(item)} disabled={busy}>
                              Восстановить
                            </button>
                            <button className="danger archive-row__act archive-row__act--danger" onClick={() => purge(item)} disabled={busy}>
                              Удалить навсегда
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedFilteredItems.length > 0 && (
                <div className="archive-bulk-bar">
                  <span className="archive-bulk-bar__count">Выбрано {selectedFilteredItems.length}</span>
                  <div className="archive-bulk-bar__actions">
                    <button className="primary" onClick={bulkRestore} disabled={busy}>
                      Восстановить выбранные
                    </button>
                    <button className="danger" onClick={bulkPurge} disabled={busy}>
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
                  {filteredFiles.map((file) => {
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
                          <button className="danger archive-row__act archive-row__act--danger" onClick={() => purgeFile(file)} disabled={busy}>
                            Удалить навсегда
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {selectedFilteredFiles.length > 0 && (
                <div className="archive-bulk-bar">
                  <span className="archive-bulk-bar__count">Выбрано {selectedFilteredFiles.length}</span>
                  <div className="archive-bulk-bar__actions">
                    <button className="danger" onClick={bulkPurgeFiles} disabled={busy}>
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
    </div>
  );
}
