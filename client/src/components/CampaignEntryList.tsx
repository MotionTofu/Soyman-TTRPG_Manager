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
    await api.del(`/campaign-entries/${id}`);
    refresh();
  }

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
      <button onClick={addEntry} style={{ alignSelf: "flex-start" }}>
        {addLabel}
      </button>
      {entries.length === 0 && <p className="muted">{emptyLabel}</p>}
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
  );
}
