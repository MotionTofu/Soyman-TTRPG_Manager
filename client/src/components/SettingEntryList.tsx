import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { SettingEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { EmptyState } from "./EmptyState";
import { EntityTabWorkspace } from "./EntityTabWorkspace";

interface Props {
  settingId: number;
  category: "notes";
  addLabel: string;
  emptyLabel: string;
}

// Таб «Заметки» как Master–Detail: список записей слева, выбранная —
// справа сразу в чтении (правка по кнопке). Верхний таб-бар не трогаем.
export function SettingEntryList({ settingId, category, addLabel, emptyLabel }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [entries, setEntries] = useState<SettingEntry[]>([]);
  const [selId, setSelId] = useState<number | null>(null);

  function refresh() {
    api
      .get<SettingEntry[]>(`/setting-entries?setting_id=${settingId}&category=${category}`)
      .then(setEntries);
  }
  useEffect(refresh, [settingId, category]);

  // Выбор пережил удаление/перезагрузку: нет выбранной — берём первую.
  useEffect(() => {
    if (entries.length > 0 && !entries.some((e) => e.id === selId)) {
      setSelId(entries[0].id);
    }
    if (entries.length === 0) setSelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  async function addEntry() {
    const created = await api.post<SettingEntry>("/setting-entries", {
      setting_id: settingId,
      category,
      title: `Запись ${entries.length + 1}`,
      content: "",
    });
    refresh();
    // Сервер отдаёт созданную запись — выбираем её сразу в правке.
    if (created?.id) setSelId(created.id);
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await api.del(`/setting-entries/${id}`);
    refresh();
  }

  const selected = entries.find((e) => e.id === selId);

  return (
    <EntityTabWorkspace
      sections={[
        {
          id: "all",
          label: "Все записи",
          count: entries.length,
          items: entries.map((e) => ({ id: String(e.id), label: e.title || "Без названия" })),
        },
      ]}
      selection={{ section: "all", item: selId != null ? String(selId) : undefined }}
      onSelect={(next) => next.item != null && setSelId(Number(next.item))}
      workspaceKey={settingId}
      navFooter={
        <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
          {addLabel}
        </button>
      }
    >
      {confirmDialog}
      {selected ? (
        <EntryCard
          key={selected.id}
          entry={selected}
          settingId={settingId}
          forceOpen
          onChange={refresh}
          onRemove={removeEntry}
        />
      ) : (
        <div className="card stack">
          <EmptyState
            title="Заметки помогают держать лор"
            hint="Короткие записи мастера: имена, факты, хуки — всё, что не тянет на статью."
            action={
              <button className="primary" onClick={addEntry}>
                {addLabel}
              </button>
            }
          />
          {entries.length === 0 && <p className="muted">{emptyLabel}</p>}
        </div>
      )}
    </EntityTabWorkspace>
  );
}

function EntryCard({
  entry,
  settingId,
  onChange,
  onRemove,
  forceOpen = false,
}: {
  entry: SettingEntry;
  settingId: number;
  onChange: () => void;
  onRemove: (id: number) => void;
  /** Внутри Master–Detail карточка всегда раскрыта, сворачивать нечего. */
  forceOpen?: boolean;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const open = editMode || expanded || forceOpen;

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
        style={{ justifyContent: "space-between", cursor: editMode || forceOpen ? "default" : "pointer" }}
        onClick={() => !editMode && !forceOpen && setExpanded((v) => !v)}
      >
        <span className="row" style={{ alignItems: "center" }}>
          {!editMode && !forceOpen && (
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
