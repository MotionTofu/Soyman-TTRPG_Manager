import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from "pdfjs-dist";
import { EventBus, PDFViewer, PDFLinkService, PDFFindController } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { api, getAuthToken } from "../api/client";
import { useAfterWrite, useResource, write } from "../data/hooks";
import type { Resource } from "../types";
import { PdfNotesPanel } from "./PdfNotesPanel";
import { PdfEntityPanel, type PdfEntitySource } from "./PdfEntityPanel";
import { capturePdfSelection, DEFAULT_PDF_PREFERENCES, type PdfNote, type PdfNoteDraft, type PdfReaderPreferences } from "./pdfNotes";
import "./pdf-reader.css";

GlobalWorkerOptions.workerSrc = workerUrl;

type OutlineItem = {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
};

type Reader = { viewer: PDFViewer; bus: EventBus; linkService: PDFLinkService; task: PDFDocumentLoadingTask };
type SelectionMenu = { draft: PdfNoteDraft; left: number; top: number };
type NoteComposer = { id: string | null; draft: PdfNoteDraft; body: string };

function OutlineList({ items, prefix = "", expanded, onToggle, onSelect }: {
  items: OutlineItem[];
  prefix?: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (item: OutlineItem, key: string) => void;
}) {
  return <ul className="pdf-reader__outline-list">
    {items.map((item, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      const hasChildren = item.items.length > 0;
      const isExpanded = expanded.has(key);
      return <li key={key}>
        <div className="pdf-reader__outline-row">
          {hasChildren ? (
            <button type="button" className="pdf-reader__outline-toggle" aria-label={`${isExpanded ? "Свернуть" : "Развернуть"} ${item.title}`}
              aria-expanded={isExpanded} onClick={() => onToggle(key)}>{isExpanded ? "▾" : "▸"}</button>
          ) : <span className="pdf-reader__outline-spacer" />}
          <button type="button" className="pdf-reader__outline-entry" disabled={!item.dest && !hasChildren}
            onClick={() => onSelect(item, key)}>{item.title || "Без названия"}</button>
        </div>
        {hasChildren && isExpanded && <OutlineList items={item.items} prefix={key} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />}
      </li>;
    })}
  </ul>;
}

