import { Link } from "react-router-dom";
import { useAction, useEntityList, write } from "../data/hooks";
import { labelled } from "../data/notices";
import type { Character } from "../types";
import backEvil from "../assets/cards/back-evil.webp";

/**
 * Заявки персонажей «без кампании» в эту кампанию — блок вверху «Состава»
 * (гриллинг «персонаж = лист» 2026-09-27, Q11/Q18). Пусто — блока нет.
 */
export function CharacterRequestsBlock({ campaignId }: { campaignId: number }) {
  const run = useAction();
  const requests = useEntityList<Character>("character", { requested_campaign_id: campaignId }).data ?? [];
  if (requests.length === 0) return null;

  async function decide(c: Character, decision: "accept" | "decline") {
    await run(
      labelled(decision === "accept" ? "Принять персонажа" : "Отклонить заявку", () =>
        write.post(`/campaigns/${campaignId}/character-requests/${c.id}/${decision}`)
      ),
      { affects: [{ kind: "character" }], retry: false }
    );
  }

  return (
    <div className="card stack character-requests" style={{ gap: 8 }}>
      <div className="player-section-header">Заявки персонажей · {requests.length}</div>
      {requests.map((c) => (
        <div key={c.id} className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <img src={c.avatar_image_url || backEvil} alt="" style={{ width: 36, height: 50, objectFit: "cover", borderRadius: 4 }} />
          <span style={{ flex: "1 1 160px", minWidth: 0 }}>
            <Link to={`/characters/${c.id}`}>
              <strong>{c.character_name}</strong>
            </Link>
            <span className="muted"> · {c.player_name}</span>
          </span>
          <button type="button" className="primary" onClick={() => void decide(c, "accept")}>
            Принять
          </button>
          <button type="button" onClick={() => void decide(c, "decline")}>
            Отклонить
          </button>
        </div>
      ))}
    </div>
  );
}
