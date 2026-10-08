/** Нарезка листа ассетов (гриллинг 2026-10-09, Н1–Н12): лист делится направляющими на куски,
 * кусок обрезается по содержимому, фон убирается только снаружи рисунка. Всё в точках листа. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pixels { data: Uint8ClampedArray; width: number; height: number }
/** Цвет фона; `null` — фон уже прозрачный. */
export type Background = readonly [number, number, number] | null;

const CLEAR = 16;
/** Фон листа — средний цвет непрозрачных углов. */
export function sheetBackground({ data, width, height }: Pixels): Background {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((at) => at * 4).filter((i) => data[i + 3] >= CLEAR);
  if (corners.length < 4) return null;
  return [0, 1, 2].map((channel) => Math.round(corners.reduce((sum, i) => sum + data[i + channel], 0) / corners.length)) as unknown as Background;
}
const isBackground = (data: Uint8ClampedArray, i: number, background: Background, tolerance: number) => data[i + 3] < CLEAR || background !== null
  && Math.abs(data[i] - background[0]) <= tolerance && Math.abs(data[i + 1] - background[1]) <= tolerance && Math.abs(data[i + 2] - background[2]) <= tolerance;

export const rectKey = (rect: Rect) => `${rect.x},${rect.y},${rect.w},${rect.h}`;
/** Куски между направляющими; полоски уже четырёх точек — это две линии рядом, а не кусок. */
export function guideCells(xs: readonly number[], ys: readonly number[], width: number, height: number): Rect[] {
  const cuts = (lines: readonly number[], size: number) => [...new Set([0, size, ...lines.map(Math.round).filter((line) => line > 0 && line < size)])].sort((a, b) => a - b);
  const cols = cuts(xs, width), rows = cuts(ys, height), cells: Rect[] = [];
  for (let r = 1; r < rows.length; r++) for (let c = 1; c < cols.length; c++) {
    const rect = { x: cols[c - 1], y: rows[r - 1], w: cols[c] - cols[c - 1], h: rows[r] - rows[r - 1] };
    if (rect.w >= 4 && rect.h >= 4) cells.push(rect);
  }
  return cells;
}
/** Направляющие, которые делят сторону поровну. */
export const evenGuides = (parts: number, size: number) => Array.from({ length: Math.max(0, Math.round(parts) - 1) }, (_, i) => Math.round((i + 1) * size / Math.round(parts)));
export function unionRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x)), y = Math.min(...rects.map((rect) => rect.y));
  return { x, y, w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x, h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y };
}
/** Кусок, обрезанный по содержимому; `null` — в нём один фон. */
export function trimRect({ data, width }: Pixels, rect: Rect, background: Background, tolerance: number): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    if (isBackground(data, (y * width + x) * 4, background, tolerance)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** «Найти сами»: отдельные рисунки на фоне, по строкам слева направо. Ищет по уменьшенной сетке: соседние штрихи одного рисунка
 * не распадаются на части. Мелкий сор отбрасывается. */
export function findPieces(pixels: Pixels, background: Background, tolerance: number): Rect[] {
  const { data, width, height } = pixels, block = Math.max(2, Math.round(Math.max(width, height) / 400));
  const gw = Math.ceil(width / block), gh = Math.ceil(height / block), filled = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!isBackground(data, (y * width + x) * 4, background, tolerance)) filled[Math.floor(y / block) * gw + Math.floor(x / block)] = 1;
  const found: Rect[] = [];
  for (let start = 0; start < filled.length; start++) {
    if (filled[start] !== 1) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, count = 0;
    const queue = [start]; filled[start] = 2;
    while (queue.length) {
      const at = queue.pop()!, x = at % gw, y = (at - x) / gw; count++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(gh - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(gw - 1, x + 1); nx++)
        if (filled[ny * gw + nx] === 1) { filled[ny * gw + nx] = 2; queue.push(ny * gw + nx); }
    }
    if (count < 4) continue;
    const rect = trimRect(pixels, { x: x0 * block, y: y0 * block, w: Math.min(width, (x1 + 1) * block) - x0 * block, h: Math.min(height, (y1 + 1) * block) - y0 * block }, background, tolerance);
    if (rect) found.push(rect);
  }
  return readingOrder(found, (rect) => rect);
}
/** Порядок чтения: по строкам слева направо. Строка — рисунки, которые начинаются выше низа первого в ней. */
export function readingOrder<T>(items: readonly T[], rectOf: (item: T) => Rect): T[] {
  const rows: T[][] = [];
  for (const item of [...items].sort((a, b) => rectOf(a).y - rectOf(b).y)) {
    const row = rows.at(-1), first = row && rectOf(row[0]);
    if (row && first && rectOf(item).y < first.y + first.h) row.push(item); else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => rectOf(a).x - rectOf(b).x));
}
/** Кусок листа отдельной картинкой: фон, который соединён с краем куска, становится прозрачным; такой же цвет внутри рисунка остаётся. */
export function cutPiece({ data, width }: Pixels, rect: Rect, background: Background, tolerance: number): Pixels {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) out.set(data.subarray(((rect.y + y) * width + rect.x) * 4, ((rect.y + y) * width + rect.x + rect.w) * 4), y * rect.w * 4);
  const seen = new Uint8Array(rect.w * rect.h), queue: number[] = [];
  const visit = (x: number, y: number) => {
    const at = y * rect.w + x;
    if (seen[at] || !isBackground(out, at * 4, background, tolerance)) return;
    seen[at] = 1; out[at * 4 + 3] = 0; queue.push(at);
  };
  for (let x = 0; x < rect.w; x++) { visit(x, 0); visit(x, rect.h - 1); }
  for (let y = 0; y < rect.h; y++) { visit(0, y); visit(rect.w - 1, y); }
  while (queue.length) {
    const at = queue.pop()!, x = at % rect.w, y = (at - x) / rect.w;
    if (x > 0) visit(x - 1, y); if (x < rect.w - 1) visit(x + 1, y); if (y > 0) visit(x, y - 1); if (y < rect.h - 1) visit(x, y + 1);
  }
  return { data: out, width: rect.w, height: rect.h };
}
