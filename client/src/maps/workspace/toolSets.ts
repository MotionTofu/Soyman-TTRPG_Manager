import type { MapDocumentV6 } from "@shared/maps/core";
import { mapKind, type MapScale } from "../mapTypes";
import type { WorkspaceTool } from "./editorCommands";

export type ToolSet = "dungeon" | "locality" | "world";
export const TOOL_SET_LABELS: Record<ToolSet, string> = { dungeon: "Подземелье", locality: "Местность", world: "Мир" };

/** Rail groups, separated visually. A set gets its own tools (Обставить, Здание,
 * Горы…) on its redesign step; until then it arranges the existing ones. */
export const TOOL_SETS: Record<ToolSet, WorkspaceTool[][]> = {
  dungeon: [["select"], ["shape", "wall", "door"], ["brush", "asset", "eraser"], ["label"]],
  locality: [["select"], ["surface", "liquid", "river", "road", "wall"], ["scatter", "asset", "eraser"], ["label"]],
  world: [["select"], ["surface", "liquid", "river", "road"], ["scatter", "asset", "eraser"], ["label"]],
};
export const toolsOf = (set: ToolSet) => TOOL_SETS[set].flat();
/** Tools that pick what they place from the catalog. */
export const CATALOG_TOOLS: WorkspaceTool[] = ["asset", "brush", "surface", "scatter", "road", "river", "wall"];

/** Наборы по виду карты: у тактической выбор из двух, у обзорной — один. */
const TACTICAL_SETS: readonly ToolSet[] = ["dungeon", "locality"], OVERVIEW_SETS: readonly ToolSet[] = ["world"];
export const setsOf = (scale: MapScale) => mapKind(scale) === "tactical" ? TACTICAL_SETS : OVERVIEW_SETS;
const storageKey = (mapId: number) => `soyman.map-tool-set.${mapId}`;

/** Last choice for this map among the sets of its kind; a tactical map with rooms is a dungeon. */
export function initialToolSet(mapId: number, scale: MapScale, document: MapDocumentV6): ToolSet {
  const sets = setsOf(scale);
  try {
    const stored = localStorage.getItem(storageKey(mapId));
    if (sets.includes(stored as ToolSet)) return stored as ToolSet;
  } catch { /* storage unavailable: fall back to the map itself */ }
  if (sets.length === 1) return sets[0];
  return document.layers.some((layer) => layer.kind === "gameplay" && layer.items.some((item) => item.kind === "room")) ? "dungeon" : "locality";
}
export function rememberToolSet(mapId: number, set: ToolSet) {
  try { localStorage.setItem(storageKey(mapId), set); } catch { /* a convenience only */ }
}
