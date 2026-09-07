import type { DndEquipmentItem, DndEquipmentSection, DndFeature } from "../../types";
import { equippedItems, wornArmorState } from "./armorClass";
import { statsAtLevel } from "./progression";
import type { ClassResourceSource } from "./dndResources";

// Боевые искусства и движение без доспехов Монаха — чистые функции поверх
// данных листа и таблиц развития. Отдельным модулем, а не в dndResources:
// там пулы и показатели для вкладки «Ресурсы», а здесь то, что уходит в
// кость скорости и таблицу атак.

// ——— кости ———

/** "1к8" → 8. Не-куб → 0 (сравнение «больше» тогда честно проигрывает). */
export function dieSize(die: string): number {
  const m = /к\s*(\d+)/i.exec(die ?? "");
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Текущая кость боевых искусств — max по источникам (мультикласс). */
export function martialArtsDie(sources: ClassResourceSource[]): string | null {
  let best: string | null = null;
  for (const { entry, progression } of sources) {
    if (!progression || entry.level <= 0) continue;
    for (const col of statsAtLevel(progression, entry.level)) {
      if (col.label.trim() !== "Кость боевых искусств") continue;
      if (dieSize(col.value) > dieSize(best ?? "")) best = col.value;
    }
  }
  return best;
}

// ——— движение без доспехов ———

/** Прибавка к ходьбе из колонки «Движение без доспехов» — max по источникам.
 *  Гейт тот же, что у защиты: без доспеха и щита. */
export function unarmoredMovementBonus(
  sources: ClassResourceSource[],
  sections: DndEquipmentSection[]
): { bonus: number; source: string | null } {
  const none = { bonus: 0, source: null as string | null };
  const { hasArmor, hasShield } = wornArmorState(sections);
  if (hasArmor || hasShield) return none;
  let bonus = 0;
  for (const { entry, progression } of sources) {
    if (!progression || entry.level <= 0) continue;
    for (const col of statsAtLevel(progression, entry.level)) {
      if (col.label.trim() !== "Движение без доспехов") continue;
      const n = parseInt((col.value ?? "").replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(n) && n > bonus) bonus = n;
    }
  }
  return bonus > 0 ? { bonus, source: "без доспехов" } : none;
}

// ——— монашеское оружие ———

export interface MonkWeaponInfo {
  category?: string;
  properties?: string;
  attackMelee?: boolean;
}

/**
 * Монашеское оружие (PHB 2024, «Боевые искусства»): простое рукопашное или
 * воинское рукопашное с «лёгким» свойством. Категория идёт снимком инвентаря
 * (weaponCategory) либо живым резолвом; когда её нет вовсе (ручная строка без
 * ссылки) — эвристика: ближнее и не «тяжёлое». Двуручное само по себе не
 * запрет: простое двуручное (Палица) по букве правила подходит.
 */
export function isMonkWeapon(info: MonkWeaponInfo): boolean {
  if (!info.attackMelee) return false;
  const props = (info.properties ?? "").toLowerCase();
  if (props.includes("лёгк")) return true;
  const category = (info.category ?? "").trim().toLowerCase();
  if (category) return category.startsWith("прост");
  return !props.includes("тяж");
}

// ——— состояние боевых искусств целиком ———

export interface MartialState {
  active: boolean;
  /** Кость ("1к8") — только когда active. */
  die: string | null;
}

/**
 * Боевые искусства активны, когда умение «Боевые искусства» на листе, доспеха
 * и щита нет, и всё надетое оружие с уроном — монашеское («используете только
 * монашеское оружие»). Не-монашеское оружие в руках гасит умение целиком —
 * включая безоружные удары — так написано в умении.
 */
export function resolveMartialArts(
  features: DndFeature[],
  sections: DndEquipmentSection[],
  sources: ClassResourceSource[],
  getCategory: (entryId: number | null | undefined) => string | undefined
): MartialState {
  const off: MartialState = { active: false, die: null };
  const hasArts = (features ?? []).some((f) => (f.name ?? "").trim() === "Боевые искусства");
  if (!hasArts) return off;
  const { hasArmor, hasShield } = wornArmorState(sections);
  if (hasArmor || hasShield) return off;
  for (const item of equippedItems(sections)) {
    if (!item.weaponDamage) continue;
    if (!isItemMonkWeapon(item, getCategory)) {
      return off;
    }
  }
  const die = martialArtsDie(sources);
  return die ? { active: true, die } : off;
}

// Снимок знает ближний/дальний бой флагами; у ручной строки флагов может не
// быть — тогда считаем ближним (монах бьёт руками и простым оружием; чисто
// дальнобойное без флага — край, документирован в тикете).
export function detectMelee(item: DndEquipmentItem): boolean {
  if (item.weaponAttackMelee != null || item.weaponAttackRanged != null) {
    return !!item.weaponAttackMelee;
  }
  return true;
}

/** Классификация одной строки инвентаря: снимок → живой резолв → эвристика. */
export function isItemMonkWeapon(
  item: DndEquipmentItem,
  getCategory: (entryId: number | null | undefined) => string | undefined
): boolean {
  return isMonkWeapon({
    category: item.weaponCategory ?? getCategory(item.entryId),
    properties: item.weaponProperties,
    attackMelee: detectMelee(item),
  });
}

// ——— замена куба в строке урона ———

/**
 * Меняет куб в строке вида "1к6 колющий" на больший. Возвращает новую строку
 * или null, когда менять нечего (куб уже не меньше или строка не разобралась).
 * Тип урона и хвост сохраняются.
 */
export function upgradeDamageDie(damage: string, die: string): string | null {
  const m = /^\s*(\d+\s*к\s*\d+)\s*(.*)$/i.exec(damage ?? "");
  if (!m) return null;
  if (dieSize(m[1]) >= dieSize(die)) return null;
  const rest = m[2].trim();
  return rest ? `${die} ${rest}` : die;
}
