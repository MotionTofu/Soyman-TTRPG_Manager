import type { MapRenderModel } from "./renderModel";
import { liquidKey, waterLevel } from "./assets/village";
import { pixelToCell } from "./grid";
import type { WaterFog } from "./water";

/**
 * Атласная вода (гриллинг 2026-10-16, А1–А10): не шейдер, а линии. По маске поверхностей строится поле воды, из него —
 * берег плавной кривой с дрожью руки, границы трёх тонов глубины, штриховка вдоль берега и места для волн.
 * Всё в мировых координатах, поэтому плитки и обычный холст рисуют одно и то же; считается блоками (`ATLAS_BLOCK`). Реки сюда не входят: они уже линии,
 * их рисует отрисовка вместе с морем — сначала тушь всего, потом вода всего, и устье сливается без шва.
 */
export interface AtlasWaterLook { shoal: number; waves: "arcs" | "caps"; density: number }

/** Ломаная в мировых координатах (x, y подряд) с рамкой — по ней плитка пропускает чужое. */
export type AtlasLine = { points: Float32Array; closed: boolean; minX: number; minY: number; maxX: number; maxY: number };
export type AtlasWave = { x: number; y: number; turn: number; chance: number };
export interface AtlasBlock {
  /** Сам блок в мире: всё, что ниже, рисуется только в его рамке. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  /** Берег — замкнутые контуры: заливка чёт-нечет даёт море с островами. */
  coast: AtlasLine[];
  /** Где глубже второй и третьей ступени тона. */
  tones: [AtlasLine[], AtlasLine[]];
  hatch: AtlasLine[];
  waves: AtlasWave[];
  /** Жидкости блока; при двух и больше — `kinds`: номер жидкости, 2 точки на клетку от (x, y), для перехода цвета
   * градиентом (А10). */
  keys: string[];
  kinds: { data: Uint8Array; size: number; x: number; y: number } | null;
}

/** Точек поля на клетку — как у кисти (отсчёт в четверть клетки): гуще берег точнее не станет, а счёт растёт квадратом.
 * Тоны и «широкая вода» — на вдвое более грубой сетке: они плавные. */
const R = 4;
/** Берег — не по середине размытого края, а чуть на суше: рваный край поверхности суши отступает от накрашенного,
 * и между ним и берегом светила бы бумага. */
const COAST = 0.3;
/** Ступени тона по глубине 1…5: мельче 2,5 — светлый, до 4 — средний, глубже — тёмный. */
const TONE_STEPS = [2.5, 4];
/** Линии штриховки — на таком расстоянии от берега, клеток: к открытому морю реже. */
const HATCH = [0.16, 0.31, 0.48, 0.68, 0.92];
/** Штриховка и волны — только где вода шире примерно двух клеток (А4). */
const WIDE = 1;

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
/** Гладкий шум 0…1 в мировых координатах: одинаков в любой плитке. */
export function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Размытие квадратом радиуса `r` (два прохода скользящей суммы, край продолжается крайним значением). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + (x < 0 ? 0 : x < w ? x : w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * k;
      const add = x + r + 1, drop = x - r;
      sum += src[row + (add < w ? add : w - 1)] - src[row + (drop > 0 ? drop : 0)];
    }
  }
  // По столбцам — все сразу, строка за строкой: так память читается подряд.
  const sum = new Float32Array(w);
  for (let y = -r; y <= r; y++) { const row = (y < 0 ? 0 : y < h ? y : h - 1) * w; for (let x = 0; x < w; x++) sum[x] += tmp[row + x]; }
  for (let y = 0; y < h; y++) {
    const row = y * w, add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, drop = (y - r > 0 ? y - r : 0) * w;
    for (let x = 0; x < w; x++) { out[row + x] = sum[x] * k; sum[x] += tmp[add + x] - tmp[drop + x]; }
  }
  return out;
}

