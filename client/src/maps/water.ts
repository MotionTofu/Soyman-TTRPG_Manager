import { flattenSplineWithWidths } from "./core/spline";
import type { MapRenderModel } from "./renderModel";
import type { MapObject } from "./core/types";
import { LIQUID_PATTERNS, LIQUID_RIMS, liquidKey, liquidRecipe, type LiquidRecipe, riverDepth, waterLevel } from "./assets/village";
import { cryptSide } from "./assets/crypt";
import { drawCachedMapImage, drawCachedMapSymbol } from "./assets/draw";
import { cutRoad, roadCrossings } from "./crossings";
import { pixelToCell } from "./grid";
import type { MapGrid } from "./mapTypes";

/** Вода шейдером (проба 2026-10-08). `mode`: 0 — комикс-панк, 1 — пиксельный пруд, 2 — пиксельное море, 3 — мягкая с дном;
 * `size` — пикселей на клетку у пиксельных. */
export interface MapWater { mode: 0 | 1 | 2 | 3; speed: number; size: number; shoal: number;
  /** Свои рецепты на время правки: пока тянут ползунок или выбирают цвет, карта не меняется — меняется только таблица рецептов. */
  liquids?: readonly LiquidRecipe[];
  /** Время для неподвижного кадра, секунд; без него — 0. Пруд-превью на экране набора крутит его сам. */ time?: number }

/** Точек маски на клетку. Маска — вся карта одной картинкой: красный канал — «здесь вода», зелёный — глубина (1–5 пятыми долями),
 * синий — «ближайший берег песчаный»: у пляжа пена шире, у травы и камня берег резче.
 * В синем канале картинки течения — номер жидкости ×32 (вода — 0), без размытия; +16 — под жидкостью накрашена земля. */
const K = 4;
/** Левый верхний угол карты. Маски воды строятся от него: у гексов карта начинается с −1. Шейдер работает в сдвинутых
 * координатах — сдвиг уходит в начало отсчёта экрана, сам шейдер о нём не знает. */
const ZERO: { readonly x: number; readonly y: number } = { x: 0, y: 0 };

/** Туман у игрока: закрытые клетки пришли с сервера пустыми — это не берег. Без тумана или у Мастера — `null`. */
export type WaterFog = { grid: MapGrid; width: number; height: number; revealed: ReadonlySet<string> } | null;
export const waterFog = (o: { playerView?: boolean; grid: MapGrid; width: number; height: number }, model: MapRenderModel): WaterFog =>
  o.playerView && model.exploration?.enabled ? { grid: o.grid, width: o.width, height: o.height, revealed: model.exploration.revealedCells } : null;

/** Из чего собрана маска воды. Пока список тот же, маску не пересобирают: перетаскивание фишки или подписи воду не меняет,
 * а пересборка — это вся карта заново и отправка картинки видеокарте на каждый шаг руки. */
export function waterSources(model: MapRenderModel, width: number, height: number, shoal = 0, lo = ZERO, fog: WaterFog = null): readonly unknown[] {
  // Рецептов здесь нет: от них зависит только таблица 5×8, её обновляет `drawLiquidRecipes`.
  const out: unknown[] = [width, height, shoal, lo.x, lo.y, fog?.revealed];
  for (const layer of model.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "terrain" && layer.terrain.mask?.source) out.push(layer.terrain.mask.source);
    if (layer.kind === "path") for (const path of layer.paths) if (path.kind === "river" && path.style && path.nodes) out.push(path.nodes, path.width, path.style, path.closed, path.flow, path.depth, path.liquid);
  }
  return out;
}

/**
 * Где на карте вода: поверхности воды из плавных слоёв и реки, залитые водой.
 * Края размыты на полклетки — по этому градиенту шейдер рисует берег и пену.
 * `shoal` — отмель в клетках: у берега глубина 1 и набирает свою на этом расстоянии, так вода глубже к середине.
 */
