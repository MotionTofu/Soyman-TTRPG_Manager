import { Link } from "react-router-dom";
import type { Player } from "../../types";
import { entityMark } from "../../pageMenu";
import { formatNearestDate } from "../../nearestDate";
import { EntityMenuButton } from "../PageContextMenu";
import { MentionText } from "../mentions/MentionText";
import { PlayerPortrait } from "./PlayerPortrait";

export function PlayerListCard({ player }: { player: Player }) {
  return (
    <article className="player-d-card" {...entityMark("player", player.id, player.name)}>
      <PlayerPortrait url={player.thumbnail_image_url ?? player.avatar_image_url} name={player.name} />
      <div className="player-d-card__body">
        <h2><Link to={`/players/${player.id}`} aria-label={`Игрок ${player.name}`}>{player.name}</Link></h2>
        <div className="player-d-card__note">
          {player.notes ? <MentionText text={player.notes} /> : <span className="muted">Заметок пока нет</span>}
        </div>
        <div className="player-d-card__date">
          {player.next_planned_date ? formatNearestDate(player.next_planned_date) : "Игра пока не запланирована"}
        </div>
      </div>
      <EntityMenuButton entity={{ type: "player", id: player.id, name: player.name }} />
    </article>
  );
}
