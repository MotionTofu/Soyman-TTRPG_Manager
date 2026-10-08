import { flattenSplineWithWidths } from "./core/spline";
import type { MapRenderModel } from "./renderModel";
import { liquidKind, riverDepth, waterLevel } from "./assets/village";

/** Вода шейдером (проба 2026-10-08). `mode`: 0 — комикс-панк, 1 — пиксельный пруд, 2 — пиксельное море, 3 — мягкая с дном;
 * `size` — пикселей на клетку у пиксельных. */
export interface MapWater { mode: 0 | 1 | 2 | 3; speed: number; size: number; shoal: number }

/** Точек маски на клетку. Маска — вся карта одной картинкой: красный канал — «здесь вода», зелёный — глубина (1–5 пятыми долями),
 * синий — «ближайший берег песчаный»: у пляжа пена шире, у травы и камня берег резче.
 * В синем канале картинки течения — номер жидкости ×32 (вода — 0), без размытия. */
const K = 4;

/** Из чего собрана маска воды. Пока список тот же, маску не пересобирают: перетаскивание фишки или подписи воду не меняет,
 * а пересборка — это вся карта заново и отправка картинки видеокарте на каждый шаг руки. */
export function waterSources(model: MapRenderModel, width: number, height: number, shoal = 0): readonly unknown[] {
  const out: unknown[] = [width, height, shoal];
  for (const layer of model.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "terrain" && layer.terrain.mask?.source) out.push(layer.terrain.mask.source);
    if (layer.kind === "path") for (const path of layer.paths) if (path.kind === "river" && path.style && path.nodes) out.push(path.nodes, path.width, path.style, path.closed, path.flow, path.depth);
  }
  return out;
}

/**
 * Где на карте вода: поверхности воды из плавных слоёв и реки, залитые водой.
 * Края размыты на полклетки — по этому градиенту шейдер рисует берег и пену.
 * `shoal` — отмель в клетках: у берега глубина 1 и набирает свою на этом расстоянии, так вода глубже к середине.
 */
export function drawWaterMask(canvas: HTMLCanvasElement, raw: HTMLCanvasElement, flow: HTMLCanvasElement, model: MapRenderModel, width: number, height: number, shoal = 0): boolean {
  const w = Math.max(1, Math.ceil(width * K)), h = Math.max(1, Math.ceil(height * K));
  for (const target of [canvas, raw, flow]) if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const pen = raw.getContext("2d"), out = canvas.getContext("2d"), stream = flow.getContext("2d");
  if (!pen || !out || !stream) return false;
  const image = pen.createImageData(w, h), data = image.data, kinds = new Uint8Array(w * h), floor = new Uint8Array(w * h);
  let any = false;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const layer of model.layers) {
    const mask = layer.kind === "terrain" && layer.visible ? layer.terrain.mask : undefined;
    if (!mask?.source) continue;
    const step = mask.sampleSize * K;
    for (const chunk of mask.source.chunks) for (let i = 0; i < chunk.values.length; i++) {
      if (!chunk.values[i]) continue;
      // Закрашенный отсчёт верхнего слоя перекрывает воду нижнего, даже если сам не вода.
      const code = mask.source.codes[chunk.values[i] - 1], depth = waterLevel(code), beach = /^village-sand/.test(code ?? "") ? 255 : 0;
      const x0 = Math.round((mask.origin.x + (chunk.cx * 16 + i % 16) * mask.sampleSize) * K), y0 = Math.round((mask.origin.y + (chunk.cy * 16 + Math.floor(i / 16)) * mask.sampleSize) * K);
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + Math.max(1, Math.round(step))); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + Math.max(1, Math.round(step))); x++) {
        const at = (y * w + x) * 4; data[at] = depth ? 255 : 0; data[at + 1] = depth * 51; kinds[at / 4] = liquidKind(code);
        // Жидкость дно не стирает: под ней остаётся то, что накрашено слоем ниже.
        if (!depth) { data[at + 2] = beach; floor[at / 4] = 1; }
      }
      any ||= depth > 0;
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
      pen.beginPath(); pen.moveTo(a.x * K, a.y * K); pen.lineTo(b.x * K, b.y * K); pen.stroke();
    }
  };
  for (const { path, samples } of rivers) {
    pen.strokeStyle = `rgb(255,${riverDepth(path) * 51},0)`;
    stroke(samples, 0);
    any = true;
  }
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
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) { near(i, x, y, -1, 0, 1); near(i, x, y, 0, -1, 1); near(i, x, y, -1, -1, 1.4); near(i, x, y, 1, -1, 1.4); }
    for (let y = h - 1, i = w * h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) { near(i, x, y, 1, 0, 1); near(i, x, y, 0, 1, 1); near(i, x, y, 1, 1, 1.4); near(i, x, y, -1, 1, 1.4); }
    if (shoal > 0) for (let i = 0; i < far.length; i++) if (px[i * 4 + 1] > 51) px[i * 4 + 1] = Math.round(51 + (px[i * 4 + 1] - 51) * Math.min(1, far[i] / (shoal * K)));
    pen.putImageData(wet, 0, 0);
    // Номер жидкости заходит на полклетки на сушу: размытый край маски шире закрашенного, и без этого у лавы была бы водяная кайма.
    for (let pass = 0; pass < 2; pass++) {
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
    for (let i = 0; i < kinds.length; i++) kinded.data[i * 4 + 2] = kinds[i] * 32;
    stream.putImageData(kinded, 0, 0);
  }
  return any;
}

