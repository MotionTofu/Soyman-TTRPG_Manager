import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { CreatureCardPreview } from "./EntityPreviewModal";
import { CHALLENGE_RATINGS, CREATURE_SIZES } from "../compendium";
import type { CompendiumEntry } from "../types";

// Бестиарий плиткой (шаг 5 ревизии). Строка списка отвечала на вопрос «как
// называется», плитка отвечает на «кого выставить»: морда, тип, размер и КО
// видны сразу, а три кнопки ведут туда, куда Мастер и шёл, — карточка,
// статблок, профиль.
//
// Правка и удаление с плитки убраны намеренно: они живут на странице
// профиля. Плитка — это «посмотреть и взять в бой», и кнопка удаления в
// сетке из 535 одинаковых прямоугольников — это ошибка, ждущая своего часа.

interface MechanicsOption {
  id: number;
  name: string;
}

/** Порядок групп по КО — числовой, а не строковый: «10» после «9», а не после «1». */
const CR_ORDER = new Map<string, number>(CHALLENGE_RATINGS.map((cr, i) => [cr, i]));

const UNSET_LABEL = "Не указан";

export type MonsterGrouping = "alpha" | "creature_type" | "cr" | "size";

/** Русское имя и английское из скобок: «Ядовитая змея [Venomous Snake]». */
export function splitCreatureName(name: string): { ru: string; en: string } {
  const match = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(name ?? "");
  return match ? { ru: match[1].trim(), en: match[2].trim() } : { ru: (name ?? "").trim(), en: "" };
}

function creatureTypeName(entry: CompendiumEntry): string {
  return (entry.data.creature_type as MechanicsOption | undefined)?.name ?? "";
}

function sizeName(entry: CompendiumEntry): string {
  return (entry.data.size as string | undefined) ?? "";
}

function crName(entry: CompendiumEntry): string {
  return (entry.data.cr as string | undefined) ?? "";
}

/**
 * Монограмма вместо портрета. Портрет есть у 243 записей бестиария D&D 5.5
 * из 535 — почти половина плиток осталась бы пустым серым квадратом, и это
 * было бы честно, но бесполезно. Цвет — не смысловой код (§1.7 тип
 * кодируется формой), а различитель заглушки: он появляется только там, где
 * портрета нет, и держится подтоном бумаги, а не заливкой.
 */
