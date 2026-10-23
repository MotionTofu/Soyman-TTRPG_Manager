import { useState } from "react";
import { CHARACTER_STATUSES, CHARACTER_STATUS_LABELS, statusOf, useSetCharacterStatus } from "../characterStatus";
import type { Character } from "../types";
import { ContextMenu } from "./ContextMenu";
import "./campaign/campaign-dossier.css";

/**
 * Статус персонажа в профиле (гриллинг «Партия», Q20, Q28): Мастер меняет
 * щелчком или ПКМ, игрок только видит — «погиб» и «ушёл» решает история.
 */
export function CharacterStatusChip({ character, editable }: { character: Character; editable: boolean }) {
  const setStatus = useSetCharacterStatus();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const status = statusOf(character);
  const label = CHARACTER_STATUS_LABELS[status];
  if (!editable) return <p className="character-status-line"><span className="dossier-status" data-status={status}>{label}</span></p>;
  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const at = e.type === "contextmenu" ? { left: e.clientX, bottom: e.clientY } : e.currentTarget.getBoundingClientRect();
    setMenu({ x: at.left, y: at.bottom });
  };
  return (
    <p className="character-status-line">
      <button type="button" className="dossier-status" data-status={status} aria-haspopup="menu" aria-expanded={!!menu}
        aria-label={`Статус: ${label}`} onClick={open} onContextMenu={open}>
        {label}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={character.character_name}
          items={CHARACTER_STATUSES.map((s) => ({
            label: `${s === status ? "✓ " : "  "}${CHARACTER_STATUS_LABELS[s]}`,
            onClick: () => void setStatus(character, s),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </p>
  );
}
