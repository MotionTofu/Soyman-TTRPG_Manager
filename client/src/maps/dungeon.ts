// Данж-генератор, пакет C (спека Данж_спек.md): порт donjon-алгоритма из
// прототипа. Только квадраты. Детерминирован: тот же вход — тот же выход
// (mulberry32, без Math.random). Выход — готовый MapCells: стены террейном
// wall, полы — plain (не пишутся), комнаты/двери/ловушки/старт/финиш.

import { cellKey } from "./grid";
import type {
  MapCells,
  MapDoor,
  MapDoorKind,
  MapRoom,
  MapRoomType,
  MapTrap,
  MapTrapKind,
} from "./render";

export interface DungeonParams {
  seed: number;
  rooms: number; // 3..30
  corrWidth: 1 | 2 | "mixed";
  loops: number; // 0..100
  secrets: boolean;
  traps: "none" | "some" | "many";
}

interface Rng {
  (): number;
}

function hashSeed(seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h | 0;
}

function mulberry32(a: number): Rng {
  let s = a;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOM_TYPES: MapRoomType[] = ["empty", "barracks", "temple", "treasury", "prison", "lab"];

function pickRoomType(rand: Rng): MapRoomType {
  const r = rand();
  if (r < 0.4) return ROOM_TYPES[0];
  if (r < 0.6) return ROOM_TYPES[1];
  if (r < 0.75) return ROOM_TYPES[2];
  if (r < 0.85) return ROOM_TYPES[3];
  if (r < 0.93) return ROOM_TYPES[4];
  return ROOM_TYPES[5];
}

function pickDoorKind(rand: Rng, secrets: boolean, traps: DungeonParams["traps"]): MapDoorKind {
  const trappedW = traps === "none" ? 0 : traps === "many" ? 24 : 13;
  const secretW = secrets ? 10 : 0;
  const table: [MapDoorKind, number][] = [
    ["arch", 12],
    ["door", 45],
    ["locked", 15],
    ["trapped", trappedW],
    ["secret", secretW],
    ["portc", 8],
  ];
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [kind, w] of table) {
    r -= w;
    if (r < 0) return kind;
  }
  return "door";
}

