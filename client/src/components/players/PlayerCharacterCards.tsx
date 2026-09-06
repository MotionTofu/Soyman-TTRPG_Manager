import { Link } from "react-router-dom";
import type { PlayerCharacter } from "../../types";

/**
 * Персонажи игрока — верхний блок профиля. У каждого: аватарка, кампания,
 * ссылка на профиль персонажа и ссылка на конкретный чарник (полноэкранный
 * лист /characters/:id/sheet). В чарнике — система + системная инфа
 * (сервер уже посчитал: D&D — вид/класс/подкласс/уровень, LitM — темы,
 * ZIP — типаж/уровень).
 */
export function PlayerCharacterCards({
  characters,
  onRemove,
}: {
  characters: PlayerCharacter[];
  onRemove: (characterId: number) => void;
}) {
  if (characters.length === 0) {
    return <span className="muted">У игрока пока нет персонажей — добавьте первого ниже.</span>;
  }
  return (
    <div className="player-char-list">
      {characters.map((c) => {
        const systemLine = [c.system_name ?? "система не указана", c.system_info]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={c.id} className="player-char-card">
            {c.avatar_image_url ? (
              <Link to={`/characters/${c.id}`} aria-label={`Профиль персонажа ${c.character_name}`}>
                <img
                  src={c.avatar_image_url}
                  alt={`Аватар ${c.character_name}`}
                  className="player-char-card__avatar"
                />
              </Link>
            ) : (
              <div className="player-char-card__avatar player-char-card__avatar--placeholder" aria-hidden="true" />
            )}
            <div className="player-char-card__body">
              <div className="player-char-card__name">
                <Link to={`/characters/${c.id}`}>{c.character_name}</Link>
              </div>
              <div className="player-char-card__meta">
                Кампания:{" "}
                {c.campaign_id ? (
                  <Link to={`/campaigns/${c.campaign_id}`}>{c.campaign_name}</Link>
                ) : (
                  <span className="muted">без кампании</span>
                )}
              </div>
              <div className="player-char-card__meta">
                Чарник: <span className="player-char-card__system">{systemLine}</span>
              </div>
              <div className="player-char-card__links">
                <Link to={`/characters/${c.id}`}>Профиль →</Link>
                {c.sheet_statblock_id != null ? (
                  <Link to={`/characters/${c.id}/sheet`}>Чарник →</Link>
                ) : (
                  <Link to={`/characters/${c.id}?tab=statblock`}>Завести чарник →</Link>
                )}
              </div>
            </div>
            <button
              className="player-char-card__remove"
              onClick={() => onRemove(c.id)}
              aria-label={`Архивировать персонажа ${c.character_name}`}
              title="Архивировать персонажа"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
