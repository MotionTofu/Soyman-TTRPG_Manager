import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { CREATURE_SIZES, VEHICLE_CATEGORIES } from "../compendium";
import { VehicleCardPreview } from "./VehicleCardPreview";
import type { CompendiumEntry } from "../types";

// Транспорт плиткой — по лекалу бестиария (шаг 5 ревизии). Плитка отвечает
// на «что это за судно»: категория, размер и прочность видны сразу, три
// кнопки ведут туда, куда Мастер и шёл, — карточка, статблок, профиль.
//
// Правка и удаление с плитки убраны намеренно (то же решение, что у
// бестиария): они живут на странице судна — там же, где посты экипажа.

export type VehicleGrouping = "alpha" | "category" | "size";
export type VehicleSortDir = "asc" | "desc";

const UNSET_LABEL = "Не указан";
const CATEGORY_ORDER = new Map<string, number>(VEHICLE_CATEGORIES.map((c, i) => [c, i]));

function categoryName(entry: CompendiumEntry): string {
  return (entry.data?.category as string | undefined) ?? "";
}
function sizeName(entry: CompendiumEntry): string {
  return (entry.data?.size as string | undefined) ?? "";
}

/** Заглушка — paper-2 без цветового кода (§1.7), hue-вариация удалена в Фазе 5 (C1). */

function monogramLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

// Группировка ровно как у бестиария: пустая группа не создаётся (§1.11),
// записи без значения собираются в хвостовую «Не указан».
function groupVehicles(
  list: CompendiumEntry[],
  grouping: VehicleGrouping,
  dir: VehicleSortDir = "asc"
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
    else if (grouping === "category") push(categoryName(e) || UNSET_LABEL, e);
    else push(sizeName(e) || UNSET_LABEL, e);
  }

  const keys = [...map.keys()];
  const unset = keys.filter((k) => k === UNSET_LABEL);
  const rest = keys.filter((k) => k !== UNSET_LABEL);
  if (grouping === "category") {
    rest.sort((a, b) => {
      const cmp = (CATEGORY_ORDER.get(a) ?? 999) - (CATEGORY_ORDER.get(b) ?? 999);
      return dir === "asc" ? cmp : -cmp;
    });
  } else if (grouping === "size") {
    const order = new Map<string, number>(CREATURE_SIZES.map((s, i) => [s, i]));
    rest.sort((a, b) => {
      const cmp = (order.get(a) ?? 999) - (order.get(b) ?? 999);
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rest.sort((a, b) => (dir === "asc" ? a.localeCompare(b, "ru") : b.localeCompare(a, "ru")));
  }
  return [...rest, ...unset].map((k) => [k, map.get(k)!]);
}

interface Props {
  entries: CompendiumEntry[];
  grouping: VehicleGrouping;
  sortDir?: VehicleSortDir;
  sectionId: number;
  /** Поиск раскрывает все группы: свёрнутая группа прячет то, что искали. */
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}

export function VehicleTileGrid({
  entries,
  grouping,
  sortDir = "asc",
  sectionId,
  searchActive,
  onToggleFavourite,
}: Props) {
  const [modal, setModal] = useState<{ id: number; view: "card" | "statblock" } | null>(null);

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
  // Избранные не дублируются в своей группе.
  const groups = useMemo(
    () => groupVehicles(entries.filter((e) => !e.favourite), grouping, sortDir),
    [entries, grouping, sortDir]
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && (
        <VehicleGroup
          label="Избранное"
          sectionId={sectionId}
          list={favourites}
          forceOpen={searchActive}
          onOpenModal={setModal}
          onToggleFavourite={onToggleFavourite}
        />
      )}
      {groups.map(([label, list]) => (
        <VehicleGroup
          key={label}
          label={label}
          sectionId={sectionId}
          list={list}
          forceOpen={searchActive}
          onOpenModal={setModal}
          onToggleFavourite={onToggleFavourite}
        />
      ))}
      {modal && (
        <Modal onClose={() => setModal(null)}>
          <VehicleCardPreview
            id={modal.id}
            statblockInline
            autoShowStatblock={modal.view === "statblock"}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function VehicleGroup({
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
  onOpenModal: (m: { id: number; view: "card" | "statblock" }) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const key = `vehicle-group-${sectionId}-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  // Пишется только настоящее переключение (та же ловушка, что у бестиария:
  // без сверки React проставлял `open` после монтирования и браузер шлёл на
  // это `toggle`).
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
        <span
          className="muted"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: 400 }}
        >
          · {list.length}
        </span>
      </summary>
      <div className="monster-grid">
        {list.map((e) => (
          <VehicleTile
            key={e.id}
            entry={e}
            onOpenModal={onOpenModal}
            onToggleFavourite={onToggleFavourite}
          />
        ))}
      </div>
    </details>
  );
}

// memo — то же, что у бестиария: щелчок по звезде правит одну запись, а без
// него перерисовывался весь раздел. Обработчики приходят стабильными
// (useCallback у владельца состояния).
const VehicleTile = memo(function VehicleTile({
  entry,
  onOpenModal,
  onToggleFavourite,
}: {
  entry: CompendiumEntry;
  onOpenModal: (m: { id: number; view: "card" | "statblock" }) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const category = categoryName(entry);
  const size = sizeName(entry);
  const favourite = !!entry.favourite;
  const raw = entry.data ?? {};
  const str = (k: string) => {
    const v = raw[k];
    return v == null || v === "" ? "" : String(v);
  };
  const ac = str("ac");
  const hp = str("hp");

  return (
    <article
      className="monster-tile"
      onClick={() => onOpenModal({ id: entry.id, view: "card" })}
      title="Открыть карточку транспорта"
    >
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
        {entry.avatar_image_url ? (
          // Портрет — изображение-СОДЕРЖИМОЕ, дуотон на него не ложится (§1.13).
          <img className="monster-tile__portrait" src={entry.avatar_image_url} alt="" />
        ) : (
          <span className="monster-tile__monogram" aria-hidden="true">
            {monogramLetter(entry.name)}
          </span>
        )}
        <div className="monster-tile__facts">
          {entry.name_original && <span className="monster-tile__en">{entry.name_original}</span>}
          <span className="monster-tile__meta">
            {[category, size].filter(Boolean).join(" · ") || "Категория не указана"}
          </span>
          <span className="monster-tile__value">
            КД {ac || "—"} · {hp ? `${hp} хитов` : "хитов —"}
          </span>
        </div>
      </div>

      <footer className="monster-tile__actions" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" onClick={() => onOpenModal({ id: entry.id, view: "card" })}>
          Карточка
        </button>
        <button type="button" onClick={() => onOpenModal({ id: entry.id, view: "statblock" })}>
          Статблок
        </button>
        <Link to={`/compendium/${entry.id}`} onClick={(ev) => ev.stopPropagation()}>
          Профиль
        </Link>
      </footer>
    </article>
  );
});

/** Звезда пишется сразу — список раздела не перезагружается ради одной отметки. */
export async function saveFavourite(entryId: number, favourite: boolean): Promise<void> {
  await api.put(`/systems/entries/${entryId}/favourite`, { favourite });
}