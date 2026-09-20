import { brushCells, cellKey, neighbors, pixelToCell } from "../../grid";
import type { MapFull } from "../../mapTypes";
import type { MapCells } from "../../render";
import type { BrushSize, PaintTool } from "../editorTypes";

// Красящие инструменты (Фаза 1, Tool Controller): paintAt/singleAction/altPick
// и чистые операции paintStroke/floodFill. Историю не владеют: мазок закрывает
// Input (без push здесь), точечные действия пушат через push.

// Мазок кистью/оверлеем/ластиком по клеткам вокруг центра. Возвращает,
// изменилось ли хоть что-то (неменявший мазок в историю не идёт).
export function paintStroke(
  draft: MapCells,
  grid: MapFull["grid"],
  width: number,
  height: number,
  cx: number,
  cy: number,
  size: BrushSize,
  tool: PaintTool,
  terrain: string
): boolean {
  let changed = false;
  for (const cell of brushCells(grid, cx, cy, size, width, height)) {
    const key = cellKey(cell.x, cell.y);
    if (tool === "road" || tool === "river") {
      // Оверлеи ложатся поверх любого террейна (река — и поверх дороги: мост дорисуется сам).
      const set = tool === "road" ? draft.roads : draft.rivers;
      if (!set.has(key)) {
        set.add(key);
        changed = true;
      }
    } else if (tool === "eraser") {
      if ((draft.terrain.get(key) ?? "plain") !== "plain") {
        draft.terrain.delete(key);
        changed = true;
      }
      if (draft.roads.has(key)) {
        draft.roads.delete(key);
        changed = true;
      }
      if (draft.rivers.has(key)) {
        draft.rivers.delete(key);
        changed = true;
      }
    } else {
      if ((draft.terrain.get(key) ?? "plain") !== terrain) {
        if (terrain === "plain") draft.terrain.delete(key);
        else draft.terrain.set(key, terrain);
        changed = true;
      }
    }
  }
  return changed;
}

// Заливка связной области одного террейна (4-связность на квадратах,
// 6 — на гексах). Край поля — естественная граница.
export function floodFill(
  draft: MapCells,
  grid: MapFull["grid"],
  width: number,
  height: number,
  sx: number,
  sy: number,
  terrain: string
): boolean {
  const start = cellKey(sx, sy);
  const from = draft.terrain.get(start) ?? "plain";
  if (from === terrain) return false;
  const seen = new Set<string>([start]);
  const stack = [{ x: sx, y: sy }];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of neighbors(grid, cur.x, cur.y)) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
      const key = cellKey(n.x, n.y);
      if (seen.has(key)) continue;
      if ((draft.terrain.get(key) ?? "plain") !== from) continue;
      seen.add(key);
      stack.push(n);
    }
  }
  for (const key of seen) {
    if (terrain === "plain") draft.terrain.delete(key);
    else draft.terrain.set(key, terrain);
  }
  return seen.size > 0;
}

export interface PaintAtOptions {
  // Временный RMB-ластик: решает Input и передаёт значением (без зависимости
  // tools → input). Выбранный инструмент при этом не меняется.
  eraseOverride?: boolean;
}

interface CreatePaintToolsArgs {
  map: MapFull | null;
  tool: PaintTool;
  terrain: string;
  brushSize: BrushSize;
  cellsRef: { current: MapCells };
  setCells: (c: MapCells) => void;
  push: (before: MapCells) => void;
  clone: (c: MapCells) => MapCells;
  selectTool: (t: PaintTool) => void;
  setTerrain: (t: string) => void;
}

export function createPaintTools(a: CreatePaintToolsArgs) {
  // Синхронный подсчёт: changed считается ДО setCells (иначе апдейтер
  // выполняется позже рендера и одиночный клик возвращал false — мазок
  // терялся для истории, P0-1). Реф обновляется оптимистично сразу, чтобы
  // быстрые pointermove до перерендера не затирали друг друга.
  function paintAt(wx: number, wy: number, opts: PaintAtOptions = {}): boolean {
    if (!a.map) return false;
    const cell = pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height);
    if (!cell) return false;
    const draft = a.clone(a.cellsRef.current);
    const effTool = opts.eraseOverride ? "eraser" : a.tool;
    // Стена дабом — та же кисть террейна, только краска зафиксирована (линия — отдельно).
    const effTerrain = effTool === "wall" ? "wall" : a.terrain;
    const changed = paintStroke(
      draft,
      a.map.grid,
      a.map.width,
      a.map.height,
      cell.x,
      cell.y,
      a.brushSize,
      effTool,
      effTerrain
    );
    if (!changed) return false;
    a.cellsRef.current = draft;
    a.setCells(draft);
    return true;
  }

  function singleAction(wx: number, wy: number) {
    if (!a.map) return;
    const cell = pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height);
    if (!cell) return;
    if (a.tool === "picker") {
      const t = a.cellsRef.current.terrain.get(cellKey(cell.x, cell.y)) ?? "plain";
      a.setTerrain(t);
      a.selectTool("brush");
      return;
    }
    // fill
    const before = a.clone(a.cellsRef.current);
    const draft = a.clone(before);
    if (floodFill(draft, a.map.grid, a.map.width, a.map.height, cell.x, cell.y, a.terrain)) {
      a.cellsRef.current = draft;
      a.setCells(draft);
      a.push(before);
    }
  }

  function altPick(wx: number, wy: number) {
    if (!a.map) return;
    // Пипетка поверх любого инструмента (P1-9 + Этап C): берёт террейн, а клетка
    // с оверлеем включает его инструмент (дорога — верхняя, потом река).
    // С активным оверлеем Alt+клик наоборот точечно снимает его, террейн не трогая.
    const cell = pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height);
    if (cell) {
      const key = cellKey(cell.x, cell.y);
      const active = a.tool;
      if (active === "road" || active === "river") {
        const set = active === "road" ? a.cellsRef.current.roads : a.cellsRef.current.rivers;
        if (set.has(key)) {
          const before = a.clone(a.cellsRef.current);
          const draft = a.clone(before);
          (active === "road" ? draft.roads : draft.rivers).delete(key);
          a.cellsRef.current = draft;
          a.setCells(draft);
          a.push(before);
        }
      } else {
        a.setTerrain(a.cellsRef.current.terrain.get(key) ?? "plain");
        a.selectTool(
          a.cellsRef.current.roads.has(key)
            ? "road"
            : a.cellsRef.current.rivers.has(key)
              ? "river"
              : "brush"
        );
      }
    }
  }

  return { paintAt, singleAction, altPick };
}

export type PaintTools = ReturnType<typeof createPaintTools>;
