import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SCENE_KINDS, SCENE_STATUSES } from "../sceneKinds";
import type { StoryArc, StoryScene } from "../types";

// "Приключения" — the setting's prepared story content. Rendered on both the
// setting profile (originals) and a campaign profile (same list with that
// campaign's copy-on-write overrides swapped in, plus playthrough status).
// Scenes open on their own page; this is the index.
export function AdventuresTab({
  settingId,
  campaignId,
}: {
  settingId: number;
  campaignId?: number;
}) {
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [arcName, setArcName] = useState("");
  const [addingUnder, setAddingUnder] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, string>>({});

  function refresh() {
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setArcs);
    const q = new URLSearchParams({ setting_id: String(settingId) });
    if (campaignId) q.set("campaign_id", String(campaignId));
    api.get<StoryScene[]>(`/story/scenes?${q.toString()}`).then(setScenes);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId, campaignId]);

  async function createArc(parentId: number | null, name: string) {
    if (!name.trim()) return;
    await api.post("/story/arcs", { setting_id: settingId, parent_id: parentId, name });
    setArcName("");
    setChildName("");
    setAddingUnder(null);
    refresh();
  }

  async function renameArc(arc: StoryArc) {
    const name = prompt("Название приключения", arc.name);
    if (!name?.trim()) return;
    await api.put(`/story/arcs/${arc.id}`, { name: name.trim() });
    refresh();
  }

  async function deleteArc(arc: StoryArc) {
    if (!confirm(`Отправить «${arc.name}» в архив вместе со сценами?`)) return;
    await api.del(`/story/arcs/${arc.id}`);
    refresh();
  }

  async function createScene(arcId: number | null) {
    const key = String(arcId ?? "none");
    const name = sceneDrafts[key];
    if (!name?.trim()) return;
    await api.post("/story/scenes", {
      setting_id: settingId,
      arc_id: arcId,
      // A scene added from inside a campaign belongs to that campaign only —
      // the setting's own list stays untouched (see schema.sql).
      campaign_id: campaignId ?? null,
      name: name.trim(),
    });
    setSceneDrafts((d) => ({ ...d, [key]: "" }));
    refresh();
  }

  async function setStatus(scene: StoryScene, status: string) {
    if (!campaignId) return;
    await api.put(`/story/scenes/${scene.id}/state`, { campaign_id: campaignId, status });
    refresh();
  }

  const roots = arcs.filter((a) => a.parent_id == null);
  const looseScenes = scenes.filter((s) => s.arc_id == null);

  function renderArc(arc: StoryArc, depth: number) {
    const children = arcs.filter((a) => a.parent_id === arc.id);
    const arcScenes = scenes.filter((s) => s.arc_id === arc.id);
    const key = String(arc.id);
    return (
      <div key={arc.id} className="stack" style={{ marginLeft: depth * 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong className="entry-title">{arc.name}</strong>
          {/* Arcs themselves belong to the setting and have no campaign
              override layer — editing them from inside a campaign would
              silently change every other campaign's list too. */}
          {!campaignId && (
            <span className="row">
              <button onClick={() => setAddingUnder(addingUnder === arc.id ? null : arc.id)}>
                + Вложенное
              </button>
              <button onClick={() => renameArc(arc)}>Переименовать</button>
              <button className="danger" onClick={() => deleteArc(arc)}>
                Архивировать
              </button>
            </span>
          )}
        </div>
        {arc.description && <span className="muted">{arc.description}</span>}
        {addingUnder === arc.id && (
          <div className="row">
            <input
              placeholder="Название вложенного приключения или главы"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <button className="primary" onClick={() => createArc(arc.id, childName)}>
              Создать
            </button>
          </div>
        )}
        <SceneList scenes={arcScenes} campaignId={campaignId} onStatus={setStatus} />
        <div className="row">
          <input
            placeholder="Название сцены"
            value={sceneDrafts[key] ?? ""}
            onChange={(e) => setSceneDrafts((d) => ({ ...d, [key]: e.target.value }))}
          />
          <button onClick={() => createScene(arc.id)}>+ Сцена</button>
        </div>
        {children.map((c) => renderArc(c, depth + 1))}
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Приключение — блок подготовленного сюжета внутри сеттинга (книга, ваншот, арка). Внутри
        него живут сцены: описание для мастера, текст для зачитывания, проверки, награды и
        переходы.{" "}
        {campaignId
          ? "Здесь показаны сцены сеттинга в том виде, в каком их видит эта кампания: правка создаёт копию только для неё, оригинал в сеттинге не меняется."
          : "Кампании наследуют эти сцены и могут править их у себя, не трогая оригинал."}
      </p>

      {!campaignId && (
        <div className="row">
          <input
            placeholder="Название приключения"
            value={arcName}
            onChange={(e) => setArcName(e.target.value)}
          />
          <button className="primary" onClick={() => createArc(null, arcName)}>
            + Приключение
          </button>
        </div>
      )}

      {roots.map((a) => renderArc(a, 0))}

      {(looseScenes.length > 0 || roots.length === 0) && (
        <div className="stack">
          <strong className="entry-title">Сцены вне приключений</strong>
          <SceneList scenes={looseScenes} campaignId={campaignId} onStatus={setStatus} />
          <div className="row">
            <input
              placeholder="Название сцены"
              value={sceneDrafts.none ?? ""}
              onChange={(e) => setSceneDrafts((d) => ({ ...d, none: e.target.value }))}
            />
            <button onClick={() => createScene(null)}>+ Сцена</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SceneList({
  scenes,
  campaignId,
  onStatus,
}: {
  scenes: StoryScene[];
  campaignId?: number;
  onStatus: (scene: StoryScene, status: string) => void;
}) {
  if (scenes.length === 0) return <p className="muted">Сцен пока нет.</p>;
  return (
    <div className="entity-row-list">
      {scenes.map((s) => (
        <div key={s.id} className="entity-row">
          <Link
            to={`/scenes/${s.id}${campaignId ? `?campaign=${campaignId}` : ""}`}
            className="entity-row-name"
          >
            {s.name}
          </Link>
          <span className="muted">{SCENE_KINDS.find((k) => k.key === s.kind)?.label}</span>
          {s.is_override && <span className="badge tag">изменено в кампании</span>}
          {s.campaign_only && <span className="badge tag">только в кампании</span>}
          {campaignId && (
            <span className="entity-row-actions">
              <select
                value={s.state?.status ?? "pending"}
                onChange={(e) => onStatus(s, e.target.value)}
              >
                {SCENE_STATUSES.map((st) => (
                  <option key={st.key} value={st.key}>
                    {st.label}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
