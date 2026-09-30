import { useEffect, useMemo, useRef, useState } from "react";
import {useAuthenticatedFileUrl} from "../../utils/fileUrl";
import { NavIcon } from "../NavIcons";
import type { MasteringBook, MasteringSection } from "../../types";

const alphabet = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export function MasteringShelf({ shelf, books, categoryLabel, search, covers, bookmarked, dragging, dragOver, onDrag, onDrop, onAdd, onEditShelf, onOpen, onNotes, onBookSettings, initialDescending = false, onSort, title, shelfKey }: {
  shelf: MasteringSection | null;
  books: MasteringBook[];
  categoryLabel?: string;
  search: boolean;
  covers: Map<string, string>;
  bookmarked: Set<number>;
  dragging: number | null;
  dragOver: boolean;
  onDrag: (id: number | null) => void;
  onDrop: (id: number | null) => void;
  onAdd: () => void;
  onEditShelf?: () => void;
  onOpen: (id: number, order: number[]) => void;
  onNotes?: (id: number, order: number[]) => void;
  initialDescending?: boolean;
  onSort?: (descending: boolean) => void;
  onBookSettings?: (id:number) => void;
  title?: string;
  shelfKey?: string;
}) {
  const name = title ?? shelf?.name ?? "Без полки";
  const trackId = `mastering-shelf-${shelfKey ?? shelf?.id ?? books[0]?.category ?? "empty"}`;
  const track = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [descending, setDescending] = useState(initialDescending);
  useEffect(() => { setDescending(initialDescending); }, [initialDescending]);
  const sortedBooks = useMemo(() => [...books].sort((a, b) => (descending ? -1 : 1) * alphabet.compare(a.title, b.title) || a.id - b.id), [books, descending]);
  const [position, setPosition] = useState({ overflow: false, start: true, end: false });
  const showAll = expanded || search;
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => setPosition({ overflow: node.scrollWidth > node.clientWidth + 2, start: node.scrollLeft < 2, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); node.removeEventListener("scroll", measure); };
  }, [books, showAll]);
  function scroll(direction: number) {
    const node = track.current;
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * node.clientWidth * .85, behavior: reduceMotion ? "instant" : "smooth" });
  }
  return <section className={`mastering-shelf${dragOver ? " is-drag-over" : ""}`} aria-label={name}
    onDragOver={event => { if (dragging != null) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
    onDrop={event => { if (dragging != null) { event.preventDefault(); onDrop(shelf?.id ?? null); } }}>
    <header className="mastering-shelf__head">
      <div className="mastering-shelf__name"><NavIcon name="book" /><h2>{name}</h2><span className="mastering-shelf__count">{books.length}</span>{categoryLabel && <span className="mastering-shelf__meta">{categoryLabel}</span>}{shelf?.system_name && <span className="mastering-shelf__meta">{shelf.system_name}</span>}</div>
      <div className="mastering-shelf__actions">
        <button type="button" aria-label={`Сортировка ${descending ? "Я–А" : "А–Я"}: ${name}`} title={`Переключить на ${descending ? "А–Я" : "Я–А"}`} onClick={() => { setDescending(!descending); onSort?.(!descending); track.current?.scrollTo({ left: 0 }); }}>{descending ? "Я–А" : "А–Я"}</button>
        {!showAll && position.overflow && <><button type="button" aria-label={`Предыдущие книги: ${name}`} disabled={position.start} onClick={() => scroll(-1)}><NavIcon name="arrowLeft" /></button><button type="button" aria-label={`Следующие книги: ${name}`} disabled={position.end} onClick={() => scroll(1)}><NavIcon name="arrowRight" /></button></>}
        {!search && (position.overflow || expanded) && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={trackId}>
          {expanded ? "Свернуть" : `Показать все · ${books.length}`}
        </button>}
        <button type="button" aria-label={`Добавить книгу на полку ${name}`} title="Добавить книгу" onClick={onAdd}><NavIcon name="plus" /></button>
        {onEditShelf && <button type="button" aria-label={`Настройки полки ${name}`} title="Настройки полки" onClick={onEditShelf}><NavIcon name="edit" /></button>}
      </div>
    </header>
    {books.length ? <div className={`mastering-shelf__track${showAll ? " is-expanded" : ""}`} ref={track} id={trackId}>
      {sortedBooks.map(book => <MasteringBookCover key={book.id} book={book} src={book.cover_image ? covers.get(book.cover_image) : undefined} saved={bookmarked.has(book.id)} dragging={dragging === book.id} onDrag={onDrag} onOpen={id => onOpen(id, sortedBooks.map(item => item.id))} onNotes={onNotes ? id => onNotes(id, sortedBooks.map(item => item.id)) : undefined} onSettings={onBookSettings} />)}
    </div> : <div className="mastering-shelf__empty"><NavIcon name="book" /><span>Первая книга ждёт своего места</span><button type="button" onClick={onAdd}>Добавить книгу</button></div>}
  </section>;
}

function MasteringBookCover({ book, src, saved, dragging, onDrag, onOpen, onNotes, onSettings }: {
  book: MasteringBook; src?: string; saved: boolean; dragging: boolean;
  onDrag: (id: number | null) => void; onOpen: (id: number) => void;
  onNotes?: (id: number) => void;
  onSettings?: (id:number) => void;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const authenticated=useAuthenticatedFileUrl(src??null);
  const imageSource=src?.startsWith("/files/")?authenticated:src;
  const showImage = imageSource && failedSource !== imageSource;
  const words = book.title.trim().split(/\s+/);
  const caption = words.length > 25 ? `${words.slice(0, 25).join(" ")}…` : book.title;
  return <div className="mastering-book-item">
    <button id={`mastering-book-${book.id}`} type="button" className={`mastering-book mastering-book--${book.id % 4}${dragging ? " is-dragging" : ""}${showImage ? " has-cover" : ""}`}
    aria-label={`Открыть книгу: ${book.title}`} title={book.title} onClick={() => onOpen(book.id)} draggable
    onDragStart={event => { onDrag(book.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(book.id)); }} onDragEnd={() => onDrag(null)}>
    {showImage && <img className="mastering-book__image" src={imageSource} alt="" loading="lazy" draggable={false} onError={() => setFailedSource(imageSource)} />}
    {saved && <span className="mastering-book__bookmark" aria-label="Закладка" />}
    <span className="mastering-book__label">{book.format === "pdf" ? "PDF" : book.format === "workbook" ? "Тетрадь" : "Маркдаун"}</span>
    <span className="mastering-book__symbol"><NavIcon name={book.category === "live" ? "sword" : book.category === "knowledge" ? "book" : ["star", "die", "map", "document"][book.id % 4] as "star" | "die" | "map" | "document"} /></span>
    <span className="mastering-book__title">{book.title}</span>
    <span className="mastering-book__meta">{book.system_name || (book.reading_minutes ? `${book.reading_minutes} мин чтения` : book.format === "pdf" ? "Документ PDF" : "Статья")}</span>
    </button>
    <span className="mastering-book-caption" title={book.title}>{caption}</span>
    {!!book.note_count && onNotes && <button type="button" className="library-note-badge" aria-label={`Заметки к книге: ${book.title}`} onClick={() => onNotes(book.id)}>Заметки · {book.note_count}</button>}
    {onSettings && <button type="button" className="library-book-settings" aria-label={`Размещение и обложка: ${book.title}`} onClick={()=>onSettings(book.id)}><NavIcon name="edit"/>Полка и обложка</button>}
  </div>;
}
