/**
 * Снаряжение — чистая часть: пустая строка инвентаря, стабильные id и
 * грузоподъёмность. Вынесена из `client/src/components/dnd/dndEquipment.ts`,
 * где живёт рядом с сетевым `fetchEquipmentMeta`; нормализация листа
 * пользуется `ensureEquipmentIds`, а она теперь общая с сервером.
 */
import type { DndEquipmentItem } from "./types";

export const EMPTY_EQUIPMENT_ITEM: DndEquipmentItem = { name: "", qty: "", weight: "", notes: "" };

// Стабильный id строки инвентаря: crypto там, где есть, иначе
// счётчик+время — лишь бы не совпал внутри листа.
let equipmentIdSeq = 0;
export function makeEquipmentId(): string {
  try {
    // Пакет общий с сервером и потому собирается без DOM-типов: `crypto`
    // ищется структурно, а не через тип `Crypto`. В браузере и в node 19+
    // это одно и то же `globalThis.crypto`.
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof c?.randomUUID === "function") return c.randomUUID();
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

/** Грузоподъёмность в фунтах: СИЛ × 15 × 2^(удвоения). */
export function carryCapacityLb(strScore: number, doublings: number): number {
  const str = Number.isFinite(strScore) && strScore > 0 ? strScore : 10;
  return str * 15 * 2 ** Math.max(0, doublings);
}


/**
 * Умения, удваивающие грузоподъёмность («Мощное телосложение», увеличение
 * размера). Структурного источника у них нет — в листе это просто строки
 * названий, поэтому поиск идёт регулярным выражением по имени.
 *
 * Живёт здесь, а не рядом с сетевым кодом чарника, потому что от этого
 * зависит `carryCapacity` в `deriveSheet`: пока функция лежала в клиенте,
 * модуль считал грузоподъёмность без удвоений и врал вдвое у любого, у кого
 * есть «Мощное телосложение».
 */
const CARRY_DOUBLE_RE = /мощное телосложение|powerful build|увеличени|enlarge|гигантск|мощь велика/i;

export function findCarryDoublings(features: { name?: string }[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    const name = (f?.name ?? "").trim();
    if (name && CARRY_DOUBLE_RE.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Количество из названия строки инвентаря: «Болты (15)» → «Болты», 15;
 * «8x листы Пергамента» → «листы Пергамента», 8. Так пишут чужие листы
 * (Long Story Short), и связь со справочником ищется уже по чистому имени.
 */
export function splitEquipmentQty(rawName: string): { name: string; qty: string } {
  const mQty = /^(\d+)\s*[x×]\s*(.+)$/i.exec(rawName.trim());
  if (mQty) return { name: mQty[2].trim(), qty: mQty[1] };
  const mParen = /^(.*)\(\s*(\d+)\s*\)\s*$/.exec(rawName.trim());
  if (mParen && mParen[1].trim()) return { name: mParen[1].trim(), qty: mParen[2] };
  return { name: rawName, qty: "" };
}

/** Запись справочника в той мере, в какой её читает снимок предмета. */
export interface EquipmentEntryLike {
  kind: string;
  name: string;
  data?: Record<string, unknown> | null;
}

// Настройка в записях справочника: у магпредметов это `data.attunement`
// (чекбокс), у казначейских артефактов — `data.requires_attunement`.
// Проверяем оба, иначе фильтр «требует настройки» молча ничего не находит.
export function entryRequiresAttunement(data: Record<string, unknown> | undefined | null): boolean {
  if (!data) return false;
  if (data.attunement) return true;
  return data.requires_attunement === true || data.requires_attunement === 1;
}

// Расходник ли запись компендиума: вторую склянку берут как `qty+1` в ту же
// строку. Эвристика: категории + тип магпредмета + имя для боеприпасов.
export function isStackableEquipmentEntry(e: EquipmentEntryLike): boolean {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const cat = typeof data.category === "string" ? data.category : "";
  if (cat === "Расходники" || cat === "Материалы") return true;
  const type = typeof data.type === "string" ? (data.type as string) : "";
  if (e.kind === "magic_item" && (type === "Зелья" || cat === "Зелья")) return true;
  return /стрел|болт|пул(я|и)|ядр(о|а)|порох|зелье|potion|свиток|scroll|па[её]к|факел|масло|противоядие/i.test(e.name);
}

/**
 * Снимок полей записи справочника в строку инвентаря: доспех и КЗ, оружие,
 * вес и цена, магия и заряды. `computeArmorClass` и `deriveSheet` читают эти
 * поля без похода в справочник.
 *
 * Живёт в общем пакете, потому что снимает его не только пикер инвентаря
 * на клиенте, но и импорт из Long Story Short на сервере: две копии списка
 * полей разошлись бы на первом новом поле.
 */
export function equipmentMetaFromEntry(entryId: number, entry: EquipmentEntryLike): Partial<DndEquipmentItem> {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const weaponProperties = Array.isArray(data.weapon_properties)
    ? (data.weapon_properties as { name: string }[]).map((p) => p.name).join(", ")
    : undefined;
  const weaponMastery =
    data.weapon_mastery && typeof data.weapon_mastery === "object"
      ? (data.weapon_mastery as { name?: string }).name
      : undefined;
  const meta: Partial<DndEquipmentItem> = {
    entryId,
    armorType: str(data.armor_type),
    ac: str(data.ac),
    maxDexBonus: str(data.max_dex_bonus),
    dexBonus: typeof data.dex_bonus === "boolean" ? data.dex_bonus : undefined,
    acBonus: str(data.ac_bonus),
    weaponDamage: typeof data.damage === "string" && data.damage ? data.damage : undefined,
    weaponAttackMelee: !!data.attack_melee,
    weaponAttackRanged: !!data.attack_ranged,
    weaponProperties: weaponProperties || undefined,
    weaponMastery: weaponMastery || undefined,
    // Категория для монашеского оружия (см. isMonkWeapon в dndMonk.ts).
    weaponCategory: typeof data.category === "string" && data.category ? data.category : undefined,
    // Расходник ли запись — тем же эвристическим правилом, что пикер:
    // пути без полной записи (мешок, дроп) иначе сливать не умеют.
    stackable: isStackableEquipmentEntry(entry) ? true : undefined,
    // Вес и цена строкой из справочника — снимок на момент добавления.
    // Вес сразу участвует в сводке (parseWeight понимает единицы),
    // цена пока только показывается в строке. Пути добавления спредят
    // мету поверх пустых значений, так что лежит само везде.
    weight: nonEmpty(data.weight),
    cost: nonEmpty(data.cost),
    // Снапшот магпредмета: редкость/настройка/проклятие/тип для тегов
    // строки и фильтров пикера. Ключ настройки — см. entryRequiresAttunement
    // (attunement у магпредметов, requires_attunement у казначейских).
    rarity: typeof data.rarity === "string" && data.rarity ? data.rarity : undefined,
    requiresAttunement: entryRequiresAttunement(data) ? true : undefined,
    cursed: data.cursed ? true : undefined,
    itemType: typeof data.item_type === "string" && data.item_type ? data.item_type : undefined,
  };
  // Снапшот зарядов магического предмета: шаблон (max/recharge) копируется
  // строкой, остаток стартует с максимума, если он — обычное число.
  // Максимум-кубик («1к8+1») числом не выразить — остаток остаётся
  // незаданным, игрок впишет его сам (степпер/форма листа это умеют).
  const charges = data.charges as { max?: unknown; recharge?: unknown } | undefined;
  if (charges && typeof charges.max === "string" && charges.max.trim()) {
    meta.chargesMax = charges.max.trim();
    meta.chargesRecharge = charges.recharge === "dawn" || charges.recharge === "none" ? charges.recharge : undefined;
    meta.chargesLeft = /^\d+$/.test(charges.max.trim()) ? Number(charges.max.trim()) : null;
  }
  return meta;
}
