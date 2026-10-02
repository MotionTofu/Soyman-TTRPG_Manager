import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { dataKeys } from "../data/entities";
import { labelled } from "../data/notices";
import { getCachedUser } from "../api/currentUser";
import { syncMentionLinks } from "../mentions";
import { PageFrame } from "../components/PageFrame";
import { EmptyState } from "../components/EmptyState";
import { SectionBackground } from "../components/SectionBackground";
import { LoadErrorCard, ListSkeleton } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { NavIcon } from "../components/NavIcons";
import { useConfirm } from "../hooks/useConfirm";
import { MasteringBookForm } from "../components/mastering/MasteringBookForm";
import { MASTERING_AFFECTS, MASTERING_CATEGORIES, type MasteringDraft } from "../components/mastering/masteringTypes";
import { MasteringShelf } from "../components/mastering/MasteringShelf";
import { MasteringReader } from "../components/mastering/MasteringReader";
import type { MasteringBook, MasteringNote, MasteringSection, System } from "../types";
import "./mastering-library.css";

const NO_BOOKS: MasteringBook[] = [];
const NO_SECTIONS: MasteringSection[] = [];
const NO_SYSTEMS: System[] = [];
type ResolvedCover = { uid: string; category: string | null; file_url: string | null };
const RESOURCE_IMAGE = /^soyman:resource\/([0-9a-f-]{36})$/i;

