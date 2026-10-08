import { defaultFilterVert, Filter, GlProgram, Texture } from "pixi.js";
import { flattenSplineWithWidths } from "../core/spline";
import type { MapRenderModel } from "../renderModel";
import { waterLevel } from "../assets/village";

/** Вода шейдером (проба 2026-10-08). `mode`: 0 — комикс-панк, 1 — пиксельный пруд, 2 — пиксельное море, 3 — мягкая с дном;
 * `size` — пикселей на клетку у пиксельных. */
export interface MapWater { mode: 0 | 1 | 2 | 3; speed: number; size: number }

/** Точек маски на клетку. Маска — вся карта одной картинкой: красный канал — «здесь вода», зелёный — глубина (1–5 пятыми долями). */
const K = 4;

/** Из чего собрана маска воды. Пока список тот же, маску не пересобирают: перетаскивание фишки или подписи воду не меняет,
 * а пересборка — это вся карта заново и отправка картинки видеокарте на каждый шаг руки. */
export function waterSources(model: MapRenderModel, width: number, height: number): readonly unknown[] {
  const out: unknown[] = [width, height];
  for (const layer of model.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "terrain" && layer.terrain.mask?.source) out.push(layer.terrain.mask.source);
    if (layer.kind === "path") for (const path of layer.paths) if (path.kind === "river" && path.style && path.nodes) out.push(path.nodes, path.width, path.style, path.closed);
  }
  return out;
}

/**
 * Где на карте вода: поверхности воды из плавных слоёв и реки, залитые водой.
 * Края размыты на полклетки — по этому градиенту шейдер рисует берег и пену.
 */
export function drawWaterMask(canvas: HTMLCanvasElement, raw: HTMLCanvasElement, model: MapRenderModel, width: number, height: number): boolean {
  const w = Math.max(1, Math.ceil(width * K)), h = Math.max(1, Math.ceil(height * K));
  for (const target of [canvas, raw]) if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const pen = raw.getContext("2d"), out = canvas.getContext("2d");
  if (!pen || !out) return false;
  const image = pen.createImageData(w, h), data = image.data;
  let any = false;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const layer of model.layers) {
    const mask = layer.kind === "terrain" && layer.visible ? layer.terrain.mask : undefined;
    if (!mask?.source) continue;
    const step = mask.sampleSize * K;
    for (const chunk of mask.source.chunks) for (let i = 0; i < chunk.values.length; i++) {
      if (!chunk.values[i]) continue;
      // Закрашенный отсчёт верхнего слоя перекрывает воду нижнего, даже если сам не вода.
      const depth = waterLevel(mask.source.codes[chunk.values[i] - 1]);
      const x0 = Math.round((mask.origin.x + (chunk.cx * 16 + i % 16) * mask.sampleSize) * K), y0 = Math.round((mask.origin.y + (chunk.cy * 16 + Math.floor(i / 16)) * mask.sampleSize) * K);
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + Math.max(1, Math.round(step))); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + Math.max(1, Math.round(step))); x++) {
        const at = (y * w + x) * 4; data[at] = depth ? 255 : 0; data[at + 1] = depth * 51;
      }
      any ||= depth > 0;
    }
  }
  pen.putImageData(image, 0, 0);
  pen.lineCap = pen.lineJoin = "round";
  for (const layer of model.layers) {
    if (layer.kind !== "path" || !layer.visible) continue;
    for (const path of layer.paths) {
      if (path.kind !== "river" || !path.style || !path.nodes || path.nodes.length < 2) continue;
      const samples = flattenSplineWithWidths(path.closed ? [...path.nodes, path.nodes[0]] : path.nodes, path.width ?? 0.22, 0.25);
      pen.strokeStyle = /deep/.test(path.style) ? "#ffcc00" : "#ff6600";
      for (let i = 1; i < samples.length; i++) {
        pen.lineWidth = (samples[i - 1].width + samples[i].width) / 2 * K;
        pen.beginPath(); pen.moveTo(samples[i - 1].x * K, samples[i - 1].y * K); pen.lineTo(samples[i].x * K, samples[i].y * K); pen.stroke();
      }
      any = true;
    }
  }
  out.filter = `blur(${K * 0.4}px)`; out.drawImage(raw, 0, 0); out.filter = "none";
  return any;
}

// Вода считается из координат карты: не повторяется, не мутнеет при приближении и движется.
// Обе руки двигаются рывками, а не плавно: покадровая анимация ближе к рисованной карте.
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform highp vec4 uInputSize;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uTime;
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