interface BuiltRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function generateDungeon(width: number, height: number, params: DungeonParams): MapCells {
  const rand = mulberry32(hashSeed(params.seed));
  const randInt = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
  const randOdd = (a: number, b: number) => {
    let v = randInt(a, b);
    if (v % 2 === 0) v++;
    if (v > b) v -= 2;
    if (v < a) v = a + (a % 2 === 0 ? 1 : 0);
    return v;
  };
  // Рабочее поле: 0 — целина, 1 — комната, 2 — коридор.
  const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(0));
  const rooms: BuiltRoom[] = [];
  const roomTypes: MapRoomType[] = [];
  const inB = (r: number, c: number) => r >= 0 && r < height && c >= 0 && c < width;

  const canPlace = (r: number, c: number, w: number, h: number): boolean => {
    for (let rr = r - 1; rr < r + h + 1; rr++)
      for (let cc = c - 1; cc < c + w + 1; cc++) {
        if (!inB(rr, cc) || grid[rr][cc] !== 0) return false;
      }
    return true;
  };

  const placeRoom = (r: number, c: number, w: number, h: number): void => {
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) grid[rr][cc] = 1;
    if (w >= 7 && h >= 7 && rand() < 0.45) {
      const pr = r + Math.floor(h / 2);
      const pc = c + Math.floor(w / 2);
      if (inB(pr, pc)) grid[pr][pc] = 0;
      if (w >= 9 && h >= 7 && rand() < 0.5) {
        if (inB(pr, pc + 2)) grid[pr][pc + 2] = 0;
        if (inB(pr, pc - 2)) grid[pr][pc - 2] = 0;
      }
    }
    rooms.push({ x: c, y: r, w, h });
    roomTypes.push(pickRoomType(rand));
  };

  const corrW = (): number => {
    if (params.corrWidth === 1) return 1;
    if (params.corrWidth === 2) return 2;
    return rand() < 0.35 ? 2 : 1;
  };

  const carveH = (r: number, c1: number, c2: number, w: number): void => {
    const a = Math.min(c1, c2);
    const b = Math.max(c1, c2);
    for (let dr = 0; dr < w; dr++) {
      const rr = r + dr;
      if (!inB(rr, a)) continue;
      for (let c = a; c <= b; c++) if (inB(rr, c) && grid[rr][c] === 0) grid[rr][c] = 2;
    }
  };

  const carveV = (c: number, r1: number, r2: number, w: number): void => {
    const a = Math.min(r1, r2);
    const b = Math.max(r1, r2);
    for (let dc = 0; dc < w; dc++) {
      const cc = c + dc;
      if (!inB(a, cc)) continue;
      for (let r = a; r <= b; r++) if (inB(r, cc) && grid[r][cc] === 0) grid[r][cc] = 2;
    }
  };

  const carveBetween = (ai: number, bi: number): void => {
    const a = rooms[ai];
    const b = rooms[bi];
    const w = corrW();
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const horiz = Math.abs(bx - ax) > Math.abs(by - ay);
    let sr: number;
    let sc: number;
    let er: number;
    let ec: number;
    if (horiz) {
      if (bx > ax) {
        sc = a.x + a.w;
        sr = Math.floor(a.y + a.h / 2);
        ec = b.x - 1;
        er = Math.floor(b.y + b.h / 2);
      } else {
        sc = a.x - 1;
        sr = Math.floor(a.y + a.h / 2);
        ec = b.x + b.w;
        er = Math.floor(b.y + b.h / 2);
      }
    } else if (by > ay) {
      sr = a.y + a.h;
      sc = Math.floor(a.x + a.w / 2);
      er = b.y - 1;
      ec = Math.floor(b.x + b.w / 2);
    } else {
      sr = a.y - 1;
      sc = Math.floor(a.x + a.w / 2);
      er = b.y + b.w;
      ec = Math.floor(b.x + b.w / 2);
    }
    if (w === 2) {
      if (horiz) {
        sr = Math.max(a.y, Math.min(a.y + a.h - 2, sr));
        er = Math.max(b.y, Math.min(b.y + b.h - 2, er));
      } else {
        sc = Math.max(a.x, Math.min(a.x + a.w - 2, sc));
        ec = Math.max(b.x, Math.min(b.x + b.w - 2, ec));
      }
    }
    sr = Math.max(0, Math.min(height - 1, sr));
    sc = Math.max(0, Math.min(width - 1, sc));
    er = Math.max(0, Math.min(height - 1, er));
    ec = Math.max(0, Math.min(width - 1, ec));
    if (rand() < 0.5) {
      carveH(sr, sc, ec, w);
      carveV(ec, sr, er, w);
    } else {
      carveV(sc, sr, er, w);
      carveH(er, sc, ec, w);
    }
  };

  // 1. Комнаты.
  let attempts = 0;
  const maxAttempts = params.rooms * 80;
  while (rooms.length < params.rooms && attempts < maxAttempts) {
    attempts++;
    let w = randOdd(3, 9);
    let h = randOdd(3, 7);
    if (rand() < 0.2) {
      w = randOdd(5, 11);
      h = randOdd(5, 11);
    }
    // Комната обязана влезть целиком (иначе на 8×8 ничего не встанет).
    if (w > width - 2 || h > height - 2) continue;
    const r = randOdd(1, height - h - 1);
    const c = randOdd(1, width - w - 1);
    if (canPlace(r, c, w, h)) placeRoom(r, c, w, h);
  }

  // 2. MST-связность + петли.
  if (rooms.length > 1) {
    const connected = [0];
    const remaining = new Set(rooms.map((_, i) => i).filter((i) => i !== 0));
    while (remaining.size > 0) {
      let best = -1;
      let bestPair: [number, number] = [0, 0];
      let bestDist = Infinity;
      for (const ci of connected)
        for (const ri of remaining) {
          const a = rooms[ci];
          const b = rooms[ri];
          const d = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) + Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
          if (d < bestDist) {
            bestDist = d;
            best = ri;
            bestPair = [ci, ri];
          }
        }
      carveBetween(bestPair[0], bestPair[1]);
      connected.push(best);
      remaining.delete(best);
    }
  }
  if (rooms.length > 4 && rand() * 100 < params.loops) {
    const tries = Math.floor(rooms.length * 0.4);
    for (let i = 0; i < tries; i++) {
      const a = randInt(0, rooms.length - 1);
      const b = randInt(0, rooms.length - 1);
      if (a !== b) carveBetween(a, b);
    }
  }

  const isFloor = (r: number, c: number) => inB(r, c) && (grid[r][c] === 1 || grid[r][c] === 2);

  // Старт нужен починке как корень BFS — считаем до дверей.
  let start: { x: number; y: number } | null = null;
  if (rooms.length > 0) {
    const rm = rooms[0];
    start = { x: Math.floor(rm.x + rm.w / 2), y: Math.floor(rm.y + rm.h / 2) };
  }

  // 3. Починка связности ДО дверей: коридоры починки без дверей, двери
  // ставятся один раз по финальной топологии (иначе ручные сносились бы).
  fixDungeonConnectivity(grid, rooms, start);

  // 4. Двери в проходах с группировкой (парные делят pair).
  // Правило горлышка (хотелка 1): дверь ставится, только если снаружи узкий
  // проход 1–2 тайла — прогон коридора (grid 2) вдоль стены длиной ≤2 с запертыми
  // концами, либо сосед — комната (дверь между комнатами — тоже проход).
  // Длинные «прилипания» коридора вдоль стены и широкие раскрытия дверей не получают.
  const corridorRun = (r: number, c: number, dr: number, dc: number): { len: number; closed: boolean } => {
    let len = 1;
    let er = r + dr;
    let ec = c + dc;
    while (inB(er, ec) && grid[er][ec] === 2) {
      len++;
      er += dr;
      ec += dc;
    }
    const endClosed = !inB(er, ec) || grid[er][ec] !== 2;
    return { len, closed: endClosed };
  };
  // Узкий ли проход в клетке коридора (or, oc), идущий вдоль стены:
  // ось прогона задаётся направлением (dr, dc) вдоль стены.
  const isNarrowPassage = (or: number, oc: number, dr: number, dc: number): boolean => {
    const fwd = corridorRun(or, oc, dr, dc);
    const back = corridorRun(or, oc, -dr, -dc);
    return fwd.len + back.len - 1 <= 2 && fwd.closed && back.closed;
  };
  const doors: MapDoor[] = [];
  let pairSeq = 0;
  const procSide = (rm: BuiltRoom, side: "n" | "s" | "e" | "w"): void => {
    const adj: { ir: number; ic: number }[] = [];
    // Вдоль стены — ось прогона: для n/s идём по колонкам, для w/e — по строкам.
    const along: [number, number] = side === "n" || side === "s" ? [0, 1] : [1, 0];
    const consider = (ir: number, ic: number, or: number, oc: number): void => {
      const outside = inB(or, oc) ? grid[or][oc] : -1;
      if (outside !== 2 && outside !== 1) return;
      // Комната снаружи — дверь между комнатами, всегда проход.
      if (outside === 1) {
        adj.push({ ir, ic });
        return;
      }
      if (isNarrowPassage(or, oc, along[0], along[1])) adj.push({ ir, ic });
    };
    if (side === "n") {
      const y = rm.y - 1;
      for (let c = rm.x; c < rm.x + rm.w; c++) consider(rm.y, c, y, c);
    } else if (side === "s") {
      const y = rm.y + rm.h;
      for (let c = rm.x; c < rm.x + rm.w; c++) consider(rm.y + rm.h - 1, c, y, c);
    } else if (side === "w") {
      const x = rm.x - 1;
      for (let r = rm.y; r < rm.y + rm.h; r++) consider(r, rm.x, r, x);
    } else {
      const x = rm.x + rm.w;
      for (let r = rm.y; r < rm.y + rm.h; r++) consider(r, rm.x + rm.w - 1, r, x);
    }
    if (adj.length === 0) return;
    const groups: { ir: number; ic: number }[][] = [[adj[0]]];
    for (let i = 1; i < adj.length; i++) {
      const pr = adj[i - 1];
      const nw = adj[i];
      const cont = side === "n" || side === "s" ? nw.ic === pr.ic + 1 : nw.ir === pr.ir + 1;
      if (cont) groups[groups.length - 1].push(nw);
      else groups.push([nw]);
    }
    for (const g of groups) {
      const kind = pickDoorKind(rand, params.secrets, params.traps);
      const cells = g.length === 1 ? [g[0]] : g.length === 2 ? g : (() => {
        const mid = Math.floor(g.length / 2);
        return g.length % 2 === 0 ? [g[mid - 1], g[mid]] : [g[mid]];
      })();
      const pair = cells.length > 1 ? `p${++pairSeq}` : null;
      for (const it of cells) doors.push({ x: it.ic, y: it.ir, edge: side, kind, secret: false, pair });
    }
  };
  for (const rm of rooms) {
    procSide(rm, "n");
    procSide(rm, "s");
    procSide(rm, "w");
    procSide(rm, "e");
  }

  // 5. Финиш/ловушки.
  let finish: { x: number; y: number } | null = null;
  if (rooms.length > 0 && start) {
    let bestD = -1;
    for (const o of rooms) {
      const cx = Math.floor(o.x + o.w / 2);
      const cy = Math.floor(o.y + o.h / 2);
      const d = Math.abs(cx - start.x) + Math.abs(cy - start.y);
      if (d > bestD) {
        bestD = d;
        finish = { x: cx, y: cy };
      }
    }
    if (finish && finish.x === start.x && finish.y === start.y) finish = null;
  }
  const traps: MapTrap[] = [];
  if (params.traps !== "none") {
    const count = params.traps === "many" ? Math.floor(rooms.length * 1.2) + 2 : Math.floor(rooms.length * 0.6) + 1;
    const floors: [number, number][] = [];
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) if (grid[r][c] === 1 || grid[r][c] === 2) floors.push([r, c]);
    const doorCells = new Set(doors.map((d) => cellKey(d.x, d.y)));
    const startKey = start ? cellKey(start.x, start.y) : null;
    const kinds: MapTrapKind[] = ["pit", "arrow", "gas", "glyph"];
    for (let i = 0; i < count && floors.length > 0; i++) {
      const idx = Math.floor(rand() * floors.length);
      const [r, c] = floors.splice(idx, 1)[0];
      if (doorCells.has(cellKey(c, r)) || cellKey(c, r) === startKey) continue;
      traps.push({ x: c, y: r, kind: kinds[Math.floor(rand() * kinds.length)] });
    }
  }

  // 6. Материализация: всё поле — стены, полы — plain (не пишутся).
  const terrain = new Map<string, string>();
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) if (grid[r][c] === 0) terrain.set(cellKey(c, r), "wall");

  const outRooms = rooms.map((r, i) => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    type: roomTypes[i],
    name: "",
  }));
  return { terrain, roads: new Set(), rivers: new Set(), labels: [], rooms: outRooms, doors, traps, markers: [], start, finish };
}

