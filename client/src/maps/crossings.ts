import { flattenSplineWithWidths } from "./core/spline";
import { liquidKey, liquidRecipe, riverDepth, waterLevel, type LiquidRecipe } from "./assets/village";
import type { MapRenderModel, RenderPath } from "./renderModel";

/** Переправы (решение 2026-10-08): там, где дорога «Местности» идёт над водой, движок сам кладёт мост или брод.
 * На карте переправа не хранится — она следует за дорогой и водой. Хранится только выбор Мастера
 * «здесь другое»: точка и вид в `properties.crossings` дороги. */
export const CROSSING_KINDS = { "bridge-wood": "Деревянный мост", "bridge-stone": "Каменный мост", ford: "Брод", none: "Без переправы" } as const;
export type CrossingKind = keyof typeof CROSSING_KINDS;
/** `art` — картинка переправы своего набора, если Мастер выбрал именно её; `kind` при этом — какой настил она заменяет. */
export type CrossingChoice = { x: number; y: number; kind: CrossingKind; art?: string };
/** `from`/`to` — расстояние от начала дороги, клеток; `x`/`y` — середина. */
export interface Crossing { from: number; to: number; x: number; y: number; deep: boolean; kind: CrossingKind; chosen: boolean; art?: string }
type Sample = { x: number; y: number; width: number };

/** Вода для переправы по коду материала (твёрдая жидкость, лёд, — та же суша): 0 — суша, 1 — мелко (брод), 2 — глубоко (мост). Граница — глубина 3 из 5. */
export const waterDepth = (code: string | null | undefined, own?: readonly LiquidRecipe[]) => { const level = liquidRecipe(liquidKey(code), own).solid ? 0 : waterLevel(code); return level >= 3 ? 2 : level ? 1 : 0; };

/** Выбор Мастера из свойств линии; чужое и битое отбрасывается. */
export function crossingChoices(value: unknown): CrossingChoice[] {
  return Array.isArray(value) ? value.filter((item): item is CrossingChoice => !!item && typeof item === "object" &&
    Number.isFinite(item.x) && Number.isFinite(item.y) && typeof item.kind === "string" && item.kind in CROSSING_KINDS && (item.art === undefined || typeof item.art === "string")) : [];
}
/** Выбор относится к переправе, если его точка лежит на ней или в клетке от неё: переправа съезжает вместе с дорогой и рекой. */
export const choiceFits = (choice: { x: number; y: number }, at: Pick<Crossing, "from" | "to" | "x" | "y">) =>
  Math.hypot(choice.x - at.x, choice.y - at.y) <= (at.to - at.from) / 2 + 1;

const STEP = 0.25, PAD = 0.5, GAP = 1;
const waters = new WeakMap<MapRenderModel, (x: number, y: number) => number>();
const painted = new WeakMap<MapRenderModel, (x: number, y: number) => number>();
/** Глубина воды, накрашенной кистью, в точке карты (верхний слой перекрывает нижний); реки-линии не в счёт. */
export function paintedWaterAt(model: MapRenderModel) {
  let known = painted.get(model);
  if (known) return known;
  const masks: { ox: number; oy: number; size: number; side: number; codes: readonly (string | null)[]; chunks: Map<string, readonly number[]> }[] = [];
  for (const layer of model.layers) {
    const mask = layer.visible && layer.kind === "terrain" ? layer.terrain.mask : undefined;
    if (mask?.source?.chunks.length) masks.push({ ox: mask.origin.x, oy: mask.origin.y, size: mask.sampleSize, side: Math.round(Math.sqrt(mask.source.chunks[0].values.length)),
      codes: mask.source.codes, chunks: new Map(mask.source.chunks.map(chunk => [`${chunk.cx}:${chunk.cy}`, chunk.values])) });
  }
  known = (x, y) => {
    let depth = 0;
    for (const mask of masks) {
      const sx = Math.floor((x - mask.ox) / mask.size), sy = Math.floor((y - mask.oy) / mask.size), cx = Math.floor(sx / mask.side), cy = Math.floor(sy / mask.side);
      const value = mask.chunks.get(`${cx}:${cy}`)?.[(sy - cy * mask.side) * mask.side + sx - cx * mask.side];
      if (value) depth = waterDepth(mask.codes[value - 1], model.liquids);
    }
    return depth;
  };
  painted.set(model, known);
  return known;
}
/** Вода в точке карты: закрашенная кистью и реки-линии. */
function waterAt(model: MapRenderModel) {
  let known = waters.get(model);
  if (known) return known;
  const brushed = paintedWaterAt(model);
  const rivers: { depth: number; samples: Sample[]; box: [number, number, number, number] }[] = [];
  for (const layer of model.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "path") for (const path of layer.paths) {
      if (path.kind !== "river" || !path.nodes || path.nodes.length < 2) continue;
      const samples = flattenSplineWithWidths(path.closed ? [...path.nodes, path.nodes[0]] : path.nodes, path.width ?? 0.22, STEP);
      const reach = Math.max(...samples.map(sample => sample.width)) / 2, xs = samples.map(sample => sample.x), ys = samples.map(sample => sample.y);
      rivers.push({ depth: riverDepth(path) >= 3 ? 2 : 1, samples, box: [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach] });
    }
  }
  known = (x, y) => {
    let depth = brushed(x, y);
    for (const river of rivers) {
      if (river.depth <= depth || x < river.box[0] || y < river.box[1] || x > river.box[2] || y > river.box[3]) continue;
      for (let i = 1; i < river.samples.length; i++) {
        const a = river.samples[i - 1], b = river.samples[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(x - a.x - dx * t, y - a.y - dy * t) <= (a.width + (b.width - a.width) * t) / 2) { depth = river.depth; break; }
      }
    }
    return depth;
  };
  waters.set(model, known);
  return known;
}