export function drawWaterMask(canvas: HTMLCanvasElement, raw: HTMLCanvasElement, flow: HTMLCanvasElement, recipes: HTMLCanvasElement, model: MapRenderModel, width: number, height: number, shoal = 0, lo: { x: number; y: number } = ZERO, fog: WaterFog = null): boolean {
  const w = Math.max(1, Math.ceil((width - lo.x) * K)), h = Math.max(1, Math.ceil((height - lo.y) * K));
  for (const target of [canvas, raw, flow]) if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const pen = raw.getContext("2d"), out = canvas.getContext("2d"), stream = flow.getContext("2d");
  if (!pen || !out || !stream) return false;
  const image = pen.createImageData(w, h), data = image.data, kinds = new Uint8Array(w * h), floor = new Uint8Array(w * h);
  let any = false;
  // Строки рецептов раздаются по жидкостям этой карты: вода — нулевая, остальные по мере встречи. Строк восемь,
  // поэтому на карте умещается вода и ещё семь жидкостей; восьмая лишняя делит строку с седьмой.
  const rows = ["water"], rowOf = (key: string) => { const row = rows.indexOf(key); return row >= 0 ? row : rows.length < 8 ? rows.push(key) - 1 : 7; };
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const layer of model.layers) {
    const mask = layer.kind === "terrain" && layer.visible ? layer.terrain.mask : undefined;
    if (!mask?.source) continue;
    const step = mask.sampleSize * K, codes = mask.source.codes;
    // Код материала разбирается один раз на материал, при первой встрече, а не на каждый отсчёт: на большой карте отсчётов
    // сотни тысяч, и разбор съедал больше половины сборки маски на каждом шаге кисти.
    const looks: ({ depth: number; beach: number; row: number } | undefined)[] = [];
    for (const chunk of mask.source.chunks) for (let i = 0; i < chunk.values.length; i++) {
      const value = chunk.values[i];
      if (!value) continue;
      // Закрашенный отсчёт верхнего слоя перекрывает воду нижнего, даже если сам не вода.
      let look = looks[value - 1];
      if (!look) { const code = codes[value - 1], level = waterLevel(code); look = looks[value - 1] = { depth: level, beach: /^village-sand/.test(code ?? "") ? 255 : 0, row: level ? rowOf(liquidKey(code)) : 0 }; }
      const { depth, beach, row } = look;
      const x0 = Math.round((mask.origin.x - lo.x + (chunk.cx * 16 + i % 16) * mask.sampleSize) * K), y0 = Math.round((mask.origin.y - lo.y + (chunk.cy * 16 + Math.floor(i / 16)) * mask.sampleSize) * K);
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + Math.max(1, Math.round(step))); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + Math.max(1, Math.round(step))); x++) {
        const at = (y * w + x) * 4; data[at] = depth ? 255 : 0; data[at + 1] = depth * 51; kinds[at / 4] = row;
        // Жидкость дно не стирает: под ней остаётся то, что накрашено слоем ниже.
        if (!depth) { data[at + 2] = beach; floor[at / 4] = 1; }
      }
      any ||= depth > 0;
    }
  }
  // У игрока вода продолжается в пустоту закрытых клеток (и за край карты) на полторы клетки: иначе край тумана стал бы берегом
  // с мелководьем и штриховкой. Данных это не добавляет — под туманом вода выдумана и закрыта.
  if (fog && any) {
    const reach = new Float32Array(w * h).fill(1e6), from = new Int32Array(w * h).fill(-1), open = new Uint8Array(w * h);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (data[i * 4]) { reach[i] = 0; from[i] = i; continue; }
      const cell = floor[i] ? null : pixelToCell(fog.grid, lo.x + (x + 0.5) / K, lo.y + (y + 0.5) / K, fog.width, fog.height);
      open[i] = floor[i] || cell && fog.revealed.has(`${cell.x},${cell.y}`) ? 0 : 1;
    }
    const spread = (i: number, j: number, cost: number) => { if (open[i] && reach[j] + cost < reach[i]) { reach[i] = reach[j] + cost; from[i] = from[j]; } };
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (x) spread(i, i - 1, 1); if (y) spread(i, i - w, 1); if (x && y) spread(i, i - w - 1, 1.4); if (y && x < w - 1) spread(i, i - w + 1, 1.4);
    }
    for (let y = h - 1, i = w * h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) {
      if (x < w - 1) spread(i, i + 1, 1); if (y < h - 1) spread(i, i + w, 1); if (x < w - 1 && y < h - 1) spread(i, i + w + 1, 1.4); if (y < h - 1 && x) spread(i, i + w - 1, 1.4);
    }
    for (let i = 0; i < reach.length; i++) if (open[i] && from[i] >= 0 && reach[i] <= K * 1.5) {
      data[i * 4] = data[from[i] * 4]; data[i * 4 + 1] = data[from[i] * 4 + 1]; kinds[i] = kinds[from[i]];
    }
  }
  pen.putImageData(image, 0, 0);
  pen.lineCap = pen.lineJoin = "round";
  const rivers = model.layers.flatMap(layer => layer.kind === "path" && layer.visible ? layer.paths : [])
    .flatMap(path => path.kind === "river" && path.style && path.nodes && path.nodes.length > 1
      ? [{ path, samples: flattenSplineWithWidths(path.closed ? [...path.nodes, path.nodes[0]] : path.nodes, path.width ?? 0.22, 0.25) }] : []);
  /** Обводит реку по отрезкам; `extra` — прибавка к ширине в клетках, `ink` — цвет отрезка по его направлению. */
  const stroke = (samples: typeof rivers[number]["samples"], extra: number, ink?: (dx: number, dy: number) => string) => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      if (ink) pen.strokeStyle = ink((b.x - a.x) / length, (b.y - a.y) / length);
      pen.lineWidth = ((a.width + b.width) / 2 + extra) * K;
      pen.beginPath(); pen.moveTo((a.x - lo.x) * K, (a.y - lo.y) * K); pen.lineTo((b.x - lo.x) * K, (b.y - lo.y) * K); pen.stroke();
    }
  };
  for (const { path, samples } of rivers) {
    pen.strokeStyle = `rgb(255,${riverDepth(path) * 51},0)`;
    stroke(samples, 0);
    any = true;
    // Река не из воды: её точки получают номер своей жидкости — по кругам вдоль линии, как её и обводит перо.
    if (!path.liquid) continue;
    const row = rowOf(path.liquid);
    for (const sample of samples) {
      const r = sample.width / 2 * K + 1, cx = (sample.x - lo.x) * K, cy = (sample.y - lo.y) * K;
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) kinds[y * w + x] = row;
    }
  }
  rowsOf.set(recipes, rows); drawLiquidRecipes(recipes, model.liquids);
  if (any) {
    // Расстояние до суши двумя проходами (шаг по прямой 1, по диагонали 1,4). Край карты сушей не считается: море уходит за него.
    // Вместе с расстоянием вода узнаёт, какой у неё ближайший берег.
    const wet = pen.getImageData(0, 0, w, h), px = wet.data, far = new Float32Array(w * h);
    for (let i = 0; i < far.length; i++) far[i] = px[i * 4] > 127 ? 1e6 : 0;
    const near = (i: number, x: number, y: number, dx: number, dy: number, cost: number) => {
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) return;
      const from = i + dy * w + dx;
      // Где дно накрашено, вода знает его сама; иначе судит по ближайшему берегу.
      if (far[from] + cost < far[i]) { far[i] = far[from] + cost; if (!floor[i]) px[i * 4 + 2] = px[from * 4 + 2]; }
    };
    // Суша (расстояние 0) не меняется — её пропускаем сразу: на материке это большая часть карты.
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (far[i]) { near(i, x, y, -1, 0, 1); near(i, x, y, 0, -1, 1); near(i, x, y, -1, -1, 1.4); near(i, x, y, 1, -1, 1.4); }
    for (let y = h - 1, i = w * h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) if (far[i]) { near(i, x, y, 1, 0, 1); near(i, x, y, 0, 1, 1); near(i, x, y, 1, 1, 1.4); near(i, x, y, -1, 1, 1.4); }
    if (shoal > 0) for (let i = 0; i < far.length; i++) if (px[i * 4 + 1] > 51) px[i * 4 + 1] = Math.round(51 + (px[i * 4 + 1] - 51) * Math.min(1, far[i] / (shoal * K)));
    pen.putImageData(wet, 0, 0);
    // Номер жидкости заходит на клетку на сушу: размытый и рваный край шире закрашенного, и без этого у лавы была бы водяная кайма.
    for (let pass = 0; pass < K; pass++) {
      const was = kinds.slice();
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (!far[i] && !was[i])
        kinds[i] = Math.max(x ? was[i - 1] : 0, x < w - 1 ? was[i + 1] : 0, y ? was[i - w] : 0, y < h - 1 ? was[i + w] : 0);
    }
  }
  out.filter = `blur(${K * 0.4}px)`; out.drawImage(raw, 0, 0); out.filter = "none";
  // Течение — вторая картинка: красный — снос вправо, зелёный — вниз, ровный серый — стоячая вода.
  // Полоса на клетку шире реки: воду всё равно ограничивает маска, зато узкая река после размытия не теряет течение.
  const calm = "rgb(128,128,0)";
  pen.fillStyle = calm; pen.fillRect(0, 0, w, h);
  for (const { path, samples } of rivers) {
    if (path.closed || path.flow === "still") continue;
    const sign = path.flow === "back" ? -127 : 127;
    stroke(samples, 1, (dx, dy) => `rgb(${Math.round(128 + sign * dx)},${Math.round(128 + sign * dy)},0)`);
  }
  stream.fillStyle = calm; stream.fillRect(0, 0, w, h);
  stream.filter = `blur(${K * 0.5}px)`; stream.drawImage(raw, 0, 0); stream.filter = "none";
  if (any) {
    const kinded = stream.getImageData(0, 0, w, h);
    for (let i = 0; i < kinds.length; i++) kinded.data[i * 4 + 2] = kinds[i] * 32 + (floor[i] ? 16 : 0);
    stream.putImageData(kinded, 0, 0);
  }
  return any;
}

