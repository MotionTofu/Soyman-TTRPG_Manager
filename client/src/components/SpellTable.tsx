import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { buildSpellDetail } from "./dnd/SheetSpells";
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

// Сокращение школы стоит рядом с полным названием (решение владельца
// 2026-10-29): видно сразу оба, сокращение запоминается.
const SCHOOL_ABBR: Record<string, string> = {
  "Воплощение": "ВП", "Вызов": "ВЫ", "Иллюзия": "ИЛ", "Некромантия": "НК",
  "Ограждение": "ОГ", "Очарование": "ОЧ", "Преобразование": "ПБ", "Прорицание": "ПР",
};
function schoolAbbr(name: string): string {
  return SCHOOL_ABBR[name] ?? name.slice(0, 2).toUpperCase();
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
  /** Классы верхнего уровня: в колонке «Классы» подклассы не пишутся. */
  classIds: ReadonlySet<number>;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}

/** Заклинания таблицей по группам (макет «Д» Roll-Spells). Строка открывает
 *  ту же карточку, что прежде плитка. */
export function SpellTable({
  entries,
  grouping,
  sortDir = "asc",
  sectionId,
  searchActive,
  classIds,
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
  const groupProps = { sectionId, forceOpen: searchActive, classIds, onOpenModal: setModal, onToggleFavourite };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && <SpellGroup label="Избранное" list={favourites} {...groupProps} />}
      {groups.map(([label, list]) => (
        <SpellGroup key={label} label={label} list={list} {...groupProps} />
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
  classIds,
  onOpenModal,
  onToggleFavourite,
}: {
  label: string;
  list: CompendiumEntry[];
  sectionId: number;
  forceOpen: boolean;
  classIds: ReadonlySet<number>;
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
  const isOpen = forceOpen || open;
  return (
    <details className="comp-category monster-group" open={isOpen} onToggle={(e) => { if (forceOpen) return; remember((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary className="comp-level-label chevron-summary">
        <NavIcon name="chevron" className="chevron-icon" />
        <span className="d-plate">{label}</span>
        <span className="d-note">{list.length}</span>
      </summary>
      {/* Закрытая группа таблицу не строит: в разделе ~400 строк. */}
      {isOpen && (
        <div className="spell-table-wrap">
          <table className="spell-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Школа</th>
                <th>Время</th>
                <th>Дистанция</th>
                <th>Длительность</th>
                <th>Метки</th>
                <th>Классы</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <SpellRow key={e.id} entry={e} classIds={classIds} onOpenModal={onOpenModal} onToggleFavourite={onToggleFavourite} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function SpellRow({
  entry,
  classIds,
  onOpenModal,
  onToggleFavourite,
}: {
  entry: CompendiumEntry;
  classIds: ReadonlySet<number>;
  onOpenModal: (e: CompendiumEntry) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const detail = buildSpellDetail(entry);
  const school = schoolName(entry);
  const data = entry.data as Record<string, unknown>;
  const classes = ((data.classes as { id: number; name: string }[] | undefined) ?? []).filter((c) => classIds.has(c.id));
  const favourite = !!entry.favourite;
  return (
    <tr onClick={() => onOpenModal(entry)}>
      <td><span className="spell-table__name">
        <button type="button" className={`spell-table__star${favourite ? " is-on" : ""}`} title={favourite ? "Убрать из избранного" : "В избранное"}
          onClick={(ev) => { ev.stopPropagation(); onToggleFavourite(entry, !favourite); }}>
          <NavIcon name="star" filled={favourite} />
        </button>
        <button type="button" className="spell-table__open" onClick={(ev) => { ev.stopPropagation(); onOpenModal(entry); }}>
          {entry.name || "Без названия"}
        </button>
      </span></td>
      <td>{school && <><span className="spell-table__school" aria-hidden="true">{schoolAbbr(school)}</span>{school}</>}</td>
      <td>{detail.castingTime ?? "—"}</td>
      <td>{detail.range ?? "—"}</td>
      <td>{detail.duration ?? "—"}</td>
      <td className="spell-table__tags">
        {data.ritual ? <span title="Ритуал">Р</span> : null}
        {data.concentration ? <span title="Концентрация">К</span> : null}
      </td>
      <td className="spell-table__classes" title={classes.map((c) => c.name).join(", ")}>
        {classes.map((c) => c.name.slice(0, 3).toUpperCase()).join(" ")}
      </td>
    </tr>
  );
}
