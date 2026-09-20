import type { SetStateAction } from "react";
import { cellCenter, cellKey, pixelToCell } from "../../grid";
import type { MapFull } from "../../mapTypes";
import type { MapCells } from "../../render";

// Стены (Фаза 1, Tool Controller): вершины полилинии, живой конец, финиш
// растеризацией в wall одним history step. Состояния wallDraft/wallLive/
// wallLineMode живут снаружи (UI/хоткеи/рендер их тоже читают) и приходят
// значением + сеттерами; доменная обработка — здесь.

// Растеризация отрезка в клетки (стены линией, Этап E): суперкавер сэмплированием —
// шаг в пол-клетки не оставляет дыр ни на прямой, ни на диагонали.
function traceLineCells(
  grid: MapFull["grid"],
  width: number,
  height: number,
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2));
  for (let i = 0; i <= steps; i++) {
    const wx = a.x + ((b.x - a.x) * i) / steps;
    const wy = a.y + ((b.y - a.y) * i) / steps;
    const cell = pixelToCell(grid, wx, wy, width, height);
    if (!cell) continue;
    const k = cellKey(cell.x, cell.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cell);
  }
  return out;
}

interface CreateWallToolsArgs {
  map: MapFull | null;
  wallSnap: boolean;
  wallDraft: { x: number; y: number }[] | null;
  wallLive: { x: number; y: number } | null;
  setWallDraft: (v: SetStateAction<{ x: number; y: number }[] | null>) => void;
  setWallLive: (v: { x: number; y: number } | null) => void;
  cellsRef: { current: MapCells };
  setCells: (c: MapCells) => void;
  push: (before: MapCells) => void;
  clone: (c: MapCells) => MapCells;
}

export function createWallTools(a: CreateWallToolsArgs) {
  // Стены линией: вершина со снепом — центр клетки, без снепа — сырая точка.
  function quantizeVertex(wx: number, wy: number): { x: number; y: number } {
    if (!a.map || !a.wallSnap) return { x: wx, y: wy };
    const cell = pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height);
    if (!cell) return { x: wx, y: wy };
    const c = cellCenter(a.map.grid, cell.x, cell.y);
    return { x: c.cx, y: c.cy };
  }

  // Клик — вершина; финиш — дабл-клик/Enter/кнопка (снаружи).
  function tapVertex(wx: number, wy: number) {
    if (!a.map) return;
    if (!pixelToCell(a.map.grid, wx, wy, a.map.width, a.map.height)) return;
    const v = quantizeVertex(wx, wy);
    a.setWallDraft((d) => [...(d ?? []), v]);
    a.setWallLive(null);
  }

  function hoverLive(wx: number, wy: number) {
    a.setWallLive(quantizeVertex(wx, wy));
  }

  // Финиш полилинии стен: растеризация всех звеньев в wall одним undo-шагом.
  function finishWallLine(includeLive: boolean) {
    if (!a.map) {
      a.setWallDraft(null);
      a.setWallLive(null);
      return;
    }
    const d = a.wallDraft ?? [];
    const verts = includeLive && a.wallLive ? [...d, a.wallLive] : d;
    a.setWallDraft(null);
    a.setWallLive(null);
    if (verts.length < 2) return;
    const before = a.clone(a.cellsRef.current);
    const draft = a.clone(before);
    let changed = false;
    const seen = new Set<string>();
    for (let i = 0; i + 1 < verts.length; i++) {
      for (const cell of traceLineCells(a.map.grid, a.map.width, a.map.height, verts[i], verts[i + 1])) {
        const k = cellKey(cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        if ((draft.terrain.get(k) ?? "plain") !== "wall") {
          draft.terrain.set(k, "wall");
          changed = true;
        }
      }
    }
    if (!changed) return;
    a.cellsRef.current = draft;
    a.setCells(draft);
    a.push(before);
  }

  return { quantizeVertex, tapVertex, hoverLive, finishWallLine };
}

export type WallTools = ReturnType<typeof createWallTools>;
