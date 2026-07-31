import { useState } from "react";
import { Link } from "react-router-dom";
import type { SettingBeing } from "../types";
import { BEING_CATEGORIES } from "../beingCategories";
import { TagChips } from "./TagChips";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { MentionText } from "./mentions/MentionText";

// Three overlapping circles — flags a being that belongs to more than one
// faction, so a list scoped to a single faction still shows it isn't the
// being's only one.
function MultiFactionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="15" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function formatMeta(meta: SettingBeing["creature_meta"]): string | null {
  if (!meta) return null;
  const parts = [meta.size, meta.creatureType, meta.alignment].filter((p) => p && p.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

// Shared row-list rendering used by Население (the setting-wide list), the
// embedded being lists on a Location's "Обитатели" tab and a Community's
// "Представители" tab, so all three read identically. A row's body toggles
// an inline expanded card (type/size/alignment, factions, habitats, short
// description) instead of navigating — navigation is the explicit "Перейти"
// button, kept separate so a click anywhere else on the row doesn't leave
// the current page.
export function BeingEntityRowList<B extends SettingBeing>({
  beings,
  onDelete,
  deleteLabel = "Удалить",
  onDuplicate,
  emptyLabel = "Пока никого нет.",
  getFactions,
  getFactionCount,
  getLocationSuffix,
  hideDelete,
}: {
  beings: B[];
  onDelete: (id: number) => void;
  deleteLabel?: string;
  onDuplicate?: (being: B) => void;
  emptyLabel?: string;
  // Factions this being belongs to, when known in this list's context (e.g.
  // Location's Обитатели tab, which fetches faction membership alongside
  // each inhabitant). Also drives the multi-faction icon (length > 1).
  getFactions?: (being: B) => { id: number; name: string }[] | undefined;
  // Faction count when only the count (not the list) is available — e.g. a
  // Community's own Представители tab, which already knows every row is a
  // member of at least this faction and only needs the total for the badge.
  getFactionCount?: (being: B) => number | undefined;
  // "(location name)" suffix after the being's name — only meaningful for
  // the nested-inhabitants view, where a row's home location isn't the page
  // currently being viewed.
  getLocationSuffix?: (being: B) => string | null | undefined;
  // Hides the delete button for rows where it wouldn't make sense — e.g.
  // nested inhabitants shown on a location that isn't their actual home,
  // where "Убрать отсюда" has no relationship to remove.
  hideDelete?: (being: B) => boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; being: B } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const thumbnailStyles = loadThumbnailStyles();

  function contextMenuItems(being: B): ContextMenuItem[] {
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
        const factions = getFactions?.(b);
        const factionCount = factions?.length ?? getFactionCount?.(b) ?? 0;
        const locationSuffix = getLocationSuffix?.(b);
        const meta = formatMeta(b.creature_meta);
        const isOpen = expandedId === b.id;
        return (
          <div key={b.id}>
            <div
              className={`entity-row${isBg ? " entity-row-bg" : ""}`}
              style={{ ...(isBg ? { backgroundImage: `url("${url}")` } : undefined), cursor: "pointer" }}
              onClick={() => setExpandedId(isOpen ? null : b.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, being: b });
              }}
            >
              {mode === "banner" && url && <img src={url} alt="" className="entity-row-thumb" />}
              <span className="entity-row-name">
                {b.name}
                {locationSuffix && <span className="muted"> ({locationSuffix})</span>}
                {meta && <span className="entity-row-meta muted">{meta}</span>}
              </span>
              <span className="muted">{BEING_CATEGORIES.find((c) => c.key === b.category)?.label}</span>
              {factionCount > 1 && (
                <span className="entity-row-badge" title="Состоит в нескольких фракциях">
                  <MultiFactionIcon />
                </span>
              )}
              <span className="entity-row-tags">
                <TagChips tags={b.tags} />
              </span>
              <span className="entity-row-actions" onClick={(e) => e.stopPropagation()}>
                <Link to={`/beings/${b.id}`}>Перейти</Link>
                {!hideDelete?.(b) && (
                  <button type="button" onClick={() => onDelete(b.id)}>
                    {deleteLabel}
                  </button>
                )}
              </span>
            </div>
            {isOpen && (
              <div className="entity-row-expanded">
                {meta && <div className="muted">{meta}</div>}
                {factions && factions.length > 0 && (
                  <div>
                    <span className="muted">Фракции: </span>
                    {factions.map((f) => (
                      <Link key={f.id} to={`/communities/${f.id}`} style={{ marginRight: 6 }}>
                        {f.name}
                      </Link>
                    ))}
                  </div>
                )}
                {(b.locations ?? []).length > 0 && (
                  <div>
                    <span className="muted">Места обитания: </span>
                    {(b.locations ?? []).map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && ", "}
                        <Link to={`/locations/${l.id}`}>{l.name}</Link>
                      </span>
                    ))}
                  </div>
                )}
                {b.description ? (
                  <MentionText text={b.description} />
                ) : (
                  <span className="muted">Описания пока нет.</span>
                )}
              </div>
            )}
          </div>
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
