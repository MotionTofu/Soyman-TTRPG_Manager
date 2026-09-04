import { api } from "../../api/client";
import type { CompendiumEntry, DndEquipmentItem } from "../../types";

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
    const weaponProperties = Array.isArray(entry.data.weapon_properties)
      ? (entry.data.weapon_properties as { name: string }[]).map((p) => p.name).join(", ")
      : undefined;
    const weaponMastery =
      entry.data.weapon_mastery && typeof entry.data.weapon_mastery === "object"
        ? (entry.data.weapon_mastery as { name?: string }).name
        : undefined;
    const meta: Partial<DndEquipmentItem> = {
      entryId,
      armorType: typeof entry.data.armor_type === "string" ? entry.data.armor_type : undefined,
      ac: typeof entry.data.ac === "string" ? entry.data.ac : undefined,
      maxDexBonus: typeof entry.data.max_dex_bonus === "string" ? entry.data.max_dex_bonus : undefined,
      dexBonus: typeof entry.data.dex_bonus === "boolean" ? entry.data.dex_bonus : undefined,
      acBonus: typeof entry.data.ac_bonus === "string" ? entry.data.ac_bonus : undefined,
      weaponDamage: typeof entry.data.damage === "string" && entry.data.damage ? entry.data.damage : undefined,
      weaponAttackMelee: !!entry.data.attack_melee,
      weaponAttackRanged: !!entry.data.attack_ranged,
      weaponProperties: weaponProperties || undefined,
      weaponMastery: weaponMastery || undefined,
    };
    equipmentMetaCache.set(entryId, meta);
    return meta;
  } catch {
    return { entryId };
  }
}

export const EMPTY_EQUIPMENT_ITEM: DndEquipmentItem = { name: "", qty: "", weight: "", notes: "" };