/** Расстояние до ближайшей точки-семени (`seeds` — 1), в точках поля: два прохода с переносом ближайшего семени,
 * корень только в конце. `at` — где семя на самом деле (x, y парами), если граница проходит не через центр точки. */
function distance(seeds: Uint8Array, w: number, h: number, at?: Float32Array): Float32Array {
  const n = w * h, d2 = new Float64Array(n).fill(Infinity), sx = new Float32Array(n).fill(-1), sy = new Float32Array(n);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (seeds[i]) { d2[i] = 0; sx[i] = at ? at[2 * i] : x; sy[i] = at ? at[2 * i + 1] : y; }
  const take = (i: number, x: number, y: number, j: number) => {
    const ax = sx[j];
    if (ax < 0) return;
    const dx = x - ax, dy = y - sy[j], v = dx * dx + dy * dy;
    if (v < d2[i]) { d2[i] = v; sx[i] = ax; sy[i] = sy[j]; }
  };
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (d2[i] === 0) continue;
    if (x) take(i, x, y, i - 1);
    if (y) { take(i, x, y, i - w); if (x) take(i, x, y, i - w - 1); if (x < w - 1) take(i, x, y, i - w + 1); }
  }
  for (let y = h - 1, i = n - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) {
    if (d2[i] === 0) continue;
    if (x < w - 1) take(i, x, y, i + 1);
    if (y < h - 1) { take(i, x, y, i + w); if (x < w - 1) take(i, x, y, i + w + 1); if (x) take(i, x, y, i + w - 1); }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(d2[i]);
  return out;
}

type Contour = { points: number[]; closed: boolean };
/** Уровни поля ломаными (квадраты-марш), все уровни за один проход. Ломаные в точках поля; у края поля — открытые. */
export function contour(field: Float32Array, w: number, h: number, levels: readonly number[]): Contour[][] {
  // Ребро сетки: горизонтальное (x,y)-(x+1,y) — 2i, вертикальное (x,y)-(x,y+1) — 2i+1.
  const found = levels.map(() => ({ segments: [] as number[], ends: new Map<number, number[]>() }));
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = field[i], b = field[i + 1], c = field[i + w + 1], d = field[i + w];
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
    for (let n = 0; n < levels.length; n++) {
      const level = levels[n];
      if (lo > level || hi <= level) continue;
      const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      const top = 2 * i, bottom = 2 * (i + w), left = 2 * i + 1, right = 2 * (i + 1) + 1, { segments, ends } = found[n];
      const link = (p: number, q: number) => {
        const k = segments.push(p, q) / 2 - 1;
        for (const e of [p, q]) { const list = ends.get(e); if (list) list.push(k); else ends.set(e, [k]); }
      };
      const center = (a + b + c + d) / 4 > level;
      switch (index) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: if (center) { link(left, top); link(bottom, right); } else { link(left, bottom); link(top, right); } break;
        case 10: if (center) { link(top, right); link(left, bottom); } else { link(left, top); link(bottom, right); } break;
      }
    }
  }
  return found.map(({ segments, ends }, n) => {
    const level = levels[n], used = new Uint8Array(segments.length / 2), out: Contour[] = [];
    const point = (edge: number, into: number[]) => {
      const i = edge >> 1, x = i % w, y = (i - x) / w, j = edge & 1 ? i + w : i + 1, p = field[i], q = field[j];
      const t = p === q ? 0.5 : (level - p) / (q - p);
      if (edge & 1) into.push(x, y + t); else into.push(x + t, y);
    };
    const walk = (start: number, from: number): Contour => {
      const points: number[] = [];
      point(from, points);
      let edge = from, k = start;
      for (;;) {
        used[k] = 1;
        const next = segments[2 * k] === edge ? segments[2 * k + 1] : segments[2 * k];
        point(next, points);
        edge = next;
        const more = ends.get(edge)!.find(m => !used[m]);
        if (more === undefined) break;
        k = more;
      }
      return { points, closed: edge === from && points.length > 4 };
    };
    // Сначала ломаные с концами (у края поля), потом замкнутые.
    for (const [edge, list] of ends) if (list.length === 1 && !used[list[0]]) out.push(walk(list[0], edge));
    for (let k = 0; k < used.length; k++) if (!used[k]) out.push(walk(k, segments[2 * k]));
    return out;
  });
}

