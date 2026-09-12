import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { EntityTabWorkspace } from "./EntityTabWorkspace";

interface Props {
  campaignId: number;
  category: "notes" | "quotes" | "gm_notes" | "post_production";
  addLabel: string;
  emptyLabel: string;
  // Forwarded to MentionTextarea — preselects "Сеттинг" in the @-mention
  // "Создать новую сущность" flow. Pass campaign.setting_id when known.
  defaultSettingId?: number;
  // Master–Detail: список записей слева, выбранная — справа в чтении.
  // Не задано — плоский список, как раньше (остальные места).
  layout?: "list" | "master-detail";
}

export function CampaignEntryList({ campaignId, category, addLabel, emptyLabel, defaultSettingId, layout = "list" }: Props) {
  const [confirmDialog, confirm] = useConfirm();
  const [entries, setEntries] = useState<CampaignEntry[]>([]);
  const [selId, setSelId] = useState<number | null>(null);

  function refresh() {
    api
      .get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaignId}&category=${category}`)
      .then(setEntries);
  }
  useEffect(refresh, [campaignId, category]);

  // Выбор пережил удаление/перезагрузку: нет выбранной — берём первую.
  useEffect(() => {
    if (layout !== "master-detail") return;
    if (entries.length > 0 && !entries.some((e) => e.id === selId)) {
      setSelId(entries[0].id);
    }
    if (entries.length === 0) setSelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, layout]);

  async function addEntry() {
    const created = await api.post<CampaignEntry>("/campaign-entries", {
      campaign_id: campaignId,
      category,
      title: `Запись ${entries.length + 1}`,
      content: "",
    });
    refresh();
    // Сервер отдаёт созданную запись — выбираем её сразу в правке.
    if (layout === "master-detail" && created?.id) setSelId(created.id);
  }

  async function removeEntry(id: number) {
    if (!(await confirm({ message: "Удалить запись?", confirmLabel: "Удалить", danger: true })))
      return;
    await api.del(`/campaign-entries/${id}`);
    refresh();
  }

  const isPostProduction = category === "post_production";

  if (layout === "master-detail") {
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
        workspaceKey={campaignId}
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
            campaignId={campaignId}
            defaultSettingId={defaultSettingId}
            forceOpen
            onChange={refresh}
            onRemove={removeEntry}
          />
        ) : (
          <div className="card" style={{ borderStyle: "dashed" }}>
            <p style={{ maxWidth: "62ch" }}>{emptyLabel}</p>
            <button className="primary" onClick={addEntry}>
              {addLabel}
            </button>
          </div>
        )}
      </EntityTabWorkspace>
    );
  }

  return (
    <div className="stack">
      {confirmDialog}
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          campaignId={campaignId}
          defaultSettingId={defaultSettingId}
          onChange={refresh}
          onRemove={removeEntry}
        />
      ))}
      {entries.length === 0 ? (
        <div className="card" style={{ borderStyle: "dashed" }}>
          <p style={{ maxWidth: "62ch" }}>
            {isPostProduction
              ? "Итоги появляются после игры — эпилоги, несбывшиеся линии, идеи для сиквела."
              : emptyLabel}
          </p>
          <button className="primary" onClick={addEntry}>
            {addLabel}
          </button>
        </div>
      ) : (
        <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
          {addLabel}
        </button>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  campaignId,
  defaultSettingId,
  onChange,
  onRemove,
  forceOpen = false,
}: {
  entry: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
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
    await api.put(`/campaign-entries/${entry.id}`, { title, content });
    syncMentionLinks("campaign", campaignId, entry.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <details className="card res-group" open={open} onToggle={(e) => { if (!editMode && !forceOpen) setExpanded((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="res-group__band" onClick={(e) => { if (editMode || forceOpen) e.preventDefault(); }}>
        {editMode ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок"
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <span className="res-group__title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(entry.id);
          }}
          style={{ flexShrink: 0 }}
          aria-label="Удалить"
        >
          ✕
        </button>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        {open &&
          (editMode ? (
            <>
              <MentionTextarea value={content} onChange={setContent} rows={4} defaultSettingId={defaultSettingId} />
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
    </details>
  );
}