const NONE: readonly Crossing[] = [];
const found = new WeakMap<MapRenderModel, WeakMap<RenderPath, readonly Crossing[]>>();
/** Переправы дороги. Только у дорог-полос: линия тушью на обзорной карте мостов сама не строит.
 * ponytail: считается заново на каждую правку карты (шаг четверть клетки, реки отсекаются рамкой);
 * если карты с сотней дорог начнут тормозить — запоминать по дороге и рамке изменившейся воды. */
export function roadCrossings(model: MapRenderModel, path: RenderPath): readonly Crossing[] {
  if (path.kind !== "road" || !path.style || !path.nodes || path.nodes.length < 2) return NONE;
  let byPath = found.get(model);
  if (!byPath) found.set(model, byPath = new WeakMap());
  let result = byPath.get(path);
  if (result) return result;
  const at = waterAt(model), samples = flattenSplineWithWidths(path.closed ? [...path.nodes, path.nodes[0]] : path.nodes, path.width ?? 0.22, STEP);
  const runs: { from: number; to: number; deep: boolean }[] = [];
  let arc = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i) arc += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    const depth = at(samples[i].x, samples[i].y);
    if (!depth) continue;
    const last = runs.at(-1);
    // Островок короче клетки переправу не рвёт.
    if (last && arc - last.to < GAP) { last.to = arc; last.deep ||= depth === 2; }
    else runs.push({ from: arc, to: arc, deep: depth === 2 });
  }
  const choices = path.crossings ?? [], cut = arcs(samples);
  result = runs.map(run => {
    // Настил выходит на берег на полклетки с каждой стороны.
    const from = Math.max(0, run.from - PAD), to = Math.min(arc, run.to + PAD), middle = slice(samples, cut, (from + to) / 2, (from + to) / 2)[0];
    const crossing = { from, to, x: middle.x, y: middle.y, deep: run.deep };
    const choice = choices.filter(item => choiceFits(item, crossing)).sort((a, b) => Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y))[0];
    const auto: CrossingKind = !run.deep ? "ford" : /cobbles/.test(path.style!) ? "bridge-stone" : "bridge-wood";
    return { ...crossing, kind: choice?.kind ?? auto, chosen: !!choice, ...(choice?.art ? { art: choice.art } : {}) };
  });
  byPath.set(path, result);
  return result;
}