/** Срезает углы ломаной (Чайкин) и прореживает точки ближе `step`. */
function smooth(points: number[], closed: boolean, rounds: number, step: number): number[] {
  let p = points;
  if (closed && p.length > 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p = p.slice(0, -2);
  for (let r = 0; r < rounds; r++) {
    const n = p.length / 2, q: number[] = closed ? [] : [p[0], p[1]];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
      q.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    if (!closed) q.push(p[p.length - 2], p[p.length - 1]);
    p = q;
  }
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const last = i === p.length - 2 && !closed;
    if (last || Math.hypot(p[i] - out[out.length - 2], p[i + 1] - out[out.length - 1]) >= step) out.push(p[i], p[i + 1]);
  }
  return out;
}

/** Дрожь руки: точки уходят по нормали на гладкий шум — линия живая, но не лохматая (А3). Дрожат только точки у `near`:
 * остальное лежит в запасе блока и всё равно обрезается. */
function tremble(p: number[], closed: boolean, amount: number, near: (x: number, y: number) => boolean): number[] {
  const n = p.length / 2, out = p.slice();
  for (let i = 0; i < n; i++) {
    if (!near(p[2 * i], p[2 * i + 1])) continue;
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const tx = p[2 * b] - p[2 * a], ty = p[2 * b + 1] - p[2 * a + 1], length = Math.hypot(tx, ty) || 1;
    const x = p[2 * i], y = p[2 * i + 1], shift = (noise(x * 1.7, y * 1.7) - 0.5) * 2 * amount + (noise(x * 5.3 + 7, y * 5.3) - 0.5) * amount * 0.6;
    out[2 * i] = x - ty / length * shift; out[2 * i + 1] = y + tx / length * shift;
  }
  return out;
}

function line(points: number[], closed: boolean): AtlasLine {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]); minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  return { points: Float32Array.from(points), closed, minX, minY, maxX, maxY };
}

/** Длинные ломаные режутся на куски: плитка рисует только свои. */
function pieces(points: number[], size = 160): AtlasLine[] {
  if (points.length / 2 <= size) return [line(points, false)];
  const out: AtlasLine[] = [];
  for (let i = 0; i < points.length / 2 - 1; i += size) out.push(line(points.slice(2 * i, 2 * Math.min(points.length / 2, i + size + 1)), false));
  return out;
}

/** Сторона блока, клеток: вода считается блоками, и мазок кисти пересчитывает только задетые. */
export const ATLAS_BLOCK = 8;
type Source = NonNullable<NonNullable<Extract<MapRenderModel["layers"][number], { kind: "terrain" }>["terrain"]["mask"]>["source"]>;
type Mask = { origin: { x: number; y: number }; sampleSize: number; source: Source };
const chunkIndex = new WeakMap<Source, Map<string, readonly number[]>>();
const chunksOf = (source: Source) => {
  let known = chunkIndex.get(source);
  if (!known) chunkIndex.set(source, known = new Map(source.chunks.map(chunk => [`${chunk.cx}:${chunk.cy}`, chunk.values])));
  return known;
};
const codeKeys = new WeakMap<readonly (string | null)[], string>();
const codesKey = (codes: readonly (string | null)[]) => { let key = codeKeys.get(codes); if (key === undefined) codeKeys.set(codes, key = codes.join("|")); return key; };

const blocks = new Map<string, { deps: unknown[]; block: AtlasBlock | null }>();

/**
 * Блоки атласной воды, которые видны в `view` (мировые координаты). `width`, `height` и `lo` — границы мира карты,
 * как у масок живой воды. Блок пересчитывается, только если под его окном сменился кусок маски или настройка.
 */
