import { Link } from "react-router-dom";
import type { PlayerCharacter } from "../../types";
import { entityMark } from "../../pageMenu";
import { EntityMenuButton } from "../PageContextMenu";
import { PlayerPortrait } from "./PlayerPortrait";
import { CHARACTER_STATUS_LABELS } from "../../characterStatus";

/** Персонаж = лист: один маршрут, одно меню объекта. */
export function PlayerCharacterCards({ characters }: { characters: PlayerCharacter[] }) {
  if (characters.length === 0) return <p className="muted">У игрока пока нет персонажей.</p>;
  return (
    <div className="player-char-list">
      {characters.map((character) => (
        <article key={character.id} className="player-char-card" {...entityMark("character", character.id, character.character_name)}>
          <Link to={`/characters/${character.id}`} aria-label={`Открыть лист ${character.character_name}`}>
            <PlayerPortrait url={character.thumbnail_image_url ?? character.avatar_image_url} name={character.character_name} character />
          </Link>
          <div className="player-char-card__body">
            <h3 className="player-char-card__name"><Link to={`/characters/${character.id}`}>{character.character_name}</Link></h3>
            <div className="player-char-card__meta">{[character.system_name, character.system_info].filter(Boolean).join(" · ") || "Система не указана"}</div>
            <div className="player-char-card__meta">
              {character.campaign_id ? <Link to={`/campaigns/${character.campaign_id}`}>{character.campaign_name}</Link> : "Без кампании"}
              {character.status && <> · {CHARACTER_STATUS_LABELS[character.status]}</>}
            </div>
            <Link className="player-char-card__open" to={`/characters/${character.id}`}>{character.sheet_statblock_id != null ? "Открыть лист →" : "Завести лист →"}</Link>
          </div>
          <EntityMenuButton entity={{ type: "character", id: character.id, name: character.character_name }} />
        </article>
      ))}
    </div>
  );
}
