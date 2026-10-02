import type { SettingCycle, SettingCyclePoint } from "./types";

// Элементы цикла как отрезки (разбор 2026-10-02, Q3 Б, Q7): у элемента начало
// и необязательный конец; без конца — отметка одного дня; конец меньше
// начала — отрезок через конец оборота. Общее для панели под осью и карточки
// цикла.

export interface CycleSegment {
  /** Первый день — от начала летоисчисления. */
  start: number;
  /** Длина в днях, не меньше одного. */
  days: number;
  name: string;
  /** Номер элемента в цикле — чередование заливки. */
  index: number;
}

/** Длина элемента в днях. */
export function elementDays(point: Pick<SettingCyclePoint, "day_offset" | "day_end">, period: number): number {
  if (point.day_end == null) return 1;
  return ((((point.day_end - point.day_offset) % period) + period) % period) + 1;
}

/** Элементы цикла; без них цикл отмечает начало каждого оборота. */
export function cycleElements(cycle: SettingCycle): Pick<SettingCyclePoint, "name" | "day_offset" | "day_end">[] {
  return cycle.points.length > 0 ? cycle.points : [{ name: "оборот", day_offset: 0, day_end: null }];
}

/**
 * Отрезки цикла, задевающие окно [from, to]. «dense» — их столько, что
 * рисовать нечего: дорожка заштриховывается.
 */
export function cycleSegments(cycle: SettingCycle, anchor: number, from: number, to: number, maxSegments: number): CycleSegment[] | "dense" {
  const period = cycle.period_days;
  if (period < 1) return [];
  const elements = cycleElements(cycle);
  if (((to - from) / period + 2) * elements.length > maxSegments) return "dense";
  const out: CycleSegment[] = [];
  elements.forEach((el, index) => {
    const days = elementDays(el, period);
    // Первый оборот, чей отрезок может дотянуться до окна слева.
    const first = Math.floor((from - days - anchor - el.day_offset) / period);
    for (let k = first; ; k++) {
      const start = anchor + el.day_offset + k * period;
      if (start > to) break;
      if (start + days > from) out.push({ start, days, name: el.name, index });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/** Где цикл «сейчас»: день внутри оборота, с нуля. */
export function dayInTurn(day: number, anchor: number, period: number): number {
  return (((day - anchor) % period) + period) % period;
}
