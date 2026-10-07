import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

/** Вид печати поверх готовой карты. Размеры — в клетках: стиль масштабируется вместе с картой. */
export interface MapLook {
  /** На сколько клеток цвет съезжает относительно чёрной линии. */
  shift: readonly [number, number];
  /** Размах дрожания линии, клеток. */
  wobble: number;
  /** Сила зерна бумаги, 0…1. */
  grain: number;
}

// `uInputSize` объявлен с highp, как в вершинном шейдере PixiJS: при разной
// точности программа не линкуется.
// Тушь остаётся на месте, цвет берётся со сдвигом — как при печати в две
// краски с неточным совмещением. Чтобы линия не двоилась, сдвинутый тёмный
// пиксель считается линией, а не цветом, и заменяется несдвинутым.
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec2 uShift;
uniform float uWobble;
uniform float uGrain;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ink(vec3 c) { return 1.0 - smoothstep(0.18, 0.42, dot(c, vec3(0.299, 0.587, 0.114))); }
vec3 at(vec2 px) { return texture(uTexture, clamp(px * uInputSize.zw, uInputClamp.xy, uInputClamp.zw)).rgb; }

void main() {
  vec2 px = vTextureCoord * uInputSize.xy;
  // Мировые координаты: рисунок шума привязан к карте и не плывёт при сдвиге.
  vec2 world = (px - uOrigin) / uScale;
  // Дрожание не больше шести пикселей: на сильном приближении линия не должна ломаться.
  float amp = min(uWobble * uScale, 6.0);
  px += (vec2(noise(world * 1.7), noise(world * 1.7 + 31.7)) - 0.5) * 2.0 * amp;
  vec3 line = at(px);
  vec2 shift = uShift * uScale;
  float len = length(shift);
  if (len > 8.0) shift *= 8.0 / len;
  vec3 tint = at(px + shift);
  tint = mix(tint, line, ink(tint));
  vec3 color = mix(tint, line, ink(line));
  // Зерно — в пикселях экрана, но привязано к сдвигу карты.
  color *= 1.0 - uGrain * (hash(floor(px - uOrigin)) - 0.5);
  finalColor = vec4(color, 1.0);
}`;

/** Один проход на всю карту. Камера и вид приходят через `aim`. */
export function createStyleFilter() {
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-style" }),
    resources: { look: {
      uOrigin: { value: new Float32Array(2), type: "vec2<f32>" }, uScale: { value: 1, type: "f32" },
      uShift: { value: new Float32Array(2), type: "vec2<f32>" }, uWobble: { value: 0, type: "f32" }, uGrain: { value: 0, type: "f32" },
    } },
    resolution: 1, antialias: "off", padding: 0,
  });
  const uniforms = filter.resources.look.uniforms as { uOrigin: Float32Array; uScale: number; uShift: Float32Array; uWobble: number; uGrain: number };
  return {
    filter,
    /** `x`, `y` — мировой ноль в пикселях устройства, `scale` — пикселей устройства на клетку. */
    aim(look: MapLook, x: number, y: number, scale: number) {
      uniforms.uOrigin[0] = x; uniforms.uOrigin[1] = y; uniforms.uScale = scale;
      uniforms.uShift[0] = look.shift[0]; uniforms.uShift[1] = look.shift[1];
      uniforms.uWobble = look.wobble; uniforms.uGrain = look.grain;
    },
  };
}
