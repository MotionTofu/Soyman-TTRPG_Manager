import type { MapDocumentV6 } from "@shared/maps/core";
import { MAP_TERRAIN_FILL, readChrome } from "../render";

// Stable identities let Canvas reuse the surface bitmap while panning.
const PALETTES = {
  blueprint: { ...MAP_TERRAIN_FILL, plain: "#ffffff", wall: "#293541", stone: "#e9edf0" },
  "paper-ink": { ...MAP_TERRAIN_FILL, plain: "#eee5ce", wall: "#ddd2b5", stone: "#cbbf9e" },
  // Прозрачный камень накладывает рисунок на бумагу; толща скалы — чёрная тушь.
  "comic-punk": { ...MAP_TERRAIN_FILL, plain: "#d8cfb6", wall: "#1b1a18", stone: "#d8cfb600" },
};

export function workspaceDrawingStyle(document: MapDocumentV6) {
  const style = document.appearance?.style ?? "paper-ink";
  const paper = style === "blueprint" ? "#ffffff" : style === "comic-punk" ? "#e9e1c8" : "#f1eedf";
  return {
    chrome: { ...readChrome(), paper, ink: "#171717", line: style === "blueprint" ? "#8494a4" : "#867e69", muted: "#625f54" },
    terrainFill: PALETTES[style],
    fonts: { label: '"Sofia Sans Semi Condensed", sans-serif', mono: '"Sofia Sans Semi Condensed", sans-serif' },
    cartography: style !== "blueprint",
    artPack: style === "comic-punk" ? "crypt" as const : "cartography" as const,
  };
}
