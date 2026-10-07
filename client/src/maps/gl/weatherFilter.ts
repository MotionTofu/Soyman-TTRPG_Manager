import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

/** Погода поверх карты: каждое поле — сила от 0 до 1. */
export interface MapWeather { fog: number; smoke: number; rain: number; snow: number; stars: number }
export const anyWeather = (weather: MapWeather) => weather.fog + weather.smoke + weather.rain + weather.snow + weather.stars > 0;

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
uniform float uFog;
uniform float uSmoke;
uniform float uRain;
uniform float uSnow;
uniform float uStars;

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

  if (uStars > 0.0) {
    // Ночь: без затемнения светлые росчерки на бумаге не видны.
    c *= mix(vec3(1.0), vec3(0.3, 0.34, 0.55), uStars);
    vec2 cell = floor(px / 46.0), f = fract(px / 46.0) - 0.5 - (vec2(hash(cell), hash(cell + 9.0)) - 0.5) * 0.7;
    float twinkle = 0.5 + 0.5 * sin(t * (1.0 + 3.0 * hash(cell + 3.0)) + 40.0 * hash(cell + 5.0));
    c += uStars * step(0.7, hash(cell + 1.0)) * smoothstep(0.05, 0.0, length(f)) * twinkle * vec3(1.0, 0.97, 0.8);
    // Падающие звёзды: дорожки под углом, в каждой время от времени пролетает одна.
    vec2 dir = normalize(vec2(1.0, 0.55));
    float along = dot(px, dir), across = dot(px, vec2(-dir.y, dir.x));
    float lane = floor(across / 70.0), slot = t * 0.35 + hash(vec2(lane, 2.0)) * 7.0;
    float live = step(0.72, hash(vec2(lane, floor(slot))));
    float head = fract(slot) * 2600.0 - 300.0 + hash(vec2(lane, 4.0)) * 400.0, tail = head - along;
    float mid = (lane + 0.2 + 0.6 * hash(vec2(lane, floor(slot) + 8.0))) * 70.0;
    c += uStars * live * step(0.0, tail) * smoothstep(240.0, 0.0, tail) * smoothstep(2.2, 0.0, abs(across - mid)) * vec3(1.0, 0.95, 0.7);
  }
  if (uSmoke > 0.0) {
    vec2 q = world * 0.35 + vec2(t * 0.05, -t * 0.11);
    float n = fbm(q + fbm(q * 1.7 - t * 0.07));
    c = mix(c, vec3(0.16, 0.15, 0.15), smoothstep(0.42, 0.78, n) * 0.8 * uSmoke);
  }
  if (uFog > 0.0) {
    // Клочьями, а не ровной пеленой: сквозь разрывы карта видна как есть.
    float n = fbm(world * 0.22 + vec2(t * 0.09, t * 0.03) + fbm(world * 0.1 - t * 0.02));
    c = mix(c, vec3(0.93, 0.94, 0.95), smoothstep(0.3, 0.8, n) * 0.9 * uFog);
  }
  if (uRain > 0.0) {
    c *= 1.0 - 0.12 * uRain;
    for (int i = 1; i <= 3; i++) {
      float k = float(i);
      vec2 g = vec2(px.x + px.y * 0.2, px.y) / vec2(9.0 + 5.0 * k, 70.0 + 30.0 * k);
      float col = floor(g.x), y = g.y - t * (2.6 - 0.4 * k + hash(vec2(col, k))) + hash(vec2(col, 7.0)) * 10.0;
      float f = fract(y), on = step(0.6, hash(vec2(col, floor(y) + k * 13.0)));
      float drop = on * smoothstep(0.14, 0.0, abs(fract(g.x) - 0.5)) * smoothstep(0.0, 0.5, f) * smoothstep(1.0, 0.85, f);
      c = mix(c, vec3(0.42, 0.5, 0.68), drop * 0.55 * uRain);
    }
  }
  if (uSnow > 0.0) {
    for (int i = 1; i <= 3; i++) {
      float k = float(i);
      vec2 p = px / (18.0 + 12.0 * k);
      p.y -= t * (0.9 - 0.15 * k);
      p.x += sin(p.y * 1.3 + t * 0.6 + k) * 0.25;
      vec2 cell = floor(p), f = fract(p) - 0.5 - (vec2(hash(cell + k), hash(cell + k + 5.0)) - 0.5) * 0.6;
      float r = 0.08 + 0.1 * hash(cell + 2.0), d = length(f), on = step(0.45, hash(cell + 3.0 + k)) * uSnow;
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
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-weather" }),
    resources: { weather: { uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: f32(1), uTime: f32(),
      uFog: f32(), uSmoke: f32(), uRain: f32(), uSnow: f32(), uStars: f32() } },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.weather.uniforms as { uOrigin: Float32Array; uScale: number; uTime: number; uFog: number; uSmoke: number; uRain: number; uSnow: number; uStars: number };
  return {
    filter,
    aim(weather: MapWeather, x: number, y: number, scale: number, seconds: number) {
      uniforms.uOrigin[0] = x; uniforms.uOrigin[1] = y; uniforms.uScale = scale;
      // Час по кругу: у float в шейдере на больших числах пропадает плавность.
      uniforms.uTime = seconds % 3600;
      uniforms.uFog = weather.fog; uniforms.uSmoke = weather.smoke; uniforms.uRain = weather.rain; uniforms.uSnow = weather.snow; uniforms.uStars = weather.stars;
    },
  };
}
