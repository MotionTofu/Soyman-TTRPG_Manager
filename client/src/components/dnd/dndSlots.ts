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
  /** Прогрессия подкласса (Мистический рыцарь, Плут-Мистический трюкач):
   *  даёт ячейки, заговоры и подготовленные, когда у самого класса слотовых
   *  колонок нет. Уровень — уровень базового класса, строки таблицы
   *  подкласса размечены им же. */
  subProgression?: ClassProgression;
  /** Половинчатый заклинатель с округлением вверх (Артефактор: собственный
   *  подсчёт мультикласса — уровень/2 вверх, а не вниз как у остальных).
   *  Маркер — поле round_up_multiclass у записи класса, имён в коде нет. */
  roundUp?: boolean;
}

/** Маркер округления вверх из данных записи класса. */
export function isRoundUpCaster(classData: Record<string, unknown> | undefined): boolean {
  return classData?.round_up_multiclass === true;
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

// Тип заклинателя строки классов с учётом подкласса: у Воина слотовых
// колонок нет, и без подклассовой прогрессии Мистический рыцарь навсегда
// остался бы не-заклинателем. Классовая таблица главнее: если ячейки есть
// у обеих (homebrew), считаем по классу.
export function sourceCasterKind(source: ClassSlotSource): CasterKind {
  const own = casterKind(source.progression);
  return own !== "none" ? own : casterKind(source.subProgression);
}

// Ячейки строки: классовые, а когда их нет — подклассовые. null, если ячеек
// нет ни там, ни там.
export function sourceSpellSlots(source: ClassSlotSource): number[] | null {
  return (
    spellSlotsAtLevel(source.progression, source.level) ??
    spellSlotsAtLevel(source.subProgression, source.level)
  );
}

// Уровень заклинателя для многоклассья: полные классы идут целиком,
// половинчатые — половина, третьеразрядные — треть, всё с округлением вниз
// по каждому классу отдельно (правила 5.5). Исключение — Артефактор: его
// собственный подсчёт округляет половину вверх (roundUp с записи класса).
// Договор магии Колдуна в этот счёт не входит вовсе.
export function effectiveCasterLevel(sources: ClassSlotSource[]): number {
  let total = 0;
  for (const s of sources) {
    switch (sourceCasterKind(s)) {
      case "full":
        total += s.level;
        break;
      case "half":
        total += s.roundUp ? Math.ceil(s.level / 2) : Math.floor(s.level / 2);
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
  const own = sources.find((s) => sourceCasterKind(s) === "full");
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
  const casters = sources.filter((s) => s.level > 0 && sourceCasterKind(s) !== "none");
  const pact = pactFrom(sources);

  if (casters.length === 0) {
    return pact ? { slots: Array(9).fill(0), pact, basis: "single" } : EMPTY_SLOTS;
  }
  // Один заклинательный класс — берём его собственную строку. Это точнее
  // любой общей формулы: у половинчатых классов своя таблица, а не «половина
  // от полной». Подклассовая строка (Мистический рыцарь) подхватывается
  // внутри sourceSpellSlots, когда у класса своих ячеек нет.
  if (casters.length === 1) {
    const slots = sourceSpellSlots(casters[0]);
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

// Таинственный арканум колдуна (тикет 03 warlock): какой круг открывается
// на каком уровне КОЛДУНА (не суммарном — у мультикласса свой счёт).
// Пустых кругов арканум не даёт: пипсы выводятся из самих пиков строк.
export const ARCANUM_UNLOCKS: { circle: number; warlockLevel: number }[] = [
  { circle: 6, warlockLevel: 11 },
  { circle: 7, warlockLevel: 13 },
  { circle: 8, warlockLevel: 15 },
  { circle: 9, warlockLevel: 17 },
];

export function arcanumUnlockedCircles(warlockLevel: number): number[] {
  return ARCANUM_UNLOCKS.filter((a) => warlockLevel >= a.warlockLevel).map((a) => a.circle);
}

// Пипсы кругов с арканумом (тикет 03): сколько использований показывает
// круг — число строк арканума в нём (обычно 1, в круге не больше одного).
// isArcanum — предикат строки (у листа это s.arcanum), чтобы не тащить тип.
export function arcanumCountByCircle(
  spellsByLevel: { arcanum?: boolean }[][],
): number[] {
  return Array.from({ length: 9 }, (_, i) =>
    i < 5 ? 0 : spellsByLevel[i].filter((s) => s?.arcanum === true).length
  );
}

// Старший круг с пиками арканума — секции ниже не разворачиваем.
export function arcanumTopCircle(spellsByLevel: { arcanum?: boolean }[][]): number {
  return arcanumCountByCircle(spellsByLevel).reduce((top, n, i) => (n > 0 ? i + 1 : top), 0);
}
