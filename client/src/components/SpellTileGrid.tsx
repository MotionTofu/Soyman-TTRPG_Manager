import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import type { CompendiumEntry } from "../types";

export type SpellGrouping = "alpha" | "level" | "school";
export type SpellSortDir = "asc" | "desc";

const UNSET_LABEL = "Не указан";

function spellLevelLabel(level: number | null): string {
  if (level == null) return UNSET_LABEL;
  return level === 0 ? "Заговоры" : `${level} ур.`;
}

function schoolName(entry: CompendiumEntry): string {
  const raw = entry.data?.school as { name?: string } | string | undefined;
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  return raw.name ?? "";
}

function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function groupSpells(
  list: CompendiumEntry[],
  grouping: SpellGrouping,
  dir: SpellSortDir = "asc"
): [string, CompendiumEntry[]][] {
  const byName = [...list].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, "ru");
    return dir === "asc" ? cmp : -cmp;
  });
  const map = new Map<string, CompendiumEntry[]>();
  const push = (key: string, entry: CompendiumEntry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  };
  for (const e of byName) {
    if (grouping === "alpha") push(monogramLetter(e.name), e);
    else if (grouping === "level") push(spellLevelLabel(e.level), e);
    else push(schoolName(e) || UNSET_LABEL, e);
  }
  const keys = [...map.keys()];
  const unset = keys.filter((k) => k === UNSET_LABEL);
  const rest = keys.filter((k) => k !== UNSET_LABEL);
  if (grouping === "level") {
    const order = (label: string) => {
      if (label === "Заговоры") return -1;
      const n = parseInt(label, 10);
      return Number.isFinite(n) ? n : 999;
    };
    rest.sort((a, b) => {
      const cmp = order(a) - order(b);
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rest.sort((a, b) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru")));
  }
  return [...rest, ...unset].map((k) => [k, map.get(k)!]);
}

interface Props {
  entries: CompendiumEntry[];
  grouping: SpellGrouping;
  sortDir?: SpellSortDir;
  sectionId: number;
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}

export function SpellTileGrid({
  entries,
  grouping,
  sortDir = "asc",
  sectionId,
  searchActive,
  onToggleFavourite,
}: Props) {
  const [modal, setModal] = useState<CompendiumEntry | null>(null);

  const favourites = useMemo(
    () =>
      entries
        .filter((e) => e.favourite)
        .sort((a, b) => {
          const cmp = a.name.localeCompare(b.name, "ru");
          return sortDir === "asc" ? cmp : -cmp;
        }),
    [entries, sortDir]
  );
  const groups = useMemo(
    () => groupSpells(entries.filter((e) => !e.favourite), grouping, sortDir),
    [entries, grouping, sortDir]
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && (
        <SpellGroup label="Избранное" sectionId={sectionId} list={favourites} forceOpen={searchActive} onOpenModal={setModal} onToggleFavourite={onToggleFavourite} />
      )}
      {groups.map(([label, list]) => (
        <SpellGroup key={label} label={label} sectionId={sectionId} list={list} forceOpen={searchActive} onOpenModal={setModal} onToggleFavourite={onToggleFavourite} />
      ))}
      {modal && (
        <Modal onClose={() => setModal(null)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>{modal.name}</h3>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{spellLevelLabel(modal.level)} {schoolName(modal) ? `· ${schoolName(modal)}` : ""} {(modal.data as Record<string, unknown>)?.ritual ? "· ритуал" : ""} {(modal.data as Record<string, unknown>)?.concentration ? "· концентрация" : ""}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{modal.description || "Без описания"}</div>
            <div className="row" style={{ gap: 6 }}>
              <Link to={`/compendium/${modal.id}`} className="primary" onClick={() => setModal(null)}>Профиль</Link>
              <button onClick={() => { addToBag({ type: "compendium_entry", id: modal.id, title: modal.name, kind: modal.kind, system_id: modal.system_id, section_id: modal.section_id }); setModal(null); }}>В мешок</button>
              <button onClick={() => setModal(null)}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SpellGroup({
  label,
  list,
  sectionId,
  forceOpen,
  onOpenModal,
  onToggleFavourite,
}: {
  label: string;
  list: CompendiumEntry[];
  sectionId: number;
  forceOpen: boolean;
  onOpenModal: (e: CompendiumEntry) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const key = `spell-group-${sectionId}-${label}`;
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
        {list.map((e) => (
          <SpellTile key={e.id} entry={e} onOpenModal={onOpenModal} onToggleFavourite={onToggleFavourite} />
        ))}
      </div>
    </details>
  );
}

const SpellTile = memo(function SpellTile({
  entry,
  onOpenModal,
  onToggleFavourite,
}: {
  entry: CompendiumEntry;
  onOpenModal: (e: CompendiumEntry) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const favourite = !!entry.favourite;
  const level = spellLevelLabel(entry.level);
  const school = schoolName(entry);
  const ritual = !!(entry.data as Record<string, unknown>)?.ritual;
  const conc = !!(entry.data as Record<string, unknown>)?.concentration;
  const meta = [level !== UNSET_LABEL ? level : null, school || null].filter(Boolean).join(" · ") || "Заклинание";
  return (
    <article className="monster-tile" onClick={() => onOpenModal(entry)} title="Открыть карточку">
      <header className="monster-tile__band">
        <button type="button" className={`monster-tile__star${favourite ? " is-on" : ""}`} title={favourite ? "Убрать из избранного" : "В избранное"} onClick={(ev) => { ev.stopPropagation(); onToggleFavourite(entry, !favourite); }}><NavIcon name="star" filled={favourite} /></button>
        <span className="monster-tile__name">{entry.name || "Без названия"}</span>
        <button type="button" className="monster-tile__bag" title="В мешок" onClick={(ev) => { ev.stopPropagation(); addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id }); }}><NavIcon name="bag" /></button>
      </header>
      <div className="monster-tile__body">
        <span className="monster-tile__monogram" aria-hidden="true">{monogramLetter(entry.name)}</span>
        <div className="monster-tile__facts">
          <span className="monster-tile__meta">{meta}</span>
          <span className="monster-tile__value" style={{ fontSize: "var(--fs-meta)" }}>{[ritual ? "ритуал" : null, conc ? "концентрация" : null].filter(Boolean).join(" · ") || "—"}</span>
        </div>
      </div>
      <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" onClick={() => onOpenModal(entry)}>Карточка</button>
        <Link to={`/compendium/${entry.id}`} onClick={(ev) => ev.stopPropagation()}>Профиль</Link>
      </footer>
    </article>
  );
});

export async function saveFavourite(entryId: number, favourite: boolean): Promise<void> {
  await api.put(`/systems/entries/${entryId}/favourite`, { favourite });
}
