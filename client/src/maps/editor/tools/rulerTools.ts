import { cellDistance } from "../../grid";
import type { MapGrid } from "../../mapTypes";
import type { Dispatch, SetStateAction } from "react";

// Линейка (Фаза 1, Tool Controller): тапы начала/конца + живой конец за
// курсором. Состояние ruler живёт снаружи (рендер его тоже рисует) и приходит
// значением + сеттером; обработка — здесь.

export interface RulerState {
  a: { x: number; y: number };
  b: { x: number; y: number } | null;
  locked: boolean;
}

// Замер линейки (P1-2): на квадратах — евклид по прямой (Чебышев врал по диагонали:
// 5 клеток по диагонали — не 5, а ~7.1), на гексах — шаги cellDistance.
export function rulerMeasure(
  grid: MapGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cells: string; dist: number } {
  if (grid === "square") {
    const d = Math.hypot(bx - ax, by - ay);
    return { cells: (Math.round(d * 10) / 10).toString().replace(".", ","), dist: d };
  }
  const steps = cellDistance(grid, ax, ay, bx, by);
  return { cells: String(steps), dist: steps };
}

interface CreateRulerToolsArgs {
  ruler: RulerState | null;
  setRuler: Dispatch<SetStateAction<RulerState | null>>;
}

export function createRulerTools(a: CreateRulerToolsArgs) {
  // Первый клик — начало, второй — конец (замер остаётся, пока выбран
  // инструмент); клик по готовому — новый замер. Тач — те же тапы.
  function tap(cell: { x: number; y: number }) {
    a.setRuler((r) =>
      !r || r.locked ? { a: cell, b: null, locked: false } : { a: r.a, b: r.b ?? r.a, locked: true }
    );
  }

  // Живой конец замера следует за курсором, пока второй клик не зафиксировал.
  function hover(cell: { x: number; y: number } | null) {
    const cur = a.ruler;
    const nb = cell ?? null;
    if ((nb?.x ?? -1) !== (cur?.b?.x ?? -1) || (nb?.y ?? -1) !== (cur?.b?.y ?? -1)) {
      if (cur) a.setRuler({ a: cur.a, b: nb, locked: false });
    }
  }

  return { tap, hover };
}

export type RulerTools = ReturnType<typeof createRulerTools>;