// Вода считается из координат карты: не повторяется, не мутнеет при приближении и движется.
// Пиксельные виды двигаются рывками, а не плавно: покадровая анимация ближе к рисованной карте.
/** Общая часть шейдера: по точке карты и времени отдаёт цвет воды. Ею рисуют и сцена WebGL, и обычный холст. */
export const WATER_GLSL = `
const float MASK_K = ${K}.0;
uniform sampler2D uMask;
uniform sampler2D uFlow;
uniform vec2 uMap;
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
  vec3 mk = texture(uMask, w / uMap).rgb;
  float edge = mk.r + (noise(w * 2.7) - 0.5) * 0.14;
  // Порог ниже середины: шейдер закрывает и размытый край картинки воды под собой.
  float a = smoothstep(0.38, 0.44, edge);
  if (a <= 0.0) return vec4(0.0);
  float tick = floor(t * 5.0);
  float deep = smoothstep(0.25, 0.8, depthAt(w));
  vec3 col = mix(vec3(0.19, 0.62, 0.56), vec3(0.11, 0.36, 0.44), deep);
  col *= 1.0 - 0.13 * step(0.6, noise(s * 0.8 + vec2(tick * 0.07, 3.0)));
  vec3 ink = vec3(0.09, 0.09, 0.1);
  // Ряды дуг: в каждом ряду свой сдвиг, часть дуг пропущена, редкие — белые блики.
  vec2 q = vec2(s.x * 1.5 - tick * 0.12, s.y * 2.4 + 0.5 * sin(s.x * 0.9));
  float row = floor(q.y), x = q.x + hash(vec2(row, 3.0)) * 9.0, seg = floor(x), fx = fract(x), fy = fract(q.y) - 0.5;
  float arc = abs(fy - 0.2 * sin(fx * 3.14159) + 0.1);
  float body = step(0.14, fx) * step(fx, 0.86) * step(arc, 0.075 + 0.03 * hash(vec2(seg, row + 5.0)));
  float kind = hash(vec2(seg, row));
  col = mix(col, ink, body * step(0.55, kind) * (1.0 - step(0.9, kind)));
  col = mix(col, vec3(0.93, 0.98, 0.95), body * step(0.9, kind));
  // Берег: внутри воды полоска пены, по самой кромке — тушь.
  float shore = smoothstep(0.45, 1.0, mk.r);
  float foam = step(shore, 0.14 + 0.24 * mk.b + 0.12 * noise(vec2(s.x * 3.0 + tick * 0.4, s.y * 3.0))) * step(0.35, noise(s * 5.0 + tick));
  col = mix(col, vec3(0.93, 0.98, 0.95), foam);
  col = mix(col, ink, 1.0 - smoothstep(0.43, 0.5, edge));
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
  vec3 mk = texture(uMask, c / uMap).rgb;
  if (mk.r < 0.4) return vec4(0.0);
  float tick = floor(t * 6.0);
  // Ступени тонов на границе глубин ломаются шахматным смешением.
  float depth = depthAt(c) + (mod(p.x + p.y, 2.0) - 0.5) * 0.07;
  vec3 col = isSea ? sea(ps, tick, depth) : pond((ps + 0.5) / P, tick / 6.0, depth);
  // Пена у берега: сплошная кромка в один пиксель и рваная полоса за ней — у пляжа широкая, у травы узкая.
  float shore = smoothstep(0.4, 1.0, mk.r), reach = 0.14 + 0.3 * step(0.5, mk.b);
  col = mix(col, vec3(0.9, 0.98, 0.95), min(1.0, step(shore, 0.1) + step(shore, reach) * step(0.6, hash(p + tick))));
  return vec4(col, 1.0);
}

// Мягкая: без пикселей и без туши. Цвет плавно темнеет с глубиной, на мели просвечивает песчаное дно с камешками,
// по воде плывут тонкие светлые кольца бликов.
vec4 soft(vec2 w, vec2 s, float t) {
  vec3 mk = texture(uMask, w / uMap).rgb;
  float a = smoothstep(0.36, 0.5, mk.r);
  if (a <= 0.0) return vec4(0.0);
  float depth = depthAt(w);
  vec3 col = mix(vec3(0.56, 0.84, 0.8), vec3(0.2, 0.47, 0.7), smoothstep(0.08, 0.85, depth));
  float bed = noise(w * 3.0) * 0.5 + noise(w * 7.0 + 4.0) * 0.5;
  vec3 bottom = mix(vec3(0.87, 0.8, 0.58), vec3(0.6, 0.56, 0.44), smoothstep(0.58, 0.66, bed));
  col = mix(bottom, col, 0.3 + 0.7 * smoothstep(0.04, 0.42, depth));
  vec2 q = s * 0.9 + 0.2 * vec2(noise(s * 1.1 + t * 0.2), noise(s * 1.1 + 5.0 - t * 0.2));
  float line = (1.0 - smoothstep(0.0, 0.05, cellEdge(q, t * 0.6))) * (0.6 - 0.35 * depth) * smoothstep(0.25, 0.6, noise(s * 0.6 + t * 0.1 + 3.0));
  col = mix(col, vec3(0.94, 1.0, 0.97), line);
  // Прибой: светлая полоска у самой кромки, дышит. У пляжа она широкая, у травы и камня — тонкая, а под ней тень берега.
  float rim = 1.0 - smoothstep(0.5, 0.56 + 0.16 * mk.b + 0.04 * sin(t * 1.5 + w.x * 2.0 + w.y), mk.r);
  col *= 1.0 - 0.3 * (1.0 - mk.b) * (1.0 - smoothstep(0.5, 0.8, mk.r));
  col = mix(col, vec3(0.96, 0.98, 0.9), rim * (0.45 + 0.3 * mk.b));
  return vec4(col, a);
}

// Другие жидкости — та же вода, перекрашенная по яркости в свою шкалу: тёмное, среднее, светлое. Рисунок вида
// (пиксели, дуги, блики) остаётся, поэтому лава в пиксельной карте пиксельная, а блики на ней — раскалённые трещины.
vec3 ramp(vec3 c, vec3 lo, vec3 mid, vec3 hi) {
  float x = clamp((dot(c, vec3(0.3, 0.59, 0.11)) - 0.25) / 0.7, 0.0, 1.0);
  return x < 0.5 ? mix(lo, mid, x * 2.0) : mix(mid, hi, x * 2.0 - 1.0);
}
vec3 liquid(vec3 c, float kind) {
  if (kind < 0.5) return c;
  if (kind < 1.5) return ramp(c, vec3(0.13, 0.15, 0.07), vec3(0.3, 0.34, 0.14), vec3(0.62, 0.68, 0.36));
  if (kind < 2.5) return ramp(c, vec3(0.16, 0.05, 0.04), vec3(0.72, 0.18, 0.04), vec3(1.0, 0.9, 0.4));
  if (kind < 3.5) return ramp(c, vec3(0.55, 0.72, 0.82), vec3(0.8, 0.9, 0.94), vec3(1.0));
  if (kind < 4.5) return ramp(c, vec3(0.2, 0.33, 0.05), vec3(0.6, 0.78, 0.1), vec3(0.93, 1.0, 0.6));
  if (kind < 5.5) return ramp(c, vec3(0.03, 0.03, 0.04), vec3(0.12, 0.1, 0.09), vec3(0.42, 0.36, 0.3));
  return ramp(c, vec3(0.02, 0.03, 0.06), vec3(0.1, 0.13, 0.2), vec3(0.55, 0.6, 0.68));
}
// Во сколько раз жидкость медленнее воды: лёд стоит, лава и смола ползут.
float pace(float kind) { return kind < 0.5 ? 1.0 : kind < 1.5 ? 0.5 : kind < 2.5 ? 0.35 : kind < 3.5 ? 0.0 : kind < 4.5 ? 1.2 : kind < 5.5 ? 0.25 : 0.5; }
vec4 look(vec2 w, vec2 s, float t) { return uWater.x > 2.5 ? soft(w, s, t) : uWater.x > 0.5 ? pixel(w, s, t, uWater.x > 1.5) : comic(w, s, t); }
// Мокрая полоса на суше у самой воды, 0…1: земля там темнее.
float wetAt(vec2 world) {
  if (world.x <= 0.0 || world.y <= 0.0 || world.x >= uMap.x || world.y >= uMap.y) return 0.0;
  bool blocky = uWater.x > 0.5 && uWater.x < 2.5;
  return smoothstep(0.03, 0.36, texture(uMask, (blocky ? (floor(world * uWater.z) + 0.5) / uWater.z : world) / uMap).r);
}
vec4 waterAt(vec2 world, float t) {
  if (world.x <= 0.0 || world.y <= 0.0 || world.x >= uMap.x || world.y >= uMap.y) return vec4(0.0);
  // Пиксельные виды считают течение по целому «пикселю» карты, иначе клетки рисунка рвутся.
  bool blocky = uWater.x > 0.5 && uWater.x < 2.5;
  vec2 w = blocky ? (floor(world * uWater.z) + 0.5) / uWater.z : world;
  // Номер жидкости берётся из середины точки маски, без сглаживания: между номерами нет «промежуточной» жидкости.
  float kind = floor(texture(uFlow, (floor(w * MASK_K) + 0.5) / MASK_K / uMap).b * 7.97 + 0.5);
  t *= pace(kind);
  vec2 f = texture(uFlow, w / uMap).rg * 2.0 - 1.0;
  if (dot(f, f) < 0.01) { vec4 calm = look(w, w, t); return vec4(liquid(calm.rgb, kind), calm.a); }
  // Рисунок сносит вдоль реки. Если сносить бесконечно, на излучинах он растянется в кашу, поэтому идут два
  // круга сноса со сдвигом в полкруга: пока один возвращается к началу, виден другой.
  float ph = (blocky ? floor(t * 6.0) / 6.0 : t) * 0.4 + noise(w * 0.12);
  float a = fract(ph), b = fract(ph + 0.5), share = 1.0 - abs(2.0 * a - 1.0);
  vec4 one = look(w, w - f * (a - 0.5) * 2.4, t), two = look(w, w - f * (b - 0.5) * 2.4, t);
  // Мягкая вода смешивает круги плавно; у остальных своя палитра, поэтому круги меняются пятнами.
  vec4 moved = mix(two, one, uWater.x > 2.5 ? share : step(noise(w * 1.7 + 20.0), share));
  return vec4(liquid(moved.rgb, kind), moved.a);
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
${WATER_GLSL}
void main() {
  vec2 world = (vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) - uOrigin) / uScale;
  vec4 water = waterAt(world, uTime * uWater.y);
  // Вне воды — полупрозрачная тень мокрой полосы.
  finalColor = vec4(water.rgb * water.a, water.a + (1.0 - water.a) * wetAt(world) * 0.22);
}`;
type Still = { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; at: (name: string) => WebGLUniformLocation | null; mask: HTMLCanvasElement; raw: HTMLCanvasElement; flow: HTMLCanvasElement; sources: readonly unknown[]; any: boolean };
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
    // Две картинки: в ячейке 0 — маска воды, в ячейке 1 — течение.
    for (const unit of [gl.TEXTURE1, gl.TEXTURE0]) {
      gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    const blank = () => document.createElement("canvas");
    still = { canvas, gl, at: (name) => gl.getUniformLocation(program, name), mask: blank(), raw: blank(), flow: blank(), sources: [], any: false };
  } catch (error) { console.warn("Живая вода на обычном холсте недоступна", error); }
  return still;
}
/** Кусок холста за один проход: больше видеокарта может не дать, а картинка карты бывает 8192 точки. */
const STILL_SIDE = 2048;
/**
 * Рисует воду поверх уже нарисованной земли. `ratio` — точек холста на точку вёрстки. false — воды нет или WebGL
 * недоступен: на холсте остаётся вода-картинка.
 */
