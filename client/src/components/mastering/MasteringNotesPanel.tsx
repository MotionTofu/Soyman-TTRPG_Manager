import { useLayoutEffect, useMemo, useRef } from "react";
import { ReaderNoteCard, type ReaderNoteActions } from "../ReaderNoteCard";
import type { TextNote } from "./textNotes";
import type { LocatedTextNote } from "./useMasteringAnnotations";

export function MasteringNotesPanel({ notes, mode, showHighlights, prose, activeId, loading, error, onRetry, onMode, onHighlights, onClose, onAdd, onExport, onOpen, actions }: {
  notes: LocatedTextNote[]; mode: "margins" | "list"; showHighlights: boolean; prose: HTMLDivElement | null;
  activeId: string | null; loading: boolean; error: string | null;
  onRetry: () => void; onMode: (mode: "margins" | "list") => void; onHighlights: (value: boolean) => void;
  onClose: () => void; onAdd: () => void; onExport: () => void; onOpen: (id: string) => void; actions: ReaderNoteActions<TextNote>;
}) {
  const scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  const syncedTop = useRef(0);
  const general = notes.filter(note => !note.anchor || !note.located);
  const anchored = useMemo(() => notes.filter(note => note.anchor && note.located).sort((a, b) => a.top - b.top || a.created_at.localeCompare(b.created_at)), [notes]);
  useLayoutEffect(() => { if (mode === "list" && scroll.current) scroll.current.scrollTop = 0; }, [mode]);
  useLayoutEffect(() => {
    const lane = canvas.current;
    if (!lane || !prose || mode !== "margins") return;
    const measure = () => {
      const cards = [...lane.querySelectorAll<HTMLElement>(".pdf-reader__note-card")];
      if (!cards.length) { lane.style.height = "0px"; return; }
      let bottom = 0;
      cards.forEach((card, index) => { const top = Math.max(anchored[index]?.top ?? 0, bottom); card.style.top = `${top}px`; bottom = top + card.offsetHeight + 12; });
      lane.style.height = `${Math.max(prose.scrollHeight, bottom)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(prose);
    lane.querySelectorAll<HTMLElement>(".pdf-reader__note-card").forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [anchored, prose, mode]);
  useLayoutEffect(() => {
    const viewport = scroll.current, source = prose?.closest<HTMLElement>(".app-content");
    if (!viewport || !prose || mode !== "margins") return;
    const sync = () => {
      viewport.scrollTop = Math.max(0, viewport.getBoundingClientRect().top - prose.getBoundingClientRect().top);
      syncedTop.current = viewport.scrollTop;
    };
    sync();
    const target = source ?? window;
    target.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync); observer.observe(prose); observer.observe(viewport);
    return () => { target.removeEventListener("scroll", sync); observer.disconnect(); };
  }, [notes, prose, mode]);
  function card(note: LocatedTextNote) {
    return <ReaderNoteCard key={note.id} note={note} active={note.id === activeId} general={!note.anchor} locationLabel={note.anchor ? "Цитата" : "Вся книга"} staleLabel="Цитата изменилась — проверьте привязку" canLocate={note.located} actions={actions} onOpen={note => onOpen(note.id)} />;
  }
  return <aside className="mastering-notes" aria-label="Заметки к книге">
    <header><strong>Заметки · {notes.length}</strong><button type="button" aria-label="Свернуть заметки" onClick={onClose}>›</button></header>
    <div className="mastering-notes__controls">
      <div role="group" aria-label="Режим заметок"><button type="button" aria-pressed={mode === "margins"} onClick={() => onMode("margins")}>У текста</button><button type="button" aria-pressed={mode === "list"} onClick={() => onMode("list")}>Список</button></div>
      <label><input type="checkbox" checked={showHighlights} onChange={event => onHighlights(event.target.checked)} /> Подсветка цитат</label>
      <button type="button" onClick={onAdd}>+ Общая заметка</button>
      {!!notes.length && <button type="button" onClick={onExport}>Экспорт в Markdown</button>}
    </div>
    {mode === "margins" && !!general.length && <div className="mastering-notes__general">{general.map(card)}</div>}
    <div className="mastering-notes__scroll" ref={scroll} onScroll={event => {
      if (mode !== "margins" || !prose) return;
      const delta = event.currentTarget.scrollTop - syncedTop.current;
      if (Math.abs(delta) < 2) return;
      syncedTop.current = event.currentTarget.scrollTop;
      const source = prose.closest<HTMLElement>(".app-content");
      if (source) source.scrollBy({ top: delta }); else window.scrollBy({ top: delta });
    }}>
      {loading && <p className="muted">Загружаем заметки…</p>}
      {error && <p role="alert">{error}<button type="button" onClick={onRetry}>Повторить</button></p>}
      {!loading && !error && !notes.length && <p className="muted">Выделите фрагмент статьи, чтобы добавить заметку к цитате, или создайте общую заметку.</p>}
      {mode === "list" ? <div className="mastering-notes__list">{notes.map(card)}</div> : <div className="mastering-notes__canvas" ref={canvas}>{anchored.map(card)}</div>}
    </div>
  </aside>;
}
