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
function depthKey(settingId: number): string {
  return `geography-rootdepth-${settingId}`;
}

/** Шаги вложенности: id ноды → сколько уровней вниз под ней видно.
 * Записи нет = видно всё (без лимита). */
export function loadRootDepths(settingId: number): Record<number, number> {
  try {
    const raw = localStorage.getItem(depthKey(settingId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && Number.isFinite(v) && v >= 0) {
        out[id] = Math.min(Math.round(v), 25);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRootDepths(settingId: number, depths: Record<number, number>): void {
  try {
    localStorage.setItem(depthKey(settingId), JSON.stringify(depths));
  } catch {
    /* ignore */
  }
}

export function resetRootDepths(settingId: number): void {
  try {
    localStorage.removeItem(depthKey(settingId));
  } catch {
    /* ignore */
  }
}

function posKey(settingId: number): string {
  return `geography-rootpos-${settingId}`;
}

export function loadRootPositions(settingId: number): Record<number, RootPos> {
  try {
    const raw = localStorage.getItem(posKey(settingId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, RootPos>;
    const out: Record<number, RootPos> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
        out[id] = { x: v.x, y: v.y };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRootPositions(settingId: number, pos: Record<number, RootPos>): void {
  try {
    localStorage.setItem(posKey(settingId), JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export function resetRootPositions(settingId: number): void {
  try {
    localStorage.removeItem(posKey(settingId));
  } catch {
    /* ignore */
  }
}

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

/** Веер: уровни — кольцами вокруг центра, угол — по порядку листьев.
 * Ширина превращается в дугу: широкой ветке достаётся широкий сектор. */
export function layoutRadial(
  shown: SettingLocation[],
  byParent: Map<number | null, SettingLocation[]>
): Record<number, RootPos> {
  const ids = new Set(shown.map((l) => l.id));
  const kidsOf = (id: number | null): SettingLocation[] =>
    (byParent.get(id) ?? []).filter((k) => ids.has(k.id));
  const roots = shown.filter((l) => l.parent_id == null || !ids.has(l.parent_id));

  // Листья в порядке обхода — каждому свой угловой слот.
  const leafOrder: number[] = [];
  const seenWalk = new Set<number>();
  function dfs(id: number): void {
    if (seenWalk.has(id)) return;
    seenWalk.add(id);
    const kids = kidsOf(id);
    if (kids.length === 0) leafOrder.push(id);
    else for (const k of kids) dfs(k.id);
  }
  for (const r of roots) dfs(r.id);
  // Осиротевшие циклом без листьев — сами себе слот.
  for (const l of shown) {
    if (!seenWalk.has(l.id)) {
      seenWalk.add(l.id);
      leafOrder.push(l.id);
    }
  }
  const n = Math.max(leafOrder.length, 1);
  const slotAngle = (i: number): number => ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;

  const angleCache = new Map<number, number>();
  function angle(id: number, visiting?: Set<number>): number {
    const cached = angleCache.get(id);
    if (cached != null) return cached;
    const seen = visiting ?? new Set<number>();
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = kidsOf(id);
    let a: number;
    if (kids.length === 0) {
      const idx = leafOrder.indexOf(id);
      a = slotAngle(idx < 0 ? 0 : idx);
    } else {
      let sum = 0;
      for (const k of kids) sum += angle(k.id, seen);
      a = sum / kids.length;
    }
    angleCache.set(id, a);
    seen.delete(id);
    return a;
  }

  // Глубина от корней леса.
  const depthMap = new Map<number, number>();
  const queue: number[] = [];
  for (const r of roots) {
    depthMap.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const d = depthMap.get(id) ?? 0;
    for (const k of kidsOf(id)) {
      if (!depthMap.has(k.id)) {
        depthMap.set(k.id, d + 1);
        queue.push(k.id);
      }
    }
  }

  // Радиус растёт с числом листьев, чтобы дуги не давили ноды.
  const base = Math.max(260, (n * 200) / (Math.PI * 2));
  const step = 230;
  const pos: Record<number, RootPos> = {};
  for (const l of shown) {
    const a = angle(l.id);
    const r = base + (depthMap.get(l.id) ?? 0) * step;
    pos[l.id] = {
      x: Math.cos(a) * r - ROOT_NODE_W / 2,
      y: Math.sin(a) * r - ROOT_NODE_H / 2,
    };
  }
  return pos;
}

/** Матрёшка: боксы считаются снизу вверх — родитель вмещает детей.
 * Строки внутри бокса стремятся к квадрату (cols = ceil(sqrt(n))). */
export const NEST_NODE_W = 220;
const NEST_NODE_H = 96;
const NEST_PAD = 16;
const NEST_HEAD = 40;
const NEST_GAP = 12;
const NEST_ROOT_GAP = 40;

function nestCols(n: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(n)));
}

export interface NestedLayout {
  pos: Record<number, RootPos>;
  widths: Record<number, number>;
  heights: Record<number, number>;
}

export function layoutNested(
  shown: SettingLocation[],
  byParent: Map<number | null, SettingLocation[]>
): NestedLayout {
  const ids = new Set(shown.map((l) => l.id));
  const kidsOfAll = (id: number): SettingLocation[] =>
    (byParent.get(id) ?? []).filter((k) => ids.has(k.id));
  const roots = shown.filter((l) => l.parent_id == null || !ids.has(l.parent_id));

  const W = new Map<number, number>();
  const H = new Map<number, number>();
  function size(id: number, visiting?: Set<number>): { w: number; h: number } {
    const cw = W.get(id);
    const ch = H.get(id);
    if (cw != null && ch != null) return { w: cw, h: ch };
    const seen = visiting ?? new Set<number>();
    if (seen.has(id)) return { w: NEST_NODE_W, h: NEST_NODE_H };
    seen.add(id);
    const kids = kidsOfAll(id).filter((k) => !seen.has(k.id));
    let w = NEST_NODE_W;
    let h = NEST_NODE_H;
    if (kids.length > 0) {
      const cols = nestCols(kids.length);
      let innerW = 0;
      let innerH = 0;
      for (let i = 0; i < kids.length; i += cols) {
        let rowW = 0;
        let rowH = 0;
        for (let j = i; j < Math.min(i + cols, kids.length); j++) {
          const s = size(kids[j].id, seen);
          rowW += s.w + (j > i ? NEST_GAP : 0);
          rowH = Math.max(rowH, s.h);
        }
        innerW = Math.max(innerW, rowW);
        innerH += rowH + (i > 0 ? NEST_GAP : 0);
      }
      w = Math.max(NEST_NODE_W, innerW + NEST_PAD * 2);
      h = NEST_HEAD + innerH + NEST_PAD * 2;
    }
    W.set(id, w);
    H.set(id, h);
    seen.delete(id);
    return { w, h };
  }
  for (const r of roots) size(r.id);

  const pos: Record<number, RootPos> = {};
  function place(id: number, x: number, y: number, visiting?: Set<number>): void {
    pos[id] = { x, y };
    const seen = visiting ?? new Set<number>();
    if (seen.has(id)) return;
    seen.add(id);
    const kids = kidsOfAll(id).filter((k) => !seen.has(k.id));
    if (kids.length === 0) {
      seen.delete(id);
      return;
    }
    const cols = nestCols(kids.length);
    let cy = y + NEST_HEAD + NEST_PAD;
    for (let i = 0; i < kids.length; i += cols) {
      let cx = x + NEST_PAD;
      let rowH = 0;
      for (let j = i; j < Math.min(i + cols, kids.length); j++) {
        place(kids[j].id, cx, cy, seen);
        cx += (W.get(kids[j].id) ?? NEST_NODE_W) + NEST_GAP;
        rowH = Math.max(rowH, H.get(kids[j].id) ?? NEST_NODE_H);
      }
      cy += rowH + NEST_GAP;
    }
    seen.delete(id);
  }
  let cx = 0;
  for (const r of roots) {
    place(r.id, cx, 0);
    cx += (W.get(r.id) ?? NEST_NODE_W) + NEST_ROOT_GAP;
  }

  const widths: Record<number, number> = {};
  const heights: Record<number, number> = {};
  for (const [k, v] of W) widths[k] = v;
  for (const [k, v] of H) heights[k] = v;
  return { pos, widths, heights };
}
