import type { SetStateAction } from "react";
import { cellCenter, cellKey, pixelToCell } from "../../grid";
import { applyTerrainCellEdits } from "../../core/mutations/terrain";
import type { MapDocumentV5 } from "../../core/types";
import type { MapGeometry } from "../hooks/useMapSelection";

// Стены (Фаза 2G): вершины полилинии, живой конец, финиш растеризацией
// в wall одним history step через terrain batch. Состояния wallDraft/wallLive/
// wallLineMode живут снаружи и приходят значением + сеттерами.

// Растеризация отрезка в клетки (стены линией, Этап E): суперкавер сэмплированием —
// шаг в пол-клетки не оставляет дыр ни на прямой, ни на диагонали.
function traceLineCells(
  grid: MapGeometry["grid"],
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
  geom: MapGeometry | null;
  wallSnap: boolean;
  wallDraft: { x: number; y: number }[] | null;
  wallLive: { x: number; y: number } | null;
  setWallDraft: (v: SetStateAction<{ x: number; y: number }[] | null>) => void;
  setWallLive: (v: { x: number; y: number } | null) => void;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  push: (before: MapDocumentV5) => void;
  setActionError: (e: string | null) => void;
}

export function createWallTools(a: CreateWallToolsArgs) {
  // Стены линией: вершина со снепом — центр клетки, без снепа — сырая точка.
  function quantizeVertex(wx: number, wy: number): { x: number; y: number } {
    if (!a.geom || !a.wallSnap) return { x: wx, y: wy };
    const cell = pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height);
    if (!cell) return { x: wx, y: wy };
    const c = cellCenter(a.geom.grid, cell.x, cell.y);
    return { x: c.cx, y: c.cy };
  }

  // Клик — вершина; финиш — дабл-клик/Enter (снаружи).
  function tapVertex(wx: number, wy: number) {
    if (!a.geom) return;
    if (!pixelToCell(a.geom.grid, wx, wy, a.geom.width, a.geom.height)) return;
    const v = quantizeVertex(wx, wy);
    a.setWallDraft((d) => [...(d ?? []), v]);
    a.setWallLive(null);
  }

  function hoverLive(wx: number, wy: number) {
    a.setWallLive(quantizeVertex(wx, wy));
  }

  // Финиш полилинии стен: растеризация всех звеньев в wall одним undo-шагом.
  function finishWallLine(includeLive: boolean) {
    const g = a.geom;
    const doc = a.documentRef.current;
    if (!g || !doc) {
      a.setWallDraft(null);
      a.setWallLive(null);
      return;
    }
    const d = a.wallDraft ?? [];
    const verts = includeLive && a.wallLive ? [...d, a.wallLive] : d;
    a.setWallDraft(null);
    a.setWallLive(null);
    if (verts.length < 2) return;
    const layer = doc.layers.find((l) => l.kind === "terrain");
    if (!layer || layer.kind !== "terrain" || layer.representation !== "cells") {
      a.setActionError("В документе нет клеточного terrain-слоя.");
      return;
    }
    const seen = new Set<string>();
    const edits: Array<{ x: number; y: number; material: { type: "builtin"; key: string } }> = [];
    for (let i = 0; i + 1 < verts.length; i++) {
      for (const cell of traceLineCells(g.grid, g.width, g.height, verts[i], verts[i + 1])) {
        const k = cellKey(cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        edits.push({ x: cell.x, y: cell.y, material: { type: "builtin", key: "terrain/wall" } });
      }
    }
    const r = applyTerrainCellEdits(doc, layer.id, edits);
    if (!r.ok) {
      a.setActionError(r.issues[0]?.message ?? "Не удалось построить стены.");
      return;
    }
    if (!r.changed) return;
    a.documentRef.current = r.document;
    a.setDocument(r.document);
    a.push(doc);
  }

  return { quantizeVertex, tapVertex, hoverLive, finishWallLine };
}

export type WallTools = ReturnType<typeof createWallTools>;
