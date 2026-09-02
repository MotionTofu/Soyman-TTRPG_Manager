import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import type { CompendiumEntry } from "../types";

export type SimpleGrouping = "alpha" | "category";
export type SimpleSortDir = "asc" | "desc";

const UNSET_LABEL = "Не указан";

function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function categoryFor(entry: CompendiumEntry, field: string): string {
  const v = (entry.data as Record<string, unknown>)?.[field];
  if (v == null || String(v).trim() === "") return "";
  if (typeof v === "object" && v !== null && "name" in (v as Record<string, unknown>)) return String((v as { name: unknown }).name);
  return String(v);
}

function groupSimple(list: CompendiumEntry[], field: string | null, grouping: SimpleGrouping, dir: SimpleSortDir = "asc"): [string, CompendiumEntry[]][] {
  const byName = [...list].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, "ru");
    return dir === "asc" ? cmp : -cmp;
  });
  const map = new Map<string, CompendiumEntry[]>();
  const push = (key: string, e: CompendiumEntry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  };
  for (const e of byName) {
    if (grouping === "alpha") push(monogramLetter(e.name), e);
    else {
      const cat = field ? categoryFor(e, field) : "";
      push(cat || UNSET_LABEL, e);
    }
  }
  const keys = [...map.keys()];
  const unset = keys.filter((k) => k === UNSET_LABEL);
  const rest = keys.filter((k) => k !== UNSET_LABEL);
  rest.sort((a, b) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru")));
  return [...rest, ...unset].map((k) => [k, map.get(k)!]);
}

interface Props {
  entries: CompendiumEntry[];
  grouping: SimpleGrouping;
  sortDir?: SimpleSortDir;
  sectionId: number;
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
  categoryField: string | null;
  kindLabel: string;
}

export function SimpleKindTileGrid({ entries, grouping, sortDir = "asc", sectionId, searchActive, onToggleFavourite, categoryField, kindLabel }: Props) {
  const [modal, setModal] = useState<CompendiumEntry | null>(null);
  const favourites = useMemo(() => entries.filter((e) => e.favourite).sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, "ru");
    return sortDir === "asc" ? cmp : -cmp;
  }), [entries, sortDir]);
  const groups = useMemo(() => groupSimple(entries.filter((e) => !e.favourite), categoryField, grouping, sortDir), [entries, grouping, sortDir, categoryField]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && <SimpleGroup label="Избранное" sectionId={sectionId} list={favourites} forceOpen={searchActive} onOpenModal={setModal} onToggleFavourite={onToggleFavourite} kindLabel={kindLabel} categoryField={categoryField} />}
      {groups.map(([label, list]) => <SimpleGroup key={label} label={label} sectionId={sectionId} list={list} forceOpen={searchActive} onOpenModal={setModal} onToggleFavourite={onToggleFavourite} kindLabel={kindLabel} categoryField={categoryField} />)}
      {modal && (
        <Modal onClose={() => setModal(null)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>{modal.name}</h3>
            <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{categoryField ? categoryFor(modal, categoryField) || kindLabel : kindLabel}</div>
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

function SimpleGroup({ label, list, sectionId, forceOpen, onOpenModal, onToggleFavourite, kindLabel, categoryField }: { label: string; list: CompendiumEntry[]; sectionId: number; forceOpen: boolean; onOpenModal: (e: CompendiumEntry) => void; onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void; kindLabel: string; categoryField: string | null }) {
  const key = `simple-group-${sectionId}-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  const remember = useCallback((next: boolean) => { setOpen((prev) => { if (prev !== next) localStorage.setItem(key, next ? "1" : "0"); return next; }); }, [key]);
  return (
    <details className="comp-category" open={forceOpen || open} onToggle={(e) => { if (forceOpen) return; remember((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="comp-level-label chevron-summary"><NavIcon name="chevron" className="chevron-icon" />{label} <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>· {list.length}</span></summary>
      <div className="monster-grid">{list.map((e) => <SimpleTile key={e.id} entry={e} onOpenModal={onOpenModal} onToggleFavourite={onToggleFavourite} kindLabel={kindLabel} categoryField={categoryField} />)}</div>
    </details>
  );
}

const SimpleTile = memo(function SimpleTile({ entry, onOpenModal, onToggleFavourite, kindLabel, categoryField }: { entry: CompendiumEntry; onOpenModal: (e: CompendiumEntry) => void; onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void; kindLabel: string; categoryField: string | null }) {
  const favourite = !!entry.favourite;
  const cat = categoryField ? categoryFor(entry, categoryField) : "";
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
          <span className="monster-tile__meta">{cat || kindLabel}</span>
          <span className="monster-tile__value" style={{ fontSize: "var(--fs-meta)" }}>{entry.description ? entry.description.slice(0, 80) : "—"}</span>
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
