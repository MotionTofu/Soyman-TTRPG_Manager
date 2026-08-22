import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SectionHeading } from "../components/SectionHeading";
import type { MasteringNote, System } from "../types";
import { NavIcon } from "../components/NavIcons";

const CATEGORIES: { key: MasteringNote["category"]; label: string }[] = [
  { key: "prep", label: "Подготовка" },
  { key: "live", label: "Во время игры" },
  { key: "knowledge", label: "База знаний" },
];

export function MasteringPage() {
  const [category, setCategory] = useState<MasteringNote["category"]>("prep");
  const [notes, setNotes] = useState<MasteringNote[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [systemId, setSystemId] = useState("");

  function refresh() {
    api.get<MasteringNote[]>(`/mastering?category=${category}`).then(setNotes);
  }
  useEffect(refresh, [category]);
  useEffect(() => {
    api.get<System[]>("/systems").then(setSystems);
  }, []);

  async function create() {
    if (!title.trim()) return;
    await api.post("/mastering", {
      category,
      title,
      content,
      system_id: systemId ? Number(systemId) : undefined,
    });
    setTitle("");
    setContent("");
    setSystemId("");
    refresh();
  }

  async function archiveNote(id: number) {
    if (!confirm("Отправить заметку в архив?")) return;
    await api.del(`/mastering/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      <SectionHeading section="mastering">Мастерение</SectionHeading>
      <div className="tabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={category === c.key ? "active" : ""}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="card stack">
        <input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
        {category === "knowledge" && (
          <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
            <option value="">Система…</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <MentionTextarea value={content} onChange={setContent} rows={4} placeholder="Текст заметки" />
        <button className="primary" onClick={create} style={{ alignSelf: "flex-start" }}>
          Добавить
        </button>
      </div>

      <div className="stack">
        {notes.map((n) => (
          <NoteCard key={n.id} note={n} onChange={refresh} onArchive={archiveNote} />
        ))}
        {notes.length === 0 && <p className="muted">Пока пусто.</p>}
      </div>
    </div>
  );
}

export function NoteCard({
  note,
  onChange,
  onArchive,
}: {
  note: MasteringNote;
  onChange: () => void;
  onArchive: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [content, setContent] = useState(note.content);

  async function save() {
    await api.put(`/mastering/${note.id}`, { content });
    syncMentionLinks("mastering", note.id, note.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>
          {note.title} {note.system_name && <span className="badge tag">{note.system_name}</span>}
        </h3>
        <div className="entity-header-actions">
          {!editMode && <button onClick={() => setEditMode(true)}>Редактировать</button>}
          <button className="danger" onClick={() => onArchive(note.id)}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>
      {editMode ? (
        <>
          <MentionTextarea value={content} onChange={setContent} rows={4} />
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </>
      ) : (
        <div style={{ whiteSpace: "pre-wrap" }}>
          <MentionText text={note.content} />
        </div>
      )}
    </div>
  );
}
