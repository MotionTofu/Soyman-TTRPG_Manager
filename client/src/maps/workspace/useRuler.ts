import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Vec2 } from "@shared/maps/core";
import { cellDistance, cellWidth, pixelToCell } from "../grid";
import { formatMeters, parseCellLore, type MapGrid } from "../mapTypes";

type Camera = { toWorld: (event: { clientX: number; clientY: number }) => { wx: number; wy: number } };
export type RulerLine = { from: Vec2; to: Vec2; label: string };

/** Мерка линейки: на квадратах — по прямой, на гексах — шагами по клеткам; к клеткам — то, что в клетке («1,5 м», «2 км»). */
export function rulerLabel(grid: MapGrid, cellLore: string, width: number, height: number, from: Vec2, to: Vec2): string {
  const a = grid === "square" ? null : pixelToCell(grid, from.x, from.y, width, height), b = grid === "square" ? null : pixelToCell(grid, to.x, to.y, width, height);
  const cells = a && b ? cellDistance(grid, a.x, a.y, b.x, b.y) : Math.hypot(to.x - from.x, to.y - from.y) / cellWidth(grid);
  const per = parseCellLore(cellLore);
  return `${String(Math.round(cells * 10) / 10).replace(".", ",")} кл.${per !== null ? ` · ${formatMeters(cells * per)}` : ""}`;
}

/** «Линейка»: тянут — меряют; линия остаётся до следующего замера, Esc или смены инструмента. Карту не меняет. */
export function useRuler({ active, camera, space, grid, cellLore, width, height }: {
  active: boolean; camera: Camera; space: { current: boolean }; grid: MapGrid; cellLore: string; width: number; height: number;
}) {
  const [span, setSpan] = useState<{ from: Vec2; to: Vec2 } | null>(null);
  const dragging = useRef(false);
  useEffect(() => { if (!active) setSpan(null); }, [active]);
  const world = (event: { clientX: number; clientY: number }) => { const p = camera.toWorld(event); return { x: p.wx, y: p.wy }; };
  function down(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (!active || event.button !== 0 || space.current) return false;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const at = world(event); dragging.current = true; setSpan({ from: at, to: at });
    return true;
  }
  function move(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (!dragging.current) return false;
    const at = world(event); setSpan((current) => current && { ...current, to: at });
    return true;
  }
  function up(): boolean {
    if (!dragging.current) return false;
    dragging.current = false;
    return true;
  }
  const line: RulerLine | null = span ? { ...span, label: rulerLabel(grid, cellLore, width, height, span.from, span.to) } : null;
  return { line, down, move, up, clear: () => setSpan(null) };
}
