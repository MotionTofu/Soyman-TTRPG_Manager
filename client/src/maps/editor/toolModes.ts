import type { MapGrid } from "../mapTypes";
import type { PaintTool } from "./editorTypes";

export type EditorMode = "region" | "local" | "dungeon";

type ToolDescription = { label: string; title: string };

export const TOOL_DESCRIPTIONS: Record<PaintTool, ToolDescription> = {
  select: { label: "Выбор", title: "Выбор (V): выбрать, переместить или удалить объект" },
  brush: { label: "Кисть", title: "Кисть террейна (B)" },
  fill: { label: "Заливка", title: "Заливка связной области (G)" },
  eraser: { label: "Ластик", title: "Очистить террейн, дорогу или реку (E)" },
  picker: { label: "Пипетка", title: "Взять террейн с карты (I)" },
  road: { label: "Дорога", title: "Дорога поверх террейна (R)" },
  river: { label: "Река", title: "Река под дорогами (N)" },
  wall: { label: "Стена", title: "Стена: мазок или полилиния (W)" },
  shape: { label: "Прямоугольник", title: "Прямоугольник: выберите содержимое в свойствах и протяните (U)" },
  ruler: { label: "Линейка", title: "Замер расстояния: два клика, Esc — сброс (M)" },
  label: { label: "Подпись", title: "Создать или изменить подпись (T)" },
  door: { label: "Дверь", title: "Поставить дверь на квадратной сетке (D)" },
  trap: { label: "Ловушка", title: "Поставить ловушку (L)" },
  chest: { label: "Сундук", title: "Поставить сундук (C)" },
  altar: { label: "Алтарь", title: "Поставить алтарь (A)" },
  marker: { label: "Маркер", title: "Поставить маркер выбранного вида (K)" },
  start: { label: "Старт", title: "Поставить точку старта (S)" },
  finish: { label: "Финиш", title: "Поставить точку финиша (F)" },
  asset: { label: "Символ", title: "Разместить свободный символ или своё изображение" },
  fog: { label: "Туман", title: "Раскрывать или скрывать клетки для игроков" },
};

export const COMMON_TOOLS: readonly PaintTool[] = ["select", "eraser", "picker", "ruler", "label", "fog"];

export const MODE_TOOLS: Record<EditorMode, readonly PaintTool[]> = {
  region: ["brush", "fill", "road", "river", "marker", "asset"],
  local: ["brush", "fill", "road", "river", "shape", "wall", "asset"],
  dungeon: ["shape", "wall", "brush", "fill", "door", "trap", "chest", "altar", "start", "finish"],
};

export const DEFAULT_MODE_TOOL: Record<EditorMode, PaintTool> = {
  region: "brush",
  local: "brush",
  dungeon: "shape",
};

const ALL_TOOLS = Object.keys(TOOL_DESCRIPTIONS) as PaintTool[];

export function extraToolsForMode(mode: EditorMode): PaintTool[] {
  const visible = new Set([...COMMON_TOOLS, ...MODE_TOOLS[mode]]);
  return ALL_TOOLS.filter((tool) => !visible.has(tool));
}

export function toolUnavailableReason(tool: PaintTool, grid: MapGrid | undefined): string | null {
  return tool === "door" && grid === "hex" ? "Двери можно ставить только на квадратной сетке." : null;
}
