import { MentionText } from "./mentions/MentionText";

export type ReaderNote = { id: string; quote: string; body: string; created_at: string; needs_reattach: boolean };
export type ReaderNoteActions<T> = {
  onHover: (id: string | null) => void; onLocate: (note: T) => void; onEdit: (note: T) => void;
  onDelete: (note: T) => void; onReattach: (note: T) => void;
};

/** Общая карточка заметок PDF и библиотеки. Геометрией привязки занимается читалка. */
export function ReaderNoteCard<T extends ReaderNote>({ note, active, general, locationLabel, staleLabel, canLocate, actions, onOpen }: {
  note: T; active: boolean; general: boolean; locationLabel: string; staleLabel: string; canLocate: boolean;
  actions: ReaderNoteActions<T>; onOpen: (note: T) => void;
}) {
  return <article className={`pdf-reader__note-card${active ? " is-active" : ""}${general ? " is-general" : ""}`}
    data-note-id={note.id} onMouseEnter={() => actions.onHover(note.id)} onMouseLeave={() => actions.onHover(null)}>
    <div className="pdf-reader__note-meta"><span>{locationLabel}</span><time dateTime={note.created_at}>{new Date(note.created_at).toLocaleDateString("ru-RU")}</time></div>
    {note.needs_reattach && <div className="pdf-reader__note-stale">{staleLabel}</div>}
    {note.quote && <blockquote title={note.quote}>{note.quote}</blockquote>}
    <div className="pdf-reader__note-body"><MentionText text={note.body} /></div>
    <div className="pdf-reader__note-actions">
      <button type="button" onClick={() => onOpen(note)}>Открыть</button>
      {canLocate && !note.needs_reattach && <button type="button" onClick={() => actions.onLocate(note)}>К цитате</button>}
      {note.needs_reattach && <button type="button" onClick={() => actions.onReattach(note)}>Перепривязать</button>}
      <button type="button" onClick={() => actions.onEdit(note)}>Править</button>
      <button type="button" onClick={() => actions.onDelete(note)}>Удалить</button>
    </div>
  </article>;
}
