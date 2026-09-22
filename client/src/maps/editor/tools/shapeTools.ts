import { applyTerrainCellEdits } from "../../core/mutations/terrain";
import type { LayerId, MapDocumentV5 } from "../../core/types";
import type { MapGeometry } from "../hooks/useMapSelection";
import { NO_COMPATIBLE_LAYER_ERROR, resolveToolTargetLayer } from "./layerTargets";
import { addCellsToLayerPath, removeCellsFromLayerPath } from "./v5paths";

// Шейпы (Фаза 3A): прямоугольное применение содержимым.
// Правила: terrain rect / road rect / river rect / wall rect / eraser rect —
// применением на клетки ректа одним шагом через V5 mutations в target слоях;
// room rect — НЕ созданием, а запросом onRequestRoomCreate (модалка у UI).

export type ShapeContent = "room" | "terrain" | "road" | "river" | "wall" | "eraser";

interface CreateShapeToolsArgs {
  geom: MapGeometry | null;
  shapeContent: ShapeContent;
  terrain: string;
  shapeAnchor: { x: number; y: number } | null;
  activeLayerId: LayerId | null;
  onActiveLayer: (id: LayerId) => void;
  setShapeAnchor: (v: { x: number; y: number } | null) => void;
  setRectPreview: (r: { x: number; y: number; w: number; h: number } | null) => void;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  push: (before: MapDocumentV5) => void;
  newId: () => string;
  setActionError: (e: string | null) => void;
  onRequestRoomCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
}

function resolveTarget(
  a: CreateShapeToolsArgs,
  doc: MapDocumentV5,
  want: "terrain" | "path",
  silent = false,
): string | null {
  const r = resolveToolTargetLayer(doc, a.activeLayerId, want);
  if (!r.ok) {
    if (!silent) a.setActionError(NO_COMPATIBLE_LAYER_ERROR);
    return null;
  }
  if (!r.keptActive) a.onActiveLayer(r.layerId);
  return r.layerId;
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
    const doc = a.documentRef.current;
    if (!doc) return;
    const x0 = Math.min(pa.x, pb.x);
    const y0 = Math.min(pa.y, pb.y);
    const x1 = Math.max(pa.x, pb.x);
    const y1 = Math.max(pa.y, pb.y);
    const content = a.shapeContent;
    if (content === "room") {
      a.onRequestRoomCreate({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      return;
    }
    const rectCells: Array<{ x: number; y: number }> = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        rectCells.push({ x, y });
      }
    }
    if (content === "road" || content === "river") {
      const layerId = resolveTarget(a, doc, "path");
      if (!layerId) return;
      const r = addCellsToLayerPath(doc, layerId, content, rectCells, a.newId);
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось положить путь.");
        return;
      }
      if (!r.changed) return;
      a.documentRef.current = r.document;
      a.setDocument(r.document);
      a.push(doc);
      return;
    }
    const layerId = resolveTarget(a, doc, "terrain");
    if (!layerId) return;
    if (content === "eraser") {
      const def = doc.layers.find((l) => l.id === layerId);
      const defaultMaterial =
        def && def.kind === "terrain" ? def.defaultMaterial : { type: "builtin" as const, key: "terrain/plain" };
      const r = applyTerrainCellEdits(
        doc,
        layerId,
        rectCells.map((c) => ({ ...c, material: defaultMaterial })),
      );
      let next = doc;
      let changed = false;
      if (!r.ok) {
        a.setActionError(r.issues[0]?.message ?? "Не удалось стереть.");
        return;
      }
      if (r.changed) {
        next = r.document;
        changed = true;
      }
      for (const kind of ["road", "river"] as const) {
        const pathLayerId = resolveTarget(a, next, "path", true);
        if (!pathLayerId) break;
        const rr = removeCellsFromLayerPath(next, pathLayerId, kind, rectCells);
        if (!rr.ok) {
          a.setActionError(rr.issues[0]?.message ?? "Не удалось снять путь.");
          return;
        }
        if (rr.changed) {
          next = rr.document;
          changed = true;
        }
      }
      if (!changed) return;
      a.documentRef.current = next;
      a.setDocument(next);
      a.push(doc);
      return;
    }
    const t = content === "wall" ? "wall" : a.terrain;
    const r = applyTerrainCellEdits(
      doc,
      layerId,
      rectCells.map((c) => ({ ...c, material: { type: "builtin" as const, key: `terrain/${t}` } })),
    );
    if (!r.ok) {
      a.setActionError(r.issues[0]?.message ?? "Не удалось применить шейп.");
      return;
    }
    if (!r.changed) return;
    a.documentRef.current = r.document;
    a.setDocument(r.document);
    a.push(doc);
  }

  return { tap, startDrag, moveDrag, apply };
}

export type ShapeTools = ReturnType<typeof createShapeTools>;
