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
      // Категория для монашеского оружия (см. isMonkWeapon в dndMonk.ts).
      weaponCategory: typeof entry.data.category === "string" && entry.data.category ? entry.data.category : undefined,
      // Снапшот магпредмета: редкость/настройка/проклятие/тип для тегов
      // строки и фильтров пикера. Ключ настройки — см.
      // entryRequiresAttunement (attunement у магпредметов,
      // requires_attunement у казначейских).
      rarity: typeof entry.data.rarity === "string" && entry.data.rarity ? entry.data.rarity : undefined,
      requiresAttunement: entryRequiresAttunement(entry.data as Record<string, unknown>) ? true : undefined,
      cursed: (entry.data as Record<string, unknown>).cursed ? true : undefined,
      itemType: typeof entry.data.item_type === "string" && entry.data.item_type ? entry.data.item_type : undefined,
    };
    // Снапшот зарядов магического предмета: шаблон (max/recharge) копируется
    // строкой, остаток стартует с максимума, если он — обычное число.
    // Максимум-кубик («1к8+1») числом не выразить — остаток остаётся
    // незаданным, игрок впишет его сам (степпер/форма ниже это умеют).
    const charges = entry.data.charges as { max?: unknown; recharge?: unknown } | undefined;
    if (charges && typeof charges.max === "string" && charges.max.trim()) {
      meta.chargesMax = charges.max.trim();
      meta.chargesRecharge = charges.recharge === "dawn" || charges.recharge === "none" ? charges.recharge : undefined;
      meta.chargesLeft = /^\d+$/.test(charges.max.trim()) ? Number(charges.max.trim()) : null;
    }
    equipmentMetaCache.set(entryId, meta);
    return meta;
  } catch {
    return { entryId };
  }
}

export const EMPTY_EQUIPMENT_ITEM: DndEquipmentItem = { name: "", qty: "", weight: "", notes: "" };

// Стабильный id строки инвентаря: crypto там, где есть, иначе
// счётчик+время — лишь бы не совпал внутри листа.
let equipmentIdSeq = 0;
export function makeEquipmentId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof (c as Crypto).randomUUID === "function") return (c as Crypto).randomUUID();
  } catch { /* ниже запасной путь */ }
  equipmentIdSeq += 1;
  return `eq-${Date.now().toString(36)}-${equipmentIdSeq.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/** Добить id строкам, пришедшим без него (старые листы): без этого ключи
 *  React снова свалятся на индекс. */
export function ensureEquipmentIds(items: DndEquipmentItem[]): DndEquipmentItem[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.id) return it;
    changed = true;
    return { ...it, id: makeEquipmentId() };
  });
  return changed ? next : items;
}

// Настройка в записях справочника: у магпредметов это `data.attunement`
// (чекбокс), у казначейских артефактов — `data.requires_attunement`.
// Проверяем оба, иначе фильтр «требует настройки» молча ничего не находит.
export function entryRequiresAttunement(data: Record<string, unknown> | undefined | null): boolean {
  if (!data) return false;
  if (data.attunement) return true;
  return data.requires_attunement === true || data.requires_attunement === 1;
}

/** Грузоподъёмность в фунтах: СИЛ × 15 × 2^(удвоения). */
export function carryCapacityLb(strScore: number, doublings: number): number {
  const str = Number.isFinite(strScore) && strScore > 0 ? strScore : 10;
  return str * 15 * 2 ** Math.max(0, doublings);
}

// Удвоения грузоподъёмности ищутся по именам умений — источника-структуры
// нет; найденное перечисляется в подсказке, а не молчится.
const CARRY_DOUBLE_RE = /мощное телосложение|powerful build|увеличени|enlarge|гигантск|мощь велика/i;

export function findCarryDoublings(features: { name: string }[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    const name = (f.name ?? "").trim();
    if (name && CARRY_DOUBLE_RE.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

// Расходник ли запись компендиума: вторую склянку берут как `qty+1` в ту же
// строку. Эвристика: категории + тип магпредмета + имя для боеприпасов.
export function isStackableEquipmentEntry(e: Pick<CompendiumEntry, "kind" | "name" | "data">): boolean {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const cat = typeof data.category === "string" ? data.category : "";
  if (cat === "Расходники" || cat === "Материалы") return true;
  const type = typeof data.type === "string" ? (data.type as string) : "";
  if (e.kind === "magic_item" && (type === "Зелья" || cat === "Зелья")) return true;
  return /стрел|болт|пул(я|и)|ядр(о|а)|порох|зелье|potion|свиток|scroll|па[её]к|факел|масло|противоядие/i.test(e.name);
}

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