/** Точек на клетку у картинки «что стоит в воде»: пена идёт по контуру рисунка, а не по клеткам. */
const THINGS_K = 8;
/** Вещи «Деревни», которые лежат на самой воде: пены вокруг них нет, пока Мастер не снимет «не трогать воду». */
const FLOATERS = new Set(["lilies", "lilies-small", "lily-flower", "duckweed", "algae", "leaves", "fish", "ripples", "gas-bubbles", "lava-crust", "ice-hole"]
  .map(key => `soyman-village:${key}`));
/** Вода не замечает объект: так отмечено у него или это вещь, лежащая на воде. */
export const ignoresWater = (object: MapObject) => typeof object.properties?.dry === "boolean" ? object.properties.dry
  : object.visual.type === "asset" && FLOATERS.has(object.visual.assetId);
/** Объекты, которые вода замечает (гриллинг 2026-10-15, В7, В9): все, кроме отмеченных «не трогать воду», и мосты дорог.
 * Брод — мелководье, у него пены нет. Фишки не входят (В10): они двигаются постоянно. */
function* waterThings(model: MapRenderModel) {
  for (const layer of model.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "object") for (const item of layer.items) if (!ignoresWater(item.object)) yield { kind: "object", item } as const;
    if (layer.kind === "path") for (const path of layer.paths) {
      const crossings = roadCrossings(model, path);
      if (crossings.some(crossing => crossing.kind === "bridge-wood" || crossing.kind === "bridge-stone")) yield { kind: "bridge", path, crossings } as const;
    }
  }
}
/** Из чего собрана картинка «что стоит в воде». Объект неизменен, пока его не правили; картинка учитывается, когда догрузилась. */
export function waterThingSources(model: MapRenderModel, width: number, height: number, lo = ZERO): readonly unknown[] {
  const out: unknown[] = [width, height, lo.x, lo.y];
  for (const thing of waterThings(model)) {
    if (thing.kind === "object") out.push(thing.item.object, "image" in thing.item.asset ? thing.item.asset.image : thing.item.asset);
    else out.push(thing.path.nodes, thing.path.width, thing.crossings.map(crossing => `${crossing.from}:${crossing.to}:${crossing.kind}`).join("|"));
  }
  return out;
}
let thingScratch: HTMLCanvasElement | null = null;
/**
 * Картинка «что стоит в воде»: красный — контур, размытый на треть клетки (кольцо пены), зелёный — размытый
 * на клетку (рябь), синий — сам контур. Шейдер читает её только там, где вода, поэтому объекты на суше ничего не меняют.
 */
export function drawWaterThings(canvas: HTMLCanvasElement, model: MapRenderModel, width: number, height: number, lo: { x: number; y: number } = ZERO): void {
  const w = Math.max(1, Math.ceil((width - lo.x) * THINGS_K)), h = Math.max(1, Math.ceil((height - lo.y) * THINGS_K));
  const shape = thingScratch ??= document.createElement("canvas");
  for (const target of [canvas, shape]) if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const pen = shape.getContext("2d"), out = canvas.getContext("2d");
  if (!pen || !out) return;
  pen.setTransform(1, 0, 0, 1, 0, 0); pen.clearRect(0, 0, w, h);
  pen.setTransform(THINGS_K, 0, 0, THINGS_K, -lo.x * THINGS_K, -lo.y * THINGS_K);
  pen.lineCap = pen.lineJoin = "round"; pen.strokeStyle = "#fff";
  for (const thing of waterThings(model)) {
    if (thing.kind === "object") {
      const { object, asset } = thing.item, { position, scale } = object.transform;
      let { rotation } = object.transform;
      // Как на карте: вид по стороне не крутится.
      const base = "image" in asset ? asset : null, side = base?.views?.[cryptSide(rotation)] ?? null, view = side && (side.image || !base?.image) ? side : null;
      if (view) rotation = 0;
      const art = view ? view.image : base?.image ?? null;
      pen.save(); pen.translate(position.x, position.y); pen.rotate(rotation * Math.PI / 180); pen.scale(scale.x, scale.y);
      if ("glyph" in asset) drawCachedMapSymbol(pen, asset);
      else if (art) drawCachedMapImage(pen, art, Math.max(Math.abs(scale.x), Math.abs(scale.y)) * THINGS_K);
      else pen.fillRect(-0.5, -0.5, 1, 1);
      pen.restore();
    } else {
      const { path, crossings } = thing, nodes = path.nodes!;
      const samples = flattenSplineWithWidths(path.closed ? [...nodes, nodes[0]] : nodes, path.width ?? 0.22, 0.25);
      for (const deck of cutRoad(samples, crossings).decks) {
        if (deck.kind !== "bridge-wood" && deck.kind !== "bridge-stone") continue;
        for (let i = 1; i < deck.samples.length; i++) {
          const a = deck.samples[i - 1], b = deck.samples[i];
          pen.lineWidth = (a.width + b.width) / 2; pen.beginPath(); pen.moveTo(a.x, a.y); pen.lineTo(b.x, b.y); pen.stroke();
        }
      }
    }
  }
  // Цвет рисунка не важен — только где он есть.
  pen.setTransform(1, 0, 0, 1, 0, 0); pen.globalCompositeOperation = "source-in"; pen.fillStyle = "#fff"; pen.fillRect(0, 0, w, h); pen.globalCompositeOperation = "source-over";
  const alpha = (blur: number) => {
    out.setTransform(1, 0, 0, 1, 0, 0); out.clearRect(0, 0, w, h);
    out.filter = blur ? `blur(${blur}px)` : "none"; out.drawImage(shape, 0, 0); out.filter = "none";
    const data = out.getImageData(0, 0, w, h).data, values = new Uint8Array(w * h);
    for (let i = 0; i < values.length; i++) values[i] = data[i * 4 + 3];
    return values;
  };
  const near = alpha(THINGS_K * 0.33), wide = alpha(THINGS_K), body = alpha(0);
  const image = out.createImageData(w, h);
  for (let i = 0; i < near.length; i++) image.data.set([near[i], wide[i], body[i], 255], i * 4);
  out.putImageData(image, 0, 0);
}

