import { api } from "../../api/client";
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
}

export function startingSetsFrom(entry: CompendiumEntry | undefined, ownerLabel: string): StartingSet[] {
  if (!entry) return [];
  const sets: StartingSet[] = [];
  for (const slot of ["a", "b"] as const) {
    const items = (entry.data[`equipment_${slot}_items`] as StartingSet["items"] | undefined) ?? [];
    const manual = (entry.data[`equipment_${slot}_manual`] as string[] | undefined) ?? [];
    const gold = (entry.data[`equipment_${slot}_gold`] as string | undefined) ?? "";
    if (items.length === 0 && manual.length === 0 && !gold) continue;
    sets.push({ label: `${ownerLabel} — набор ${slot.toUpperCase()}`, gold, items, manual });
  }
  return sets;
}

// Snapshots an equipment/magic_item compendium entry's armor/АС fields at
// add time — computeArmorClass() then reads these cached fields without a
// live lookup. Заклинания от снапшота отказались (см. resolveSpell), но у
// снаряжения он пока остаётся: КЗ считается вне рендера, где кэша нет.
const equipmentMetaCache = new Map<number, Partial<DndEquipmentItem>>();
export function clearEquipmentMetaCache(entryId?: number): void {
  if (entryId != null) equipmentMetaCache.delete(entryId);
  else equipmentMetaCache.clear();
}
export async function fetchEquipmentMeta(entryId: number): Promise<Partial<DndEquipmentItem>> {
  if (equipmentMetaCache.has(entryId)) return equipmentMetaCache.get(entryId)!;
  try {
    const entry = await api.get<CompendiumEntry>(`/systems/entries/${entryId}`);
    // Какие поля снимаются — решает общий пакет: тем же снимком импорт из
    // Long Story Short связывает инвентарь на сервере.
    const meta = equipmentMetaFromEntry(entryId, entry);
    equipmentMetaCache.set(entryId, meta);
    return meta;
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