const arcs = (samples: readonly Sample[]) => { let run = 0; return samples.map((sample, i) => i ? run += Math.hypot(sample.x - samples[i - 1].x, sample.y - samples[i - 1].y) : 0); };
/** Кусок линии от расстояния `a` до `b` с точными концами. */
function slice(samples: readonly Sample[], length: readonly number[], a: number, b: number): Sample[] {
  const point = (s: number) => {
    let i = 1;
    while (i < samples.length - 1 && length[i] < s) i++;
    const p = samples[i - 1], q = samples[i], t = Math.max(0, Math.min(1, (s - length[i - 1]) / (length[i] - length[i - 1] || 1)));
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, width: p.width + (q.width - p.width) * t };
  };
  return [point(a), ...samples.filter((_, i) => length[i] > a + 1e-6 && length[i] < b - 1e-6), ...(b > a ? [point(b)] : [])];
}

export interface RoadCut { key: string; road: Sample[][]; decks: { kind: CrossingKind; art?: string; samples: Sample[] }[] }
/** Дорога, разрезанная переправами: куски самой дороги и настилы между ними. «Без переправы» дорогу не режет. */
export function cutRoad(samples: readonly Sample[], crossings: readonly Crossing[]): RoadCut {
  const spans = crossings.filter(crossing => crossing.kind !== "none"), length = arcs(samples), total = length.at(-1) ?? 0;
  const road: Sample[][] = [];
  let start = 0;
  for (const edge of [...spans.map(span => [span.from, span.to]), [total, total]]) {
    if (edge[0] - start > 1e-3) road.push(slice(samples, length, start, edge[0]));
    start = Math.max(start, edge[1]);
  }
  return { key: cutKey(crossings), road, decks: spans.map(span => ({ kind: span.kind, art: span.art, samples: evenDeck(slice(samples, length, span.from, Math.min(total, span.to))) })) };
}
/** Настил одной ширины: дорога, что кончается в воде, сходит на нет языком, а мост — нет. */
function evenDeck(samples: Sample[]): Sample[] {
  const width = Math.max(...samples.map(sample => sample.width));
  return samples.map(sample => ({ ...sample, width }));
}
export const cutKey = (crossings: readonly Crossing[]) => crossings.map(crossing => `${crossing.from.toFixed(3)}:${crossing.to.toFixed(3)}:${crossing.kind}:${crossing.art ?? ""}`).join("|");

const chance = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
/** Заглушка настила, пока грузится его полоса: мост — доски или камень с перилами, брод — россыпь камней. */
export function drawCrossingDraft(ctx: CanvasRenderingContext2D, kind: CrossingKind, samples: readonly Sample[], scale: number, ox: number, oy: number, ink: string) {
  if (samples.length < 2) return;
  const X = (x: number) => ox + x * scale, Y = (y: number) => oy + y * scale;
  const width = samples.reduce((sum, sample) => sum + sample.width, 0) / samples.length * scale;
  const trace = () => { ctx.beginPath(); samples.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); };
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "butt";
  if (kind !== "ford") {
    trace(); ctx.strokeStyle = ink; ctx.lineWidth = width + Math.max(3, width * 0.18); ctx.stroke();
    trace(); ctx.strokeStyle = kind === "bridge-stone" ? "#8d8a84" : "#a9773f"; ctx.lineWidth = width; ctx.stroke();
  }
  const step = kind === "bridge-wood" ? 0.3 : kind === "bridge-stone" ? 0.55 : 0.4;
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, scale * 0.04);
  let run = 0, next = step / 2, n = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    for (; length > 0 && next <= run + length; next += step, n++) {
      const t = (next - run) / length, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, half = (a.width + (b.width - a.width) * t) / 2;
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      if (kind === "ford") for (const k of [0, 1]) {
        const off = (chance(n * 2 + k) - 0.5) * half * 1.6, r = half * (0.16 + 0.14 * chance(n * 2 + k + 99)) * scale;
        ctx.beginPath(); ctx.ellipse(X(x + nx * off), Y(y + ny * off), r * 1.3, r, chance(n + k) * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = "#a8a498"; ctx.fill(); ctx.stroke();
      } else {
        // Камень — кладка вперевязку: поперечина через одну доходит только до середины.
        const reach = kind === "bridge-stone" && n % 2 ? 0 : half;
        ctx.beginPath(); ctx.moveTo(X(x - nx * half), Y(y - ny * half)); ctx.lineTo(X(x + nx * reach), Y(y + ny * reach)); ctx.stroke();
      }
    }
    run += length;
  }
  ctx.restore();
}
