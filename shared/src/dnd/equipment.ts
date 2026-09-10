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
