import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MentionText } from "../components/mentions/MentionText";
import type { PdfNote, PdfReaderPreferences } from "./pdfNotes";
import { ReaderNoteCard } from "../components/ReaderNoteCard";

type PageMetric = { page: number; top: number; height: number };

type NoteActions = {
  onHover: (id: string | null) => void;
  onLocate: (note: PdfNote) => void;
  onEdit: (note: PdfNote) => void;
  onDelete: (note: PdfNote) => void;
  onReattach: (note: PdfNote) => void;
};

function noteLabel(note: PdfNote, numbers: ReadonlyMap<string, number>) {
  if (note.page_number == null) return "Вся книга";
  const number = numbers.get(note.id);
  return number == null ? `Стр. ${note.page_number}` : `№${number} · Стр. ${note.page_number} · Цитата`;
}

function NoteCard({ note, numberMap, active, actions, onOpen }: {
  note: PdfNote; numberMap: ReadonlyMap<string, number>; active: boolean; actions: NoteActions; onOpen: (note: PdfNote) => void;
}) {
  return <ReaderNoteCard note={note} active={active} general={note.page_number == null} locationLabel={noteLabel(note, numberMap)}
    editInHeader staleLabel="Проверьте привязку к PDF" canLocate={note.page_number != null} actions={actions} onOpen={onOpen} />;
}

function MarginLane({ metric, notes, noteNumbers, activeId, actions, onOpen }: {
  metric: PageMetric; notes: PdfNote[]; noteNumbers: ReadonlyMap<string, number>;
  activeId: string | null; actions: NoteActions; onOpen: (note: PdfNote) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const lane = ref.current;
    if (!lane) return;
    const cards = [...lane.querySelectorAll<HTMLElement>(".pdf-reader__note-card")];
    const startDensity = notes.length >= 8 ? 3 : notes.length >= 5 ? 2 : notes.length >= 3 ? 1 : 0;
    const topPadding = 25;
    const bottomPadding = 8;
    let density = startDensity;
    let heights: number[] = [];
    let gap = 8;
    for (; density <= 3; density++) {
      lane.dataset.density = String(density);
      gap = [9, 7, 5, 4][density];
      heights = cards.map((card) => card.offsetHeight);
      if (heights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, cards.length - 1) <= metric.height - topPadding - bottomPadding) break;
    }
    if (density > 3) {
      lane.dataset.density = "3";
      lane.classList.add("is-scrollable");
      for (const card of cards) { card.style.position = "relative"; card.style.top = ""; }
      return;
    }
    lane.classList.remove("is-scrollable");
    const tops: number[] = [];
    for (let index = 0; index < cards.length; index++) {
      const desired = (notes[index].anchors[0]?.rects[0]?.y ?? 0) * metric.height;
      tops[index] = Math.max(topPadding, desired, index ? tops[index - 1] + heights[index - 1] + gap : topPadding);
    }
    for (let index = cards.length - 1; index >= 0; index--) {
      const limit = index === cards.length - 1 ? metric.height - bottomPadding : tops[index + 1] - gap;
      tops[index] = Math.min(tops[index], limit - heights[index]);
      cards[index].style.position = "absolute";
      cards[index].style.top = `${tops[index]}px`;
    }
  }, [notes, metric.height]);
  // инлайн-стиль намеренно — дорожка заметок стоит по измеренной странице PDF
  return <div ref={ref} className="pdf-reader__notes-lane" style={{ top: metric.top, height: metric.height }}>
    <div className="pdf-reader__notes-lane-heading">Стр. {metric.page} · {notes.length} заметок</div>
    {notes.map((note) => <NoteCard key={note.id} note={note} numberMap={noteNumbers} active={activeId === note.id} actions={actions} onOpen={onOpen} />)}
  </div>;
}

