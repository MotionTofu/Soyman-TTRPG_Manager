import { cellKey } from "../../grid";
import type { MapFull } from "../../mapTypes";
import type { MapCells } from "../../render";

// Шейпы (Фаза 1, Tool Controller): прямоугольное применение содержимым.
// Правила: terrain rect / road rect / river rect / wall rect / eraser rect —
// применением на клетки ректа одним шагом; room rect — НЕ созданием, а
// запросом onRequestRoomCreate (модалка и draft формы остаются у UI).

export type ShapeContent = "room" | "terrain" | "road" | "river" | "wall" | "eraser";

interface CreateShapeToolsArgs {
  map: MapFull | null;
  shapeContent: ShapeContent;
  terrain: string;
  shapeAnchor: { x: number; y: number } | null;
  setShapeAnchor: (v: { x: number; y: number } | null) => void;
  setRectPreview: (r: { x: number; y: number; w: number; h: number } | null) => void;
  cellsRef: { current: MapCells };
  setCells: (c: MapCells) => void;
  push: (before: MapCells) => void;
  clone: (c: MapCells) => MapCells;
  onRequestRoomCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
}

export function createShapeTools(a: CreateShapeToolsArgs) {
  // Тач-шейп: тап — первый угол, тап — второй (прямоугольник готов).
  function tap(cell: { x: number; y: number }) {
    const anchor = a.shapeAnchor;
    if (!anchor) {
      a.setShapeAnchor(cell);
      a.setRectPreview({ x: cell.x, y: cell.y, w: 1, h: 1 });
    } else {
      a.setShapeAnchor(null);
      a.setRectPreview(null);
      apply({ x: anchor.x, y: anchor.y }, cell);
    }
  }

  // Мышь: drag от угла к углу (якорь держит Input в shapeDragRef).
  function startDrag(cell: { x: number; y: number }) {
    a.setRectPreview({ x: cell.x, y: cell.y, w: 1, h: 1 });
  }

  function moveDrag(anchor: { x: number; y: number }, cell: { x: number; y: number }) {
    a.setRectPreview({
      x: Math.min(anchor.x, cell.x),
      y: Math.min(anchor.y, cell.y),
      w: Math.abs(cell.x - anchor.x) + 1,
      h: Math.abs(cell.y - anchor.y) + 1,
    });
  }

  // Шейп-прямоугольник: комната — запросом в модалку, остальное — применением
  // на клетки ректа одним шагом (террейн — текущий, оверлеи — поверх, ластик — чистка).
  function apply(pa: { x: number; y: number }, pb: { x: number; y: number }) {
    if (!a.map) return;
    const x0 = Math.min(pa.x, pb.x);
    const y0 = Math.min(pa.y, pb.y);
    const x1 = Math.max(pa.x, pb.x);
    const y1 = Math.max(pa.y, pb.y);
    const content = a.shapeContent;
    if (content === "room") {
      a.onRequestRoomCreate({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      return;
    }
    const before = a.clone(a.cellsRef.current);
    const draft = a.clone(before);
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = cellKey(x, y);
        if (content === "road" || content === "river") {
          const set = content === "road" ? draft.roads : draft.rivers;
          if (!set.has(k)) {
            set.add(k);
            changed = true;
          }
        } else if (content === "eraser") {
          if ((draft.terrain.get(k) ?? "plain") !== "plain") {
            draft.terrain.delete(k);
            changed = true;
          }
          if (draft.roads.has(k)) {
            draft.roads.delete(k);
            changed = true;
          }
          if (draft.rivers.has(k)) {
            draft.rivers.delete(k);
            changed = true;
          }
        } else {
          const t = content === "wall" ? "wall" : a.terrain;
          if ((draft.terrain.get(k) ?? "plain") !== t) {
            if (t === "plain") draft.terrain.delete(k);
            else draft.terrain.set(k, t);
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
    a.cellsRef.current = draft;
    a.setCells(draft);
    a.push(before);
  }

  return { tap, startDrag, moveDrag, apply };
}

export type ShapeTools = ReturnType<typeof createShapeTools>;
