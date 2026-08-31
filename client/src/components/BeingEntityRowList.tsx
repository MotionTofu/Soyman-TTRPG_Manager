import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SettingBeing } from "../types";
import { BEING_CATEGORIES } from "../beingCategories";
import { TagChips } from "./TagChips";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { MentionText } from "./mentions/MentionText";
import { StatblockIcon, statblockBadgeTitle } from "./StatblockIcon";
import { isSafeImageUrl } from "../utils/safeUrl";

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

function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;
  const q = query.trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", padding: 0 }}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
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
  asLinks,
  highlight,
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
  // Matches Сообщества/Народы/Культуры's row behavior instead of the default
  // click-to-expand: the whole row is a Link straight to the profile (no
  // inline preview, no right-click menu), and the trailing action reads
  // "Изменить" instead of "Перейти" — used by Население's top-level
  // Существа list so the two subsections of that tab look and act alike.
  // Обитатели/Представители embeds keep the richer expand-in-place default.
  asLinks?: boolean;
  highlight?: string;
}) {
  const navigate = useNavigate();
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
        const rawUrl = b.thumbnail_image_url || b.avatar_image_url;
        const safeUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
        const mode = thumbnailStyles.beings;
        const factions = getFactions?.(b);
        const factionCount = factions?.length ?? getFactionCount?.(b) ?? 0;
        const locationSuffix = getLocationSuffix?.(b);
        const meta = formatMeta(b.creature_meta);
        const isOpen = !asLinks && expandedId === b.id;
        const RowTag = (asLinks ? Link : "div") as React.ElementType;
        const rowProps = asLinks
          ? { to: `/beings/${b.id}` }
          : {
              role: "button",
              tabIndex: 0,
              "aria-expanded": isOpen,
              onClick: () => setExpandedId(isOpen ? null : b.id),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedId(isOpen ? null : b.id);
                }
              },
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, being: b });
              },
            };
        return (
          <div key={b.id}>
            <RowTag
              className="entity-row"
              style={{ cursor: "pointer" }}
              {...(rowProps as object)}
            >
              {mode === "banner" && safeUrl ? (
                <img src={safeUrl} alt="" className="entity-row-thumb" />
              ) : mode === "banner" ? (
                <span className="entity-row-thumb" aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: "14px", fontWeight: 700, color: "var(--muted)", background: "var(--bg-elevated)", border: "1px solid var(--line)" }}>{b.name.trim().charAt(0).toUpperCase() || "•"}</span>
              ) : null}
              <span className="entity-row-name">
                <Highlight text={b.name} query={highlight} />
                {locationSuffix && <span className="muted"> ({locationSuffix})</span>}
                {meta && <span className="entity-row-meta">{meta}</span>}
              </span>
              <span className="badge tag" style={{ fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{BEING_CATEGORIES.find((c) => c.key === b.category)?.label}</span>
              {(b.statblock_count ?? 0) > 0 && (
                <span
                  className="entity-row-badge"
                  title={statblockBadgeTitle(b.statblock_count ?? 0)}
                >
                  <StatblockIcon />
                </span>
              )}
              {factionCount > 1 && (
                <span className="entity-row-badge" title="Состоит в нескольких фракциях">
                  <MultiFactionIcon />
                </span>
              )}
              <span className="entity-row-tags">
                <TagChips tags={(b.tags ?? []).slice(0, 3)} />
                {(b.tags ?? []).length > 3 && <span className="badge tag">+{b.tags.length - 3}</span>}
              </span>
              <span className="entity-row-actions" onClick={(e) => e.stopPropagation()}>
                {/* В режиме asLinks вся строка — ссылка, а <a> внутри <a>
                    недопустима: браузер такую разметку разбирает по-своему.
                    Поэтому здесь кнопка с той же навигацией. preventDefault
                    ещё и не даёт строке-ссылке сработать заодно с кнопкой. */}
                {asLinks ? (
                  <button
                    type="button"
                    className="entity-row-action-link"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/beings/${b.id}`);
                    }}
                  >
                    Изменить
                  </button>
                ) : (
                  <Link to={`/beings/${b.id}`}>Перейти</Link>
                )}
                {!hideDelete?.(b) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onDelete(b.id);
                    }}
                  >
                    {deleteLabel}
                  </button>
                )}
              </span>
            </RowTag>
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
