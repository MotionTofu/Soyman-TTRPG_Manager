import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MentionTextarea } from "./mentions/MentionTextarea";
import { MentionText } from "./mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import type { CampaignEntry } from "../types";

interface Props {
  campaignId: number;
  defaultSettingId?: number;
}

// Secrets/clues that carry over between sessions until marked revealed —
// reuses the campaign_entries table (category="secrets"), repurposing
// `status` as the revealed marker (none = unrevealed, done = revealed).
export function SecretsTracker({ campaignId, defaultSettingId }: Props) {
  const [secrets, setSecrets] = useState<CampaignEntry[]>([]);

  function refresh() {
    api
      .get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaignId}&category=secrets`)
      .then(setSecrets);
  }
  useEffect(refresh, [campaignId]);

  async function addSecret() {
    await api.post("/campaign-entries", {
      campaign_id: campaignId,
      category: "secrets",
      title: `Тайна ${secrets.length + 1}`,
      content: "",
    });
    refresh();
  }

  async function removeSecret(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/campaign-entries/${id}`);
    refresh();
  }

  const unrevealed = secrets.filter((s) => s.status !== "done");
  const revealed = secrets.filter((s) => s.status === "done");

  return (
    <div className="stack">
      <strong>Нераскрытые</strong>
      <div className="stack">
        {unrevealed.map((s) => (
          <SecretCard
            key={s.id}
            secret={s}
            campaignId={campaignId}
            defaultSettingId={defaultSettingId}
            onChange={refresh}
            onRemove={removeSecret}
          />
        ))}
        {unrevealed.length === 0 && <p className="muted">Нераскрытых тайн нет.</p>}
      </div>
      <button onClick={addSecret} style={{ alignSelf: "flex-start" }}>
        + Добавить тайну
      </button>

      {revealed.length > 0 && (
        <>
          <strong className="muted">Раскрытые</strong>
          <div className="stack">
            {revealed.map((s) => (
              <SecretCard
            key={s.id}
            secret={s}
            campaignId={campaignId}
            defaultSettingId={defaultSettingId}
            onChange={refresh}
            onRemove={removeSecret}
          />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SecretCard({
  secret,
  campaignId,
  defaultSettingId,
  onChange,
  onRemove,
}: {
  secret: CampaignEntry;
  campaignId: number;
  defaultSettingId?: number;
  onChange: () => void;
  onRemove: (id: number) => void;
}) {
  const [editMode, setEditMode] = useState(() => !secret.content);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(secret.title);
  const [content, setContent] = useState(secret.content);
  const revealed = secret.status === "done";
  const open = editMode || expanded;

  async function save() {
    await api.put(`/campaign-entries/${secret.id}`, { title, content });
    syncMentionLinks("campaign", campaignId, secret.content, content);
    setEditMode(false);
    onChange();
  }

  async function toggleRevealed() {
    await api.put(`/campaign-entries/${secret.id}`, { status: revealed ? "none" : "done" });
    onChange();
  }

  return (
    <div className="card stack" style={revealed ? { opacity: 0.7 } : undefined}>
      <div
        className="row"
        style={{ justifyContent: "space-between", cursor: editMode ? "default" : "pointer" }}
        onClick={() => !editMode && setExpanded((v) => !v)}
      >
        {editMode ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название тайны" />
        ) : (
          <strong style={revealed ? { textDecoration: "line-through" } : undefined}>{secret.title}</strong>
        )}
        <button
          className="comp-mini"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(secret.id);
          }}
        >
          ✕
        </button>
      </div>
      {open &&
        (editMode ? (
          <>
            <MentionTextarea
              value={content}
              onChange={setContent}
              rows={3}
              placeholder="Детали, подсказки…"
              defaultSettingId={defaultSettingId}
            />
            <div className="row">
              <button className="primary" onClick={save}>
                Сохранить
              </button>
              <button onClick={() => setEditMode(false)}>Отмена</button>
            </div>
          </>
        ) : (
          <>
            {secret.content && (
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={secret.content} />
              </div>
            )}
            <div className="row" style={{ alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setEditMode(true)}>Редактировать</button>
              <label className="row" style={{ alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={revealed} onChange={toggleRevealed} />
                Раскрыта
              </label>
            </div>
          </>
        ))}
    </div>
  );
}