export function PdfNotesPanel({ notes, noteNumbers, preferences, onPreferenceChange, continuous, onContinuousChange, onAddNote, ready, actions, activeId,
  container, viewer, zoom, layoutTick, loading, error }: {
  notes: PdfNote[];
  noteNumbers: ReadonlyMap<string, number>;
  preferences: PdfReaderPreferences;
  onPreferenceChange: (patch: Partial<PdfReaderPreferences>) => void;
  continuous: boolean;
  onContinuousChange: (value: boolean) => void;
  onAddNote: () => void;
  ready: boolean;
  actions: NoteActions;
  activeId: string | null;
  container: HTMLDivElement | null;
  viewer: HTMLDivElement | null;
  zoom: number;
  layoutTick: number;
  loading: boolean;
  error: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openedNoteId, setOpenedNoteId] = useState<string | null>(null);
  const openedNote = notes.find((note) => note.id === openedNoteId);
  const openNote = (note: PdfNote) => { setOpenedNoteId(note.id); actions.onHover(note.id); };
  const closeNote = () => { setOpenedNoteId(null); actions.onHover(null); };
  useEffect(() => {
    if (!openedNoteId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpenedNoteId(null); actions.onHover(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openedNoteId, actions]);
  const general = notes.filter((note) => note.page_number == null);
  const pageNotes = notes.filter((note) => note.page_number != null);
  const groups = new Map<number, PdfNote[]>();
  for (const note of pageNotes) {
    const page = note.page_number!;
    groups.set(page, [...(groups.get(page) ?? []), note]);
  }
  const metrics = [...groups].map(([page, group]) => {
    const element = viewer?.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`);
    return element ? { metric: { page, top: element.offsetTop, height: element.clientHeight }, group } : null;
  }).filter((item): item is { metric: PageMetric; group: PdfNote[] } => item !== null);

  useLayoutEffect(() => {
    if (continuous || preferences.note_mode !== "margins" || !container || !scrollRef.current) return;
    const sync = () => { if (scrollRef.current) scrollRef.current.scrollTop = container.scrollTop; };
    sync();
    container.addEventListener("scroll", sync);
    return () => container.removeEventListener("scroll", sync);
  }, [container, continuous, preferences.note_mode, zoom, layoutTick]);

  return <div className="pdf-reader__notes" role="tabpanel" aria-label="Заметки к PDF">
    <div className="pdf-reader__notes-controls">
      <div role="group" aria-label="Режим заметок">
        <button type="button" aria-pressed={!continuous && preferences.note_mode === "list"}
          onClick={() => { onContinuousChange(false); onPreferenceChange({ note_mode: "list" }); }}>Список</button>
        <button type="button" aria-pressed={!continuous && preferences.note_mode === "margins"}
          onClick={() => { onContinuousChange(false); onPreferenceChange({ note_mode: "margins" }); }}>У страниц</button>
        <button type="button" aria-pressed={continuous} onClick={() => onContinuousChange(true)}>Одним текстом</button>
      </div>
      <div className="pdf-reader__notes-actions">
        <button type="button" disabled={!ready} onClick={onAddNote}>+ Общая заметка</button>
        <label><input className="pdf-reader__highlight-toggle" type="checkbox" checked={preferences.show_highlights}
          onChange={(event) => onPreferenceChange({ show_highlights: event.target.checked })} /> Подсветка</label>
      </div>
    </div>
    {!continuous && preferences.note_mode === "margins" && general.length > 0 &&
      <div className="pdf-reader__notes-general"><strong>Ко всей книге</strong>
        {general.map((note) => <NoteCard key={note.id} note={note} numberMap={noteNumbers} active={activeId === note.id} actions={actions} onOpen={openNote} />)}
      </div>}
    <div ref={scrollRef} className="pdf-reader__notes-scroll" onScroll={(event) => {
      if (!continuous && preferences.note_mode === "margins" && container && Math.abs(container.scrollTop - event.currentTarget.scrollTop) > 1)
        container.scrollTop = event.currentTarget.scrollTop;
    }}>
      {loading && <p className="muted">Загружаю заметки…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !notes.length && <p className="pdf-reader__notes-empty">Выделите цитату в PDF или создайте общую заметку.</p>}
      {continuous ? <div className="pdf-reader__notes-list">
        {notes.map(note => <article key={note.id} className="pdf-reader__note-card">
          <h3>{noteLabel(note, noteNumbers)}</h3>
          {note.quote && <blockquote>{note.quote}</blockquote>}
          <MentionText text={note.body} />
          {note.needs_reattach && <p>Проверьте привязку к PDF</p>}
          {note.page_number != null && !note.needs_reattach &&
            <button type="button" onClick={() => actions.onLocate(note)}>К цитате</button>}
        </article>)}
      </div> : preferences.note_mode === "list" ?
        <div className="pdf-reader__notes-list">{notes.map((note) => <NoteCard key={note.id} note={note} numberMap={noteNumbers} active={activeId === note.id} actions={actions} onOpen={openNote} />)}</div> :
        // инлайн-стиль намеренно — высота полотна заметок повторяет прокрутку читалки
        <div className="pdf-reader__notes-canvas" style={{ height: Math.max(viewer?.scrollHeight ?? 0, container?.clientHeight ?? 0) }}>
          {metrics.map(({ metric, group }) => <MarginLane key={metric.page} metric={metric} notes={group} noteNumbers={noteNumbers} activeId={activeId} actions={actions} onOpen={openNote} />)}
        </div>}
    </div>
    {openedNote && <div className="pdf-reader__note-detail" role="dialog" aria-label="Полная заметка">
      <div className="pdf-reader__note-detail-head">
        <div>
          <strong>{noteLabel(openedNote, noteNumbers)}</strong>
          <time dateTime={openedNote.created_at}>{new Date(openedNote.created_at).toLocaleDateString("ru-RU")}</time>
        </div>
        <button type="button" onClick={closeNote} aria-label="Закрыть полную заметку">×</button>
      </div>
      {openedNote.needs_reattach && <div className="pdf-reader__note-stale">Проверьте привязку к PDF</div>}
      {openedNote.quote && <blockquote>{openedNote.quote}</blockquote>}
      <div className="pdf-reader__note-body"><MentionText text={openedNote.body} /></div>
      <div className="pdf-reader__note-actions">
        {openedNote.page_number != null && !openedNote.needs_reattach && <button type="button" onClick={() => actions.onLocate(openedNote)}>К цитате</button>}
        {openedNote.needs_reattach && <button type="button" onClick={() => { actions.onReattach(openedNote); closeNote(); }}>Перепривязать</button>}
        <button type="button" onClick={() => { actions.onEdit(openedNote); closeNote(); }}>Править</button>
      </div>
    </div>}
  </div>;
}
