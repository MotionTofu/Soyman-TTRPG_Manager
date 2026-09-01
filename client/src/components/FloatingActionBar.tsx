import type { RosterPlayer } from "../types";
import { NavIcon } from "./NavIcons";

interface Props {
  selectedCount: number;
  roster: RosterPlayer[];
  onGrant?: (playerId: number) => void;
  onRevoke?: (playerId: number) => void;
  onInclude?: () => void;
  onExclude?: () => void;
  onClear: () => void;
}

export function FloatingActionBar({ selectedCount, roster, onGrant, onRevoke, onInclude, onExclude, onClear }: Props) {
  if (selectedCount === 0) return null;
  const isVisibility = !!(onGrant && onRevoke);
  return (
    <div className="floating-action-bar">
      <div className="floating-action-bar-inner card">
        <span className="floating-action-bar-count">
          Выбрано: <strong>{selectedCount}</strong>
        </span>
        {isVisibility ? (
          <div className="floating-action-bar-players">
            {roster.map((p) => (
              <div key={p.id} className="floating-action-bar-player">
                <span className="floating-action-bar-player-name">{p.name}</span>
                <button className="floating-action-bar-btn grant" onClick={() => onGrant!(p.id)} title={`Показать ${p.name}`} aria-label={`Показать ${p.name}`}>
                  <NavIcon name="eye" />
                </button>
                <button className="floating-action-bar-btn revoke" onClick={() => onRevoke!(p.id)} title={`Скрыть от ${p.name}`} aria-label={`Скрыть от ${p.name}`}>
                  <NavIcon name="close" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="floating-action-bar-players">
            <button className="primary" onClick={onInclude}>Включить</button>
            <button onClick={onExclude}>Убрать</button>
          </div>
        )}
        <button className="floating-action-bar-close" onClick={onClear} title="Сбросить выделение" aria-label="Сбросить выделение">
          ✕
        </button>
      </div>
    </div>
  );
}
