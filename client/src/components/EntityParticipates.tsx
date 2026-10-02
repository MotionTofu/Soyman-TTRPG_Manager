import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";

// «Участвует» во «Связях» существа и сообщества (гриллинг профилей
// 2026-10-02, Q16; тикет 11): приключение — цель из хода событий, под ним
// сцены с ролью. Только Мастеру: маршрут стоит за общим гейтом /api.

interface Participates {
  id: number;
  name: string;
  manual: boolean;
  goal: string;
  scenes: { id: number; name: string; section: string; role: string; tactic: string }[];
}

const SECTION_WORD: Record<string, string> = {
  scene_plot_characters: "сюжетный",
  scene_obstacles: "препятствие",
};

export function EntityParticipates({ entityType, entityId }: { entityType: "being" | "community"; entityId: number }) {
  const list = useResource<{ adventures: Participates[] }>(`/participations/entity/${entityType}/${entityId}`).data
    ?.adventures;
  if (!list || list.length === 0) return null;
  return (
    <details className="paper-fold" open>
      <summary>
        Участвует <span className="paper-fold__count">{list.length}</span>
      </summary>
      <ul className="paper-rows participates">
        {list.map((a) => (
          <li key={a.id}>
            <div className="participates__adventure">
              <span className="paper-rows__main">
                <Link className="mention-link" to={`/adventures/${a.id}`}>
                  {a.name}
                </Link>
                {a.goal && <span className="paper-rows__sub"> — цель: {a.goal}</span>}
              </span>
              {a.manual && <span className="paper-rows__sub">за кадром</span>}
            </div>
            {a.scenes.length > 0 && (
              <ul className="participates__scenes">
                {a.scenes.map((s) => (
                  <li key={s.id}>
                    <Link className="mention-link" to={`/scenes/${s.id}`}>
                      {s.name}
                    </Link>
                    <span className="paper-rows__sub">
                      {" "}
                      — {s.role || SECTION_WORD[s.section] || "в составе"}
                      {s.tactic && ` · ${s.tactic}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
