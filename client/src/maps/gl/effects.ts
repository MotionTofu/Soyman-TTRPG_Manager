import type { MapLook } from "./styleFilter";
import type { MapWeather } from "./weatherFilter";
import type { MapWater } from "./waterFilter";

/** Эффекты меню «Эффекты» и их ползунки. Проба: выбор живёт в браузере, не в
 * карте, поэтому игроки его не видят. На шаге «Стол» погода станет состоянием сцены. */
interface Param { key: string; label: string; min: number; max: number; step: number; value: number }
const amount: Param = { key: "amount", label: "Сила", min: 0, max: 3, step: 0.1, value: 1 };
const speed: Param = { key: "speed", label: "Скорость", min: 0, max: 3, step: 0.1, value: 1 };
const cloud: Param[] = [{ key: "density", label: "Плотность", min: 0.1, max: 1, step: 0.05, value: 0.7 }, speed,
  { key: "size", label: "Размер клочьев", min: 0.3, max: 3, step: 0.1, value: 1 }];
export const EFFECTS = {
  shift: { label: "Съехавшая печать", group: "Печать", params: [amount] },
  wobble: { label: "Дрожащая линия", group: "Печать", params: [amount] },
  grain: { label: "Зерно бумаги", group: "Печать", params: [amount] },
  fog: { label: "Туман", group: "Погода", params: cloud },
  smoke: { label: "Дым", group: "Погода", params: cloud },
  rain: { label: "Дождь", group: "Погода", params: [{ key: "density", label: "Густота", min: 0.1, max: 1, step: 0.05, value: 0.5 }, speed,
    { key: "slant", label: "Наклон", min: -0.6, max: 0.6, step: 0.05, value: 0.2 }] },
  snow: { label: "Снег", group: "Погода", params: [{ key: "density", label: "Густота", min: 0.1, max: 1, step: 0.05, value: 0.5 }, speed,
    { key: "size", label: "Размер хлопьев", min: 0.4, max: 2.5, step: 0.1, value: 1 }] },
  stars: { label: "Звездопад", group: "Погода", params: [{ key: "night", label: "Темнота ночи", min: 0, max: 1, step: 0.05, value: 0.7 },
    { key: "rate", label: "Падающие звёзды", min: 0, max: 1, step: 0.05, value: 0.3 }] },
  // Проба: вода шейдером вместо картинки. Включены обе — рисуется пиксельная.
  water: { label: "Живая вода — комикс", group: "Вода (проба)", params: [speed] },
  waterPixel: { label: "Живая вода — пиксель-арт", group: "Вода (проба)", params: [speed, { key: "size", label: "Пикселей на клетку", min: 4, max: 16, step: 1, value: 8 }] },
} satisfies Record<string, { label: string; group: string; params: Param[] }>;
export type MapEffect = keyof typeof EFFECTS;
export interface EffectState { on: boolean; values: Record<string, number> }
export type MapEffects = Record<MapEffect, EffectState>;

const KEY = "soyman.mapEffects.v2";
const NAMES = Object.keys(EFFECTS) as MapEffect[];
export const defaultMapEffects = (): MapEffects => Object.fromEntries(NAMES.map((name) =>
  [name, { on: EFFECTS[name].group === "Печать", values: Object.fromEntries(EFFECTS[name].params.map((param) => [param.key, param.value])) }])) as MapEffects;

export function loadMapEffects(): MapEffects {
  const effects = defaultMapEffects();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<MapEffect, Partial<EffectState>>>;
    for (const name of NAMES) {
      if (typeof stored[name]?.on === "boolean") effects[name].on = stored[name].on;
      for (const param of EFFECTS[name].params) {
        const value = stored[name]?.values?.[param.key];
        if (typeof value === "number" && value >= param.min && value <= param.max) effects[name].values[param.key] = value;
      }
    }
  } catch { /* битая запись — исходные значения */ }
  return effects;
}
export function saveMapEffects(effects: MapEffects) {
  try { localStorage.setItem(KEY, JSON.stringify(effects)); } catch { /* выбор живёт до перезагрузки */ }
}

/** Вид печати оформления с учётом ползунков; `null` — проход не нужен. */
export function chosenLook(look: MapLook | null, effects: MapEffects): MapLook | null {
  if (!look) return null;
  const k = (name: MapEffect) => effects[name].on ? effects[name].values.amount : 0;
  const chosen: MapLook = { shift: [look.shift[0] * k("shift"), look.shift[1] * k("shift")], wobble: look.wobble * k("wobble"), grain: Math.min(1, look.grain * k("grain")) };
  return chosen.shift[0] || chosen.shift[1] || chosen.wobble || chosen.grain ? chosen : null;
}
/** Вода шейдером; `null` — вода остаётся картинкой. */
export function chosenWater(effects: MapEffects): MapWater | null {
  if (effects.waterPixel.on) return { mode: 1, speed: effects.waterPixel.values.speed, size: effects.waterPixel.values.size };
  return effects.water.on ? { mode: 0, speed: effects.water.values.speed, size: 8 } : null;
}
/** Погода для шейдера: первым числом сила (0 — выключено), дальше ползунки по порядку. */
export function chosenWeather(effects: MapEffects): MapWeather {
  const pack = (name: MapEffect, first: string, ...rest: string[]): [number, number, number] => {
    const { on, values } = effects[name];
    return [on ? values[first] : 0, values[rest[0]] ?? 0, values[rest[1]] ?? 0];
  };
  const stars = effects.stars;
  return { fog: pack("fog", "density", "speed", "size"), smoke: pack("smoke", "density", "speed", "size"), rain: pack("rain", "density", "speed", "slant"),
    snow: pack("snow", "density", "speed", "size"), stars: [+stars.on, stars.values.night, stars.values.rate] };
}
