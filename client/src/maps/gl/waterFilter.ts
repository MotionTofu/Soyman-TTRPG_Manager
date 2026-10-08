import { defaultFilterVert, Filter, GlProgram, Texture } from "pixi.js";
import { flattenSplineWithWidths } from "../core/spline";
import type { MapRenderModel } from "../renderModel";
import { waterDepth as depthOf } from "../crossings";

/** Вода шейдером (проба 2026-10-08). `mode`: 0 — комикс-панк, 1 — пиксель-арт; `size` — пикселей на клетку во втором. */
export interface MapWater { mode: 0 | 1; speed: number; size: number }

/** Точек маски на клетку. Маска — вся карта одной картинкой: красный канал — «здесь вода», зелёный — «глубоко». */
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
      const depth = depthOf(mask.source.codes[chunk.values[i] - 1]);
      const x0 = Math.round((mask.origin.x + (chunk.cx * 16 + i % 16) * mask.sampleSize) * K), y0 = Math.round((mask.origin.y + (chunk.cy * 16 + Math.floor(i / 16)) * mask.sampleSize) * K);
      for (let y = Math.max(0, y0); y < Math.min(h, y0 + Math.max(1, Math.round(step))); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + Math.max(1, Math.round(step))); x++) {
        const at = (y * w + x) * 4; data[at] = depth ? 255 : 0; data[at + 1] = depth === 2 ? 255 : 0;
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
      pen.strokeStyle = /deep/.test(path.style) ? "#ffff00" : "#ff0000";
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

// Комикс-панк: плоская заливка, пятна, толстые дуги волн, тушевый берег и рваная пена.
vec4 comic(vec2 w, float t) {
  vec2 mk = texture(uMask, w / uMap).rg;
  float edge = mk.r + (noise(w * 2.7) - 0.5) * 0.14;
  // Порог ниже середины: шейдер закрывает и размытый край картинки воды под собой.
  float a = smoothstep(0.38, 0.44, edge);
  if (a <= 0.0) return vec4(0.0);
  float tick = floor(t * 5.0);
  float deep = smoothstep(0.35, 0.7, mk.g);
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

// Пиксель-арт: всё считается по целым «пикселям» карты, четыре тона с шахматным смешением.
vec4 pixel(vec2 w, float t) {
  float P = uWater.z;
  vec2 p = floor(w * P);
  vec2 mk = texture(uMask, (p + 0.5) / P / uMap).rg;
  if (mk.r < 0.4) return vec4(0.0);
  float tick = floor(t * 6.0);
  float n = noise(p * vec2(0.16, 0.33) + vec2(tick * 0.09, tick * 0.04)) * 0.6 + noise(p * vec2(0.06, 0.11) - vec2(tick * 0.03, 0.0)) * 0.4;
  float v = n + mod(p.x + p.y, 2.0) * 0.07 - 0.3 * smoothstep(0.35, 0.7, mk.g);
  vec3 col = v < 0.3 ? vec3(0.09, 0.2, 0.31) : v < 0.47 ? vec3(0.12, 0.37, 0.55) : v < 0.62 ? vec3(0.18, 0.56, 0.69) : vec3(0.36, 0.76, 0.79);
  // Блики: короткие горизонтальные чёрточки, бегущие по течению.
  float gx = floor((p.x + tick + hash(vec2(p.y, 1.0)) * 40.0) / 3.0);
  col = mix(col, vec3(0.85, 0.96, 0.94), step(0.93, hash(vec2(gx, p.y))) * step(0.45, n));
  // Пена у берега: сплошная кромка в один пиксель и рваная полоса за ней.
  float shore = smoothstep(0.4, 1.0, mk.r);
  col = mix(col, vec3(0.93, 0.98, 0.96), min(1.0, step(shore, 0.12) + step(shore, 0.4) * step(0.55, hash(p + tick))));
  return vec4(col, 1.0);
}

void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec2 world = (vTextureCoord * uInputSize.xy - uOrigin) / uScale;
  vec4 water = vec4(0.0);
  if (world.x > 0.0 && world.y > 0.0 && world.x < uMap.x && world.y < uMap.y) {
    float t = uTime * uWater.y;
    water = uWater.x > 0.5 ? pixel(world, t) : comic(world, t);
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