// BFS-достижимость по не-стенам + автосоединение изолированных.
// Та же функция — за кнопкой «Починить связность» (там grid строится из
// текущего blob: wall → 0, остальное → пол).
export function dungeonReachable(grid: number[][], start: { x: number; y: number } | null): Set<string> {
  const seen = new Set<string>();
  if (!start) return seen;
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (start.y < 0 || start.y >= h || start.x < 0 || start.x >= w || grid[start.y][start.x] === 0) return seen;
  const q: [number, number][] = [[start.y, start.x]];
  seen.add(cellKey(start.x, start.y));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length > 0) {
    const head = q.shift();
    if (!head) break;
    const [r, c] = head;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= h || nc < 0 || nc >= w || grid[nr][nc] === 0) continue;
      const k = cellKey(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nr, nc]);
    }
  }
  return seen;
}

function fixDungeonConnectivity(
  grid: number[][],
  rooms: BuiltRoom[],
  start: { x: number; y: number } | null
): void {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const inB = (r: number, c: number) => r >= 0 && r < h && c >= 0 && c < w;
  let reach = dungeonReachable(grid, start);
  const isolated = rooms.filter(
    (rm) => {
      for (let rr = rm.y; rr < rm.y + rm.h; rr++)
        for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach.has(cellKey(cc, rr))) return false;
      return true;
    }
  );
  if (isolated.length === 0) return;
  for (const rm of isolated) {
    let best: BuiltRoom | null = null;
    let bestD = Infinity;
    for (const o of rooms) {
      if (o === rm) continue;
      // Комната связна, если хоть клетка достижима.
      let linked = false;
      for (let rr = o.y; rr < o.y + o.h && !linked; rr++)
        for (let cc = o.x; cc < o.x + o.w && !linked; cc++) if (reach.has(cellKey(cc, rr))) linked = true;
      if (!linked) continue;
      const d = Math.abs(rm.x + rm.w / 2 - (o.x + o.w / 2)) + Math.abs(rm.y + rm.h / 2 - (o.y + o.h / 2));
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) continue;
    // L-коридор по прямой между центрами (только целина → пол).
    const x0 = Math.floor(rm.x + rm.w / 2);
    const y0 = Math.floor(rm.y + rm.h / 2);
    const x1 = Math.floor(best.x + best.w / 2);
    const y1 = Math.floor(best.y + best.h / 2);
    for (let c = Math.min(x0, x1); c <= Math.max(x0, x1); c++)
      if (inB(y0, c) && grid[y0][c] === 0) grid[y0][c] = 2;
    for (let r = Math.min(y0, y1); r <= Math.max(y0, y1); r++)
      if (inB(r, x1) && grid[r][x1] === 0) grid[r][x1] = 2;
    reach = dungeonReachable(grid, start);
  }
}

