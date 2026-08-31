import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { CreatureCardPreview } from "./EntityPreviewModal";
import { BEING_CATEGORIES } from "../beingCategories";
import type { SettingBeing, SettingCommunity } from "../types";

// Tile for setting beings — visual twin of MonsterTile (system bestiary) per §1.4 band + portrait/monogram + facts + actions.
// Reuses .monster-tile / .monster-grid CSS so zine/noir/riot themes stay single-source.
function monogramTone(type: string): number {
  let hash = 0;
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}
function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
function categoryLabel(cat: string): string {
  return BEING_CATEGORIES.find((c) => c.key === cat)?.label ?? cat;
}
function metaLine(b: SettingBeing): string {
  const m = b.creature_meta;
  const parts: string[] = [];
  if (m?.creatureType) parts.push(m.creatureType);
  if (m?.size) parts.push(m.size);
  if (parts.length === 0) return categoryLabel(b.category);
  return parts.join(" · ");
}

export type BeingGrouping = "alpha" | "category" | "community";
export type SortDir = "asc" | "desc";

function groupBeings(list: SettingBeing[], grouping: BeingGrouping, dir: SortDir = "asc"): [string, SettingBeing[]][] {
  const collator = (a: string, b: string) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru"));
  if (grouping === "alpha") {
    const map = new Map<string, SettingBeing[]>();
    for (const b of list) {
      const k = monogramLetter(b.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    const keys = [...map.keys()].sort(collator);
    return keys.map((k) => [k, map.get(k)!]);
  }
  if (grouping === "category") {
    const map = new Map<string, SettingBeing[]>();
    for (const b of list) {
      const k = categoryLabel(b.category) || "Без категории";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    const keys = [...map.keys()].sort(collator);
    return keys.map((k) => [k, map.get(k)!]);
  }
  // community — each being appears in every community it belongs to (multi-faction icon signals)
  const map = new Map<string, SettingBeing[]>();
  const noFaction: SettingBeing[] = [];
  for (const b of list) {
    const comms = (b as unknown as { communities?: { id: number; name: string }[] }).communities ?? [];
    if (comms.length === 0) noFaction.push(b);
    else for (const c of comms) {
      if (!map.has(c.name)) map.set(c.name, []);
      map.get(c.name)!.push(b);
    }
  }
  const keys = [...map.keys()].sort(collator);
  const groups: [string, SettingBeing[]][] = keys.map((k) => [k, map.get(k)!]);
  if (noFaction.length > 0) groups.push(["Без фракции", noFaction]);
  return groups;
}

const SettingBeingTile = memo(function SettingBeingTile({
  being,
  onOpenModal,
  selected,
  onToggleSelect,
}: {
  being: SettingBeing;
  onOpenModal: (m: { id: number; view: "card" | "statblock" }) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const comms = (being as unknown as { communities?: { id: number; name: string }[] }).communities ?? [];
  const isMulti = comms.length > 1;
  const meta = metaLine(being);
  const loc = being.locations?.[0]?.name ?? "";
  return (
    <article className={`monster-tile${selected ? " is-selected" : ""}`} onClick={() => onOpenModal({ id: being.id, view: "card" })} title="Открыть карточку" style={selected ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined}>
      <header className="monster-tile__band">
        {onToggleSelect && (
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect} onClick={(e) => e.stopPropagation()} style={{ flex: "none" }} />
        )}
        <span className="monster-tile__name">{being.name || "Без названия"}</span>
        {isMulti && <span className="monster-tile__bag" title="В нескольких фракциях" style={{ display: "inline-flex" }}><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="15" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="15" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></span>}
      </header>
      <div className="monster-tile__body">
        {being.avatar_image_url ? (
          <img className="monster-tile__portrait" src={being.avatar_image_url} alt="" />
        ) : (
          <span className="monster-tile__monogram" style={{ ["--monogram-tone" as string]: `${monogramTone(meta)}` }} aria-hidden="true">
            {monogramLetter(being.name)}
          </span>
        )}
        <div className="monster-tile__facts">
          {being.name_original && <span className="monster-tile__en">{being.name_original}</span>}
          <span className="monster-tile__meta">{meta}{loc ? ` · ${loc}` : ""}</span>
          {(being as unknown as { community_count?: number }).community_count !== undefined && comms.length > 0 && (
            <span className="monster-tile__cr">{comms.map((c) => c.name).slice(0, 2).join(", ")}{comms.length > 2 ? ` +${comms.length - 2}` : ""}</span>
          )}
        </div>
      </div>
      <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" onClick={() => onOpenModal({ id: being.id, view: "card" })}>Карточка</button>
        <button type="button" onClick={() => onOpenModal({ id: being.id, view: "statblock" })}>Статблок</button>
        <Link to={`/beings/${being.id}`} onClick={(ev) => ev.stopPropagation()}>Профиль</Link>
      </footer>
    </article>
  );
});

function BeingGroup({
  label,
  list,
  forceOpen,
  onOpenModal,
  selectedIds,
  onToggleSelect,
}: {
  label: string;
  list: SettingBeing[];
  forceOpen: boolean;
  onOpenModal: (m: { id: number; view: "card" | "statblock" }) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const key = `settling-beings-group-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  const remember = useCallback((next: boolean) => {
    setOpen((prev) => {
      if (prev !== next) localStorage.setItem(key, next ? "1" : "0");
      return next;
    });
  }, [key]);
  return (
    <details className="comp-category" open={forceOpen || open} onToggle={(e) => { if (forceOpen) return; remember((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="comp-level-label chevron-summary">
        <NavIcon name="chevron" className="chevron-icon" />
        {label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>· {list.length}</span>
      </summary>
      <div className="monster-grid">
        {list.map((b) => <SettingBeingTile key={b.id} being={b} onOpenModal={onOpenModal} selected={selectedIds?.has(b.id)} onToggleSelect={onToggleSelect ? () => onToggleSelect(b.id) : undefined} />)}
      </div>
    </details>
  );
}

export function SettingBeingTileGrid({
  beings,
  grouping,
  searchActive,
  dir = "asc",
  onCreate,
  selectedIds,
  onToggleSelect,
}: {
  beings: SettingBeing[];
  grouping: BeingGrouping;
  searchActive: boolean;
  dir?: SortDir;
  onCreate?: () => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const [modal, setModal] = useState<{ id: number; view: "card" | "statblock" } | null>(null);
  const groups = useMemo(() => groupBeings(beings, grouping, dir), [beings, grouping, dir]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {groups.map(([label, list]) => (
        <BeingGroup key={label} label={label} list={list} forceOpen={searchActive} onOpenModal={setModal} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
      ))}
      {onCreate && (
        <div className="monster-grid">
          <article className="monster-tile" onClick={onCreate} title="Создать" style={{ borderStyle: "dashed", background: "var(--paper-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 140 }}>
            <span style={{ fontSize: 32, color: "var(--muted)" }}>+</span>
          </article>
        </div>
      )}
      {modal && (
        <Modal onClose={() => setModal(null)}>
          <CreatureCardPreview type="being" id={modal.id} statblockInline autoShowStatblock={modal.view === "statblock"} onClose={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

// Community tile — same grid, simpler facts
const SettingCommunityTile = memo(function SettingCommunityTile({ community }: { community: SettingCommunity }) {
  return (
    <article className="monster-tile" title={community.name}>
      <Link to={`/communities/${community.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", flex: 1 }}>
        <header className="monster-tile__band">
          <span className="monster-tile__name">{community.name || "Без названия"}</span>
        </header>
        <div className="monster-tile__body">
          {community.thumbnail_image_url || community.avatar_image_url ? (
            <img className="monster-tile__portrait" src={(community.thumbnail_image_url || community.avatar_image_url)!} alt="" />
          ) : (
            <span className="monster-tile__monogram" style={{ ["--monogram-tone" as string]: `${monogramTone(community.name)}` }} aria-hidden="true">
              {monogramLetter(community.name)}
            </span>
          )}
          <div className="monster-tile__facts">
            <span className="monster-tile__meta">{(community.tags ?? []).slice(0, 3).join(" · ") || "Сообщество"}</span>
          </div>
        </div>
        <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 4px" }}>Открыть →</span>
        </footer>
      </Link>
    </article>
  );
});

export function SettingCommunityTileGrid({ communities, searchActive, dir = "asc", onCreate }: { communities: SettingCommunity[]; searchActive: boolean; dir?: SortDir; onCreate?: () => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, SettingCommunity[]>();
    for (const c of communities) {
      const k = monogramLetter(c.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    const collator = (a: string, b: string) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru"));
    const keys = [...map.keys()].sort(collator);
    return keys.map((k) => [k, map.get(k)!] as [string, SettingCommunity[]]);
  }, [communities, dir]);

  // reuse same collapsible grouping as beings for consistency
  return (
    <div className="stack" style={{ gap: 10 }}>
      {groups.map(([label, list]) => (
        <details key={label} className="comp-category" open={searchActive || localStorage.getItem(`settling-community-group-${label}`) !== "0"} onToggle={(e) => {
          if (searchActive) return;
          localStorage.setItem(`settling-community-group-${label}`, (e.currentTarget as HTMLDetailsElement).open ? "1" : "0");
        }}>
          <summary className="comp-level-label chevron-summary">
            <NavIcon name="chevron" className="chevron-icon" />
            {label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>· {list.length}</span>
          </summary>
          <div className="monster-grid">
            {list.map((c) => <SettingCommunityTile key={c.id} community={c} />)}
          </div>
        </details>
      ))}
      {onCreate && (
        <div className="monster-grid">
          <article className="monster-tile" onClick={onCreate} title="Создать сообщество" style={{ borderStyle: "dashed", background: "var(--paper-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 140 }}>
            <span style={{ fontSize: 32, color: "var(--muted)" }}>+</span>
          </article>
        </div>
      )}
    </div>
  );
}