const rowsOf = new WeakMap<HTMLCanvasElement, readonly string[]>();
/** Перерисовать таблицу рецептов, не трогая маску: строки остаются теми, что раздала последняя сборка маски. */
export function drawLiquidRecipes(recipes: HTMLCanvasElement, liquids?: readonly LiquidRecipe[]) {
  drawRecipes(recipes, (rowsOf.get(recipes) ?? ["water"]).map(key => liquidRecipe(key, liquids)));
}
const tone = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
/** Рецепты жидкостей картинкой 6×8: строка — номер жидкости в маске, столбцы читает `recipe()` шейдера.
 * Картинка, а не массив чисел: так рецепт одинаково доходит и до сцены WebGL, и до обычного холста. */
function drawRecipes(recipes: HTMLCanvasElement, rows: readonly LiquidRecipe[]) {
  recipes.width = 6; recipes.height = 8;
  const pen = recipes.getContext("2d");
  if (!pen) return;
  const image = pen.createImageData(6, 8);
  const patterns = Object.keys(LIQUID_PATTERNS), rims = Object.keys(LIQUID_RIMS);
  rows.forEach((item, row) => {
    const cells = [...item.tones.map(tone), [item.pace / 2 * 255, item.size / 4 * 255, item.bed * 255],
      [patterns.indexOf(item.pattern) / 8 * 255, rims.indexOf(item.rim) / 8 * 255, item.glow * 255], [(item.shore ?? 0.4) * 255, (item.ragged ?? 0.4) * 255, 0]];
    cells.forEach((cell, column) => image.data.set([...cell.map(Math.round), 255], (row * 6 + column) * 4));
  });
  pen.putImageData(image, 0, 0);
}

