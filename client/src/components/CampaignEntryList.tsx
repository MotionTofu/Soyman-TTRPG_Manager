import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";

interface Props {
  campaignId: number;
  category: "notes" | "quotes" | "gm_notes" | "post_production";
  addLabel: string;
  emptyLabel: string;
  // Forwarded to MentionTextarea — preselects "Сеттинг" in the @-mention
  // "Создать новую сущность" flow. Pass campaign.setting_id when known.
  defaultSettingId?: number;
}

export function CampaignEntryList({ campaignId, category, addLabel, emptyLabel, defaultSettingId }: Props) {
  const [entries, setEntries] = useState<CampaignEntry[]>([]);

  function refresh() {
    api
      .get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaignId}&category=${category}`)
      .then(setEntries);
  }
  useEffect(refresh, [campaignId, category]);

  async function addEntry() {
    await api.post("/campaign-entries", {
      campaign_id: campaignId,
      category,
      title: `Запись ${entries.length + 1}`,
      content: "",
    });
    refresh();
  }

  async function removeEntry(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/campaign-entries/${id}`);
    refresh();
  }

  const isPostProduction = category === "post_production";
  return (
    <div className="stack">
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
}: {
  entry: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onChange: () => void;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !entry.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const open = editMode || expanded;

  async function save() {
    await api.put(`/campaign-entries/${entry.id}`, { title, content });
    syncMentionLinks("campaign", campaignId, entry.content, content);
    setEditMode(false);
    onChange();
  }

  return (
    <details className="card res-group" open={open} onToggle={(e) => { if (!editMode) setExpanded((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="res-group__band" onClick={(e) => { if (editMode) e.preventDefault(); }}>
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
