import { useEffect, useState } from "react";
import type { Affect } from "../data/entities";
import { useAction, useResource, write } from "../data/hooks";
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
const NO_ENTRIES: SettingEntry[] = [];
const ENTRY_AFFECTS: Affect[] = [{ path: "/setting-entries" }];

export function SettingEntryList({ settingId, category, addLabel, emptyLabel }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const entriesPath = `/setting-entries?setting_id=${settingId}&category=${category}`;
  const entries = useResource<SettingEntry[]>(entriesPath).data ?? NO_ENTRIES;
  const [selId, setSelId] = useState<number | null>(null);
  const run = useAction();

  // Выбор пережил удаление/перезагрузку: нет выбранной — берём первую.
  useEffect(() => {
    if (entries.length > 0 && !entries.some((e) => e.id === selId)) {
      setSelId(entries[0].id);
    }
    if (entries.length === 0) setSelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  async function addEntry() {
    // Повтор создал бы вторую запись.
    const created = await run(
      () =>
        write.post<SettingEntry>("/setting-entries", {
          setting_id: settingId,
          category,
          title: `Запись ${entries.length + 1}`,
          content: "",
        }),
      { affects: ENTRY_AFFECTS, retry: false }
    );
    // Сервер отдаёт созданную запись — выбираем её сразу в правке.
    if (created?.id) setSelId(created.id);
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await run(() => write.del(`/setting-entries/${id}`).then(() => true), { affects: ENTRY_AFFECTS });
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
  onRemove,
  forceOpen = false,
}: {
  entry: SettingEntry;
  settingId: number;
  onRemove: (id: number) => void;
  /** Внутри Master–Detail карточка всегда раскрыта, сворачивать нечего. */
  forceOpen?: boolean;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const open = editMode || expanded || forceOpen;
  const run = useAction();

  // Правка остаётся открытой, если не записалось.
  async function save() {
    const done = await run(
      async () => {
        await write.put(`/setting-entries/${entry.id}`, { title, content });
        await syncMentionLinks("setting", settingId, entry.content, content);
        return true;
      },
      { affects: ENTRY_AFFECTS }
    );
    if (done) setEditMode(false);
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
