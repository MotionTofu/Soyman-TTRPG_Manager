import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

/** Погода поверх карты. Первое число — сила (0 — выключено), дальше свои настройки:
 * туман и дым — скорость и размер клочьев; дождь — скорость и наклон; снег —
 * скорость и размер хлопьев; звездопад — включён, темнота ночи, частота падающих. */
type Knobs = readonly [number, number, number];
export interface MapWeather { fog: Knobs; smoke: Knobs; rain: Knobs; snow: Knobs; stars: Knobs }
export const anyWeather = (weather: MapWeather) => Object.values(weather).some((knobs: Knobs) => knobs[0] > 0);

// Всё считается в шейдере, без картинок и частиц. Туман и дым привязаны к карте
// (плывут над ней и масштабируются вместе с ней), осадки и звёзды — к экрану.
// `uInputSize` — highp, как в вершинном шейдере PixiJS, иначе программа не линкуется.
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uTime;
uniform vec3 uFog;
uniform vec3 uSmoke;
uniform vec3 uRain;
uniform vec3 uSnow;
uniform vec3 uStars;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }

void main() {
  vec3 c = texture(uTexture, vTextureCoord).rgb;
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 world = (px - uOrigin) / uScale;
  float t = uTime;

  if (uStars.x > 0.0) {
    // Ночь: без затемнения светлые росчерки на бумаге не видны.
    c *= mix(vec3(1.0), vec3(0.14, 0.17, 0.4), uStars.y);
    vec2 cell = floor(px / 46.0), f = fract(px / 46.0) - 0.5 - (vec2(hash(cell), hash(cell + 9.0)) - 0.5) * 0.7;
    float twinkle = 0.5 + 0.5 * sin(t * (1.0 + 3.0 * hash(cell + 3.0)) + 40.0 * hash(cell + 5.0));
    c += step(0.7, hash(cell + 1.0)) * smoothstep(0.05, 0.0, length(f)) * twinkle * vec3(1.0, 0.97, 0.8);
    // Падающие звёзды: дорожки под углом, в каждой время от времени пролетает одна.
    vec2 dir = normalize(vec2(1.0, 0.55));
    float along = dot(px, dir), across = dot(px, vec2(-dir.y, dir.x));
    float lane = floor(across / 70.0), slot = t * 0.35 + hash(vec2(lane, 2.0)) * 7.0;
    float live = step(1.0 - 0.9 * uStars.z, hash(vec2(lane, floor(slot))));
    float head = fract(slot) * 2600.0 - 300.0 + hash(vec2(lane, 4.0)) * 400.0, tail = head - along;
    float mid = (lane + 0.2 + 0.6 * hash(vec2(lane, floor(slot) + 8.0))) * 70.0;
    c += live * step(0.0, tail) * smoothstep(240.0, 0.0, tail) * smoothstep(2.2, 0.0, abs(across - mid)) * vec3(1.0, 0.95, 0.7);
  }
  if (uSmoke.x > 0.0) {
    float ts = t * uSmoke.y;
    vec2 q = world * 0.35 / uSmoke.z + vec2(ts * 0.05, -ts * 0.11);
    float n = fbm(q + fbm(q * 1.7 - ts * 0.07));
    c = mix(c, vec3(0.16, 0.15, 0.15), smoothstep(0.42, 0.78, n) * 1.15 * uSmoke.x);
  }
  if (uFog.x > 0.0) {
    float tf = t * uFog.y;
    // Клочьями, а не ровной пеленой: сквозь разрывы карта видна как есть.
    vec2 q = world / uFog.z;
    float n = fbm(q * 0.22 + vec2(tf * 0.09, tf * 0.03) + fbm(q * 0.1 - tf * 0.02));
    c = mix(c, vec3(0.93, 0.94, 0.95), min(1.0, smoothstep(0.3, 0.8, n) * 1.3 * uFog.x));
  }
  if (uRain.x > 0.0) {
    c *= 1.0 - 0.2 * uRain.x;
    for (int i = 1; i <= 3; i++) {
      float k = float(i);
      vec2 g = vec2(px.x + px.y * uRain.z, px.y) / vec2(9.0 + 5.0 * k, 70.0 + 30.0 * k);
      float col = floor(g.x), y = g.y - t * uRain.y * (2.6 - 0.4 * k + hash(vec2(col, k))) + hash(vec2(col, 7.0)) * 10.0;
      float f = fract(y), on = step(1.0 - 0.8 * uRain.x, hash(vec2(col, floor(y) + k * 13.0)));
      float drop = on * smoothstep(0.14, 0.0, abs(fract(g.x) - 0.5)) * smoothstep(0.0, 0.5, f) * smoothstep(1.0, 0.85, f);
      c = mix(c, vec3(0.42, 0.5, 0.68), drop * 0.55);
    }
  }
  if (uSnow.x > 0.0) {
    for (int i = 1; i <= 3; i++) {
      float k = float(i);
      vec2 p = px / (18.0 + 12.0 * k);
      p.y -= t * uSnow.y * (0.9 - 0.15 * k);
      p.x += sin(p.y * 1.3 + t * uSnow.y * 0.6 + k) * 0.25;
      vec2 cell = floor(p), f = fract(p) - 0.5 - (vec2(hash(cell + k), hash(cell + k + 5.0)) - 0.5) * 0.6;
      float r = min(0.45, (0.08 + 0.1 * hash(cell + 2.0)) * uSnow.z), d = length(f), on = step(1.0 - 1.1 * uSnow.x, hash(cell + 3.0 + k));
      // Серо-синий ободок: белая снежинка на бумаге иначе теряется.
      c = mix(c, vec3(0.5, 0.56, 0.68), on * 0.6 * smoothstep(r * 1.7, r, d));
      c = mix(c, vec3(1.0), on * smoothstep(r, r * 0.5, d));
    }
  }
  finalColor = vec4(c, 1.0);
}`;

/** Один анимированный проход. Камера, время и погода приходят через `aim`. */
export function createWeatherFilter() {
  const f32 = (value = 0) => ({ value, type: "f32" as const });
  const vec3 = () => ({ value: new Float32Array(3), type: "vec3<f32>" as const });
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-weather" }),
    resources: { weather: { uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: f32(1), uTime: f32(),
      uFog: vec3(), uSmoke: vec3(), uRain: vec3(), uSnow: vec3(), uStars: vec3() } },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.weather.uniforms as { uOrigin: Float32Array; uScale: number; uTime: number; uFog: Float32Array; uSmoke: Float32Array; uRain: Float32Array; uSnow: Float32Array; uStars: Float32Array };
  return {
    filter,
    aim(weather: MapWeather, x: number, y: number, scale: number, seconds: number) {
      uniforms.uOrigin[0] = x; uniforms.uOrigin[1] = y; uniforms.uScale = scale;
      // Час по кругу: у float в шейдере на больших числах пропадает плавность.
      uniforms.uTime = seconds % 3600;
      uniforms.uFog.set(weather.fog); uniforms.uSmoke.set(weather.smoke); uniforms.uRain.set(weather.rain); uniforms.uSnow.set(weather.snow); uniforms.uStars.set(weather.stars);
    },
  };
}
