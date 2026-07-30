import { useState } from "react";
import { Link } from "react-router-dom";
import type { SettingBeing } from "../types";
import { BEING_CATEGORIES } from "../beingCategories";
import { TagChips } from "./TagChips";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { loadThumbnailStyles } from "../thumbnailStyles";

// Shared row-list rendering used by Население (the setting-wide list) and by
// the embedded being lists on a Location's "Обитатели" tab and a
// Community's "Представители" tab, so all three read identically.
export function BeingEntityRowList({
  beings,
  onDelete,
  deleteLabel = "Удалить",
  onDuplicate,
  emptyLabel = "Пока никого нет.",
}: {
  beings: SettingBeing[];
  onDelete: (id: number) => void;
  deleteLabel?: string;
  onDuplicate?: (being: SettingBeing) => void;
  emptyLabel?: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; being: SettingBeing } | null>(null);
  const thumbnailStyles = loadThumbnailStyles();

  function contextMenuItems(being: SettingBeing): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (onDuplicate) items.push({ label: "Создать копию", onClick: () => onDuplicate(being) });
    items.push({ label: deleteLabel, danger: true, onClick: () => onDelete(being.id) });
    return items;
  }

  return (
    <div className="entity-row-list">
      {beings.map((b) => {
        const url = b.thumbnail_image_url || b.avatar_image_url;
        const mode = thumbnailStyles.beings;
        const isBg = mode === "background" && !!url;
        return (
          <Link
            key={b.id}
            to={`/beings/${b.id}`}
            className={`entity-row${isBg ? " entity-row-bg" : ""}`}
            style={isBg ? { backgroundImage: `url("${url}")` } : undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, being: b });
            }}
          >
            {mode === "banner" && url && <img src={url} alt="" className="entity-row-thumb" />}
            <span className="entity-row-name">{b.name}</span>
            <span className="muted">{BEING_CATEGORIES.find((c) => c.key === b.category)?.label}</span>
            <span className="entity-row-tags">
              <TagChips tags={b.tags} />
            </span>
            <span className="entity-row-actions">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(b.id);
                }}
              >
                {deleteLabel}
              </button>
            </span>
          </Link>
        );
      })}
      {beings.length === 0 && <p className="muted">{emptyLabel}</p>}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems(menu.being)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