export function PdfReaderPage() {
  const { id } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/resources";
  const { data: resource, loading, error: resourceError } = useResource<Resource>(id ? `/resources/${id}` : null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const outlineButtonRef = useRef<HTMLButtonElement>(null);
  const outlineCloseRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<PdfNote[]>([]);
  const [preferences, setPreferences] = useState<PdfReaderPreferences>(DEFAULT_PDF_PREFERENCES);
  const preferencesRef = useRef(preferences);
  const preferenceSaveRef = useRef(Promise.resolve());
  const [notesError, setNotesError] = useState("");
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [composer, setComposer] = useState<NoteComposer | null>(null);
  const [entitySelection, setEntitySelection] = useState<{ quote: string; page: number | null } | null>(null);
  const [entityPlacement, setEntityPlacement] = useState<"left" | "right">(() =>
    localStorage.getItem("pdf-entity-placement") === "left" ? "left" : "right");
  const [savingNote, setSavingNote] = useState(false);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const fileUrl = resource?.file_url?.split("?")[0];
  const isPdf = !!resource?.file_url && (resource.category === "pdf" || /\.pdf$/i.test(fileUrl ?? ""));
  const notesPath = id && isPdf ? `/resources/${id}/pdf-notes` : null;
  const preferencesPath = id && isPdf ? `/resources/${id}/pdf-reader-preferences` : null;
  const notesQuery = useResource<PdfNote[]>(notesPath);
  const markdownPath = id && isPdf && notes.length ? `/resources/${id}/pdf-notes-markdown` : null;
  const markdownQuery = useResource<{ resource_id: number }>(markdownPath);
  const preferencesQuery = useResource<PdfReaderPreferences>(preferencesPath);
  const sourceQuery = useResource<PdfEntitySource[]>(id && isPdf ? `/pdf-entity-sources/resource/${id}` : null);
  const afterWrite = useAfterWrite();

  useEffect(() => { if (notesQuery.data) setNotes(notesQuery.data); }, [notesQuery.data]);
  useEffect(() => {
    if (!ready) return;
    const requested = Number(new URLSearchParams(location.search).get("page"));
    const viewer = readerRef.current?.viewer;
    if (viewer && Number.isInteger(requested) && requested > 0 && requested <= pageCount) viewer.currentPageNumber = requested;
  }, [ready, pageCount, location.search]);
  useEffect(() => {
    if (!preferencesQuery.data) return;
    preferencesRef.current = preferencesQuery.data;
    setPreferences(preferencesQuery.data);
  }, [preferencesQuery.data]);

  useEffect(() => {
    if (!fileUrl || !isPdf || !containerRef.current || !viewerRef.current) return;
    let disposed = false;
    const bus = new EventBus();
    const linkService = new PDFLinkService({ eventBus: bus });
    const findController = new PDFFindController({ eventBus: bus, linkService });
    const viewer = new PDFViewer({
      container: containerRef.current, viewer: viewerRef.current,
      eventBus: bus, linkService, findController, textLayerMode: 1, annotationMode: 1,
    });
    linkService.setViewer(viewer);
    const token = getAuthToken();
    const task = getDocument({ url: fileUrl, httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined });
    readerRef.current = { viewer, bus, linkService, task };
    setReady(false);
    setError("");
    setOutline([]);
    setOutlineLoading(true);
    setOutlineError("");
    setOutlineOpen(false);
    setPage(1);
    setPageCount(0);
    setSelectionMenu(null);
    setComposer(null);
    setEntitySelection(null);
    setActiveNoteId(null);
    setHoveredNoteId(null);
    setReattachId(null);
    bus.on("pagesinit", () => {
      if (disposed) return;
      viewer.currentScaleValue = "page-width";
      setReady(true);
      setLayoutTick((value) => value + 1);
    });
    bus.on("pagesloaded", () => { if (!disposed) setLayoutTick((value) => value + 1); });
    bus.on("pagerendered", () => { if (!disposed) setLayoutTick((value) => value + 1); });
    bus.on("pagechanging", (event: { pageNumber: number }) => { if (!disposed) setPage(event.pageNumber); });
    bus.on("scalechanging", () => {
      if (!disposed) {
        setZoom(Math.round(viewer.currentScale * 100));
        setLayoutTick((value) => value + 1);
      }
    });
    void task.promise.then((doc) => {
      if (disposed) return;
      setPageCount(doc.numPages);
      linkService.setDocument(doc);
      viewer.setDocument(doc);
      void doc.getOutline().then((items) => {
        if (disposed) return;
        const entries = (items ?? []) as OutlineItem[];
        setOutline(entries);
        setExpandedOutline(new Set(entries.map((_, index) => String(index))));
      }).catch(() => {
        if (!disposed) setOutlineError("Не удалось прочитать оглавление PDF");
      }).finally(() => {
        if (!disposed) setOutlineLoading(false);
      });
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Не удалось открыть PDF");
      if (!disposed) setOutlineLoading(false);
    });
    return () => {
      disposed = true;
      readerRef.current = null;
      void task.destroy();
    };
  }, [fileUrl, isPdf]);

  useEffect(() => {
    if (!outlineOpen) return;
    outlineCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOutline();
      } else if (event.key === "Tab") {
        const buttons = outlinePanelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [outlineOpen]);

  useEffect(() => {
    if (!selectionMenu && !reattachId) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelectionMenu(null); setReattachId(null); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [selectionMenu, reattachId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.querySelectorAll(".pdf-reader__highlight-layer").forEach((layer) => layer.remove());
    for (const note of notes) {
      if (note.needs_reattach || (!preferences.show_highlights && note.id !== hoveredNoteId)) continue;
      for (const anchor of note.anchors) {
        const pageElement = viewer.querySelector<HTMLElement>(`.page[data-page-number="${anchor.page}"]`);
        if (!pageElement) continue;
        let layer = pageElement.querySelector<HTMLElement>(".pdf-reader__highlight-layer");
        if (!layer) {
          layer = document.createElement("div");
          layer.className = "pdf-reader__highlight-layer";
          pageElement.append(layer);
        }
        for (const rect of anchor.rects) {
          const mark = document.createElement("div");
          mark.className = `pdf-reader__highlight${note.id === hoveredNoteId || note.id === activeNoteId ? " is-active" : ""}`;
          mark.style.left = `${rect.x * 100}%`;
          mark.style.top = `${rect.y * 100}%`;
          mark.style.width = `${rect.w * 100}%`;
          mark.style.height = `${rect.h * 100}%`;
          layer.append(mark);
        }
      }
    }
    return () => viewer.querySelectorAll(".pdf-reader__highlight-layer").forEach((layer) => layer.remove());
  }, [notes, preferences.show_highlights, hoveredNoteId, activeNoteId, ready, layoutTick]);

  function closeOutline() {
    setOutlineOpen(false);
    outlineButtonRef.current?.focus();
  }

  function toggleOutline(key: string) {
    setExpandedOutline((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectOutlineItem(item: OutlineItem, key: string) {
    if (!item.dest) {
      toggleOutline(key);
      return;
    }
    const destination = item.dest;
    void readerRef.current?.linkService.goToDestination(destination).then(() => {
      closeOutline();
    }).catch(() => {
      setOutlineError("Не удалось перейти к этому разделу");
    });
  }

  function updatePreferences(patch: Partial<PdfReaderPreferences>) {
    if (!preferencesPath) return;
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);
    preferenceSaveRef.current = preferenceSaveRef.current.catch(() => undefined)
      .then(() => write.put(preferencesPath, next))
      .then(() => { afterWrite([{ path: preferencesPath }]); })
      .catch(() => { setNotesError("Не удалось сохранить настройки заметок"); });
  }

  function onPdfMouseUp() {
    window.setTimeout(() => {
      const viewer = viewerRef.current;
      const viewport = containerRef.current?.parentElement;
      if (!viewer || !viewport) return;
      const draft = capturePdfSelection(viewer);
      if (!draft) return;
      const selected = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      const box = viewport.getBoundingClientRect();
      const left = Math.max(12, Math.min(box.width - 230, (selected?.right ?? box.left) - box.left));
      const top = Math.max(12, Math.min(box.height - 160, (selected?.bottom ?? box.top) - box.top + 8));
      setSelectionMenu({ draft, left, top });
    }, 0);
  }

  function openComposer(note?: PdfNote, draft?: PdfNoteDraft) {
    const source = draft ?? (note ? {
      quote: note.quote, anchors: note.anchors,
      context_before: note.context_before, context_after: note.context_after,
    } : { quote: "", anchors: [], context_before: "", context_after: "" });
    setComposer({ id: note?.id ?? null, draft: source, body: note?.body ?? "" });
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    if (preferences.notes_collapsed) updatePreferences({ notes_collapsed: false });
  }

  function openEntity(quote = "", selectedPage: number | null = null) {
    setEntitySelection({ quote, page: selectedPage });
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function changeEntityPlacement(value: "left" | "right") {
    setEntityPlacement(value);
    localStorage.setItem("pdf-entity-placement", value);
  }

  async function saveNote() {
    if (!composer || !notesPath || !composer.body.trim()) return;
    setSavingNote(true);
    setNotesError("");
    try {
      if (composer.id) {
        const saved = await write.put<PdfNote>(`${notesPath}/${composer.id}`, { body: composer.body.trim() });
        setNotes((previous) => previous.map((note) => note.id === saved.id ? saved : note));
      } else {
        const saved = await write.post<PdfNote>(notesPath, { ...composer.draft, body: composer.body.trim() });
        setNotes((previous) => [...previous, saved]);
        setActiveNoteId(saved.id);
      }
      afterWrite([{ path: notesPath }, { path: `/resources/${id}/pdf-notes-markdown` }, { path: "/resources" }]);
      setComposer(null);
    } catch (reason) {
      setNotesError(reason instanceof Error ? reason.message : "Не удалось сохранить заметку");
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(note: PdfNote) {
    if (!notesPath || !window.confirm("Удалить заметку?")) return;
    setNotesError("");
    try {
      await write.del(`${notesPath}/${note.id}`);
      setNotes((previous) => previous.filter((item) => item.id !== note.id));
      if (activeNoteId === note.id) setActiveNoteId(null);
      afterWrite([{ path: notesPath }, { path: `/resources/${id}/pdf-notes-markdown` }, { path: "/resources" }]);
    } catch (reason) {
      setNotesError(reason instanceof Error ? reason.message : "Не удалось удалить заметку");
    }
  }

  async function reattachNote(draft: PdfNoteDraft) {
    if (!notesPath || !reattachId) return;
    setNotesError("");
    try {
      const saved = await write.put<PdfNote>(`${notesPath}/${reattachId}`, draft);
      setNotes((previous) => previous.map((note) => note.id === saved.id ? saved : note));
      setActiveNoteId(saved.id);
      setReattachId(null);
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
      afterWrite([{ path: notesPath }, { path: `/resources/${id}/pdf-notes-markdown` }, { path: "/resources" }]);
    } catch (reason) {
      setNotesError(reason instanceof Error ? reason.message : "Не удалось перепривязать заметку");
    }
  }

  function locateNote(note: PdfNote) {
    if (note.needs_reattach || note.page_number == null) return;
    const viewer = readerRef.current?.viewer;
    if (!viewer) return;
    const firstRect = note.anchors[0]?.rects[0];
    const pageView = viewer.getPageView(note.page_number - 1);
    if (firstRect && pageView) {
      const [, pdfY] = pageView.viewport.convertToPdfPoint(0, firstRect.y * pageView.viewport.height);
      viewer.scrollPageIntoView({ pageNumber: note.page_number, destArray: [null, { name: "XYZ" }, 0, pdfY, null], ignoreDestinationZoom: true });
    } else viewer.currentPageNumber = note.page_number;
    setActiveNoteId(note.id);
  }

  function goToPage(value: number) {
    const viewer = readerRef.current?.viewer;
    if (viewer && pageCount) viewer.currentPageNumber = Math.max(1, Math.min(pageCount, value));
  }

  function search(value: string, again = false) {
    setQuery(value);
    readerRef.current?.bus.dispatch(value ? "find" : "findbarclose", value ? {
      source: null, type: again ? "again" : "", query: value,
      caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false,
    } : { source: null });
  }

  async function download() {
    if (!id) return;
    try {
      const fresh = await api.get<Resource>(`/resources/${id}`);
      if (!fresh.file_url) throw new Error("Файл не найден");
      const link = document.createElement("a");
      link.href = fresh.file_url;
      link.download = `${fresh.name}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать PDF");
    }
  }

  if (loading) return <p className="muted">Открываю Ресурс…</p>;
  if (resourceError) return <p role="alert">{resourceError} <Link to="/resources">К Ресурсам</Link></p>;
  if (!resource) return <p role="alert">Ресурс не найден. <Link to="/resources">К Ресурсам</Link></p>;
  if (!isPdf) return <p role="alert">У этого Ресурса нет загруженного PDF. <Link to="/resources">К Ресурсам</Link></p>;

  return (
    <section className="pdf-reader" aria-label={`Читалка: ${resource.name}`}>
      <header className="pdf-reader__toolbar">
        <Link to={returnTo}>← Назад</Link>
        <strong className="pdf-reader__title" title={resource.name}>{resource.name}</strong>
        <div className="pdf-reader__controls">
          <button ref={outlineButtonRef} type="button" aria-expanded={outlineOpen} aria-controls="pdf-reader-outline"
            onClick={() => setOutlineOpen((value) => !value)} disabled={!ready}>☰ Главы</button>
          <button type="button" aria-expanded={!preferences.notes_collapsed} onClick={() => updatePreferences({ notes_collapsed: !preferences.notes_collapsed })}
            disabled={!ready}>Заметки ({notes.length})</button>
          <button type="button" onClick={() => openComposer()} disabled={!ready}>+ Общая заметка</button>
          <button type="button" aria-expanded={!!entitySelection} onClick={() => entitySelection ? setEntitySelection(null) : openEntity()} disabled={!ready}>Сущности{sourceQuery.data?.length ? ` (${sourceQuery.data.length})` : ""}</button>
          {markdownQuery.data && <Link to={`/resources/${markdownQuery.data.resource_id}/markdown`} state={{ from: `${location.pathname}${location.search}` }}>Заметки .md</Link>}
          <button type="button" onClick={() => goToPage(page - 1)} disabled={!ready || page <= 1} aria-label="Предыдущая страница">‹</button>
          <input aria-label="Номер страницы" type="number" min={1} max={pageCount || 1} value={page}
            onChange={(event) => goToPage(Number(event.target.value))} disabled={!ready} />
          <span>из {pageCount || "—"}</span>
          <button type="button" onClick={() => goToPage(page + 1)} disabled={!ready || page >= pageCount} aria-label="Следующая страница">›</button>
          <button type="button" onClick={() => { const v = readerRef.current?.viewer; if (v) v.currentScale = Math.max(0.5, v.currentScale / 1.2); }} disabled={!ready} aria-label="Уменьшить">−</button>
          <span>{zoom}%</span>
          <button type="button" onClick={() => { const v = readerRef.current?.viewer; if (v) v.currentScale = Math.min(3, v.currentScale * 1.2); }} disabled={!ready} aria-label="Увеличить">+</button>
          <button type="button" onClick={() => { const v = readerRef.current?.viewer; if (v) v.currentScaleValue = "page-width"; }} disabled={!ready}>По ширине</button>
          <input aria-label="Поиск в PDF" type="search" placeholder="Поиск в PDF" value={query} onChange={(event) => search(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") search(query, true); }} disabled={!ready} />
          {resource.file_url && <button type="button" onClick={() => void download()}>Скачать</button>}
        </div>
      </header>
      {error && <p className="pdf-reader__error" role="alert">PDF не открылся: {error}</p>}
      {!ready && !error && <p className="pdf-reader__loading">Загружаю PDF…</p>}
      {preferences.notes_collapsed && notesError && <p className="pdf-reader__error" role="alert">{notesError}</p>}
      <div className={`pdf-reader__viewport${preferences.notes_collapsed ? "" : " has-notes"}${entitySelection ? entityPlacement === "left" ? " has-left-entity" : " has-right-entity" : ""}`}>
        <div ref={containerRef} className="pdf-reader__container" tabIndex={0} onMouseUp={onPdfMouseUp} onClick={(event) => {
          if (window.getSelection()?.toString().trim()) return;
          const element = event.target as HTMLElement;
          const pageElement = element.closest<HTMLElement>(".page");
          if (!pageElement) return;
          const box = pageElement.getBoundingClientRect();
          const pageNumber = Number(pageElement.dataset.pageNumber);
          const x = (event.clientX - box.left) / box.width;
          const y = (event.clientY - box.top) / box.height;
          const hit = notes.find((note) => !note.needs_reattach && note.anchors.some((anchor) =>
            anchor.page === pageNumber && anchor.rects.some((rect) =>
              x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)));
          if (hit) { setActiveNoteId(hit.id); if (preferences.notes_collapsed) updatePreferences({ notes_collapsed: false }); }
        }}>
          <div ref={viewerRef} className="pdfViewer" />
        </div>
        {!preferences.notes_collapsed && <PdfNotesPanel notes={notes} preferences={preferences} onPreferenceChange={updatePreferences}
          onCollapse={() => updatePreferences({ notes_collapsed: true })}
          actions={{ onHover: setHoveredNoteId, onLocate: locateNote, onEdit: (note) => openComposer(note),
            onDelete: (note) => void deleteNote(note), onReattach: (note) => { setReattachId(note.id); setSelectionMenu(null); } }}
          activeId={activeNoteId} container={containerRef.current} viewer={viewerRef.current} zoom={zoom} layoutTick={layoutTick}
          loading={notesQuery.loading} error={notesError || notesQuery.error} />}
        {reattachId && <div className="pdf-reader__reattach-hint" role="status">
          Выделите новую цитату для перепривязки заметки.
          <button type="button" onClick={() => setReattachId(null)}>Отмена</button>
        </div>}
        {selectionMenu && <div className="pdf-reader__selection-menu" style={{ left: selectionMenu.left, top: selectionMenu.top }}>
          <div><span title={selectionMenu.draft.quote}>«{selectionMenu.draft.quote}»</span>
            <button type="button" aria-label="Закрыть меню выделения" onClick={() => { setSelectionMenu(null); window.getSelection()?.removeAllRanges(); }}>×</button>
          </div>
          <button type="button" onClick={() => reattachId ? void reattachNote(selectionMenu.draft) : openComposer(undefined, selectionMenu.draft)}>
            {reattachId ? "Привязать к заметке" : "+ Заметка к цитате"}
          </button>
          {!reattachId && <button type="button" onClick={() => openEntity(selectionMenu.draft.quote, selectionMenu.draft.anchors[0]?.page ?? page)}>
            + Сущность из цитаты
          </button>}
        </div>}
        {entitySelection && <PdfEntityPanel key={`${id}-${entitySelection.quote}-${entitySelection.page}`} resource={resource}
          sources={sourceQuery.data ?? []} quote={entitySelection.quote} page={entitySelection.page} placement={entityPlacement}
          onPlacementChange={changeEntityPlacement} onClose={() => setEntitySelection(null)} />}
        {composer && <div className="pdf-reader__composer" role="dialog" aria-label={composer.id ? "Править заметку" : "Новая заметка"}>
          <div className="pdf-reader__composer-head"><strong>{composer.id ? "Править заметку" : "Новая заметка"}</strong>
            <button type="button" aria-label="Закрыть редактор заметки" onClick={() => setComposer(null)}>×</button></div>
          {composer.draft.quote ? <blockquote>{composer.draft.quote}</blockquote> : <p>Заметка ко всему PDF</p>}
          <textarea aria-label="Текст заметки" value={composer.body} onChange={(event) => setComposer({ ...composer, body: event.target.value })}
            placeholder="Ваши мысли о фрагменте…" />
          <button type="button" onClick={() => void saveNote()} disabled={savingNote || !composer.body.trim()}>
            {savingNote ? "Сохраняю…" : "Сохранить заметку"}</button>
        </div>}
        {outlineOpen && <>
          <button type="button" className="pdf-reader__outline-backdrop" aria-label="Закрыть оглавление" onClick={closeOutline} />
          <aside ref={outlinePanelRef} id="pdf-reader-outline" className="pdf-reader__outline" role="dialog" aria-modal="true" aria-label="Главы PDF">
            <header className="pdf-reader__outline-header">
              <strong>Главы PDF</strong>
              <button ref={outlineCloseRef} type="button" aria-label="Закрыть главы" onClick={closeOutline}>×</button>
            </header>
            <div className="pdf-reader__outline-body">
              {outlineLoading ? <p className="muted">Загружаю оглавление…</p> :
                <>
                  {outlineError && <p role="alert">{outlineError}</p>}
                  {outline.length === 0 && !outlineError ? <p className="muted">В этом PDF нет встроенного оглавления с главами.</p> :
                    <OutlineList items={outline} expanded={expandedOutline} onToggle={toggleOutline} onSelect={selectOutlineItem} />}
                </>}
            </div>
          </aside>
        </>}
      </div>
    </section>
  );
}