export function atlasBlocks(model: MapRenderModel, width: number, height: number, lo: { x: number; y: number }, shoal: number, fog: WaterFog,
  view: { x0: number; y0: number; x1: number; y1: number }): AtlasBlock[] {
  const masks: Mask[] = [];
  for (const layer of model.layers) if (layer.visible && layer.kind === "terrain" && layer.terrain.mask?.source) masks.push(layer.terrain.mask as Mask);
  if (!masks.length) return [];
  // Запас окна: штриховке и «широкой воде» нужно знать берег на две клетки вокруг, отмели — на свою ширину и клетку размытия.
  const margin = Math.max(2, Math.ceil(shoal) + 1), out: AtlasBlock[] = [];
  const bx0 = Math.max(0, Math.floor((view.x0 - lo.x) / ATLAS_BLOCK)), by0 = Math.max(0, Math.floor((view.y0 - lo.y) / ATLAS_BLOCK));
  const bx1 = Math.min(Math.ceil((width - lo.x) / ATLAS_BLOCK) - 1, Math.floor((view.x1 - lo.x) / ATLAS_BLOCK));
  const by1 = Math.min(Math.ceil((height - lo.y) / ATLAS_BLOCK) - 1, Math.floor((view.y1 - lo.y) / ATLAS_BLOCK));
  if (blocks.size > 4096) blocks.clear();
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const ox = lo.x + bx * ATLAS_BLOCK - margin, oy = lo.y + by * ATLAS_BLOCK - margin, side = ATLAS_BLOCK + 2 * margin;
    // Что лежит под окном блока: настройки и куски масок — сами объекты, у нетронутых кистью они те же.
    const deps: unknown[] = [width, height, lo.x, lo.y, shoal, fog?.revealed];
    for (const mask of masks) {
      const span = 16 * mask.sampleSize, index = chunksOf(mask.source);
      deps.push(codesKey(mask.source.codes), mask.origin.x, mask.origin.y, mask.sampleSize);
      for (let cy = Math.floor((oy - mask.origin.y) / span); cy * span + mask.origin.y < oy + side; cy++)
        for (let cx = Math.floor((ox - mask.origin.x) / span); cx * span + mask.origin.x < ox + side; cx++) deps.push(index.get(`${cx}:${cy}`));
    }
    const key = `${bx}:${by}`, known = blocks.get(key);
    let block: AtlasBlock | null;
    if (known && known.deps.length === deps.length && known.deps.every((value, i) => value === deps[i])) block = known.block;
    else {
      block = buildBlock(masks, width, height, lo, shoal, fog, ox, oy, side, { x0: lo.x + bx * ATLAS_BLOCK, y0: lo.y + by * ATLAS_BLOCK, x1: lo.x + (bx + 1) * ATLAS_BLOCK, y1: lo.y + (by + 1) * ATLAS_BLOCK });
      blocks.set(key, { deps, block });
    }
    if (block) out.push(block);
  }
  return out;
}

/** Блок: окно `side` клеток от (ox, oy) с запасом вокруг самого блока `rect`. Внешний ряд окна — суша: берег в окне
 * замыкается, а выдуманная его часть лежит в запасе и обрезается рамкой блока. */
