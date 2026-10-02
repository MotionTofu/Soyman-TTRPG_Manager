import type { SettingLocation } from "./types";

export type RootDirection = "top-down" | "bottom-up" | "left-right";

export interface RootPos {
  x: number;
  y: number;
}

export const ROOT_NODE_W = 220;
export const ROOT_NODE_H = 76;
const HGAP = 48;
const VGAP = 110;

export function isDescendantOf(
  ancestorId: number,
  maybeDescendantId: number,
  byId: Map<number, SettingLocation>
): boolean {
  let cur = byId.get(maybeDescendantId);
  const visited = new Set<number>();
  while (cur && cur.parent_id != null && !visited.has(cur.id)) {
    if (cur.parent_id === ancestorId) return true;
    visited.add(cur.id);
    cur = byId.get(cur.parent_id);
  }
  return false;
}

export function collectSubtreeIds(rootId: number, byParent: Map<number | null, SettingLocation[]>): number[] {
  const out: number[] = [];
  const stack = [rootId];
  const visited = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    out.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return out;
}

/** Перенос строк: больше стольких детей в ряд не кладём, остальные —
 * следующими рядами. Режет ширину широкой ветки гарантированно. */
export const ROOT_WRAP_COLS = 4;

/** Аккуратная послойная раскладка леса без внешних зависимостей (beta: вместо dagre).
 * `wrap` — переносить длинные ряды детей (иначе один ряд на всю ширину). */
