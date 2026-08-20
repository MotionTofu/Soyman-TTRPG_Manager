import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { chapterWord, sceneWord } from "../sceneKinds";
import type { StoryArc } from "../types";

// "Приключения" — the index of a setting's prepared story blocks. Everything
// inside one (chapters, scenes, milestones, secrets) lives on the adventure's
// own profile page, so this stays a short list instead of an endless scroll.
// Rendered on the setting profile only: a campaign shows the adventures it is
// linked to in its own sections instead.
export function AdventuresTab({
  settingId,
  campaignId,
}: {
  settingId: number;
  campaignId?: number;
}) {
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [name, setName] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);

  function refresh() {
    api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setArcs);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [settingId]);

  async function create() {
    if (!name.trim()) return;
    await api.post("/story/arcs", { setting_id: settingId, name });
    setName("");
    refresh();
  }

  async function archive(arc: StoryArc) {
    if (!confirm(`Отправить «${arc.name}» в архив вместе с главами и сценами?`)) return;
    await api.del(`/story/arcs/${arc.id}`);
    refresh();
  }

  // Only top-level adventures are listed; chapters belong to the profile.
  const adventures = arcs.filter((a) => a.parent_id == null);

  async function reorder(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const ids = adventures.map((a) => a.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const order = new Map(ids.map((id, i) => [id, i]));
    setArcs((prev) => [...prev].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    await api.put("/story/arcs/reorder", { order: ids });
    refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        Приключение — блок подготовленного сюжета внутри сеттинга (книга, ваншот, арка). Внутри
        него главы, сцены, вехи, тайны и зацепки.{" "}
        {campaignId
          ? "Кампания видит приключения сеттинга: правка сцены создаёт копию только для этой кампании, оригинал не меняется."
          : "Кампании наследуют эти приключения и могут править сцены у себя, не трогая оригинал."}
      </p>

      {!campaignId && (
        <div className="row">
          <input
            placeholder="Название приключения"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" onClick={create}>
            + Приключение
          </button>
        </div>
      )}

      <div className="entity-row-list">
        {adventures.map((a) => (
          <div
            key={a.id}
            className="entity-row"
            draggable={!campaignId}
            onDragStart={() => setDragId(a.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragId != null && reorder(dragId, a.id)}
          >
            <Link
              to={`/adventures/${a.id}${campaignId ? `?campaign=${campaignId}` : ""}`}
              className="entity-row-name"
            >
              {a.name}
            </Link>
            <span className="muted">
              {!!a.chapter_count && `${a.chapter_count} ${chapterWord(a.chapter_count)} · `}
              {a.scene_count} {sceneWord(a.scene_count)}
              {a.recommended_level && ` · ${a.recommended_level}`}
            </span>
            {a.is_default === 1 && <span className="badge tag">стандартное</span>}
            {!campaignId && a.is_default !== 1 && (
              <span className="entity-row-actions">
                <button className="danger" onClick={() => archive(a)}>
                  Архивировать
                </button>
              </span>
            )}
          </div>
        ))}
        {adventures.length === 0 && <p className="muted">Приключений пока нет.</p>}
      </div>
    </div>
  );
}
