import { readEntity } from "../../data/imperative";
import type { CompendiumEntry, DndEquipmentItem } from "../../types";
import { equipmentMetaFromEntry } from "@shared/dnd/equipment";

/**
 * Снаряжение: снимок полей предмета из справочника и стартовые наборы.
 *
 * Вынесено из формы листа не ради порядка, а потому что этим пользуется
 * визард создания персонажа: держать общее в файле на пять тысяч строк
 * значит тянуть за собой весь лист ради одной функции.
 */

export interface StartingSet {
  label: string;
  gold: string;
  items: { entryId: number; name: string; qty: number }[];
  /** Позиции, которые ссылкой не выражаются: «инструменты ремесленника,
   *  владение которыми вы выбрали ранее». Кладутся в инвентарь строкой без
   *  ссылки — выбрать за игрока приложение не вправе, а потерять из набора
   *  тем более. */
  manual: string[];
  /** Выбор внутри набора («музыкальный инструмент по вашему выбору») —
   *  из предметов с `tool_kind` из `group` («А|Б» — из двух видов).
   *  `fromProficiency` — «тот, владение которым вы выбрали». */
  choices: StartingSetChoice[];
  letter: string;
}

export interface StartingSetChoice {
  count: number;
  group: string;
  fromProficiency: boolean;
}

function parseSetChoices(raw: unknown): StartingSetChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    const count = typeof r.count === "number" && r.count > 0 ? r.count : 1;
    return typeof r.group === "string" && r.group.trim()
      ? [{ count, group: r.group.trim(), fromProficiency: r.fromProficiency === true }]
      : [];
  });
}

export function startingSetsFrom(entry: CompendiumEntry | undefined, ownerLabel: string): StartingSet[] {
  if (!entry) return [];
  const sets: StartingSet[] = [];
  // «C» — у Воина 2024 три варианта: два набора и 155 ЗМ.
  for (const slot of ["a", "b", "c"] as const) {
    const items = (entry.data[`equipment_${slot}_items`] as StartingSet["items"] | undefined) ?? [];
    const manual = (entry.data[`equipment_${slot}_manual`] as string[] | undefined) ?? [];
    const gold = (entry.data[`equipment_${slot}_gold`] as string | undefined) ?? "";
    const choices = parseSetChoices(entry.data[`equipment_${slot}_choices`]);
    if (items.length === 0 && manual.length === 0 && choices.length === 0 && !gold) continue;
    const letter = slot.toUpperCase();
    sets.push({ label: `${ownerLabel} — набор ${letter}`, gold, items, manual, choices, letter });
  }
  return sets;
}

// Snapshots an equipment/magic_item compendium entry's armor/АС fields at
// add time — computeArmorClass() then reads these cached fields without a
// live lookup. Заклинания от снапшота отказались (см. resolveSpell), но у
// снаряжения он пока остаётся: КЗ считается вне рендера, где кэша нет.
//
// Запись берётся из слоя данных — под тем же ключом, что и живые записи листа
// (entryCache.ts): свой кэш снимков сбрасывала только правка в разделе
// компендиума этого окна, а правка из соседнего окна оставляла старый снимок.
export async function fetchEquipmentMeta(entryId: number): Promise<Partial<DndEquipmentItem>> {
  try {
    const entry = await readEntity<CompendiumEntry>("compendium_entry", entryId);
    // Какие поля снимаются — решает общий пакет: тем же снимком импорт из
    // Long Story Short связывает инвентарь на сервере.
    return equipmentMetaFromEntry(entryId, entry);
  } catch {
    return { entryId };
  }
}

// Чистая часть переехала в общий пакет: ею пользуются нормализация листа и
// импорт из Long Story Short на сервере.
export {
  EMPTY_EQUIPMENT_ITEM,
  makeEquipmentId,
  ensureEquipmentIds,
  carryCapacityLb,
  findCarryDoublings,
  entryRequiresAttunement,
  isStackableEquipmentEntry,
  splitEquipmentQty,
} from "@shared/dnd/equipment";

// Рацион ли строка: совпадает со справочным «Рацион» и с ручными
// («Рацион ×5», «паёк»). Нужно отдыху и чипу «мало».
const RATION_RE = /рацион|па[её]к|ration/i;

export function isRationRow(item: Pick<DndEquipmentItem, "name">): boolean {
  return RATION_RE.test(item.name ?? "");
}

// Имена владений для проверки доспехов: надетое без владения в 5.5 бьёт по
// заклинаниям — строка помечается.
export function armorProfNames(profs: { name: string }[]): string[] {
  return profs.map((p) => (p.name ?? "").trim()).filter(Boolean);
}

/** Владение надето: щит/лёгкий/средний/тяжёлый по именам владений. */
export function isArmorProficient(armorType: string | undefined, profNames: readonly string[]): boolean {
  if (!armorType) return true;
  const t = armorType.trim().toLowerCase();
  const want = t.startsWith("щит") ? /щит|shield/i
    : t.startsWith("легк") || t.startsWith("лёгк") ? /л[её]гк|light/i
    : t.startsWith("средн") ? /средн|medium/i
    : t.startsWith("тяж") ? /тяж|heavy/i
    : null;
  if (!want) return true;
  return profNames.some((n) => want.test(n));
}

/** Владение оружием по строкам класса: «Простое оружие», «Воинское оружие
 *  (лёгкое)», «…(фехтовальное или лёгкое)» или имя самого оружия. */
export function isWeaponProficient(
  item: Pick<DndEquipmentItem, "name" | "weaponCategory" | "weaponProperties">,
  profNames: readonly string[]
): boolean {
  const cat = (item.weaponCategory ?? "").trim().toLowerCase();
  const props = (item.weaponProperties ?? "").toLowerCase().replace(/ё/g, "е");
  const name = item.name.trim().toLowerCase().replace(/ё/g, "е");
  return profNames.some((raw) => {
    const n = raw.trim().toLowerCase().replace(/ё/g, "е");
    if (n === name) return true;
    const m = /^(.*?оружие)\s*(?:\((.*)\))?$/.exec(n);
    if (!m || !cat || m[1] !== cat) return false;
    // Скобки — условие по свойствам: хватает любого из перечисленных.
    return !m[2] || m[2].split(/\s+или\s+|,\s*/).some((w) => props.includes(w.slice(0, 5)));
  });
}