// Вода считается из координат карты: не повторяется, не мутнеет при приближении и движется.
// Пиксельные виды двигаются рывками, а не плавно: покадровая анимация ближе к рисованной карте.
/** Общая часть шейдера: по точке карты и времени отдаёт цвет воды. Ею рисуют и сцена WebGL, и обычный холст. */
export const WATER_GLSL = `
const float MASK_K = ${K}.0;
uniform sampler2D uMask;
uniform sampler2D uFlow;
uniform sampler2D uRecipe;
uniform sampler2D uThings;
uniform vec2 uMap;
// Настройки жидкости, которую сейчас рисует вид: насколько видно дно и есть ли пена у кромки.
float gBed = 1.0, gFoam = 1.0;
// Дно (гриллинг 2026-10-15, В2–В4): земля под жидкостью — её отдаёт тот, кто рисует (сцена WebGL или обычный холст).
// gUnder — земля, уже обработанная видом воды; gClear — насколько она видна; gTop — сколько поверх лежит пены, туши и бликов:
// они остаются над дном. gGround — какая доля точки накрашена под жидкостью (0…1): где 0, вид рисует дно сам, как раньше.
vec4 groundAt(vec2 world);
vec3 gUnder = vec3(0.0);
float gClear = 0.0, gTop = 0.0;
float gGround = 0.0;
vec3 gGlow = vec3(0.0);
// Рецепт жидкости — строка картинки: три тона, потом (подвижность/2, крупность/4, дно), (рисунок/8, кромка/8, свечение)
// и (ширина берега, рваность берега).
vec3 recipe(float kind, float column) { return texture(uRecipe, vec2((column + 0.5) / 6.0, (kind + 0.5) / 8.0)).rgb; }
uniform vec3 uWater;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Глубина в точке, 0…1: среднее по кругу в полторы клетки. Так граница между глубинами расплывается в плавный
// переход, а у берега вода сама мелеет — вокруг суша с нулевой глубиной.
float depthAt(vec2 c) {
  float sum = texture(uMask, c / uMap).g * 2.0;
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.7854; sum += texture(uMask, (c + 1.5 * vec2(cos(a), sin(a))) / uMap).g; }
  return sum / 10.0;
}
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// Берег (гриллинг 2026-10-15, В6): ширина перехода и рваность из рецепта. Рваность — сдвиг точки, в которой читается
// маска воды, шумом в три октавы до клетки: береговая линия рвётся, а глубина и номер жидкости остаются на месте.
// Клетка — столько номер жидкости заходит на сушу, дальше лава получила бы водяные зубцы.
float gShore = 0.4, gRagged = 0.4;
void shoreOf(float kind) { vec3 s = recipe(kind, 5.0); gShore = s.r; gRagged = s.g; }
vec3 shoreMask(vec2 w) {
  vec2 d = vec2(noise(w * 1.1) * 0.55 + noise(w * 3.3 + 3.0) * 0.3 + noise(w * 8.7 + 5.0) * 0.15,
    noise(w * 1.1 + 7.0) * 0.55 + noise(w * 3.3 + 11.0) * 0.3 + noise(w * 8.7 + 13.0) * 0.15) - 0.5;
  return texture(uMask, (w + d * 2.0 * gRagged) / uMap).rgb;
}
// Ширина берега растягивает полосы у кромки: пену, прибой, мягкий переход. 0,4 — как было до ручки.
float reachK() { return 0.6 + gShore; }
// Сколько дна видно: ручка рецепта «Дно» и глубина. На мели почти всё, к глубине 5 — ничего; всегда с подкраской водой.
float clarity(float depth) { return gBed * (1.0 - smoothstep(0.1, 0.9, depth)); }
// Земля в точке, подкрашенная водой; false — земли нет, и дно рисуется видом.
bool under(vec2 at, vec3 tint) {
  if (gGround <= 0.0) return false;
  vec4 g = groundAt(at);
  if (g.a < 0.5) return false;
  gUnder = g.rgb * tint;
  return true;
}
// Расстояние до границы ячейки: по нему рисуется сетка бликов.
float cellEdge(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p), mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)), r = g + 0.5 + 0.4 * sin(t + 6.2831 * hash2(n + g)) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)), r = g + 0.5 + 0.4 * sin(t + 6.2831 * hash2(n + g)) - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}

// У каждого вида две точки: w — место на карте (берег, глубина, дно), s — откуда брать рисунок волн.
// В стоячей воде они совпадают, в реке рисунок сносит течением.
// Комикс-панк: плоская заливка, пятна, толстые дуги волн, тушевый берег и рваная пена.
vec4 comic(vec2 w, vec2 s, float t) {
  vec3 mk = shoreMask(w);
  float edge = mk.r + (noise(w * 2.7) - 0.5) * 0.14;
  // Порог ниже середины: шейдер закрывает и размытый край картинки воды под собой.
  float a = smoothstep(0.38, 0.44, edge);
  if (a <= 0.0) return vec4(0.0);
  float tick = floor(t * 5.0), d = depthAt(w);
  float deep = smoothstep(0.25, 0.8, d);
  vec3 col = mix(vec3(0.19, 0.62, 0.56), vec3(0.11, 0.36, 0.44), deep);
  col *= 1.0 - 0.13 * step(0.6, noise(s * 0.8 + vec2(tick * 0.07, 3.0)));
  // Дно — одной ступенью: где мелко, земля под плоской подкраской, глубже — сплошная вода.
  if (under(w, vec3(0.62, 0.86, 0.84))) gClear = step(0.35, clarity(d)) * 0.62;
  vec3 ink = vec3(0.09, 0.09, 0.1);
  // Ряды дуг: в каждом ряду свой сдвиг, часть дуг пропущена, редкие — белые блики.
  vec2 q = vec2(s.x * 1.5 - tick * 0.12, s.y * 2.4 + 0.5 * sin(s.x * 0.9));
  float row = floor(q.y), x = q.x + hash(vec2(row, 3.0)) * 9.0, seg = floor(x), fx = fract(x), fy = fract(q.y) - 0.5;
  float arc = abs(fy - 0.2 * sin(fx * 3.14159) + 0.1);
  float body = step(0.14, fx) * step(fx, 0.86) * step(arc, 0.075 + 0.03 * hash(vec2(seg, row + 5.0)));
  float kind = hash(vec2(seg, row));
  col = mix(col, ink, body * step(0.55, kind) * (1.0 - step(0.9, kind)));
  col = mix(col, vec3(0.93, 0.98, 0.95), body * step(0.9, kind));
  gTop = max(gTop, body * step(0.55, kind));
  // Берег: внутри воды полоска пены, по самой кромке — тушь.
  float shore = smoothstep(0.45, 1.0, mk.r);
  float foam = step(shore, (0.14 + 0.24 * mk.b + 0.12 * noise(vec2(s.x * 3.0 + tick * 0.4, s.y * 3.0))) * reachK()) * step(0.35, noise(s * 5.0 + tick));
  col = mix(col, vec3(0.93, 0.98, 0.95), foam * gFoam);
  col = mix(col, ink, 1.0 - smoothstep(0.43, 0.5, edge));
  gTop = max(gTop, max(foam * gFoam, 1.0 - smoothstep(0.43, 0.5, edge)));
  return vec4(col, a);
}

// Пиксель-арт: всё считается по целым «пикселям» карты. Два вида, у каждого своя шкала тонов от мели до омута.
// Пруд — плоские пятна дна и светлая сетка бликов, которая с глубиной редеет.
// Шейдер собирается как GLSL ES 1.00: массивов-констант там нет, шкала тонов — лесенкой условий.
vec3 pondTone(float i) { return i < 0.5 ? vec3(0.45, 0.78, 0.66) : i < 1.5 ? vec3(0.35, 0.68, 0.6) : i < 2.5 ? vec3(0.25, 0.56, 0.51) : i < 3.5 ? vec3(0.18, 0.44, 0.41) : i < 4.5 ? vec3(0.13, 0.34, 0.36) : vec3(0.09, 0.25, 0.3); }
vec3 pond(vec2 c, float t, float depth) {
  float n = noise(c * 0.9 + vec2(t * 0.05, 0.0)) * 0.65 + noise(c * 2.3 - vec2(0.0, t * 0.04)) * 0.35;
  float tone = clamp(floor((1.0 - n) * 1.8 + depth * 5.2 - 1.1), 0.0, 5.0);
  vec3 col = pondTone(tone);
  vec2 q = c * 0.6 + 0.18 * vec2(noise(c * 1.3 + t * 0.15), noise(c * 1.3 + 7.0 - t * 0.15));
  float edge = cellEdge(q, t * 0.5);
  // Линия бликов местами рвётся и местами белеет — как на рисованной воде.
  float lit = noise(c * 0.7 + 11.0 + t * 0.1);
  if (edge < 0.035 && lit > 0.25 + depth * 0.3) col = lit > 0.72 && depth < 0.6 ? vec3(0.86, 0.96, 0.92) : pondTone(max(tone - 2.0, 0.0)) + 0.1;
  return col;
}
// Море — короткие горизонтальные штрихи, бегущие рядами; на мели бирюза, на глубине густой синий.
vec3 seaTone(float i) { return i < 0.5 ? vec3(0.62, 0.88, 0.85) : i < 1.5 ? vec3(0.45, 0.79, 0.81) : i < 2.5 ? vec3(0.31, 0.68, 0.79) : i < 3.5 ? vec3(0.23, 0.57, 0.75) : i < 4.5 ? vec3(0.17, 0.46, 0.69) : i < 5.5 ? vec3(0.13, 0.36, 0.6) : vec3(0.1, 0.27, 0.5); }
vec3 sea(vec2 p, float tick, float depth) {
  float row = p.y, speed = 0.4 + hash(vec2(row, 9.0));
  float dash = hash(vec2(floor((p.x + hash(vec2(row, 3.0)) * 40.0 + tick * speed) / (3.0 + floor(hash(vec2(row, 5.0)) * 5.0))), row));
  float swell = noise(vec2(p.x * 0.04, p.y * 0.22) + vec2(tick * 0.03, 0.0));
  float v = swell * 0.65 + dash * 0.35;
  float tone = clamp(floor((1.0 - v) * 3.2 + depth * 4.4 - 1.1), 0.0, 6.0);
  return dash > 0.95 && swell > 0.45 ? mix(seaTone(max(tone - 3.0, 0.0)), vec3(1.0), 0.25) : seaTone(tone);
}
vec4 pixel(vec2 w, vec2 s, float t, bool isSea) {
  float P = uWater.z;
  vec2 p = floor(w * P), c = (p + 0.5) / P, ps = floor(s * P);
  vec3 mk = shoreMask(c);
  if (mk.r < 0.4) return vec4(0.0);
  float tick = floor(t * 6.0);
  // Ступени тонов на границе глубин ломаются шахматным смешением.
  float depth = depthAt(c) + (mod(p.x + p.y, 2.0) - 0.5) * 0.07;
  vec3 col = isSea ? sea(ps, tick, depth) : pond((ps + 0.5) / P, tick / 6.0, depth);
  if (under(c, isSea ? vec3(0.78, 0.92, 0.95) : vec3(0.75, 0.92, 0.86))) gClear = clarity(depth) * 0.85;
  // Пена у берега: сплошная кромка в один пиксель и рваная полоса за ней — у пляжа широкая, у травы узкая.
  float shore = smoothstep(0.4, 1.0, mk.r), reach = (0.14 + 0.3 * step(0.5, mk.b)) * reachK();
  float foam = gFoam * min(1.0, step(shore, 0.1) + step(shore, reach) * step(0.6, hash(p + tick)));
  col = mix(col, vec3(0.9, 0.98, 0.95), foam);
  gTop = max(gTop, foam);
  return vec4(col, 1.0);
}

// Мягкая: без пикселей и без туши. Цвет плавно темнеет с глубиной, на мели просвечивает песчаное дно с камешками,
// по воде плывут тонкие светлые кольца бликов.
vec4 soft(vec2 w, vec2 s, float t) {
  vec3 mk = shoreMask(w);
  float a = smoothstep(0.4 - 0.1 * gShore, 0.46 + 0.1 * gShore, mk.r);
  if (a <= 0.0) return vec4(0.0);
  float depth = depthAt(w);
  vec3 col = mix(vec3(0.56, 0.84, 0.8), vec3(0.2, 0.47, 0.7), smoothstep(0.08, 0.85, depth));
  vec2 sway = 0.05 * vec2(noise(w * 1.7 + t * 0.5) - 0.5, noise(w * 1.7 + 9.0 - t * 0.5) - 0.5);
  // Своё дно и нарисованное песчаное сменяют друг друга по доле накрашенного (gGround), а не скачком: иначе граница шла
  // ступенями по точкам маски вдоль всего берега.
  float own = under(w + sway, vec3(0.72, 0.9, 0.92)) ? gGround : 0.0;
  if (own > 0.0) gClear = clarity(depth) * 0.78;
  if (own < 1.0) {
    float bed = noise(w * 3.0) * 0.5 + noise(w * 7.0 + 4.0) * 0.5;
    vec3 bottom = mix(vec3(0.87, 0.8, 0.58), vec3(0.6, 0.56, 0.44), smoothstep(0.58, 0.66, bed));
    col = mix(mix(bottom, col, mix(1.0, 0.3 + 0.7 * smoothstep(0.04, 0.42, depth), gBed)), col, own);
  }
  vec2 q = s * 0.9 + 0.2 * vec2(noise(s * 1.1 + t * 0.2), noise(s * 1.1 + 5.0 - t * 0.2));
  float line = (1.0 - smoothstep(0.0, 0.05, cellEdge(q, t * 0.6))) * (0.6 - 0.35 * depth) * smoothstep(0.25, 0.6, noise(s * 0.6 + t * 0.1 + 3.0));
  col = mix(col, vec3(0.94, 1.0, 0.97), line);
  gTop = max(gTop, line);
  // Прибой: светлая полоска у самой кромки, дышит. У пляжа она широкая, у травы и камня — тонкая, а под ней тень берега.
  float rim = 1.0 - smoothstep(0.5, 0.5 + (0.06 + 0.16 * mk.b + 0.04 * sin(t * 1.5 + w.x * 2.0 + w.y)) * reachK(), mk.r);
  col *= 1.0 - 0.3 * (1.0 - mk.b) * (1.0 - smoothstep(0.5, 0.8, mk.r));
  col = mix(col, vec3(0.96, 0.98, 0.9), gFoam * rim * (0.45 + 0.3 * mk.b));
  gTop = max(gTop, gFoam * rim * (0.45 + 0.3 * mk.b));
  return vec4(col, a);
}

// Другие жидкости — та же вода, перекрашенная по яркости в свою шкалу: тёмное, среднее, светлое. Рисунок вида
// (пиксели, дуги, блики) остаётся, поэтому лава в пиксельной карте пиксельная, а блики на ней — раскалённые трещины.
// Рисунок поверхности pattern: 0 — рябь (родной рисунок вида), 1 — трещины, 2 — пузыри, 3 — туман, 4 — гладь.
// Всё, кроме ряби, приглушает родной рисунок и кладёт своё поверх; p — точка рисунка, t — время жидкости.
vec3 liquid(vec3 c, float kind, vec2 p, float t) {
  if (kind < 0.5) return c;
  vec3 lo = recipe(kind, 0.0), mid = recipe(kind, 1.0), hi = recipe(kind, 2.0);
  float pattern = floor(recipe(kind, 4.0).r * 8.0 + 0.5);
  float x = clamp((dot(c, vec3(0.3, 0.59, 0.11)) - 0.25) / 0.7, 0.0, 1.0);
  x = mix(x, 0.4, pattern < 0.5 ? 0.0 : pattern < 1.5 ? 0.6 : pattern < 2.5 ? 0.4 : pattern < 3.5 ? 0.55 : 0.8);
  vec3 col = x < 0.5 ? mix(lo, mid, x * 2.0) : mix(mid, hi, x * 2.0 - 1.0);
  if (pattern > 0.5 && pattern < 1.5) {
    // Трещины: крупная сетка и мелкая паутина поверх неё.
    float big = 1.0 - smoothstep(0.0, 0.045, cellEdge(p * 0.55, 0.0)), fine = 1.0 - smoothstep(0.0, 0.03, cellEdge(p * 1.7 + 9.0, 0.0));
    col = mix(col, hi, max(big * 0.85, fine * 0.35));
  } else if (pattern > 1.5 && pattern < 2.5) {
    // Пузыри: в части клеток сетки кольцо растёт и гаснет, каждое в своём темпе.
    vec2 g = floor(p * 1.6), f = fract(p * 1.6) - 0.5 - (hash2(g) - 0.5) * 0.5;
    float h = hash(g), life = fract(t * (0.25 + 0.3 * h) + h * 7.0);
    col = mix(col, hi, step(0.6, h) * (1.0 - smoothstep(0.0, 0.06, abs(length(f) - 0.1 - 0.22 * life))) * (1.0 - life));
  } else if (pattern > 2.5 && pattern < 3.5) {
    // Туман: медленные светлые клочья.
    float m = noise(p * 0.35 + vec2(t * 0.06, 0.0)) * 0.6 + noise(p * 0.9 - vec2(0.0, t * 0.04)) * 0.4;
    col = mix(col, hi, smoothstep(0.45, 0.85, m) * 0.7);
  }
  return col;
}
float kindCode(vec2 w) { return texture(uFlow, (floor(w * MASK_K) + 0.5) / MASK_K / uMap).b * 255.0 / 32.0; }
float kindAt(vec2 w) { return floor(kindCode(w) + 0.01); }
// Накрашено ли под жидкостью — сглаженно между точками маски: по ближайшей точке граница «своё дно / нарисованное» шла
// ступенями в четверть клетки вдоль всего берега (снимок владельца 2026-10-16).
float groundFlag(vec2 i) { return step(0.25, fract(texture(uFlow, (i + 0.5) / MASK_K / uMap).b * 255.0 / 32.0)); }
float groundShare(vec2 w) {
  vec2 p = w * MASK_K - 0.5, i = floor(p), f = fract(p);
  return mix(mix(groundFlag(i), groundFlag(i + vec2(1.0, 0.0)), f.x), mix(groundFlag(i + vec2(0.0, 1.0)), groundFlag(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Дно поверх жидкости, уже перекрашенной рецептом: так земля под болотом остаётся землёй, а не болотом. В пиксельных
// видах смесь огрубляется до ступеней тона, чтобы гладкая земля не выпадала из пиксель-арта.
// Вода вокруг того, что в ней стоит (В8): кольцо пены по контуру, рябь, которая расходится кругами, а в реке — след
// вниз по течению. Пена — только у жидкостей с пеной на кромке (у лавы и смолы её нет). f — течение, t — время жидкости.
vec3 things(vec3 col, vec2 w, vec2 f, float t, bool blocky) {
  vec3 th = texture(uThings, w / uMap).rgb;
  float wake = 0.0;
  if (dot(f, f) > 0.01) {
    vec2 dir = normalize(f);
    for (int i = 1; i <= 5; i++) {
      float s = float(i) * 0.45;
      wake = max(wake, texture(uThings, (w - dir * s) / uMap).r * (1.0 - s / 2.6));
    }
    // След рвётся струйками поперёк течения и мерцает.
    wake *= smoothstep(0.35, 0.7, noise(vec2(dot(w, vec2(-dir.y, dir.x)) * 5.0, dot(w, dir) * 1.5 - t * 3.0)));
  }
  if (th.r + th.g + wake < 0.01) return col;
  float ring = smoothstep(0.08, 0.35, th.r) * (1.0 - th.b);
  float ripple = step(0.8, sin(th.g * 30.0 - t * 2.6)) * smoothstep(0.03, 0.15, th.g) * (1.0 - smoothstep(0.25, 0.5, th.r));
  float foam = gFoam * max(max(ring * (blocky ? step(0.5, ring) : 0.9), wake * (blocky ? step(0.35, wake) : 0.75)), ripple * (blocky ? 0.6 : 0.45));
  gTop = max(gTop, foam);
  return mix(col, vec3(0.93, 0.98, 0.95), foam);
}
vec4 withBed(vec3 col, float a, bool blocky) {
  float show = gClear * gGround * (1.0 - gTop);
  if (show <= 0.0) return vec4(col, a);
  vec3 mixed = mix(col, gUnder, show);
  return vec4(blocky ? floor(mixed * 6.0 + 0.5) / 6.0 : mixed, a);
}
vec4 look(vec2 w, vec2 s, float t) { return uWater.x > 2.5 ? soft(w, s, t) : uWater.x > 0.5 ? pixel(w, s, t, uWater.x > 1.5) : comic(w, s, t); }
// Суша у самой жидкости: чем её подкрасить (цвет и сила). Вода мочит — земля темнее, лава обугливает;
// светящаяся жидкость ещё и подсвечивает берег — добавка уходит в gGlow.
vec4 shoreAt(vec2 world) {
  gGlow = vec3(0.0);
  if (world.x <= 0.0 || world.y <= 0.0 || world.x >= uMap.x || world.y >= uMap.y) return vec4(0.0);
  bool blocky = uWater.x > 0.5 && uWater.x < 2.5;
  vec2 w = blocky ? (floor(world * uWater.z) + 0.5) / uWater.z : world;
  float kind = kindAt(w);
  shoreOf(kind);
  float strip = smoothstep(0.03, 0.36, shoreMask(w).r);
  vec3 last = recipe(kind, 4.0);
  float rim = floor(last.g * 8.0 + 0.5);
  gGlow = recipe(kind, 1.0) * last.b * strip * 0.7;
  return rim > 0.5 && rim < 1.5 || rim > 3.5 ? vec4(0.0) : rim > 1.5 && rim < 2.5 ? vec4(0.06, 0.04, 0.03, strip * 0.55) : vec4(0.0, 0.0, 0.0, strip * 0.22);
}
// Атласная штриховка (М5): пять тонких линий вдоль кромки, к открытому морю реже. Размытая маска растёт от берега вглубь,
// поэтому её уровни идут параллельно берегу: при размытии 0,4 клетки эти уровни лежат в 0,15–0,95 клетки от кромки.
// Толщина — в точках экрана, линии рвутся шумом, как от руки. Без массивов и fwidth: Pixi на WebGL1 собирает шейдер
// по GLSL ES 1.0, где их нет, — шаг маски на точку экрана считается по соседней точке.
float hatchLine(float r, float level, float k) { return 1.0 - smoothstep(0.6, 1.4, abs(r - level) / k); }
float hatchAt(vec2 w) {
  float px = 1.0 / uScale, r = shoreMask(w).r;
  float k = max(abs(shoreMask(w + vec2(px, 0.0)).r - r) + abs(shoreMask(w + vec2(0.0, px)).r - r), 1e-4);
  float line = max(max(max(hatchLine(r, 0.646, k), hatchLine(r, 0.773, k)), max(hatchLine(r, 0.894, k), hatchLine(r, 0.964, k))), hatchLine(r, 0.991, k));
  return line * step(0.3, noise(w * 2.3));
}
vec4 atlasRim(vec4 c, vec2 w, float kind) {
  if (c.a <= 0.0 || floor(recipe(kind, 4.0).g * 8.0 + 0.5) < 3.5) return c;
  return vec4(mix(c.rgb, vec3(0.09, 0.09, 0.1), hatchAt(w) * 0.85), c.a);
}
vec4 waterAt(vec2 world, float t) {
  if (world.x <= 0.0 || world.y <= 0.0 || world.x >= uMap.x || world.y >= uMap.y) return vec4(0.0);
  // Пиксельные виды считают течение по целому «пикселю» карты, иначе клетки рисунка рвутся.
  bool blocky = uWater.x > 0.5 && uWater.x < 2.5;
  vec2 w = blocky ? (floor(world * uWater.z) + 0.5) / uWater.z : world;
  // Номер жидкости берётся из середины точки маски, без сглаживания: между номерами нет «промежуточной» жидкости.
  float kind = kindAt(w);
  gGround = blocky ? step(0.5, groundShare(w)) : groundShare(w); gClear = 0.0; gTop = 0.0;
  shoreOf(kind);
  vec3 set = recipe(kind, 3.0);
  float size = max(0.25, set.g * 4.0);
  t *= set.r * 2.0; gBed = set.b; gFoam = recipe(kind, 4.0).g < 0.06 ? 1.0 : 0.0;
  if (blocky) t = floor(t * 6.0) / 6.0;
  vec2 f = texture(uFlow, w / uMap).rg * 2.0 - 1.0;
  if (dot(f, f) < 0.01) { vec4 calm = look(w, w / size, t); return atlasRim(withBed(things(liquid(calm.rgb, kind, w / size, t), w, f, t, blocky), calm.a, blocky), w, kind); }
  // Рисунок сносит вдоль реки. Если сносить бесконечно, на излучинах он растянется в кашу, поэтому идут два
  // круга сноса со сдвигом в полкруга: пока один возвращается к началу, виден другой.
  float ph = t * 0.4 + noise(w * 0.12);
  float a = fract(ph), b = fract(ph + 0.5), share = 1.0 - abs(2.0 * a - 1.0);
  vec4 one = look(w, (w - f * (a - 0.5) * 2.4) / size, t), two = look(w, (w - f * (b - 0.5) * 2.4) / size, t);
  // Мягкая вода смешивает круги плавно; у остальных своя палитра, поэтому круги меняются пятнами.
  vec4 moved = mix(two, one, uWater.x > 2.5 ? share : step(noise(w * 1.7 + 20.0), share));
  return atlasRim(withBed(things(liquid(moved.rgb, kind, w / size, t), w, f, t, blocky), moved.a, blocky), w, kind);
}
`;

