import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { SettingEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";

interface Props {
  settingId: number;
  category: "notes";
  addLabel: string;
  emptyLabel: string;
}

export function SettingEntryList({ settingId, category, addLabel, emptyLabel }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [entries, setEntries] = useState<SettingEntry[]>([]);

  function refresh() {
    api
      .get<SettingEntry[]>(`/setting-entries?setting_id=${settingId}&category=${category}`)
      .then(setEntries);
  }
  useEffect(refresh, [settingId, category]);

  async function addEntry() {
    await api.post("/setting-entries", {
      setting_id: settingId,
      category,
      title: `Запись ${entries.length + 1}`,
      content: "",
    });
    refresh();
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await api.del(`/setting-entries/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      {confirmDialog}
      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} settingId={settingId} onChange={refresh} onRemove={removeEntry} />
      ))}
      <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
        {addLabel}
      </button>
      {entries.length === 0 && <p className="muted">{emptyLabel}</p>}
    </div>
  );
}

function EntryCard({
  entry,
  settingId,
  onChange,
  onRemove,
}: {
  entry: SettingEntry;
  settingId: number;
  onChange: () => void;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const open = editMode || expanded;

  async function save() {
    await api.put(`/setting-entries/${entry.id}`, { title, content });
    syncMentionLinks("setting", settingId, entry.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <div className="card stack">
      <div
        className="row collapsible-header"
        style={{ justifyContent: "space-between", cursor: editMode ? "default" : "pointer" }}
        onClick={() => !editMode && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!editMode && (
            <span className="comp-toggle" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          )}
          {editMode ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <strong className="entry-title">{entry.title}</strong>
          )}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(entry.id);
          }}
        >
          ✕
        </button>
      </div>
      {open &&
        (editMode ? (
          <>
            <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={settingId} />
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
              <MentionText text={entry.content} />
            </div>
            <button onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
              Редактировать
            </button>
          </>
        ))}
    </div>
  );
}