export function MasteringPage() {
  const [dialog, confirm] = useConfirm();
  const client = useQueryClient();
  const run = useAction();
  const [category, setCategory] = useState<MasteringNote["category"]>("prep");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [systemFilters, setSystemFilters] = useState<Set<number | null>>(new Set());
  const [form, setForm] = useState<MasteringDraft | null>(null);
  const [sectionForm, setSectionForm] = useState<{ section: MasteringSection | null; name: string; system_id: number | null } | null>(null);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [readingOrder, setReadingOrder] = useState<number[]>([]);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const bookmarkKey = `masteringBookBookmarks:${getCachedUser()?.id ?? "gm"}`;
  const [bookmarked] = useState<Set<number>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(bookmarkKey) ?? "[]"); return new Set(Array.isArray(saved) ? saved.filter((id): id is number => typeof id === "number") : []); }
    catch { return new Set(); }
  });
  const searching = !!query.trim();
  const params = new URLSearchParams({ view: "library" });
  if (searching) params.set("q", query.trim());
  else params.set("category", category);
  const booksPath = `/mastering?${params}`;
  const bookQuery = useResource<MasteringBook[]>(booksPath, { keepPrevious: true });
  const sectionQuery = useResource<MasteringSection[]>("/mastering/sections");
  const systems = useResource<System[]>("/systems").data ?? NO_SYSTEMS;
  const sections = sectionQuery.data ?? NO_SECTIONS;
  const books = bookQuery.data ?? NO_BOOKS;
  // Открытая книга остаётся доступна, пока перечитывается список после её правки.
  const selectedBook = useRef<MasteringBook | null>(null);
  if (selectedId != null) selectedBook.current = books.find(book => book.id === selectedId) ?? selectedBook.current;
  const readingBook = selectedId === selectedBook.current?.id ? selectedBook.current : null;
  const availableOrder = readingOrder.filter(id => books.some(book => book.id === id));
  const readingIndex = selectedId == null ? -1 : availableOrder.indexOf(selectedId);
  const previousBook = readingIndex > 0 ? books.find(book => book.id === availableOrder[readingIndex - 1]) : undefined;
  const nextBook = readingIndex >= 0 ? books.find(book => book.id === availableOrder[readingIndex + 1]) : undefined;
  const filtered = books.filter(book => (searching || book.category === category) && (!systemFilters.size || systemFilters.has(book.system_id)));
  const resources = useMemo(() => [...new Set(books.flatMap(book => {
    const uid = RESOURCE_IMAGE.exec(book.cover_image ?? "")?.[1]; return uid ? [uid.toLowerCase()] : [];
  }))].sort(), [books]);
  // resolve принимает до 100 ключей: большие библиотеки читаем пачками.
  const coverQueries = useQueries({ queries: Array.from({ length: Math.ceil(resources.length / 100) }, (_, index) =>
    resourceQuery<ResolvedCover[]>(`/resources/resolve?uids=${resources.slice(index * 100, (index + 1) * 100).join(",")}`)) });
  const resolved = coverQueries.flatMap(result => result.data ?? []);
  const covers = useMemo(() => {
    const result = new Map<string, string>();
    for (const book of books) {
      const src = book.cover_image;
      if (!src) continue;
      const uid = RESOURCE_IMAGE.exec(src)?.[1]?.toLowerCase();
      if (uid) {
        const image = resolved.find(resource => resource.uid.toLowerCase() === uid);
        if (image?.file_url && (image.category === "image" || /\.(png|jpe?g|webp|gif|avif)(?:\?|$)/i.test(image.file_url))) result.set(src, image.file_url);
      } else if (/^https?:\/\//i.test(src) || src.startsWith("/files/")) result.set(src, src);
    }
    return result;
  }, [books, resolved]);
  useEffect(() => {
    try { localStorage.setItem(bookmarkKey, JSON.stringify([...bookmarked])); } catch { /* приватный режим */ }
  }, [bookmarkKey, bookmarked]);

  function toggleSystem(id: number | null) { setSystemFilters(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function newBook(section: MasteringSection | null = null, targetCategory = category) {
    setForm({ title: "", content: "", category: section?.category ?? targetCategory, section_id: section?.id ?? null, system_id: section?.system_id ?? null });
  }
  async function create(draft: MasteringDraft) {
    const created = await run(labelled("Новая книга", () => write.post<MasteringNote>("/mastering", draft)), { affects: MASTERING_AFFECTS, retry: false });
    if (!created) return false;
    syncMentionLinks("mastering", created.id, "", draft.content);
    setCategory(draft.category); setQuery(""); setSystemFilters(new Set());
    return true;
  }
  async function archive(id: number) {
    if (!await confirm({ message: "Отправить книгу в архив?", confirmLabel: "Архивировать", danger: true })) return;
    const archived = await run(labelled("Книга не архивирована", () => write.del(`/mastering/${id}`)), { affects: [...MASTERING_AFFECTS, { path: "/archive" }] });
    if (archived !== undefined) setSelectedId(null);
  }
  async function moveToShelf(target: number | null) {
    const book = books.find(item => item.id === draggedId);
    const shelf = target != null ? sections.find(section => section.id === target) : null;
    setDraggedId(null); setDragOverSection(null);
    if (!book || book.section_id === target || (shelf && shelf.category !== book.category)) return;
    const key = dataKeys.resource(booksPath);
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<MasteringBook[]>(key, previous => previous?.map(item => item.id === book.id ? { ...item, section_id: target } : item));
    const moved = await run(labelled("Книга не перенесена", () => write.put(`/mastering/${book.id}`, { section_id: target })), { affects: MASTERING_AFFECTS });
    if (moved === undefined) void client.invalidateQueries({ queryKey: key });
  }
  async function importMarkdown(file: File | undefined) {
    if (!file || importing.current) return;
    importing.current = true; setImportError("");
    try {
      if (!/\.(md|markdown)$/i.test(file.name)) throw new Error("Выберите файл Markdown (.md или .markdown).");
      if (file.size > 10 * 1024 * 1024) throw new Error("Для статьи выберите Markdown до 10 МБ.");
      const content = (await file.text()).replace(/^\uFEFF/, "");
      setForm({ category, title: /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || file.name.replace(/\.(md|markdown)$/i, ""), content, section_id: null, system_id: null });
    } catch (error) { setImportError(error instanceof Error ? error.message : "Не удалось прочитать Markdown."); }
    finally { importing.current = false; }
  }
  async function saveSection() {
    if (!sectionForm?.name.trim() || sectionSaving) return;
    setSectionSaving(true);
    try {
      const fields = { name: sectionForm.name.trim(), system_id: sectionForm.system_id };
      const result = await run(labelled("Полка", () => sectionForm.section
        ? write.put(`/mastering/sections/${sectionForm.section.id}`, fields)
        : write.post("/mastering/sections", { ...fields, category })), { affects: MASTERING_AFFECTS, retry: false });
      if (result !== undefined) setSectionForm(null);
    } finally { setSectionSaving(false); }
  }
  async function deleteSection() {
    const section = sectionForm?.section;
    if (!section || sectionSaving || !await confirm({ message: `Удалить полку «${section.name}»? Книги перейдут в «Без раздела».`, confirmLabel: "Удалить полку", danger: true })) return;
    setSectionSaving(true);
    try {
      const result = await run(labelled("Полка не удалена", () => write.del(`/mastering/sections/${section.id}`)), { affects: MASTERING_AFFECTS });
      if (result !== undefined) setSectionForm(null);
    } finally { setSectionSaving(false); }
  }
  function closeReader() {
    const id = selectedId; setSelectedId(null);
    requestAnimationFrame(() => document.getElementById(`mastering-book-${id}`)?.focus());
  }
  function openBook(id: number, order: number[]) { setReadingOrder(order); setSelectedId(id); }
  const visibleSections = sections.filter(section => searching || section.category === category);
  const searchFiltered = searching || systemFilters.size > 0;
  const busy = bookQuery.loading || sectionQuery.loading;
  const error = bookQuery.error || sectionQuery.error;
  const refresh = () => { bookQuery.reload(); sectionQuery.reload(); };

  return <PageFrame section="mastering" title="Библиотека" className={`mastering-page mastering-library${readingBook ? " is-reading" : ""}`}>
    {dialog}<SectionBackground />
    <div hidden={!!readingBook}>
      {/* каркас в обход намеренно — категории заготовок относятся к Мастерению, а не к каталогу сущностей */}
      <div className="tabs" role="group" aria-label="Категории библиотеки">{MASTERING_CATEGORIES.map(item => <button key={item.key} className={category === item.key ? "active" : ""} aria-pressed={category === item.key} onClick={() => { setCategory(item.key); setQuery(""); setFiltersOpen(false); }}>{item.label}</button>)}</div>
      <div className="mastering-toolbar">
        <label className="mastering-search"><NavIcon name="search" /><input type="search" aria-label="Поиск по всем книгам" placeholder="Найти книгу на любой полке…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" aria-expanded={filtersOpen} aria-controls="mastering-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Фильтры{systemFilters.size > 0 && ` · ${systemFilters.size}`}</button>
        <button type="button" onClick={() => fileInput.current?.click()}><NavIcon name="upload" /> Загрузить .md</button>
        <button type="button" onClick={() => setSectionForm({ section: null, name: "", system_id: null })}><NavIcon name="plus" /> Полка</button>
        <button type="button" className="primary" onClick={() => newBook()}><NavIcon name="plus" /> Книга</button>
        <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" hidden aria-label="Загрузить Markdown" onChange={event => { void importMarkdown(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {filtersOpen && <div className="mastering-filters" id="mastering-filters"><span>Система</span><button type="button" aria-pressed={!systemFilters.size} onClick={() => setSystemFilters(new Set())}>Все</button>{systems.map(system => <button type="button" key={system.id} aria-pressed={systemFilters.has(system.id)} onClick={() => toggleSystem(system.id)}>{system.name}</button>)}<button type="button" aria-pressed={systemFilters.has(null)} onClick={() => toggleSystem(null)}>Без системы</button></div>}
      {importError && <LoadErrorCard message={importError} action={<button onClick={() => setImportError("")}>Закрыть</button>} />}
      {error && <LoadErrorCard message={`Не удалось загрузить библиотеку: ${error}`} onRetry={refresh} />}
      {busy && !books.length && !sections.length ? <ListSkeleton variant="tiles" label="Загрузка библиотеки" /> : <>
        {searching && <p className="mastering-search-results" role="status">Найдено книг: {filtered.length} · во всех категориях</p>}
        <div className="mastering-shelves" onDragOver={event => {
          if (draggedId == null) return;
          const target = (event.target as HTMLElement).closest<HTMLElement>("[data-shelf-key]");
          setDragOverSection(target?.dataset.shelfKey ?? null);
        }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverSection(null); }}>
          {visibleSections.map(section => {
            const items = filtered.filter(book => book.section_id === section.id);
            if (searchFiltered && !items.length) return null;
            return <div key={section.id} data-shelf-key={String(section.id)}><MasteringShelf shelf={section} books={items} categoryLabel={searching ? MASTERING_CATEGORIES.find(item => item.key === section.category)?.label : undefined} search={searching} covers={covers} bookmarked={bookmarked} dragging={draggedId} dragOver={dragOverSection === String(section.id)} onDrag={id => { setDraggedId(id); if (id == null) setDragOverSection(null); }} onDrop={id => void moveToShelf(id)} onAdd={() => newBook(section)} onEditShelf={() => setSectionForm({ section, name: section.name, system_id: section.system_id })} onOpen={openBook} /></div>;
          })}
          {MASTERING_CATEGORIES.filter(item => searching || item.key === category).map(item => {
            const items = filtered.filter(book => book.section_id == null && book.category === item.key);
            // Пустой хвост нужен как место назначения при переносе книги.
            if (!items.length && (draggedId == null || books.find(book => book.id === draggedId)?.category !== item.key)) return null;
            return <div key={`unsectioned-${item.key}`} data-shelf-key={`unsectioned-${item.key}`}><MasteringShelf shelf={null} books={items} categoryLabel={searching ? item.label : undefined} search={searching} covers={covers} bookmarked={bookmarked} dragging={draggedId} dragOver={dragOverSection === `unsectioned-${item.key}`} onDrag={id => { setDraggedId(id); if (id == null) setDragOverSection(null); }} onDrop={() => void moveToShelf(null)} onAdd={() => newBook(null, item.key)} onOpen={openBook} /></div>;
          })}
        </div>
        {!filtered.length && (searchFiltered || !visibleSections.length) && !error && !busy && <EmptyState kind={searchFiltered ? "search" : "primary"} title={searchFiltered ? "Книг не найдено" : "Библиотека ждёт первую книгу"} hint={searchFiltered ? "Попробуйте другое название или снимите фильтр системы." : "Создайте полку или добавьте статью — она станет книгой в вашей библиотеке."} action={searchFiltered ? <button onClick={() => { setQuery(""); setSystemFilters(new Set()); }}>Сбросить фильтры</button> : <button className="primary" onClick={() => newBook()}>Добавить книгу</button>} />}
      </>}
    </div>
    {readingBook && <MasteringReader key={readingBook.id} book={readingBook} previousBook={previousBook} nextBook={nextBook} onNavigate={setSelectedId} sections={sections} systems={systems} onClose={closeReader} onArchive={() => archive(readingBook.id)} />}
    {form && <MasteringBookForm initial={form} systems={systems} sections={sections} onSubmit={create} onClose={() => setForm(null)} />}
    {sectionForm && <Modal ariaLabel={sectionForm.section ? "Настройки полки" : "Новая полка"} closeOnBackdropClick={false} onClose={() => { if (!sectionSaving) setSectionForm(null); }}><form className="mastering-book-form" onSubmit={event => { event.preventDefault(); void saveSection(); }}><h2>{sectionForm.section ? "Настройки полки" : "Новая полка"}</h2><label>Название полки<input required value={sectionForm.name} onChange={event => setSectionForm({ ...sectionForm, name: event.target.value })} placeholder="Например, Подготовка сессии" /></label><label>Система<select value={sectionForm.system_id ?? ""} onChange={event => setSectionForm({ ...sectionForm, system_id: event.target.value ? Number(event.target.value) : null })}><option value="">Без системы</option>{systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}</select></label><div className="mastering-form-actions">{sectionForm.section && <button type="button" className="danger" disabled={sectionSaving} onClick={() => void deleteSection()}>Удалить полку</button>}<button type="button" disabled={sectionSaving} onClick={() => setSectionForm(null)}>Отмена</button><button type="submit" className="primary" disabled={sectionSaving || !sectionForm.name.trim()}>{sectionSaving ? "Сохраняем…" : sectionForm.section ? "Сохранить" : "Создать полку"}</button></div></form></Modal>}
  </PageFrame>;
}
