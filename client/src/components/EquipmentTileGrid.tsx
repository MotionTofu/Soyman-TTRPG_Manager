import { memo, useCallback, useMemo, useState } from "react";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { MentionText } from "./mentions/MentionText";
import { EQUIPMENT_CATEGORIES } from "../compendium";
import type { CompendiumEntry } from "../types";

// Плитки снаряжения — по лекалу MonsterTileGrid/VehicleTileGrid (B1).
// Плитка отвечает на «что это»: категория, цена/вес, урон/КЗ видны сразу.
// Правка/удаление остаются в дереве (list), плитка — «посмотреть и взять».

export type EquipmentGrouping = "alpha" | "category";
export type EquipmentSortDir = "asc" | "desc";

const UNSET_LABEL = "Не указан";
const CATEGORY_ORDER = new Map<string, number>(EQUIPMENT_CATEGORIES.map((c, i) => [c, i]));

function categoryName(entry: CompendiumEntry): string {
  return (entry.data?.category as string | undefined) ?? "";
}
function costName(entry: CompendiumEntry): string {
  const v = entry.data?.cost;
  return v == null || v === "" ? "" : String(v);
}
function weightName(entry: CompendiumEntry): string {
  const v = entry.data?.weight;
  return v == null || v === "" ? "" : String(v);
}
function acName(entry: CompendiumEntry): string {
  const v = entry.data?.ac;
  return v == null || v === "" ? "" : String(v);
}
function damageName(entry: CompendiumEntry): string {
  const v = entry.data?.damage;
  return v == null || v === "" ? "" : String(v);
}