export function drawWaterStill(ctx: CanvasRenderingContext2D, model: MapRenderModel, width: number, height: number, water: MapWater,
  cssW: number, cssH: number, scale: number, ox: number, oy: number, ratio: number): boolean {
  const stage = stillStage();
  if (!stage) return false;
  const { gl, canvas } = stage, sources = waterSources(model, width, height, water.shoal);
  if (sources.length !== stage.sources.length || sources.some((source, i) => source !== stage.sources[i])) {
    stage.any = drawWaterMask(stage.mask, stage.raw, stage.flow, model, width, height, water.shoal); stage.sources = sources;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.flow);
    gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage.mask);
  }
  if (!stage.any) return false;
  const W = Math.round(cssW * ratio), H = Math.round(cssH * ratio);
  gl.uniform1i(stage.at("uMask"), 0); gl.uniform1i(stage.at("uFlow"), 1); gl.uniform2f(stage.at("uMap"), width, height); gl.uniform3f(stage.at("uWater"), water.mode, water.speed, water.size);
  gl.uniform1f(stage.at("uScale"), scale * ratio); gl.uniform1f(stage.at("uTime"), 0);
  for (let y = 0; y < H; y += STILL_SIDE) for (let x = 0; x < W; x += STILL_SIDE) {
    const w = Math.min(STILL_SIDE, W - x), h = Math.min(STILL_SIDE, H - y);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(stage.at("uOrigin"), ox * ratio - x, oy * ratio - y); gl.uniform1f(stage.at("uHeight"), h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(canvas, 0, 0, w, h, x / ratio, y / ratio, w / ratio, h / ratio);
  }
  return true;
}