function monogramTone(type: string): number {
  let hash = 0;
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

/** Первая буква имени — на месте портрета. */
function monogramLetter(ru: string): string {
  return (ru.trim()[0] ?? "?").toUpperCase();
}

// Группировка. Пустая группа не создаётся вовсе (§1.11), а записи без
// значения собираются в хвостовую «Не указан»: спрятать их нельзя — запись,
// исчезнувшая при смене сортировки, читается как потеря данных.
function groupMonsters(
  list: CompendiumEntry[],
  grouping: MonsterGrouping
): [string, CompendiumEntry[]][] {
  const byName = [...list].sort((a, b) =>
    splitCreatureName(a.name).ru.localeCompare(splitCreatureName(b.name).ru, "ru")
  );
  const map = new Map<string, CompendiumEntry[]>();
  const push = (key: string, entry: CompendiumEntry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  };
  for (const e of byName) {
    if (grouping === "alpha") push(monogramLetter(splitCreatureName(e.name).ru), e);
    else if (grouping === "creature_type") push(creatureTypeName(e) || UNSET_LABEL, e);
    else if (grouping === "cr") push(crName(e) ? `КО ${crName(e)}` : UNSET_LABEL, e);
    else push(sizeName(e) || UNSET_LABEL, e);
  }

  const keys = [...map.keys()];
  const unset = keys.filter((k) => k === UNSET_LABEL);
  const rest = keys.filter((k) => k !== UNSET_LABEL);
  if (grouping === "cr") {
    rest.sort((a, b) => (CR_ORDER.get(a.slice(3)) ?? 999) - (CR_ORDER.get(b.slice(3)) ?? 999));
  } else if (grouping === "size") {
    const order = new Map<string, number>(CREATURE_SIZES.map((s, i) => [s, i]));
    rest.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  } else {
    rest.sort((a, b) => a.localeCompare(b, "ru"));
  }
  return [...rest, ...unset].map((k) => [k, map.get(k)!]);
}

interface Props {
  entries: CompendiumEntry[];
  grouping: MonsterGrouping;
  sectionId: number;
  /** Поиск раскрывает все группы: свёрнутая группа прячет то, что искали. */
  searchActive: boolean;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}

export function MonsterTileGrid({
  entries,
  grouping,
  sectionId,
  searchActive,
  onToggleFavourite,
}: Props) {
  const [modal, setModal] = useState<{ id: number; view: "card" | "statblock" } | null>(null);

  const favourites = useMemo(
    () =>
      entries
        .filter((e) => e.favourite)
        .sort((a, b) =>
          splitCreatureName(a.name).ru.localeCompare(splitCreatureName(b.name).ru, "ru")
        ),
    [entries]
  );
  // Избранные не дублируются в своей группе: один и тот же дракон дважды на
  // экране — это вопрос «а почему», а не удобство.
  const groups = useMemo(
    () => groupMonsters(entries.filter((e) => !e.favourite), grouping),
    [entries, grouping]
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      {favourites.length > 0 && (
        <MonsterGroup
          label="Избранное"
          sectionId={sectionId}
          list={favourites}
          forceOpen={searchActive}
          onOpenModal={setModal}
          onToggleFavourite={onToggleFavourite}
        />
      )}
      {groups.map(([label, list]) => (
        <MonsterGroup
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
          <CreatureCardPreview
            type="compendium_entry"
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

function MonsterGroup({
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
  const key = `bestiary-group-${sectionId}-${label}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "0");
  // Пишется только настоящее переключение. React проставляет `open` уже
  // после монтирования, и браузер шлёт на это `toggle`, — без сверки раздел
  // при каждом открытии оставлял в localStorage по ключу на каждую из
  // тридцати групп, ни одну из которых Мастер не трогал.
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
          <MonsterTile
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

// memo — не украшение: щелчок по звезде правит одну запись, а без него
// перерисовывались все 535 плиток раздела (замерено, см. отчёт шага 5).
// Обработчики приходят стабильными (useCallback у владельца состояния),
// иначе memo не срабатывает — ровно та же ловушка, что была с вехами.
const MonsterTile = memo(function MonsterTile({
  entry,
  onOpenModal,
  onToggleFavourite,
}: {
  entry: CompendiumEntry;
  onOpenModal: (m: { id: number; view: "card" | "statblock" }) => void;
  onToggleFavourite: (entry: CompendiumEntry, favourite: boolean) => void;
}) {
  const { ru, en } = splitCreatureName(entry.name);
  const type = creatureTypeName(entry);
  const size = sizeName(entry);
  const cr = crName(entry);
  const favourite = !!entry.favourite;

  return (
    <article
      className="monster-tile"
      onClick={() => onOpenModal({ id: entry.id, view: "card" })}
      title="Открыть карточку существа"
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
        <span className="monster-tile__name">{ru || "Без названия"}</span>
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
          <span
            className="monster-tile__monogram"
            style={{ ["--monogram-tone" as string]: `${monogramTone(type)}` }}
            aria-hidden="true"
          >
            {monogramLetter(ru)}
          </span>
        )}
        <div className="monster-tile__facts">
          {en && <span className="monster-tile__en">{en}</span>}
          <span className="monster-tile__meta">
            {[type, size].filter(Boolean).join(" · ") || "Тип не указан"}
          </span>
          <span className="monster-tile__cr">{cr ? `КО ${cr}` : "КО —"}</span>
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

/** Звезда пишется сразу — список бестиария не перезагружается ради одной отметки. */
export async function saveFavourite(entryId: number, favourite: boolean): Promise<void> {
  await api.put(`/systems/entries/${entryId}/favourite`, { favourite });
}
