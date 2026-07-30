import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { LinkNote } from "../types";

interface Props {
  linkId: number;
  // The entity this note is attached to (for @-mention graph-link syncing).
  entityType?: string;
  entityId?: number;
}

export function LinkNoteList({ linkId, entityType, entityId }: Props) {
  const [notes, setNotes] = useState<LinkNote[]>([]);

  function refresh() {
    api.get<LinkNote[]>(`/link-notes?link_id=${linkId}`).then(setNotes);
  }
  useEffect(refresh, [linkId]);

  async function addNote() {
    await api.post("/link-notes", { link_id: linkId, title: `Запись ${notes.length + 1}`, content: "" });
    refresh();
  }

  async function removeNote(id: number) {
    await api.del(`/link-notes/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      {notes.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          entityType={entityType}
          entityId={entityId}
          onChange={refresh}
          onRemove={removeNote}
        />
      ))}
      <button onClick={addNote} style={{ alignSelf: "flex-start" }}>
        + Добавить запись
      </button>
    </div>
  );
}

function NoteCard({
  note,
  entityType,
  entityId,
  onChange,
  onRemove,
}: {
  note: LinkNote;
  entityType?: string;
  entityId?: number;
  onChange: () => void;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !note.content);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  async function save() {
    await api.put(`/link-notes/${note.id}`, { title, content });
    if (entityType && entityId) syncMentionLinks(entityType, entityId, note.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {editMode ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок записи" />
        ) : (
          <strong>{note.title}</strong>
        )}
        <button onClick={() => onRemove(note.id)}>✕</button>
      </div>
      {editMode ? (
        <>
          <MentionTextarea value={content} onChange={setContent} rows={3} />
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ whiteSpace: "pre-wrap" }}>
            <MentionText text={note.content} />
          </div>
          <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
            Редактировать
          </button>
        </>
      )}
    </div>
  );
}
