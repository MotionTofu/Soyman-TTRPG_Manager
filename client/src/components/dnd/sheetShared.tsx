// Мелочи, общие для частей листа D&D (DndCharacterForm и файлы Sheet*).
import { type DragEvent, useRef, useEffect, type ReactNode } from "react";
import type { SearchResult } from "../../types";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { NavIcon } from "../NavIcons";

export const SPELL_LEVELS = 9;
export const MAX_SPELL_SLOTS = 6;

export function stripLatin(name: string): string {
  return name.replace(/\s*\[[^\]]*\]/g, "").trim();
}

export function readSearchDrop(e: DragEvent): SearchResult | null {
  const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SearchResult;
  } catch {
    return null;
  }
}

// Спелл's "Школа" is a pick from the compendium's "Школы магии" mechanics
// list (an { id, name } object), but older data may still have the plain
// text this field used before — read either shape.
export function spellSchoolName(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && "name" in raw) return String((raw as { name: unknown }).name) || undefined;
  return typeof raw === "string" ? raw : undefined;
}

// Колода карт вместо ряда вкладок (гриллинг 2026-09-04). Порядок — порядок
// свайпа: сначала личность и живое состояние, потом то, чем ходят в бою,
// потом всё остальное. «Ресурсы» стоят последними и нужны редко: пулы
// всплывают над той картой, где их тратят, а здесь остаётся то, что не
// тратится ни на «Действиях», ни в «Магии» — реплики Артефактора и подобное.
export const DND_VIEW_TABS = ["Карта", "Действия", "Магия", "Снаряжение", "Навыки", "Особенности", "Ресурсы", "Досье"] as const;
export type DndViewTab = (typeof DND_VIEW_TABS)[number];

/**
 * «Список доступных заклинаний» — всё, что доступно классу и подклассу
 * персонажа, с возможностью взять оттуда в лист.
 *
 * Зачем отдельно от поиска в круге. Поиск по кругу отвечает на вопрос «как
 * называется это заклинание», а Мастеру и игроку нужен обратный: «что я
 * вообще могу взять». Раньше на него отвечала книга, а не приложение —
 * в справочнике 392 заклинания, и какие из них твои, там не написано.
 *
 * Отбор идёт по полю `classes` самой записи заклинания: ссылок 1324 и все
 * живые (в отличие от `granted_spells`, где не работала ни одна). Подкласс
 * учитывается наравне с классом — у Картографа 11 заклинаний сверх 80
 * артефакторских.
 */
// Fullscreen sheet dialogs bypass the shared Modal focus handling. Keep this
// scoped to OneShot while the sheet itself is shared with the main app.
export function useOneShotOverlayFocus(initialSelector: string) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.documentElement.dataset.app !== "oneshot") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.querySelector<HTMLElement>(initialSelector) ?? dialog).focus();

    const onTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0);
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === controls.length - 1)) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      if (previous?.isConnected) previous.focus();
    };
  }, [initialSelector]);
  return dialogRef;
}

// Click-to-edit HP box — the one vitals field that changes almost every
// combat round, so it gets its own tiny local edit state instead of
// Значение виталов, по которому щёлкают, чтобы его поправить. Кнопка, а не
// `div` с `onClick`: щелчком мыши работало и так, но с клавиатуры значение не
// бралось табом вовсе, а скринридер читал его как обычный текст, не называя
// нажимаемым. Когда править нечем (нет `onQuickUpdate` — например, у чужого
// листа), это просто значение, и в фокус ему не нужно.
export function SbQuickValue({
  onClick,
  title,
  ariaLabel,
  ariaPressed,
  className,
  children,
}: {
  onClick?: () => void;
  title?: string;
  ariaLabel: string;
  // Для значений-переключателей (вдохновение): скринридер должен называть не
  // только кнопку, но и её текущее состояние.
  ariaPressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = className ? `sb-value ${className}` : "sb-value";
  if (!onClick) {
    return (
      <div className={cls} title={title}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${cls} sb-value-button`}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Pencil-as-edit-toggle, used for every per-tab local edit affordance on
// this sheet — clicking it again (while editing) acts as "Сохранить" rather
// than requiring a separate button, since reaching for the same spot you
// just clicked to enter edit mode is the more intuitive place to leave it.
export function TabEditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="comp-mini dnd-tab-edit-toggle dnd-tab-btn"
      aria-pressed={editing}
      title={editing ? "Сохранить" : "Редактировать"}
      aria-label={editing ? "Сохранить" : "Редактировать"}
      onClick={onToggle}
    >
      <NavIcon name={editing ? "check" : "edit"} />
    </button>
  );
}

// Подписанный карандаш для шапок вкладок: иконка + текст («Свойства»,
// «умения»). Тот же размер, что веер.
export function LabeledEditButton({
  label,
  editing,
  onToggle,
}: {
  label: string;
  editing?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="dnd-chip dnd-edit-labeled"
      aria-pressed={!!editing}
      title={editing ? "Сохранить" : `Редактировать: ${label}`}
      onClick={onToggle}
    >
      <NavIcon name={editing ? "check" : "edit"} />
      {label}
    </button>
  );
}

// Ресурсы tab: one pip track per applicable class resource pool (see
// dndResources.ts for the PHB 2024 formulas). Max is always computed from
// classes/abilities + the small per-resource "доп. бонус" field (external
// sources — items, feats); only the bonus and used-count are ever stored.
/**
 * Реплики Артефактора: известные схемы и созданное по ним.
 *
 * Правило класса устроено в два шага, и блок повторяет их буквально. Сперва
 * выбираются **схемы** — что вообще умеешь делать; их число растёт по
 * таблице развития («Известные схемы»). Потом по схеме **создаётся
 * предмет**, и таких одновременно можно держать столько, сколько написано в
 * колонке «Магические предметы».
 *
 * Пределы показываются числом «N из M», но не запирают (решение R4): у
 * Мастера за столом бывает причина разрешить лишнее, а приложение, которое
 * молча отказывает, вынуждает вести учёт на бумаге рядом.
 *
 * Созданный предмет ложится и сюда счётчиком, и строкой в инвентарь — там
 * его ищут. Строка помнит свою реплику (`replicaId`), поэтому исчезает
 * вместе с ней.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