export function layoutForest(
  locations: SettingLocation[],
  byParent: Map<number | null, SettingLocation[]>,
  direction: RootDirection,
  wrap?: boolean
): Record<number, RootPos> {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const roots = (byParent.get(null) ?? []).filter((r) => byId.has(r.id));
  // Корни, чей parent отфильтрован/отсутствует, тоже считаем корнями леса.
  for (const l of locations) {
    if (l.parent_id != null && !byId.has(l.parent_id)) {
      if (!roots.includes(l)) roots.push(l);
    }
  }

  // Защита от цикла в parent_id (битый дамп/прямой UPDATE в обход PUT
  // /parent): без visited рекурсия уходит в бесконечность и роняет вкладку.
  const subtreeWidth = new Map<number, number>();
  function width(id: number, visited?: Set<number>): number {
    const cached = subtreeWidth.get(id);
    if (cached != null) return cached;
    const seen = visited ?? new Set<number>();
    if (seen.has(id)) return 1;
    seen.add(id);
    const kids = (byParent.get(id) ?? []).filter((k) => byId.has(k.id) && !seen.has(k.id));
    const w = kids.length === 0 ? 1 : kids.reduce((s, k) => s + width(k.id, seen), 0);
    subtreeWidth.set(id, w);
    seen.delete(id);
    return w;
  }
  for (const r of roots) width(r.id);

  const pos: Record<number, RootPos> = {};
  const stepMain = direction === "left-right" ? ROOT_NODE_W + HGAP + 60 : ROOT_NODE_H + VGAP;
  const stepCross = direction === "left-right" ? ROOT_NODE_H + 36 : ROOT_NODE_W + HGAP;
  // Габарит ноды вдоль главной оси и зазор между рядами при переносе.
  const nodeMain = direction === "left-right" ? ROOT_NODE_W : ROOT_NODE_H;
  const gapMain = stepMain - nodeMain;
  let cursor = 0;

  /** Поперечный размах подветки с учётом переноса (в слотах). */
  const spanCache = new Map<number, number>();
  function span(id: number, visited?: Set<number>): number {
    const cached = spanCache.get(id);
    if (cached != null) return cached;
    const seen = visited ?? new Set<number>();
    if (seen.has(id)) return 1;
    seen.add(id);
    const kids = (byParent.get(id) ?? []).filter((k) => byId.has(k.id) && !seen.has(k.id));
    let s: number;
    if (kids.length === 0) s = 1;
    else if (!wrap || kids.length <= ROOT_WRAP_COLS) s = subtreeWidth.get(id) ?? 1;
    else {
      s = 0;
      for (let i = 0; i < kids.length; i += ROOT_WRAP_COLS) {
        let row = 0;
        for (let j = i; j < Math.min(i + ROOT_WRAP_COLS, kids.length); j++) {
          row += span(kids[j].id, seen);
        }
        s = Math.max(s, row);
      }
    }
    spanCache.set(id, s);
    seen.delete(id);
    return s;
  }

  /** Продольная высота подветки от верха ноды до низа потомков (px). */
  const tallCache = new Map<number, number>();
  function tall(id: number, visited?: Set<number>): number {
    const cached = tallCache.get(id);
    if (cached != null) return cached;
    const seen = visited ?? new Set<number>();
    if (seen.has(id)) return nodeMain;
    seen.add(id);
    const kids = (byParent.get(id) ?? []).filter((k) => byId.has(k.id) && !seen.has(k.id));
    let t: number;
    if (kids.length === 0) t = nodeMain;
    else if (!wrap || kids.length <= ROOT_WRAP_COLS) {
      let m = 0;
      for (const k of kids) m = Math.max(m, tall(k.id, seen));
      t = nodeMain + gapMain + m;
    } else {
      t = nodeMain + gapMain;
      for (let i = 0; i < kids.length; i += ROOT_WRAP_COLS) {
        let row = 0;
        for (let j = i; j < Math.min(i + ROOT_WRAP_COLS, kids.length); j++) {
          row = Math.max(row, tall(kids[j].id, seen));
        }
        t += row + gapMain;
      }
    }
    tallCache.set(id, t);
    seen.delete(id);
    return t;
  }

  function place(id: number, main: number, crossStart: number, visited?: Set<number>): void {
    const seen = visited ?? new Set<number>();
    if (seen.has(id)) {
      // Узел цикла: кладём отдельно, чтобы не рвать весь лес.
      pos[id] = direction === "left-right" ? { x: main, y: cursor } : { x: cursor, y: main };
      return;
    }
    seen.add(id);
    const kids = (byParent.get(id) ?? []).filter((k) => byId.has(k.id) && !seen.has(k.id));
    if (kids.length === 0) {
      const c = crossStart + stepCross / 2;
      pos[id] = direction === "left-right" ? { x: main, y: c } : { x: c, y: main };
      seen.delete(id);
      return;
    }
    const perRow = wrap ? ROOT_WRAP_COLS : kids.length;
    let rowTop = main + stepMain;
    let firstCross = 0;
    let lastCross = 0;
    for (let i = 0; i < kids.length; i += perRow) {
      let cur = crossStart;
      let rowTall = 0;
      const rowEnd = Math.min(i + perRow, kids.length);
      for (let j = i; j < rowEnd; j++) {
        place(kids[j].id, rowTop, cur, seen);
        cur += span(kids[j].id, seen) * stepCross;
        rowTall = Math.max(rowTall, tall(kids[j].id, seen));
        if (i === 0 && j === 0) {
          const p = pos[kids[j].id];
          firstCross = direction === "left-right" ? p.y : p.x;
        }
        if (i + perRow >= kids.length && j === rowEnd - 1) {
          const p = pos[kids[j].id];
          lastCross = direction === "left-right" ? p.y : p.x;
        }
      }
      rowTop += rowTall + gapMain;
    }
    seen.delete(id);
    const mid = (firstCross + lastCross) / 2;
    pos[id] = direction === "left-right" ? { x: main, y: mid } : { x: mid, y: main };
  }

  for (const r of roots) {
    const spanSlots = span(r.id) * stepCross;
    place(r.id, 0, cursor);
    cursor += spanSlots + stepCross * 0.75;
  }

  if (direction === "bottom-up") {
    let maxY = 0;
    for (const p of Object.values(pos)) maxY = Math.max(maxY, p.y);
    for (const p of Object.values(pos)) p.y = maxY - p.y;
  }
  return pos;
}