// Комикс-панк: плоская заливка, пятна, толстые дуги волн, тушевый берег и рваная пена.
vec4 comic(vec2 w, float t) {
  vec2 mk = texture(uMask, w / uMap).rg;
  float edge = mk.r + (noise(w * 2.7) - 0.5) * 0.14;
  // Порог ниже середины: шейдер закрывает и размытый край картинки воды под собой.
  float a = smoothstep(0.38, 0.44, edge);
  if (a <= 0.0) return vec4(0.0);
  float tick = floor(t * 5.0);
  float deep = smoothstep(0.25, 0.8, depthAt(w));
  vec3 col = mix(vec3(0.19, 0.62, 0.56), vec3(0.11, 0.36, 0.44), deep);
  col *= 1.0 - 0.13 * step(0.6, noise(w * 0.8 + vec2(tick * 0.07, 3.0)));
  vec3 ink = vec3(0.09, 0.09, 0.1);
  // Ряды дуг: в каждом ряду свой сдвиг, часть дуг пропущена, редкие — белые блики.
  vec2 q = vec2(w.x * 1.5 - tick * 0.12, w.y * 2.4 + 0.5 * sin(w.x * 0.9));
  float row = floor(q.y), x = q.x + hash(vec2(row, 3.0)) * 9.0, seg = floor(x), fx = fract(x), fy = fract(q.y) - 0.5;
  float arc = abs(fy - 0.2 * sin(fx * 3.14159) + 0.1);
  float body = step(0.14, fx) * step(fx, 0.86) * step(arc, 0.075 + 0.03 * hash(vec2(seg, row + 5.0)));
  float kind = hash(vec2(seg, row));
  col = mix(col, ink, body * step(0.55, kind) * (1.0 - step(0.9, kind)));
  col = mix(col, vec3(0.93, 0.98, 0.95), body * step(0.9, kind));
  // Берег: внутри воды полоска пены, по самой кромке — тушь.
  float shore = smoothstep(0.45, 1.0, mk.r);
  float foam = step(shore, 0.3 + 0.12 * noise(vec2(w.x * 3.0 + tick * 0.4, w.y * 3.0))) * step(0.35, noise(w * 5.0 + tick));
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
vec4 pixel(vec2 w, float t, bool isSea) {
  float P = uWater.z;
  vec2 p = floor(w * P), c = (p + 0.5) / P;
  vec2 mk = texture(uMask, c / uMap).rg;
  if (mk.r < 0.4) return vec4(0.0);
  float tick = floor(t * 6.0);
  // Ступени тонов на границе глубин ломаются шахматным смешением.
  float depth = depthAt(c) + (mod(p.x + p.y, 2.0) - 0.5) * 0.07;
  vec3 col = isSea ? sea(p, tick, depth) : pond(c, tick / 6.0, depth);
  // Пена у берега: сплошная кромка в один пиксель и рваная полоса за ней.
  float shore = smoothstep(0.4, 1.0, mk.r);
  col = mix(col, vec3(0.9, 0.98, 0.95), min(1.0, step(shore, 0.1) + step(shore, 0.3) * step(0.6, hash(p + tick))));
  return vec4(col, 1.0);
}

// Мягкая: без пикселей и без туши. Цвет плавно темнеет с глубиной, на мели просвечивает песчаное дно с камешками,
// по воде плывут тонкие светлые кольца бликов.
vec4 soft(vec2 w, float t) {
  vec2 mk = texture(uMask, w / uMap).rg;
  float a = smoothstep(0.36, 0.5, mk.r);
  if (a <= 0.0) return vec4(0.0);
  float depth = depthAt(w);
  vec3 col = mix(vec3(0.56, 0.84, 0.8), vec3(0.2, 0.47, 0.7), smoothstep(0.08, 0.85, depth));
  float bed = noise(w * 3.0) * 0.5 + noise(w * 7.0 + 4.0) * 0.5;
  vec3 bottom = mix(vec3(0.87, 0.8, 0.58), vec3(0.6, 0.56, 0.44), smoothstep(0.58, 0.66, bed));
  col = mix(bottom, col, 0.3 + 0.7 * smoothstep(0.04, 0.42, depth));
  vec2 q = w * 0.9 + 0.2 * vec2(noise(w * 1.1 + t * 0.2), noise(w * 1.1 + 5.0 - t * 0.2));
  float line = (1.0 - smoothstep(0.0, 0.05, cellEdge(q, t * 0.6))) * (0.6 - 0.35 * depth) * smoothstep(0.25, 0.6, noise(w * 0.6 + t * 0.1 + 3.0));
  col = mix(col, vec3(0.94, 1.0, 0.97), line);
  // Прибой: светлая полоска у самой кромки, дышит.
  float rim = 1.0 - smoothstep(0.5, 0.6 + 0.04 * sin(t * 1.5 + w.x * 2.0 + w.y), mk.r);
  col = mix(col, vec3(0.96, 0.98, 0.9), rim * 0.75);
  return vec4(col, a);
}

void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec2 world = (vTextureCoord * uInputSize.xy - uOrigin) / uScale;
  vec4 water = vec4(0.0);
  if (world.x > 0.0 && world.y > 0.0 && world.x < uMap.x && world.y < uMap.y) {
    float t = uTime * uWater.y;
    water = uWater.x > 2.5 ? soft(world, t) : uWater.x > 0.5 ? pixel(world, t, uWater.x > 1.5) : comic(world, t);
  }
  finalColor = vec4(mix(base.rgb, water.rgb * base.a, water.a), base.a);
}`;

/** Проход по слою земли: рисует воду там, где её показывает маска. */
export function createWaterFilter(mask: HTMLCanvasElement) {
  const texture = Texture.from(mask, true);
  texture.source.scaleMode = "linear";
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-water" }),
    resources: { water: { uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: { value: 1, type: "f32" }, uTime: { value: 0, type: "f32" },
      uMap: { value: new Float32Array(2), type: "vec2<f32>" }, uWater: { value: new Float32Array(3), type: "vec3<f32>" } }, uMask: texture.source },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.water.uniforms as { uOrigin: Float32Array; uScale: number; uTime: number; uMap: Float32Array; uWater: Float32Array };
  return {
    filter,
    /** Маску перерисовали — отдать её видеокарте. */
    refresh() { texture.source.update(); },
    aim(water: MapWater, x: number, y: number, scale: number, seconds: number, width: number, height: number) {
      uniforms.uOrigin[0] = x; uniforms.uOrigin[1] = y; uniforms.uScale = scale; uniforms.uTime = seconds % 3600;
      uniforms.uMap[0] = width; uniforms.uMap[1] = height;
      uniforms.uWater[0] = water.mode; uniforms.uWater[1] = water.speed; uniforms.uWater[2] = water.size;
    },
    destroy() { filter.destroy(); texture.destroy(true); },
  };
}
