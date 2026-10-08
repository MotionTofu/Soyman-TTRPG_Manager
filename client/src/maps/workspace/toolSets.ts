import type { MapKind } from "../mapTypes";
import type { WorkspaceTool } from "./editorCommands";

/** Панель инструментов по виду карты, группами: выбор · земля · постройки · наполнение · прочее.
 * Наборов-переключателей нет: дом в деревне требует и комнат с дверями, и дороги с рекой. */
export const TOOL_GROUPS: Record<MapKind, WorkspaceTool[][]> = {
  tactical: [["select"], ["surface", "liquid", "river", "road"], ["shape", "wall", "door"], ["scatter", "asset"], ["eraser", "label"]],
  overview: [["select"], ["surface", "liquid", "river", "road"], ["scatter", "asset"], ["eraser", "label"]],
};
/** «Пол» по клеткам на панели не стоит: это второй способ рисования «Поверхности», его включают в её настройках. */
export const toolsOf = (kind: MapKind): WorkspaceTool[] => [...TOOL_GROUPS[kind].flat(), "brush"];
/** Tools that pick what they place from the catalog. */
export const CATALOG_TOOLS: WorkspaceTool[] = ["asset", "brush", "surface", "scatter", "road", "river", "wall"];