function monogramTone(category: string): number {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}
function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function groupEquipment(
  list: CompendiumEntry[],
  grouping: EquipmentGrouping,
  dir: EquipmentSortDir = "asc"
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
    else push(categoryName(e) || UNSET_LABEL, e);
  }
  const keys = [...map.keys()];
  const unset = keys.filter((k) => k === UNSET_LABEL);
  const rest = keys.filter((k) => k !== UNSET_LABEL);
  if (grouping === "category") {
    rest.sort((a, b) => {
      const cmp = (CATEGORY_ORDER.get(a) ?? 999) - (CATEGORY_ORDER.get(b) ?? 999);
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rest.sort((a, b) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru")));
  }
  return [...rest, ...unset].map((k) => [k, map.get(k)!]);
}

interface Props {
  entries: CompendiumEntry[];
  grouping: EquipmentGrouping;
  sortDir?: EquipmentSortDir;
  sectionId: number;
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
  onEdit?: (entry: CompendiumEntry) => void;
}

export function EquipmentTileGrid({
  entries,
  grouping,
  sortDir = "asc",
  sectionId,
  searchActive,
  onToggleFavourite,
  onEdit,
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
    () => groupEquipment(entries.filter((e) => !e.favourite), grouping, sortDir),
    [entries, grouping, sortDir]
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && (
        <EquipmentGroup
          label="Избранное"
          sectionId={sectionId}
          list={favourites}
          forceOpen={searchActive}
          onOpenModal={setModal}
          onToggleFavourite={onToggleFavourite}
          onEdit={onEdit}
        />
      )}
      {groups.map(([label, list]) => (
        <EquipmentGroup
          key={label}
          label={label}
          sectionId={sectionId}
          list={list}
          forceOpen={searchActive}
          onOpenModal={setModal}
          onToggleFavourite={onToggleFavourite}
          onEdit={onEdit}
        />
      ))}
      {modal && (
        <Modal onClose={() => setModal(null)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>{modal.name || "Без названия"}</h3>
            <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
              {[categoryName(modal), costName(modal) && `Цена ${costName(modal)}`, weightName(modal) && `Вес ${weightName(modal)}`].filter(Boolean).join(" · ") || "Без категории"}
            </div>
            {(damageName(modal) || acName(modal)) && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                {[damageName(modal) && `Урон ${damageName(modal)}`, acName(modal) && `КЗ ${acName(modal)}`].filter(Boolean).join(" · ")}
              </div>
            )}
            {modal.description ? <MentionText text={modal.description} /> : <span className="muted">Нет описания.</span>}
            <div className="row">
              <button
                type="button"
                onClick={() => {
                  addToBag({
                    type: "compendium_entry",
                    id: modal.id,
                    title: modal.name,
                    kind: modal.kind,
                    system_id: modal.system_id,
                    section_id: modal.section_id,
                  });
                  setModal(null);
                }}
              >
                В мешок
              </button>
              <button type="button" onClick={() => setModal(null)}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EquipmentGroup({
  label,
  list,
  sectionId,
  forceOpen,
  onOpenModal,
  onToggleFavourite,
  onEdit,
}: {
  label: string;
  list: CompendiumEntry[];
  sectionId: number;
  forceOpen: boolean;
  onOpenModal: (e: CompendiumEntry) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
  onEdit?: (entry: CompendiumEntry) => void;
}) {
  const key = `equipment-group-${sectionId}-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  const remember = useCallback(
    (next: boolean) => {
      setOpen((prev) => {
        if (prev !== next) localStorage.setItem(key, next ? "1" : "0");
        return next;
      });
    },
    [key]
  );
  return (
    <details
      className="comp-category"
      open={forceOpen || open}
      onToggle={(e) => {
        if (forceOpen) return;
        remember((e.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="comp-level-label chevron-summary">
        <NavIcon name="chevron" className="chevron-icon" />
        {label}{" "}
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}>
          · {list.length}
        </span>
      </summary>
      <div className="monster-grid">
        {list.map((e) => (
          <EquipmentTile key={e.id} entry={e} onOpenModal={onOpenModal} onToggleFavourite={onToggleFavourite} onEdit={onEdit} />
        ))}
      </div>
    </details>
  );
}

const EquipmentTile = memo(function EquipmentTile({
  entry,
  onOpenModal,
  onToggleFavourite,
  onEdit,
}: {
  entry: CompendiumEntry;
  onOpenModal: (e: CompendiumEntry) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
  onEdit?: (entry: CompendiumEntry) => void;
}) {
  const category = categoryName(entry);
  const cost = costName(entry);
  const weight = weightName(entry);
  const damage = damageName(entry);
  const ac = acName(entry);
  const acBonus = entry.data?.ac_bonus ? String(entry.data.ac_bonus) : "";
  const favourite = !!entry.favourite;
  return (
    <article className="monster-tile" onClick={() => onOpenModal(entry)} title="Открыть описание">
      <header className="monster-tile__band">
        <button
          type="button"
          className={`monster-tile__star${favourite ? " is-on" : ""}`}
          title={favourite ? "Убрать из избранного" : "В избранное"}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleFavourite(entry, !favourite);
          }}
        >
          <NavIcon name="star" filled={favourite} />
        </button>
        <span className="monster-tile__name">{entry.name || "Без названия"}</span>
        <button
          type="button"
          className="monster-tile__bag"
          title="Отправить в мешок"
          onClick={(ev) => {
            ev.stopPropagation();
            addToBag({
              type: "compendium_entry",
              id: entry.id,
              title: entry.name,
              kind: entry.kind,
              system_id: entry.system_id,
              section_id: entry.section_id,
            });
          }}
        >
          <NavIcon name="bag" />
        </button>
      </header>
      <div className="monster-tile__body">
        <span
          className="monster-tile__monogram"
          style={{ ["--monogram-tone" as string]: `${monogramTone(category)}` }}
          aria-hidden="true"
        >
          {monogramLetter(entry.name)}
        </span>
        <div className="monster-tile__facts">
          <span className="monster-tile__meta">{category || "Без категории"}</span>
          <span className="monster-tile__value" style={{ fontSize: "var(--fs-meta)" }}>
            {[cost && `Цена ${cost}`, weight && `Вес ${weight}`].filter(Boolean).join(" · ") || "—"}
          </span>
          {(damage || ac || acBonus) && (
            <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
              {[damage && `Урон ${damage}`, ac && `КЗ ${ac}`, acBonus && `+${acBonus} КЗ`].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>
      <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" onClick={() => onOpenModal(entry)}>Просмотр</button>
        <button
          type="button"
          onClick={() => {
            addToBag({
              type: "compendium_entry",
              id: entry.id,
              title: entry.name,
              kind: entry.kind,
              system_id: entry.system_id,
              section_id: entry.section_id,
            });
          }}
        >
          В мешок
        </button>
        {onEdit && (
          <button type="button" onClick={() => onEdit(entry)}>Править</button>
        )}
      </footer>
    </article>
  );
});
