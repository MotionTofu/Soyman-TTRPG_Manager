import type { MapKind } from "../mapTypes";
import { TOOL_LABELS, type WorkspaceTool } from "./editorCommands";

/** Панель инструментов по виду карты, группами: выбор · земля · постройки · наполнение · прочее.
 * Наборов-переключателей нет: дом в деревне требует и комнат с дверями, и дороги с рекой. */
export const TOOL_GROUPS: Record<MapKind, WorkspaceTool[][]> = {
  tactical: [["select"], ["surface", "liquid", "river", "road"], ["shape", "wall", "door"], ["scatter", "asset"], ["eraser", "label"]],
  // В городе комнат и дверей нет: дом — одна клетка. «Комната» здесь рисует квартал.
  city: [["select"], ["surface", "liquid", "river", "road"], ["wall", "shape"], ["scatter", "asset"], ["eraser", "label"]],
  overview: [["select"], ["surface", "liquid", "river", "road"], ["scatter", "asset"], ["eraser", "label"]],
};
/** «Пол» по клеткам на панели не стоит: это второй способ рисования «Поверхности», его включают в её настройках. */
export const toolsOf = (kind: MapKind): WorkspaceTool[] => [...TOOL_GROUPS[kind].flat(), "brush"];
export const toolLabel = (kind: MapKind, tool: WorkspaceTool) => kind === "city" && tool === "shape" ? "Квартал" : TOOL_LABELS[tool];
/** Tools that pick what they place from the catalog. */
export const CATALOG_TOOLS: WorkspaceTool[] = ["asset", "brush", "surface", "scatter", "road", "river", "wall"];