// Вода одним кадром для обычного холста: тот же шейдер на отдельном маленьком WebGL-холсте, результат кладётся
// поверх земли. Так вода одинакова в редакторе без новой отрисовки, в «Скачать картинку» и у игроков.
const STILL_VERTEX = `#version 300 es
in vec2 aPoint;
void main() { gl_Position = vec4(aPoint, 0.0, 1.0); }`;
const STILL_FRAGMENT = `#version 300 es
precision highp float;
out vec4 finalColor;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uTime;
uniform float uHeight;
uniform sampler2D uGround;
uniform vec2 uChunk;
${WATER_GLSL}
vec4 groundAt(vec2 world) { return texture(uGround, (world * uScale + uOrigin) / uChunk); }
void main() {
  vec2 world = (vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) - uOrigin) / uScale;
  vec4 water = waterAt(world, uTime * uWater.y);
  // Вне воды — полупрозрачная подкраска берега и свечение добавкой.
  vec4 shore = shoreAt(world);
  finalColor = vec4(water.rgb * water.a + (1.0 - water.a) * (shore.rgb * shore.a + gGlow), water.a + (1.0 - water.a) * shore.a);
}`;
type Still = { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; at: (name: string) => WebGLUniformLocation | null; mask: HTMLCanvasElement; raw: HTMLCanvasElement; flow: HTMLCanvasElement; recipes: HTMLCanvasElement; things: HTMLCanvasElement; sources: readonly unknown[]; thingsOf: readonly unknown[]; liquids: unknown; any: boolean };
let still: Still | null | undefined;
function stillStage(): Still | null {
  if (still !== undefined) return still;
  still = null;
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas"), gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, STILL_VERTEX], [gl.FRAGMENT_SHADER, STILL_FRAGMENT]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, "aPoint");
    gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    // Пять картинок: в ячейке 0 — маска воды, в ячейке 1 — течение, в ячейке 2 — рецепты жидкостей, в ячейке 3 — земля куска,
    // в ячейке 4 — что стоит в воде.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const unit of [gl.TEXTURE4, gl.TEXTURE3, gl.TEXTURE2, gl.TEXTURE1, gl.TEXTURE0]) {
      gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    const blank = () => document.createElement("canvas");
    still = { canvas, gl, at: (name) => gl.getUniformLocation(program, name), mask: blank(), raw: blank(), flow: blank(), recipes: blank(), things: blank(), sources: [], thingsOf: [], liquids: null, any: false };
  } catch (error) { console.warn("Живая вода на обычном холсте недоступна", error); }
  return still;
}
/** Рисуется ли живая вода на обычном холсте: без WebGL на карте остаётся вода-картинка из слоя «Жидкости». */
export const waterStillReady = () => !!stillStage();
/** Кусок холста за один проход: больше видеокарта может не дать, а картинка карты бывает 8192 точки. */
const STILL_SIDE = 2048;
/**
 * Рисует воду поверх уже нарисованной земли. `ratio` — точек холста на точку вёрстки. false — воды нет или WebGL
 * недоступен: на холсте остаётся вода-картинка.
 */
