// Ячейки заклинаний, вычисленные из таблиц развития классов, а не вбитые
// руками. Данные берутся из data.progression записи класса (см.
// progression.ts) — никаких зашитых в код таблиц, поэтому самодельный класс
// работает наравне с книжным.

import {
  pactSlotsAtLevel,
  spellSlotsAtLevel,
  type ClassProgression,
} from "./progression";

export type CasterKind = "none" | "third" | "half" | "full";

export interface ClassSlotSource {
  level: number;
  progression?: ClassProgression;
}

export interface ComputedSlots {
  /** Обычные ячейки 1–9 круга. */
  slots: number[];
  /** Договор магии Колдуна — отдельная дорожка, с обычными не складывается. */
  pact: { count: number; circle: number } | null;
  /** Чем посчитано: точной строкой одного класса или таблицей многоклассья. */
  basis: "single" | "multiclass" | "none";
}

export const EMPTY_SLOTS: ComputedSlots = { slots: Array(9).fill(0), pact: null, basis: "none" };

// Тип заклинателя выводим из самой таблицы: до какого круга класс доходит на
// 20-м уровне. Полный — до 9-го, половинчатый — до 5-го, третьеразрядный —
// до 4-го. Так не нужно нигде перечислять имена классов, и своя homebrew-
// таблица классифицируется сама.
export function casterKind(progression: ClassProgression | undefined): CasterKind {
  const top = spellSlotsAtLevel(progression, 20);
  if (!top) return "none";
  let maxCircle = 0;
  for (let i = 0; i < 9; i += 1) if (top[i] > 0) maxCircle = i + 1;
  if (maxCircle >= 6) return "full";
  if (maxCircle === 5) return "half";
  if (maxCircle > 0) return "third";
  return "none";
}

// Уровень заклинателя для многоклассья: полные классы идут целиком,
// половинчатые — половина, третьеразрядные — треть, всё с округлением вниз
// по каждому классу отдельно (правила 5.5). Договор магии Колдуна в этот
// счёт не входит вовсе.
export function effectiveCasterLevel(sources: ClassSlotSource[]): number {
  let total = 0;
  for (const s of sources) {
    switch (casterKind(s.progression)) {
      case "full":
        total += s.level;
        break;
      case "half":
        total += Math.floor(s.level / 2);
        break;
      case "third":
        total += Math.floor(s.level / 3);
        break;
      default:
        break;
    }
  }
  return total;
}

// Таблица многоклассья в 5.5 совпадает с таблицей полного заклинателя,
// поэтому отдельно её не храним: берём прогрессию любого полного
// заклинателя — сперва из классов самого персонажа, потом из компендиума.
function fullCasterTable(
  sources: ClassSlotSource[],
  fallbacks: (ClassProgression | undefined)[]
): ClassProgression | undefined {
  const own = sources.find((s) => casterKind(s.progression) === "full");
  if (own?.progression) return own.progression;
  return fallbacks.find((p) => casterKind(p) === "full");
}

// Договор магии живёт сам по себе: он и восстанавливается на коротком
// отдыхе, и в уровень заклинателя не входит, поэтому считается по своему
// классу и своему уровню, без всякого многоклассья.
function pactFrom(sources: ClassSlotSource[]): { count: number; circle: number } | null {
  for (const s of sources) {
    const pact = pactSlotsAtLevel(s.progression, s.level);
    if (pact) return pact;
  }
  return null;
}

export function computeSpellSlots(
  sources: ClassSlotSource[],
  fallbackProgressions: (ClassProgression | undefined)[] = []
): ComputedSlots {
  const casters = sources.filter((s) => s.level > 0 && casterKind(s.progression) !== "none");
  const pact = pactFrom(sources);

  if (casters.length === 0) {
    return pact ? { slots: Array(9).fill(0), pact, basis: "single" } : EMPTY_SLOTS;
  }
  // Один заклинательный класс — берём его собственную строку. Это точнее
  // любой общей формулы: у половинчатых классов своя таблица, а не «половина
  // от полной».
  if (casters.length === 1) {
    const slots = spellSlotsAtLevel(casters[0].progression, casters[0].level);
    return { slots: slots ?? Array(9).fill(0), pact, basis: "single" };
  }
  const level = effectiveCasterLevel(casters);
  const table = fullCasterTable(casters, fallbackProgressions);
  const slots = spellSlotsAtLevel(table, level);
  return { slots: slots ?? Array(9).fill(0), pact, basis: "multiclass" };
}

// Сколько кругов реально доступно — чтобы лист сам развернул нужное число
// секций вместо ручного «Кругов заклинаний».
export function highestCircle(slots: number[]): number {
  let top = 0;
  for (let i = 0; i < slots.length; i += 1) if (slots[i] > 0) top = i + 1;
  return top;
}
