import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { SectionBackground } from "../components/SectionBackground";
import type { MasteringNote, MasteringSection, System } from "../types";
import { NavIcon } from "../components/NavIcons";

const CATEGORIES: { key: MasteringNote["category"]; label: string }[] = [
  { key: "prep", label: "Подготовка" },
  { key: "live", label: "Во время игры" },
  { key: "knowledge", label: "База знаний" },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function previewText(text: string, maxWords = 25, maxChars = 228): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  const words = oneLine.split(" ");
  let cur = "";
  let count = 0;
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) break;
    cur = next;
    count++;
    if (count >= maxWords) break;
  }
  if (cur.length === oneLine.length && count === words.length) return oneLine;
  return `${cur}…`;
}

function highlightParts(text: string, q: string) {
  if (!q.trim()) return text;
  const terms = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  const parts = text.split(re);
  // parts includes matches due to capturing group
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} style={{ background: "var(--accent-soft)", padding: "0 1px", borderRadius: 2 }}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

type SortMode = "date" | "az";

export function MasteringPage() {
  const [category, setCategory] = useState<MasteringNote["category"]>("prep");
  const [notes, setNotes] = useState<MasteringNote[]>([]);
  const [sections, setSections] = useState<MasteringSection[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [systemFilters, setSystemFilters] = useState<Set<number | null>>(new Set());

  function toggleSystemFilter(id: number | null) {
    setSystemFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [addOpen, setAddOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [systemId, setSystemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [sectionSystemId, setSectionSystemId] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverSection, setDragOverSection] = useState<number | "unsectioned" | null>(null);

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function refreshSections() {
    api.get<MasteringSection[]>(`/mastering/sections?category=${category}`).then(setSections);
  }
  function refreshNotes() {
    const params = new URLSearchParams();
    params.set("category", category);
    if (query.trim()) params.set("q", query.trim());
    if (sortMode) params.set("sort", sortMode);
    api.get<MasteringNote[]>(`/mastering?${params.toString()}`).then(setNotes);
  }
  function refresh() {
    refreshSections();
    refreshNotes();
  }
  useEffect(refresh, [category, query, sortMode]);
  useEffect(() => {
    api.get<System[]>("/systems").then(setSystems);
  }, []);

  async function create() {
    if (!title.trim()) return;
    await api.post("/mastering", {
      category,
      title: title.trim(),
      content,
      system_id: systemId ? Number(systemId) : null,
      section_id: sectionId ? Number(sectionId) : null,
    });
    setTitle("");
    setContent("");
    setSystemId("");
    setSectionId("");
    setAddOpen(false);
    refreshNotes();
  }

  async function createSection() {
    if (!sectionName.trim()) return;
    await api.post("/mastering/sections", {
      category,
      name: sectionName.trim(),
      system_id: sectionSystemId ? Number(sectionSystemId) : null,
    });
    setSectionName("");
    setSectionSystemId("");
    setAddSectionOpen(false);
    refreshSections();
  }

  async function archiveNote(id: number) {
    if (!confirm("Отправить заметку в архив?")) return;
    await api.del(`/mastering/${id}`);
    refreshNotes();
  }

  const activeFilters = systemFilters.size + (query.trim() ? 1 : 0);
  // Клиентский мульти-фильтр по системе — сервер отдаёт всех, режем тут
  const filteredNotes = systemFilters.size === 0 ? notes : notes.filter((n) => systemFilters.has(n.system_id));
  const allExpandableIds = filteredNotes.filter((n) => n.content.trim()).map((n) => n.id);
  const allExpanded = allExpandableIds.length > 0 && allExpandableIds.every((id) => expandedIds.has(id));

  function requestAddToSection(sid: number | null) {
    setSectionId(sid ? String(sid) : "");
    setAddOpen(true);
    setAddSectionOpen(false);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder="Как назовём заметку"]');
      el?.focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  async function handleDropToSection(targetSectionId: number | null) {
    if (draggedId == null) return;
    const note = notes.find((n) => n.id === draggedId);
    if (!note) {
      setDraggedId(null);
      setDragOverSection(null);
      return;
    }
    const targetSec = targetSectionId ? sections.find((s) => s.id === targetSectionId) : null;
    if (targetSec && targetSec.category !== note.category) {
      setDraggedId(null);
      setDragOverSection(null);
      return;
    }
    if ((note.section_id ?? null) === targetSectionId) {
      setDraggedId(null);
      setDragOverSection(null);
      return;
    }
    const did = draggedId;
    setNotes((prev) => prev.map((n) => (n.id === did ? { ...n, section_id: targetSectionId } : n)));
    setDraggedId(null);
    setDragOverSection(null);
    await api.put(`/mastering/${did}`, { section_id: targetSectionId });
    refreshNotes();
  }


  // Группировка по section_id после клиентского мульти-фильтра
  const bySection = new Map<number | null, MasteringNote[]>();
  for (const n of filteredNotes) {
    const k = n.section_id ?? null;
    const arr = bySection.get(k) ?? [];
    arr.push(n);
    bySection.set(k, arr);
  }
  const unsectioned = bySection.get(null) ?? [];

  return (
    <div className="stack" style={{ gap: 10, position: "relative" }}>
      <SectionBackground />
      <SectionHeading section="mastering" compact>
        Мастерение
      </SectionHeading>
      <div className="tabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={category === c.key ? "active" : ""}
            onClick={() => {
              setCategory(c.key);
              setAddOpen(false);
              setAddSectionOpen(false);
              setFiltersOpen(false);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="res-toolbar">
        <input
          className="res-toolbar__search"
          placeholder="Поиск по заголовку и тексту…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg res-toolbar__sort" role="group" aria-label="Сортировка">
          <button type="button" className={sortMode === "date" ? "is-active" : ""} onClick={() => setSortMode("date")}>
            Дата
          </button>
          <button type="button" className={sortMode === "az" ? "is-active" : ""} onClick={() => setSortMode("az")}>
            А-Я
          </button>
        </div>
        <button
          type="button"
          className={`res-toolbar__filters-toggle${filtersOpen ? " is-active" : ""}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Фильтры
          {activeFilters > 0 && <span className="res-toolbar__filters-count">{activeFilters}</span>}
        </button>
        <div className={`res-toolbar__filters${filtersOpen ? " is-open" : ""}`} style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="res-toolbar__filter-label">Система</span>
          <button
            type="button"
            className={`res-row__tag${systemFilters.size === 0 ? " is-active" : ""}`}
            onClick={() => setSystemFilters(new Set())}
            style={systemFilters.size === 0 ? { background: "var(--surface)", color: "var(--on-surface)", borderColor: "var(--surface)" } : {}}
          >
            Все
          </button>
          {systems.map((s) => {
            const on = systemFilters.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`res-row__tag${on ? " is-active" : ""}`}
                onClick={() => toggleSystemFilter(s.id)}
                style={on ? { background: "var(--surface)", color: "var(--on-surface)", borderColor: "var(--surface)" } : {}}
              >
                {s.name}
              </button>
            );
          })}
          <button
            type="button"
            className={`res-row__tag${systemFilters.has(null) ? " is-active" : ""}`}
            onClick={() => toggleSystemFilter(null)}
            style={systemFilters.has(null) ? { background: "var(--surface)", color: "var(--on-surface)", borderColor: "var(--surface)" } : {}}
          >
            Без системы
          </button>
        </div>
        <button
          type="button"
          className="res-toolbar__add"
          onClick={() => setAddSectionOpen((v) => !v)}
          style={{ marginLeft: 4 }}
        >
          {addSectionOpen ? "Отмена" : "+ Раздел"}
        </button>
        <button
          type="button"
          className={`primary res-toolbar__add${addOpen ? " is-active" : ""}`}
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? "Отмена" : "+ Заметка"}
        </button>
        <button
          type="button"
          className="res-toolbar__filters-toggle"
          style={{ display: "inline-flex", opacity: filteredNotes.length <= 1 ? 0.5 : 1 }}
          disabled={filteredNotes.length <= 1}
          onClick={() => {
            if (allExpanded) setExpandedIds(new Set());
            else setExpandedIds(new Set(allExpandableIds));
          }}
        >
          {allExpanded ? "Свернуть всё" : "Развернуть всё"}
        </button>
      </div>

      {addSectionOpen && (
        <div className="card res-add" style={{ gap: 12, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px", minWidth: 0 }}>
            <span className="res-toolbar__filter-label">Название раздела</span>
            <input placeholder="Напр. Подготовка к сессии, Идеи" value={sectionName} onChange={(e) => setSectionName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 180px", minWidth: 140 }}>
            <span className="res-toolbar__filter-label">Система</span>
            <select value={sectionSystemId} onChange={(e) => setSectionSystemId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Без системы</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={createSection} style={{ height: 32, whiteSpace: "nowrap" }}>
            Создать раздел
          </button>
        </div>
      )}

      {addOpen && (
        <div className="card res-add" style={{ gap: 12, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px", minWidth: 0 }}>
            <span className="res-toolbar__filter-label">Заголовок</span>
            <input placeholder="Как назовём заметку" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 160px", minWidth: 130 }}>
            <span className="res-toolbar__filter-label">Система</span>
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Без системы</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 160px", minWidth: 130 }}>
            <span className="res-toolbar__filter-label">Раздел</span>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Без раздела</option>
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={create} style={{ height: 32, whiteSpace: "nowrap" }}>
            Добавить
          </button>
          <div style={{ flex: "1 1 100%", minWidth: 0 }}>
            <MentionTextarea value={content} onChange={setContent} rows={4} placeholder="Текст заметки — поддерживает [[ссылки]], **жирный**, *курсив*, таблицы" />
          </div>
        </div>
      )}

      {filteredNotes.length === 0 ? (
        <EmptyState
          icon="barcode"
          title={
            query || activeFilters
              ? "Ничего не найдено"
              : sections.length === 0
                ? category === "prep"
                  ? "Подготовка пуста"
                  : category === "live"
                    ? "За столом тихо"
                    : "База знаний пуста"
                : "Здесь пусто"
          }
          hint={
            query || activeFilters
              ? "Попробуйте другой запрос или снимите фильтры."
              : sections.length === 0
                ? "Создайте раздел — плашка-инверсия назовёт его, а заметки лягут внутрь. Или добавьте первую заметку."
                : "Все заметки в разделах — в «Без раздела» пока пусто."
          }
          action={
            query || activeFilters ? (
              <button
                onClick={() => {
                  setQuery("");
                  setSystemFilters(new Set());
                }}
              >
                Сбросить фильтры
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {sections.map((sec) => {
            const items = bySection.get(sec.id) ?? [];
            if (items.length === 0 && (query || activeFilters)) return null;
            return (
              <MasteringSectionBlock
                key={sec.id}
                section={sec}
                notes={items}
                systems={systems}
                sections={sections}
                category={category}
                expandedIds={expandedIds}
                onToggle={toggleExpanded}
                onAddNote={requestAddToSection}
                draggedId={draggedId}
                dragOverSection={dragOverSection}
                onDragStart={setDraggedId}
                onDragOverSection={setDragOverSection}
                onDropToSection={handleDropToSection}
                query={query}
                onChange={refresh}
                onArchive={archiveNote}
              />
            );
          })}
          {unsectioned.length > 0 && (
            <MasteringSectionBlock
              key="unsectioned"
              section={null}
              notes={unsectioned}
              systems={systems}
              sections={sections}
              category={category}
              expandedIds={expandedIds}
              onToggle={toggleExpanded}
              onAddNote={requestAddToSection}
              draggedId={draggedId}
              dragOverSection={dragOverSection}
              onDragStart={setDraggedId}
              onDragOverSection={setDragOverSection}
              onDropToSection={handleDropToSection}
              query={query}
              onChange={refresh}
              onArchive={archiveNote}
            />
          )}
          {/* Если все секции пусты, но есть хвост — уже показан. Если всё пусто по фильтру — EmptyState выше */}
        </div>
      )}
    </div>
  );
}

function MasteringSectionBlock({
  section,
  notes,
  systems,
  sections,
  category,
  expandedIds,
  onToggle,
  onAddNote,
  draggedId,
  dragOverSection,
  onDragStart,
  onDragOverSection,
  onDropToSection,
  query,
  onChange,
  onArchive,
}: {
  section: MasteringSection | null;
  notes: MasteringNote[];
  systems: System[];
  sections: MasteringSection[];
  category: MasteringNote["category"];
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
  onAddNote: (sectionId: number | null) => void;
  draggedId: number | null;
  dragOverSection: number | "unsectioned" | null;
  onDragStart: (id: number | null) => void;
  onDragOverSection: (v: number | "unsectioned" | null) => void;
  onDropToSection: (sectionId: number | null) => void;
  query: string;
  onChange: () => void;
  onArchive: (id: number) => void;
}) {
  void onAddNote;
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(section?.name ?? "");
  const [systemId, setSystemId] = useState(section?.system_id ? String(section.system_id) : "");
  const [inlineOpen, setInlineOpen] = useState(false);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineContent, setInlineContent] = useState("");
  const [inlineSystemId, setInlineSystemId] = useState("");
  // Состояние свёрнутости — localStorage по id секции (§1.11 + bestiary)
  // Хвост «Без раздела» — всегда открыт, иначе старые заметки пропадают из вида
  const storageKey = section ? `masteringSectionOpen_${section.id}` : "masteringSectionOpen_unsectioned";
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {}
  }, [open, storageKey]);

  async function saveSection() {
    if (!section || !name.trim()) return;
    await api.put(`/mastering/sections/${section.id}`, {
      name: name.trim(),
      system_id: systemId ? Number(systemId) : null,
    });
    setEditMode(false);
    onChange();
  }
  async function deleteSection() {
    if (!section || !confirm(`Удалить раздел «${section.name}»? Заметки уйдут в «Без раздела».`)) return;
    await api.del(`/mastering/sections/${section.id}`);
    onChange();
  }

  async function inlineCreate() {
    if (!inlineTitle.trim()) return;
    await api.post("/mastering", {
      category,
      title: inlineTitle.trim(),
      content: inlineContent,
      system_id: inlineSystemId ? Number(inlineSystemId) : null,
      section_id: section ? section.id : null,
    });
    setInlineTitle("");
    setInlineContent("");
    setInlineSystemId("");
    setInlineOpen(false);
    onChange();
  }

  const isUnsectioned = section == null;
  const title = isUnsectioned ? "Без раздела" : section.name;
  const systemName = isUnsectioned ? null : section.system_name;
  const count = notes.length;

  if (isUnsectioned) {
    const isDragOver = dragOverSection === "unsectioned";
    return (
      <details
        className={`card res-group zine-grain${isDragOver ? " drag-over" : ""}`}
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        onDragOver={(e) => {
          e.preventDefault();
          if (dragOverSection !== "unsectioned") onDragOverSection("unsectioned");
        }}
        onDragLeave={() => {
          if (dragOverSection === "unsectioned") onDragOverSection(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDropToSection(null);
        }}
        style={{ padding: 0, overflow: "hidden" }}
      >
        <summary className="res-group__band">
          <NavIcon name="chevron" className="chevron-icon" />
          <NavIcon name="document" className="res-group__icon" />
          <span className="res-group__title">{title}</span>
          <span className="res-group__count">{count}</span>
        </summary>
        <div className="res-group__body">
          {notes.length === 0 ? (
            <div className="muted" style={{ padding: "8px 12px", fontSize: 12 }}>
              Пока пусто — добавьте заметку.
            </div>
          ) : (
            notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                systems={systems}
                sections={sections}
                isExpanded={expandedIds.has(n.id)}
                onToggle={onToggle}
                draggedId={draggedId}
                onDragStart={onDragStart}
                query={query}
                onChange={onChange}
                onArchive={onArchive}
              />
            ))
          )}
        </div>
      </details>
    );
  }

  const isDragOver = dragOverSection === section!.id;
  return (
    <details
      className={`card res-group zine-grain${isDragOver ? " drag-over" : ""}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      onDragOver={(e) => {
        e.preventDefault();
        if (dragOverSection !== section!.id) onDragOverSection(section!.id);
      }}
      onDragLeave={() => {
        if (dragOverSection === section!.id) onDragOverSection(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropToSection(section!.id);
      }}
    >
      <summary className="res-group__band">
        <NavIcon name="chevron" className="chevron-icon" />
        <NavIcon name="book" className="res-group__icon" />
        <span className="res-group__title">{title}</span>
        {systemName && <span className="res-row__tag" style={{ marginLeft: 8 }}>{systemName}</span>}
        <span className="res-group__count">{count}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.preventDefault()}>
          <button
            type="button"
            className="res-row__act"
            onClick={() => setInlineOpen((v) => !v)}
            title={inlineOpen ? "Отмена" : "Добавить заметку сюда"}
            aria-label={`Добавить заметку в раздел ${section!.name}`}
            style={{ background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--line)" }}
          >
            <NavIcon name="plus" />
          </button>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            title={editMode ? "Отмена" : "Переименовать"}
            aria-label={editMode ? "Отмена" : `Переименовать раздел ${section!.name}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px",
              height: 26,
              background: "var(--paper)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            <NavIcon name={editMode ? "close" : "edit"} />
            {editMode ? "Отмена" : "Переименовать"}
          </button>
          <button
            type="button"
            onClick={deleteSection}
            title="Удалить раздел"
            aria-label={`Удалить раздел ${section!.name}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px",
              height: 26,
              background: "var(--danger-bg)",
              color: "var(--danger-text)",
              border: "1px solid var(--danger-bg)",
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            <NavIcon name="delete" />
            Удалить
          </button>
        </span>
      </summary>
      {editMode && section && (
        <div className="card res-add" style={{ margin: 8, gap: 12, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px", minWidth: 0 }}>
            <span className="res-toolbar__filter-label">Название раздела</span>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 180px", minWidth: 140 }}>
            <span className="res-toolbar__filter-label">Система</span>
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Без системы</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={saveSection} style={{ height: 32, whiteSpace: "nowrap" }}>
            Сохранить
          </button>
          <button onClick={() => setEditMode(false)} style={{ height: 32, whiteSpace: "nowrap" }}>
            Отмена
          </button>
        </div>
      )}
      <div className="res-group__body">
        {inlineOpen && (
          <div className="card res-add" style={{ margin: 8, gap: 12, alignItems: "end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px", minWidth: 0 }}>
              <span className="res-toolbar__filter-label">Заголовок</span>
              <input placeholder="Как назовём заметку" value={inlineTitle} onChange={(e) => setInlineTitle(e.target.value)} style={{ width: "100%" }} autoFocus />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 160px", minWidth: 130 }}>
              <span className="res-toolbar__filter-label">Система</span>
              <select value={inlineSystemId} onChange={(e) => setInlineSystemId(e.target.value)} style={{ width: "100%" }}>
                <option value="">Без системы</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={inlineCreate} style={{ height: 32, whiteSpace: "nowrap" }}>
              Добавить
            </button>
            <div style={{ flex: "1 1 100%", minWidth: 0 }}>
              <MentionTextarea value={inlineContent} onChange={setInlineContent} rows={3} placeholder="Текст заметки — поддерживает [[ссылки]], **жирный**, *курсив*, таблицы" />
            </div>
          </div>
        )}
        {notes.length === 0 && !inlineOpen ? (
          <div className="muted" style={{ padding: "8px 12px", fontSize: 12 }}>
            Пока пусто — добавьте заметку в этот раздел.
          </div>
        ) : notes.length === 0 && inlineOpen ? null : (
          notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              systems={systems}
              sections={sections}
              isExpanded={expandedIds.has(n.id)}
              onToggle={onToggle}
              draggedId={draggedId}
              onDragStart={onDragStart}
              query={query}
              onChange={onChange}
              onArchive={onArchive}
            />
          ))
        )}
      </div>
    </details>
  );
}

export function NoteCard({
  note,
  systems,
  sections,
  isExpanded,
  onToggle,
  draggedId,
  onDragStart,
  query,
  onChange,
  onArchive,
}: {
  note: MasteringNote;
  systems: System[];
  sections: MasteringSection[];
  isExpanded: boolean;
  onToggle: (id: number) => void;
  draggedId: number | null;
  onDragStart: (id: number | null) => void;
  query: string;
  onChange: () => void;
  onArchive: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const expanded = isExpanded;
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [systemId, setSystemId] = useState(note.system_id ? String(note.system_id) : "");
  const [sectionId, setSectionId] = useState(note.section_id ? String(note.section_id) : "");

  async function save() {
    if (!title.trim()) return;
    await api.put(`/mastering/${note.id}`, {
      title: title.trim(),
      content,
      system_id: systemId ? Number(systemId) : null,
      section_id: sectionId ? Number(sectionId) : null,
    });
    syncMentionLinks("mastering", note.id, note.content, content);
    setEditMode(false);
    if (expanded) onToggle(note.id);
    onChange();
  }

  const showSystem = note.system_name;
  const hasContent = note.content.trim().length > 0;
  const preview = hasContent ? previewText(note.content) : "";

  return (
    <div
      className={`res-row${editMode ? " is-editing" : ""}${draggedId === note.id ? " is-dragging" : ""}`}
      draggable={!editMode}
      onDragStart={(e) => {
        onDragStart(note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => onDragStart(null)}
      style={{ opacity: draggedId === note.id ? 0.5 : 1 }}
    >
      <div
        className="res-row__line"
        onClick={() => !editMode && hasContent && onToggle(note.id)}
        style={{ cursor: hasContent && !editMode ? "pointer" : "default" }}
      >
        <span className="res-row__mark" aria-hidden="true">
          <NavIcon name={note.category === "knowledge" ? "book" : note.category === "live" ? "sword" : "document"} />
        </span>

        <span
          className="res-row__name"
          title={note.title}
          style={{ cursor: hasContent ? "pointer" : "default" }}
          onClick={(e) => {
            e.stopPropagation();
            if (!editMode && hasContent) onToggle(note.id);
          }}
        >
          {highlightParts(note.title, query)}
        </span>

        {showSystem && (
          <span className="res-row__tags">
            <span className="res-row__tag">{note.system_name}</span>
          </span>
        )}

        <span className="res-row__meta">{formatDate(note.created_at)}</span>

        <span className="res-row__actions">
          <button
            type="button"
            className="res-row__act"
            onClick={(e) => {
              e.stopPropagation();
              setTitle(note.title);
              setContent(note.content);
              setSystemId(note.system_id ? String(note.system_id) : "");
              setSectionId(note.section_id ? String(note.section_id) : "");
              setEditMode((v) => !v);
            }}
            title={editMode ? "Отмена" : "Редактировать"}
          >
            <NavIcon name={editMode ? "close" : "edit"} />
          </button>
          <button
            type="button"
            className="res-row__act"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(note.id);
            }}
            title="Архивировать"
          >
            <NavIcon name="archive" />
          </button>
        </span>
      </div>

      {!editMode && hasContent && !expanded && (
        <div
          className="muted"
          style={{ padding: "0 12px 4px 44px", fontSize: 12, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {highlightParts(preview, query)}
        </div>
      )}
      {!editMode && hasContent && expanded && (
        <div className="mastering-article" style={{ whiteSpace: "pre-wrap" }}>
          <MentionText text={note.content} />
        </div>
      )}

      {editMode && (
        <div className="res-row__form stack">
          <label>
            Заголовок
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Система
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
              <option value="">Без системы</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Раздел
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Без раздела</option>
              {sections
                .filter((sec) => sec.category === note.category)
                .map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Текст
            <MentionTextarea value={content} onChange={setContent} rows={4} />
          </label>
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