export function drawWaterStill(ctx: CanvasRenderingContext2D, model: MapRenderModel, width: number, height: number, water: MapWater,
  cssW: number, cssH: number, scale: number, ox: number, oy: number, ratio: number, lo: { x: number; y: number } = ZERO, fog: WaterFog = null): boolean {
  const stage = stillStage();
  if (!stage) return false;
  const { gl, canvas } = stage, sources = waterSources(model, width, height, water.shoal, lo, fog);
  if (sources.length !== stage.sources.length || sources.some((source, i) => source !== stage.sources[i])) {
    stage.any = drawWaterMask(stage.mask, stage.raw, stage.flow, stage.recipes, model, width, height, water.shoal, lo, fog); stage.sources = sources;
    stage.liquids = null;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.flow);
    gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.mask);
  }
  const thingSources = waterThingSources(model, width, height, lo);
  if (thingSources.length !== stage.thingsOf.length || thingSources.some((source, i) => source !== stage.thingsOf[i])) {
    drawWaterThings(stage.things, model, width, height, lo); stage.thingsOf = thingSources;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE4); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.things);
  }
  const liquids = water.liquids ?? model.liquids;
  if (liquids !== stage.liquids) {
    drawLiquidRecipes(stage.recipes, liquids); stage.liquids = liquids;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.recipes);
  }
  if (!stage.any) return false;
  const W = Math.round(cssW * ratio), H = Math.round(cssH * ratio);
  gl.uniform1i(stage.at("uMask"), 0); gl.uniform1i(stage.at("uFlow"), 1); gl.uniform1i(stage.at("uRecipe"), 2); gl.uniform1i(stage.at("uGround"), 3); gl.uniform1i(stage.at("uThings"), 4); gl.uniform2f(stage.at("uMap"), width - lo.x, height - lo.y); gl.uniform3f(stage.at("uWater"), water.mode, water.speed, water.size);
  gl.uniform1f(stage.at("uScale"), scale * ratio); gl.uniform1f(stage.at("uTime"), water.time ?? 0);
  for (let y = 0; y < H; y += STILL_SIDE) for (let x = 0; x < W; x += STILL_SIDE) {
    const w = Math.min(STILL_SIDE, W - x), h = Math.min(STILL_SIDE, H - y);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(stage.at("uOrigin"), (ox + lo.x * scale) * ratio - x, (oy + lo.y * scale) * ratio - y); gl.uniform1f(stage.at("uHeight"), h); gl.uniform2f(stage.at("uChunk"), w, h);
    // Земля под водой — то, что уже нарисовано на холсте. Если её не прочесть (чужая картинка на холсте), дно рисуется само.
    let ground: ImageData | Uint8Array = new Uint8Array(4);
    try { ground = ctx.getImageData(x, y, w, h); } catch { /* холст закрыт для чтения */ }
    gl.activeTexture(gl.TEXTURE3);
    if (ground instanceof ImageData) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ground);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ground);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(canvas, 0, 0, w, h, x / ratio, y / ratio, w / ratio, h / ratio);
  }
  return true;
}
