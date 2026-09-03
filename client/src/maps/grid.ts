// Чистая геометрия сеток: без React и DOM, только математика.
// Квадраты — обычная решётка. Гексы — pointy-top, колонны, раскладка
// odd-q (колонка x, строка y): центр гекса (x,y) в мировых единицах —
// (sqrt(3)·(x + 0.5·(y&1)), 1.5·y). Мировая единица = шаг клетки.
//
// Координаты для мастера — offset `A1…`: буква(ы) колонки + номер строки.

import type { MapGrid } from "./mapTypes";

export interface CellPos {
  x: number;
  y: number;
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): CellPos | null {
  const m = /^(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

// A1…: колонки буквами (A..Z, AA..), строки с 1.
export function coordLabel(x: number, y: number): string {
  let col = "";
  let n = x;
  do {
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${col}${y + 1}`;
}

// Центр клетки в мировых единицах.
export function cellCenter(grid: MapGrid, x: number, y: number): { cx: number; cy: number } {
  if (grid === "square") return { cx: x + 0.5, cy: y + 0.5 };
  const SQRT3 = Math.sqrt(3);
  return { cx: SQRT3 * (x + 0.5 * (y & 1)), cy: 1.5 * y };
}

// Вершины многоугольника клетки вокруг центра (для обводки/заливки).
export function cellCorners(grid: MapGrid, x: number, y: number): { px: number; py: number }[] {
  if (grid === "square") {
    return [
      { px: x, py: y },
      { px: x + 1, py: y },
      { px: x + 1, py: y + 1 },
      { px: x, py: y + 1 },
    ];
  }
  const { cx, cy } = cellCenter(grid, x, y);
  const pts: { px: number; py: number }[] = [];
  // pointy-top: вершины под углами -90, -30, 30, 90, 150, 210.
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    pts.push({ px: cx + Math.cos(a), py: cy + Math.sin(a) });
  }
  return pts;
}

// Мировые → клетка (с учётом границ поля, иначе null).
export function pixelToCell(
  grid: MapGrid,
  wx: number,
  wy: number,
  width: number,
  height: number
): CellPos | null {
  if (grid === "square") {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    return inBounds(x, y, width, height) ? { x, y } : null;
  }
  // pointy-top odd-q: ближайший центр среди кандидатов вокруг приближения.
  // Точка в стыке трёх гексов принадлежит ближайшему центру — швы рисуются
  // по границам, промах на полпикселя не виден.
  const SQRT3 = Math.sqrt(3);
  const approxR = Math.round(wy / 1.5);
  let best: CellPos | null = null;
  let bestDist = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    const r = approxR + dr;
    // odd-q: нечётные строки сдвинуты на полшага (чётность — по модулю,
    // чтобы отрицательные строки тоже считались правильно)
    const odd = ((r % 2) + 2) % 2 === 1;
    const qBase = wx / SQRT3 - (odd ? 0.5 : 0);
    for (let dq = -1; dq <= 1; dq++) {
      const q = Math.round(qBase) + dq;
      const { cx, cy } = cellCenter(grid, q, r);
      const d = (cx - wx) ** 2 + (cy - wy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = { x: q, y: r };
      }
    }
  }
  if (!best || !inBounds(best.x, best.y, width, height)) return null;
  return best;
}

// Границы мира (для автомасштаба камеры).
export function worldBounds(grid: MapGrid, width: number, height: number): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (grid === "square") return { minX: 0, minY: 0, maxX: width, maxY: height };
  const SQRT3 = Math.sqrt(3);
  return {
    minX: -1,
    minY: -1,
    maxX: SQRT3 * (width - 1 + 0.5) + 1,
    maxY: 1.5 * (height - 1) + 1,
  };
}
// Соседи клетки (для линий дорог и заливки).
export function neighbors(grid: MapGrid, x: number, y: number): CellPos[] {
  if (grid === "square") {
    return [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
  }
  const odd = (y & 1) === 1;
  const deltas = odd
    ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
    : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  return deltas.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
}

// Расстояние для кисти: Чебышев на квадратах, hex-distance на гексах.
// Экспортирована как cellDistance — та же метрика считает шаги линейки (P2-1).
export function cellDistance(grid: MapGrid, x0: number, y0: number, x1: number, y1: number): number {
  return brushDistance(grid, x0, y0, x1, y1);
}

// Расстояние для кисти: Чебышев на квадратах, hex-distance на гексах.
function brushDistance(grid: MapGrid, x0: number, y0: number, x1: number, y1: number): number {
  if (grid === "square") return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  // odd-q → axial → cube distance
  const toCube = (x: number, y: number) => {
    const q = x - ((y - (y & 1)) >> 1);
    const r = y;
    return { cx: q, cz: r, cy: -q - r };
  };
  const a = toCube(x0, y0);
  const b = toCube(x1, y1);
  return (Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy) + Math.abs(a.cz - b.cz)) / 2;
}

// Клетки кисти размера 1/2/3 вокруг центра (1 — одна клетка).
export function brushCells(
  grid: MapGrid,
  cx: number,
  cy: number,
  size: 1 | 2 | 3,
  width: number,
  height: number
): CellPos[] {
  const range = size; // запас охвата, фильтр — по дистанции ниже
  const out: CellPos[] = [];
  for (let y = cy - range; y <= cy + range; y++) {
    for (let x = cx - range; x <= cx + range; x++) {
      if (!inBounds(x, y, width, height)) continue;
      if (brushDistance(grid, cx, cy, x, y) < size) out.push({ x, y });
    }
  }
  return out;
}