// Ручная починка текущей карты: строит рабочую сетку из blob
// (wall → стена, всё остальное → пол), чинит, возвращает патч террейна
// (клетки, ставшие полом) и число соединённых комнат. Без комнат — null.
export function fixMapConnectivity(cells: MapCells, width: number, height: number): { cleared: string[]; fixed: number } | null {
  if (cells.rooms.length === 0) return null;
  const grid: number[][] = Array.from({ length: height }, () => Array(width).fill(0));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = cells.terrain.get(cellKey(x, y)) ?? "plain";
      grid[y][x] = t === "wall" ? 0 : 1;
    }
  const rooms: BuiltRoom[] = cells.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const reach0 = dungeonReachable(grid, cells.start);
  const isolatedCount = rooms.filter((rm) => {
    for (let rr = rm.y; rr < rm.y + rm.h; rr++)
      for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach0.has(cellKey(cc, rr))) return false;
    return true;
  }).length;
  if (isolatedCount === 0) return { cleared: [], fixed: 0 };
  fixDungeonConnectivity(grid, rooms, cells.start);
  // Патч: клетки, бывшие стеной и ставшие полом.
  const cleared: string[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = cellKey(x, y);
      if (grid[y][x] !== 0 && (cells.terrain.get(k) ?? "plain") === "wall") cleared.push(k);
    }
  const reach1 = dungeonReachable(grid, cells.start);
  const still = rooms.filter((rm) => {
    for (let rr = rm.y; rr < rm.y + rm.h; rr++)
      for (let cc = rm.x; cc < rm.x + rm.w; cc++) if (reach1.has(cellKey(cc, rr))) return false;
    return true;
  }).length;
  return { cleared, fixed: isolatedCount - still };
}