function buildBlock(masks: readonly Mask[], width: number, height: number, lo: { x: number; y: number }, shoal: number, fog: WaterFog,
  ox: number, oy: number, side: number, rect: AtlasBlock["rect"]): AtlasBlock | null {
  const w = side * R, h = w, n = w * h;
  const wet = new Uint8Array(n), depth = new Uint8Array(n), kind = new Uint8Array(n), floor = new Uint8Array(n);
  const keys = ["water"], keyOf = (code: string) => { const k = liquidKey(code), at = keys.indexOf(k); return at >= 0 ? at : keys.push(k) - 1; };
  // Точки окна за краем карты берут значение с края: море уходит за край, а не обрывается берегом.
  const clampX = (x: number) => Math.min(width - 1e-6, Math.max(lo.x, x)), clampY = (y: number) => Math.min(height - 1e-6, Math.max(lo.y, y));
  const sx0 = Math.ceil((clampX(ox) - ox) * R - 0.5), sx1 = Math.floor((clampX(ox + side) - ox) * R - 0.5);
  const sy0 = Math.ceil((clampY(oy) - oy) * R - 0.5), sy1 = Math.floor((clampY(oy + side) - oy) * R - 0.5);
  if (sx0 > sx1 || sy0 > sy1) return null;
  let any = false;
  for (const mask of masks) {
    const step = Math.max(1, Math.round(mask.sampleSize * R)), codes = mask.source.codes, looks: ({ level: number; kind: number } | undefined)[] = [], span = 16 * mask.sampleSize, index = chunksOf(mask.source);
    for (let cy = Math.floor((oy - mask.origin.y) / span); cy * span + mask.origin.y < oy + side; cy++)
      for (let cx = Math.floor((ox - mask.origin.x) / span); cx * span + mask.origin.x < ox + side; cx++) {
        const values = index.get(`${cx}:${cy}`);
        if (!values) continue;
        const baseX = (mask.origin.x - ox + cx * span) * R, baseY = (mask.origin.y - oy + cy * span) * R, pitch = mask.sampleSize * R;
        for (let row = 0; row < 16; row++) {
          const y0 = Math.round(baseY + row * pitch), y1 = Math.min(h, y0 + step);
          if (y1 <= 0 || y0 >= h) continue;
          for (let col = 0; col < 16; col++) {
            const value = values[row * 16 + col];
            if (!value) continue;
            const x0 = Math.round(baseX + col * pitch), x1 = Math.min(w, x0 + step);
            if (x1 <= 0 || x0 >= w) continue;
            let look = looks[value - 1];
            if (!look) { const code = codes[value - 1] ?? "", level = waterLevel(code); look = looks[value - 1] = { level, kind: level ? keyOf(code) : 0 }; }
            const level = look.level, water = level ? 1 : 0, dry = water ? 0 : 1, liquid = look.kind;
            for (let y = Math.max(0, y0); y < y1; y++) for (let x = Math.max(0, x0), at = y * w + x; x < x1; x++, at++) {
              // Закрашенный отсчёт верхнего слоя перекрывает воду нижнего, даже если сам не вода.
              wet[at] = water; depth[at] = level; kind[at] = liquid; floor[at] = dry;
            }
            any ||= water === 1;
          }
        }
      }
  }
  if (!any) return null;
  if (sx0 > 0 || sy0 > 0 || sx1 < w - 1 || sy1 < h - 1) for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const cx = x < sx0 ? sx0 : x > sx1 ? sx1 : x, cy = y < sy0 ? sy0 : y > sy1 ? sy1 : y;
    if (cx === x && cy === y) continue;
    const j = cy * w + cx; wet[i] = wet[j]; depth[i] = depth[j]; kind[i] = kind[j]; floor[i] = floor[j];
  }
  // У игрока вода продолжается в пустоту закрытых клеток на полторы клетки: край тумана — не берег.
  if (fog) {
    const open = new Uint8Array(n);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (wet[i] || floor[i]) continue;
      const cell = pixelToCell(fog.grid, ox + (x + 0.5) / R, oy + (y + 0.5) / R, fog.width, fog.height);
      open[i] = cell && fog.revealed.has(`${cell.x},${cell.y}`) ? 0 : 1;
    }
    // Ближайшая вода — проходами от соседей: точного источника не нужно, глубина под туманом выдумана.
    for (let pass = 0; pass < Math.ceil(R * 1.5); pass++) {
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        if (!open[i] || wet[i]) continue;
        const j = x && wet[i - 1] === 1 ? i - 1 : x < w - 1 && wet[i + 1] === 1 ? i + 1 : y && wet[i - w] === 1 ? i - w : y < h - 1 && wet[i + w] === 1 ? i + w : -1;
        if (j >= 0) { wet[i] = 2; depth[i] = depth[j]; kind[i] = kind[j]; }
      }
      for (let i = 0; i < n; i++) if (wet[i] === 2) wet[i] = 1;
    }
  }
  const ring = (x: number, y: number) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
  // Вода во всём окне — берега нет: заливка — рамка чуть шире блока, штриховки нет, до берега далеко.
  let open = true;
  for (let i = 0; i < n && open; i++) open = wet[i] === 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = wet[i];
  const field = open ? raw : blur(blur(raw, w, h, 1), w, h, 1), land = new Uint8Array(n);
  if (!open) for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (ring(x, y)) field[i] = 0; else if (field[i] < COAST) land[i] = 1;
  // Расстояние до берега, клеток. Семя — точка суши у воды, сдвинутая по наклону поля туда, где поле переходит порог:
  // берег идёт между точками, и от центров штриховка ложилась бы на тушь и гуляла вдоль косого берега.
  let shore: Float32Array;
  if (open) shore = new Float32Array(n).fill(Infinity);
  else {
    const at = new Float32Array(2 * n);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      at[2 * i] = x; at[2 * i + 1] = y;
      if (!land[i] || ring(x, y)) continue;
      const gx = (field[i + 1] - field[i - 1]) / 2, gy = (field[i + w] - field[i - w]) / 2, g = Math.hypot(gx, gy);
      if (g < 1e-4) continue;
      const t = Math.min(1.5, (COAST - field[i]) / g) / g;
      at[2 * i] = x + gx * t; at[2 * i + 1] = y + gy * t;
    }
    shore = distance(land, w, h, at);
    for (let i = 0; i < n; i++) shore[i] /= R;
  }
  /** Точки окна в мир; `k` — во сколько раз сетка грубее основной. */
  const toWorld = (p: number[], k = 1) => p.map((v, i) => (i & 1 ? oy : ox) + (v * k + k / 2) / R);
  const near = (line: AtlasLine) => line.maxX >= rect.x0 - 0.5 && line.minX <= rect.x1 + 0.5 && line.maxY >= rect.y0 - 0.5 && line.minY <= rect.y1 + 0.5;
  const close = (x: number, y: number) => x >= rect.x0 - 0.3 && x <= rect.x1 + 0.3 && y >= rect.y0 - 0.3 && y <= rect.y1 + 0.3;
  const coast = open ? [line([rect.x0 - 0.5, rect.y0 - 0.5, rect.x1 + 0.5, rect.y0 - 0.5, rect.x1 + 0.5, rect.y1 + 0.5, rect.x0 - 0.5, rect.y1 + 0.5], true)]
    : contour(field, w, h, [COAST])[0].flatMap(({ points, closed }) => closed ? [line(tremble(smooth(toWorld(points), true, 2, 0.04), true, 0.035, close), true)] : []);
  // Грубая сетка (вдвое реже) — тоны и «широкая вода». Глубина накрашенная, у берега на «Отмели» набирается от единицы,
  // и сглажена только по воде: суша не тянет её к нулю.
  const cw = w / 2, cn = cw * cw, share = new Float32Array(cn), sum = new Float32Array(cn), far = new Float32Array(cn).fill(Infinity);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const c = (y >> 1) * cw + (x >> 1);
    let level = depth[i] * wet[i];
    if (shoal > 0 && level > 1) level = 1 + (level - 1) * Math.min(1, shore[i] / shoal);
    share[c] += raw[i] / 4; sum[c] += level / 4; if (shore[i] < far[c]) far[c] = shore[i];
  }
  const spread = blur(blur(sum, cw, cw, 1), cw, cw, 1), weight = blur(blur(share, cw, cw, 1), cw, cw, 1), level = new Float32Array(cn), roomy = new Uint8Array(cn);
  for (let y = 0, i = 0; y < cw; y++) for (let x = 0; x < cw; x++, i++) {
    const edge = x === 0 || y === 0 || x === cw - 1 || y === cw - 1;
    level[i] = edge || weight[i] < 0.02 ? 0 : spread[i] / weight[i];
    roomy[i] = !edge && far[i] >= WIDE ? 1 : 0;
  }
  const tones = contour(level, cw, cw, TONE_STEPS).map(found => found.flatMap(({ points, closed }) => closed ? [line(smooth(toWorld(points, 2), true, 3, 0.05), true)] : [])) as [AtlasLine[], AtlasLine[]];
  // Широкая вода — не дальше клетки от точки, до берега от которой больше клетки.
  const room = distance(roomy, cw, cw), wide = (x: number, y: number) => {
    const px = Math.floor((x - ox) * R / 2), py = Math.floor((y - oy) * R / 2);
    return px >= 0 && py >= 0 && px < cw && py < cw && room[py * cw + px] <= WIDE * R / 2;
  };
  const hatch: AtlasLine[] = [];
  if (!open) contour(shore, w, h, HATCH).forEach((found, k) => {
    for (const { points, closed } of found) {
      const world = toWorld(points);
      if (!near(line(world, false))) continue;
      const p = smooth(world, closed, 3, 0.06), run: number[] = [];
      // Линия рвётся шумом, как от руки, и пропадает в узкой воде; у каждой линии свой узор разрывов.
      const flush = () => { if (run.length >= 6) hatch.push(...pieces(run.slice()).filter(near)); run.length = 0; };
      for (let i = 0; i < p.length; i += 2) {
        if (close(p[i], p[i + 1]) && wide(p[i], p[i + 1]) && noise(p[i] * 1.4 + k * 17, p[i + 1] * 1.4) > 0.24) run.push(p[i], p[i + 1]); else flush();
      }
      flush();
    }
  });
  // Волны: место и «жребий» на общей сетке со сдвигом, в блоке — только свои; какие видны, решает густота при отрисовке.
  const waves: AtlasWave[] = [], gap = 1.25;
  for (let j = Math.floor(rect.y0 / gap / 0.8) - 1; (j - 1) * gap * 0.8 < rect.y1; j++) for (let i = Math.floor(rect.x0 / gap) - 2; (i - 1) * gap < rect.x1; i++) {
    const x = (i + 0.5 * (j & 1) + (hash(i, j) - 0.5) * 0.5) * gap, y = (j + (hash(j, i) - 0.5) * 0.4) * gap * 0.8;
    if (x < rect.x0 || x >= rect.x1 || y < rect.y0 || y >= rect.y1) continue;
    const px = Math.floor((x - ox) * R), py = Math.floor((y - oy) * R);
    if (shore[py * w + px] < 1.3 || !wide(x, y)) continue;
    waves.push({ x, y, turn: (hash(i + 3, j + 7) - 0.5) * 0.5, chance: hash(i + 11, j + 5) });
  }
  // Переход цвета между жидкостями — по картинке 2 точки на клетку; суша берёт цвет ближайшей воды, чтобы размытие не тянуло к ней.
  let kinds: AtlasBlock["kinds"] = null;
  if (keys.length > 1) {
    const data = new Uint8Array(cn), has = new Uint8Array(cn);
    for (let y = 0; y < cw; y++) for (let x = 0; x < cw; x++) { const j = (y * 2 + 1) * w + x * 2 + 1; data[y * cw + x] = kind[j]; has[y * cw + x] = wet[j]; }
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < cn; i++) if (!has[i]) {
      const x = i % cw, j = x && has[i - 1] ? i - 1 : x < cw - 1 && has[i + 1] ? i + 1 : i >= cw && has[i - cw] ? i - cw : i + cw < cn && has[i + cw] ? i + cw : -1;
      if (j >= 0) { data[i] = data[j]; has[i] = 2; }
    }
    kinds = { data, size: cw, x: ox, y: oy };
  }
  return { rect, coast: coast.filter(near), tones: tones.map(list => list.filter(near)) as [AtlasLine[], AtlasLine[]], hatch, waves, keys, kinds };
}
