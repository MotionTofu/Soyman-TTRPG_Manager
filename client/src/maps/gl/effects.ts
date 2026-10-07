import type { MapLook } from "./styleFilter";
import type { MapWeather } from "./weatherFilter";

/** Что включено в меню «Эффекты». Проба: выбор живёт в браузере, не в карте,
 * поэтому игроки его не видят. На шаге «Стол» погода станет состоянием сцены. */
export const PRINT_EFFECTS = { shift: "Съехавшая печать", wobble: "Дрожащая линия", grain: "Зерно бумаги" } as const;
export const WEATHER_EFFECTS = { fog: "Туман", smoke: "Дым", rain: "Дождь", snow: "Снег", stars: "Звездопад" } as const;
export type MapEffect = keyof typeof PRINT_EFFECTS | keyof typeof WEATHER_EFFECTS;
export type MapEffects = Record<MapEffect, boolean>;

const KEY = "soyman.mapEffects";
const DEFAULTS: MapEffects = { shift: true, wobble: true, grain: true, fog: false, smoke: false, rain: false, snow: false, stars: false };

export function loadMapEffects(): MapEffects {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MapEffects>;
    return Object.fromEntries(Object.entries(DEFAULTS).map(([name, value]) => [name, typeof stored[name as MapEffect] === "boolean" ? stored[name as MapEffect] : value])) as MapEffects;
  } catch { return DEFAULTS; }
}
export function saveMapEffects(effects: MapEffects) {
  try { localStorage.setItem(KEY, JSON.stringify(effects)); } catch { /* выбор живёт до перезагрузки */ }
}

/** Вид печати оформления с учётом выключенных эффектов; `null` — проход не нужен. */
export function chosenLook(look: MapLook | null, effects: MapEffects): MapLook | null {
  if (!look) return null;
  const chosen: MapLook = { shift: effects.shift ? look.shift : [0, 0], wobble: effects.wobble ? look.wobble : 0, grain: effects.grain ? look.grain : 0 };
  return chosen.shift[0] || chosen.shift[1] || chosen.wobble || chosen.grain ? chosen : null;
}
export const chosenWeather = (effects: MapEffects): MapWeather =>
  ({ fog: +effects.fog, smoke: +effects.smoke, rain: +effects.rain, snow: +effects.snow, stars: +effects.stars });
