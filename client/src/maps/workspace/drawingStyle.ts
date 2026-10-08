import { MAP_WATER_LOOKS, type MapDocumentV6, type MapDrawingStyle } from "@shared/maps/core";
import type { MapWater } from "../water";
import type { MapLook } from "../gl/styleFilter";
import { MAP_TERRAIN_FILL, readChrome } from "../render";
import { VILLAGE_FILL, WATER_DEPTHS, waterCode } from "../assets/village";

// Stable identities let Canvas reuse the surface bitmap while panning.
const PALETTES = {
  blueprint: { ...MAP_TERRAIN_FILL, ...VILLAGE_FILL, plain: "#ffffff", wall: "#293541", stone: "#e9edf0" },
  "paper-ink": { ...MAP_TERRAIN_FILL, ...VILLAGE_FILL, plain: "#eee5ce", wall: "#ddd2b5", stone: "#cbbf9e" },
  // Прозрачный камень накладывает рисунок на бумагу; толща скалы — чёрная тушь.
  "comic-punk": { ...MAP_TERRAIN_FILL, ...VILLAGE_FILL, plain: "#d8cfb6", wall: "#1b1a18", stone: "#d8cfb600" },
};

/** Вид печати по оформлению: сдвиг цвета, дрожание линии, зерно. Работает только
 * в отрисовке через WebGL; у «Чертежа» линии должны оставаться ровными. */
const LOOKS: Record<MapDrawingStyle, MapLook | null> = {
  "comic-punk": { shift: [0.05, 0.035], wobble: 0.03, grain: 0.1 },
  "paper-ink": { shift: [0, 0], wobble: 0.015, grain: 0.08 },
  blueprint: null,
};
export const styleLook = (document: MapDocumentV6) => LOOKS[document.appearance?.style ?? "paper-ink"];
/** Живая вода карты; null — вода остаётся картинкой. */
export function mapWater(document: MapDocumentV6): MapWater | null {
  const look = document.appearance?.water;
  return look ? { mode: MAP_WATER_LOOKS.indexOf(look) as MapWater["mode"], speed: document.appearance?.waterSpeed ?? 1, size: document.appearance?.waterPixels ?? 8, shoal: document.appearance?.waterShoal ?? 0 } : null;
}
const filled = new WeakMap<object, Map<object, Record<string, string>>>();
function ownFills(palette: Record<string, string>, liquids: readonly { key: string; tones: readonly string[] }[]) {
  let known = filled.get(liquids); if (!known) filled.set(liquids, known = new Map());
  let fills = known.get(palette);
  if (!fills) known.set(palette, fills = { ...palette, ...Object.fromEntries(liquids.flatMap(item => WATER_DEPTHS.map(depth => [waterCode(depth, item.key), item.tones[1]]))) });
  return fills;
}
export function workspaceDrawingStyle(document: MapDocumentV6) {
  const water = mapWater(document);
  const style = document.appearance?.style ?? "paper-ink";
  const paper = style === "blueprint" ? "#ffffff" : style === "comic-punk" ? "#e9e1c8" : "#f1eedf";
  return {
    chrome: { ...readChrome(), paper, ink: "#171717", line: style === "blueprint" ? "#8494a4" : "#867e69", muted: "#625f54" },
    // Свои жидкости без «живой воды» — ровная заливка средним тоном.
    terrainFill: document.appearance?.liquids?.length ? ownFills(PALETTES[style], document.appearance.liquids) : PALETTES[style],
    fonts: { label: '"Sofia Sans Semi Condensed", sans-serif', mono: '"Sofia Sans Semi Condensed", sans-serif' },
    cartography: style !== "blueprint",
    artPack: style === "comic-punk" ? "crypt" as const : "cartography" as const,
    ...(document.appearance?.frame !== undefined ? { frame: document.appearance.frame } : {}),
    ...(water ? { water } : {}),
  };
}
