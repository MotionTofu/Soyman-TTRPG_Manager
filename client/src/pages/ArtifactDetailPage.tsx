import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { MentionsTab } from "../components/MentionsTab";
import type { Artifact } from "../types";

export function ArtifactDetailPage() {
  const { id } = useParams();
  const artifactId = Number(id);
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [form, setForm] = useState({ name: "", short_name: "", owner: "", power: "", history: "", notes: "" });
  const [editMode, setEditMode] = useState(false);

  function refresh() {
    api.get<Artifact>(`/artifacts/${artifactId}`).then((a) => {
      setArtifact(a);
      setForm({
        name: a.name,
        short_name: a.short_name ?? "",
        owner: a.owner,
        power: a.power,
        history: a.history,
        notes: a.notes,
      });
    });
  }
  useEffect(refresh, [artifactId]);

  if (!artifact) return <p className="muted">Загрузка…</p>;

  async function save() {
    if (!artifact) return;
    await api.put(`/artifacts/${artifactId}`, form);
    syncMentionLinks("artifact", artifactId, artifact.power, form.power);
    syncMentionLinks("artifact", artifactId, artifact.history, form.history);
    syncMentionLinks("artifact", artifactId, artifact.notes, form.notes);
    setEditMode(false);
    refresh();
  }

  async function archiveArtifact() {
    if (!artifact) return;
    if (!confirm("Отправить артефакт в архив?")) return;
    await api.del(`/artifacts/${artifactId}`);
    navigate(`/settings/${artifact.setting_id}`);
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{artifact.name}</h1>
        <div className="entity-header-actions">
          <button className="danger" onClick={archiveArtifact}>
            Архивировать
          </button>
        </div>
      </div>
      {artifact.file_path && <div className="muted">{artifact.file_path}</div>}
      {editMode ? (
        <div className="card stack">
          <label>
            Название
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Короткое имя для карты
            <input
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              title="Показывается вместо полного имени в подписи пина на карте локации"
            />
          </label>
          <label>
            Владелец
            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          </label>
          <label>
            Сила / свойства
            <MentionTextarea
              value={form.power}
              onChange={(v) => setForm({ ...form, power: v })}
              rows={4}
              defaultSettingId={artifact.setting_id}
            />
          </label>
          <label>
            История
            <MentionTextarea
              value={form.history}
              onChange={(v) => setForm({ ...form, history: v })}
              rows={4}
              defaultSettingId={artifact.setting_id}
            />
          </label>
          <label>
            Заметки
            <MentionTextarea
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              rows={3}
              defaultSettingId={artifact.setting_id}
            />
          </label>
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="card stack">
          {artifact.owner && <div className="muted">Владелец: {artifact.owner}</div>}
          {artifact.power && (
            <div>
              <strong>Сила / свойства</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={artifact.power} />
              </div>
            </div>
          )}
          {artifact.history && (
            <div>
              <strong>История</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={artifact.history} />
              </div>
            </div>
          )}
          {artifact.notes && (
            <div>
              <strong>Заметки</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={artifact.notes} />
              </div>
            </div>
          )}
          <button
            onClick={() => {
              setForm({
                name: artifact.name,
                short_name: artifact.short_name ?? "",
                owner: artifact.owner,
                power: artifact.power,
                history: artifact.history,
                notes: artifact.notes,
              });
              setEditMode(true);
            }}
            style={{ alignSelf: "flex-start" }}
          >
            Редактировать
          </button>
        </div>
      )}
      <details className="stack">
        <summary>
          <strong className="entry-title">Упоминания</strong>
        </summary>
        <MentionsTab entityType="artifact" entityId={artifactId} />
      </details>
    </div>
  );
}
