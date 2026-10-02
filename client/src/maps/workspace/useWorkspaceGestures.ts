import { wallHit } from "../wallGeometry";
import { imageHit } from "./imageHit";
import { getMapImageAsset } from "../assets/registry";
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import type { MapDocumentV6, Vec2 } from "@shared/maps/core";
import { hitTestGameplay } from "../core";
import { coordLabel, pixelToCell } from "../grid";
import { shapeContains } from "../scatter";
import type { useMapCamera } from "../editor/hooks/useMapCamera";
import { addFreePath, addScatter, editPathNode, paintSurface, paintSurfaceStroke, freePathHit, selectedPath } from "./artisticCommands";
import { geometryView } from "./editDocument";
import { cellBrushFootprint, createDoor, createRoom, paintSegment, quantize, requireEditableLayer, roomRect, addSymbol,
  type WorkspaceSelection, type WorkspaceTool } from "./editorCommands";
import type { BrushSettings } from "./ToolSettings";
import type { WorkspaceDocument } from "./useWorkspaceDocument";
import type { useTokenPlacement } from "./useTokenPlacement";
import { mergeSelections, moveSelections, selectInRect, selectionRect, type SelectionRect } from "./multiSelection";
import { addWall, wallPoint } from "./walls";
import { paintCellShapes } from "./cellPainting";

type WallGesture = { type: "wall-line"; kind?: "wall" | "road" | "river"; before: MapDocumentV6; points: Vec2[]; layerId: string; pointerId: number };

export type Gesture = { type: "paint" | "room" | "move" | "line" | "node"; before: MapDocumentV6; start: Vec2; last: Vec2; pointerId: number; points?: Vec2[]; node?: { index: number; handle: "position" | "in" | "out"; indices?: number[] }; stamps?: number }
  | { type: "pan"; start: Vec2; ox: number; oy: number; pointerId: number; resume?: WallGesture }
  | WallGesture
  | { type: "cell-area"; start: Vec2; last: Vec2; pointerId: number; layerId: string; material: string | null }
  | { type: "marquee"; before: MapDocumentV6; start: Vec2; last: Vec2; pointerId: number; base: WorkspaceSelection[]; previous: WorkspaceSelection[] };
const BRUSH_TOOLS: WorkspaceTool[] = ["surface", "scatter", "brush", "eraser"];
const NO_SELECTED_NODES: number[] = [];

/** Pointer work on the canvas: strokes, drags, picking and the brush cursor. */
export function useWorkspaceGestures({ doc, gesture, space, camera, tool, activeLayer, setActiveLayer, snap, settings, selection, setSelection,
  selections, setSelections, placement, busy, onLabel }: {
  doc: WorkspaceDocument; gesture: MutableRefObject<Gesture | null>; space: MutableRefObject<boolean>;
  camera: ReturnType<typeof useMapCamera>; tool: WorkspaceTool; activeLayer: string; setActiveLayer: (id: string) => void;
  snap: boolean; settings: BrushSettings; selection: WorkspaceSelection | null; setSelection: (selection: WorkspaceSelection | null) => void;
  selections: WorkspaceSelection[]; setSelections: (selections: WorkspaceSelection[]) => void;
  placement: ReturnType<typeof useTokenPlacement>;
  /** Leaving, a dialog open: the canvas ignores presses. */
  busy: boolean; onLabel: (position: Vec2, layerId: string) => void;
}) {
  const { documentRef, setDocument, history, autosave, commit, showError } = doc;
  const [preview, setPreview] = useState<ReturnType<typeof roomRect> | null>(null);
  const [draftLine, setDraftLine] = useState<Vec2[] | null>(null);
  const [brushCursor, setBrushCursor] = useState<Vec2 | null>(null);
  const [cursorCell, setCursorCell] = useState<string | null>(null);
  const pendingPaint = useRef<{ gesture: Gesture; points: Vec2[]; layerId: string; radius: number; color: string | null } | null>(null);
  const paintFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    paintFrame.current = null; pendingPaint.current = null;
  }, []);
  const [nodeSelection, setNodeSelection] = useState<{ pathId: string; indices: number[] } | null>(null);
  const selectedNodes = nodeSelection?.pathId === selection?.id ? nodeSelection?.indices ?? NO_SELECTED_NODES : NO_SELECTED_NODES;
  const setSelectedNodes = (indices: number[]) => setNodeSelection(selection ? { pathId: selection.id, indices } : null);
  const [marquee, setMarquee] = useState<SelectionRect | null>(null);

  function finishGesture(cancel = false, closed = false) {
    if (cancel) discardPendingPaint();
    else try { flushSurface(); } catch (error) { showError(error); discardPendingPaint(); cancel = true; }
    const current = gesture.current;
    gesture.current = null;
    setPreview(null); setDraftLine(null);
    setMarquee(null);
    if (!current) return;
    if (current.type === "pan") {
      if (current.resume && !cancel) { gesture.current = current.resume; setDraftLine(current.resume.points); }
      return;
    }
    if (current.type === "wall-line") {
      if (!cancel) commit(before => current.kind && current.kind !== "wall" ? addFreePath(before, current.layerId, current.points, current.kind, settings.lineWidth, closed) : addWall(before, current.layerId, current.points, settings.wallWidth ?? 0.36, closed));
      return;
    }
    if (current.type === "cell-area") {
      if (!cancel) commit(before => paintCellShapes(before, current.layerId, [{ type: "rect", ...roomRect(current.start, current.last, true) }], current.material));
      return;
    }
    if (current.type === "marquee") {
      const dragged = Math.hypot(current.last.x - current.start.x, current.last.y - current.start.y) * camera.cam.scale >= 4;
      setSelections(cancel ? current.previous : dragged ? mergeSelections(current.base, selectInRect(current.before, selectionRect(current.start, current.last))) : current.base);
      return;
    }
    autosave.schedule();
    if (cancel) { history.cancelStroke(); if (current.type !== "paint") setDocument(current.before); return; }
    if (current.type === "paint") history.commitStroke();
    else if (current.type === "move" || current.type === "node") {
      if (documentRef.current !== current.before) history.push(current.before);
    } else {
      try {
        const next = current.type === "line" ? addFreePath(current.before, activeLayer, current.points ?? [], tool === "river" ? "river" : "road", settings.lineWidth)
          : createRoom(current.before, activeLayer, crypto.randomUUID(), current.start, current.last, snap);
        if (next !== current.before) { history.push(current.before); setDocument(next); }
      } catch (error) { showError(error); }
    }
  }
  function discardPendingPaint() {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    paintFrame.current = null; pendingPaint.current = null;
  }
  function flushSurface() {
    const pending = pendingPaint.current;
    discardPendingPaint();
    if (!pending || pending.gesture !== gesture.current || !documentRef.current) return;
    const before = documentRef.current;
    const next = paintSurfaceStroke(before, pending.layerId, pending.points, pending.radius, pending.color);
    if (next !== before) { history.markStrokeChanged(); setDocument(next); }
  }
  function queueSurface(current: Gesture & { last: Vec2 }, point: Vec2) {
    if (!pendingPaint.current) pendingPaint.current = { gesture: current, points: [current.last], layerId: activeLayer,
      radius: settings.radius, color: tool === "eraser" ? null : settings.material };
    pendingPaint.current.points.push(point);
    if (paintFrame.current === null) paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = null;
      try { flushSurface(); } catch (error) { showError(error); finishGesture(true); }
    });
  }
  function pick(point: Vec2): WorkspaceSelection | null {
    const document = documentRef.current;
    if (!document) return null;
    const slack = 5 / camera.cam.scale;
    let roomHit: WorkspaceSelection | null = null;
    for (const layer of [...document.layers].reverse()) {
      if (!layer.visible || layer.locked) continue;
      if (layer.kind === "gameplay") {
        const view = geometryView(document);
        for (const item of [...layer.items].reverse()) {
          if (item.kind === "token") {
            const angle = -item.rotation * Math.PI / 180, dx = point.x - item.position.x, dy = point.y - item.position.y;
            const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle);
            if ((item.appearance.shape === "circle" ? Math.hypot(x, y) : Math.abs(x) + Math.abs(y)) <= item.size / 2 + slack) return { id: item.id, layerId: layer.id, kind: "token" };
          } else {
            const hit = hitTestGameplay({ ...view, layers: view.layers.flatMap((entry) => entry.id === layer.id && entry.kind === "gameplay" ? [{ ...entry, items: entry.items.filter((entity) => entity.id === item.id) }] : []) }, point, slack);
            if (hit) {
              const candidate: WorkspaceSelection = { id: hit.entityId, layerId: layer.id, kind: "gameplay" };
              // A room interior is transparent. Prefer an actual object there.
              if (item.kind === "room") roomHit ??= candidate;
              else return candidate;
            }
          }
        }
      } else if (layer.kind === "path") {
        for (const path of [...layer.paths].reverse()) {
          if (path.geometry.type === "spline" && (path.kind === "wall" ? wallHit(path.geometry.nodes.map(node => ({ ...node.position, width: node.width })), path.width, path.properties?.closed === true, point, slack) : freePathHit(path.geometry.nodes, point, path.width, slack, path.properties?.closed === true))) return { id: path.id, layerId: layer.id, kind: "path" };
        }
      } else if (layer.kind === "scatter") {
        for (const area of [...layer.areas].reverse()) if (shapeContains(area.shape, point)) return { id: area.id, layerId: layer.id, kind: "scatter" };
      } else if (layer.kind === "label" || layer.kind === "object") {
        for (const item of [...layer.items].reverse()) {
          const position = "transform" in item ? item.transform.position : item.position;
          const angle = "transform" in item ? -item.transform.rotation * Math.PI / 180 : 0;
          const dx = point.x - position.x, dy = point.y - position.y;
          const hit = "transform" in item ? Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= Math.abs(item.transform.scale.x) / 2 + slack &&
            Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= Math.abs(item.transform.scale.y) / 2 + slack : Math.hypot(dx, dy) <= Math.max(0.5, 12 / camera.cam.scale);
          if (hit) {
            if ("transform" in item && item.visual.type === "asset") {
              const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
              const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
              const image = getMapImageAsset(item.visual.assetId)?.image;
              const aspect = image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
              if (!imageHit(image, localX / (item.transform.scale.x * Math.min(1, aspect)) + 0.5, localY / (item.transform.scale.y * Math.min(1, 1 / aspect)) + 0.5)) continue;
            }
            return { id: item.id, layerId: layer.id, kind: layer.kind };
          }
        }
      }
    }
    return roomHit;
  }
  function applyBrush(document: MapDocumentV6, a: Vec2, b: Vec2, stamp: number) {
    if (tool === "scatter") return addScatter(document, activeLayer, b, settings.radius, settings.scatterProfile, settings.density, settings.scatterSize, settings.scatterSeed + stamp);
    const color = tool === "eraser" ? null : settings.material;
    const layer = document.layers.find((entry) => entry.id === activeLayer);
    return tool === "surface" || layer?.kind === "terrain" && layer.representation === "mask" && tool === "eraser"
      ? paintSurface(document, activeLayer, a, b, settings.radius, color) : paintSegment(document, activeLayer, a, b, color, settings.cellSize ?? 1);
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (busy) return;
    const world = camera.toWorld(event), point = { x: world.wx, y: world.wy };
    event.currentTarget.focus();
    const current = gesture.current;
    if (current?.type === "wall-line" && (event.button === 1 || event.button === 0 && space.current)) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { type: "pan", start: { x: event.clientX, y: event.clientY }, ox: camera.cam.ox, oy: camera.cam.oy, pointerId: event.pointerId, resume: current }; return;
    }
    if (current?.type === "wall-line" && tool === (current.kind ?? "wall") && event.button === 0 && !doc.disabled && autosave.status.kind !== "conflict") {
      const anchor = current.kind && current.kind !== "wall" ? quantize(current.before, point, snap) : wallPoint(current.before, point, snap);
      const atFirst = Math.hypot(anchor.x - current.points[0].x, anchor.y - current.points[0].y) <= Math.max(0.1, 8 / camera.cam.scale);
      if (current.points.length >= 3 && atFirst) { finishGesture(false, true); return; }
      if (current.points.length === 2 && atFirst) return;
      if (current.points.length < 256 && Math.hypot(anchor.x - current.points.at(-1)!.x, anchor.y - current.points.at(-1)!.y) > 1e-6) current.points.push(anchor);
      setDraftLine([...current.points]); return;
    }
    if (current) return;
    if (event.button === 1 || (event.button === 0 && space.current)) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { type: "pan", start: { x: event.clientX, y: event.clientY }, ox: camera.cam.ox, oy: camera.cam.oy, pointerId: event.pointerId }; return;
    }
    if (event.button !== 0 || doc.disabled || autosave.status.kind === "conflict") return;
    if (placement.pending) { placement.confirm(point); return; }
    const document = documentRef.current;
    if (!document) return;
    if (tool === "wall" || (tool === "road" || tool === "river") && settings.pathMode === "points") {
      try {
        requireEditableLayer(document, activeLayer, "path");
        const anchor = tool === "wall" ? wallPoint(document, point, snap) : quantize(document, point, snap);
        gesture.current = { type: "wall-line", kind: tool, before: document, points: [anchor], layerId: activeLayer, pointerId: event.pointerId };
        setDraftLine([anchor]); setBrushCursor(point);
      } catch (error) { showError(error); }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const path = selectedPath(document, selection), layer = document.layers.find((entry) => entry.id === selection?.layerId);
      if (path?.geometry.type === "spline" && selection && layer?.visible && !layer.locked) {
        for (let index = 0; index < path.geometry.nodes.length; index++) {
          const node = path.geometry.nodes[index];
          for (const handle of ["position", "in", "out"] as const) {
            const target = node[handle];
            if (target && Math.hypot(point.x - target.x, point.y - target.y) < 8 / camera.cam.scale) {
              if (handle === "position") {
                if (event.shiftKey) { setSelectedNodes(selectedNodes.includes(index) ? selectedNodes.filter(i => i !== index) : [...selectedNodes, index]); return; }
                const indices = selectedNodes.includes(index) ? selectedNodes : [index];
                setSelectedNodes(indices);
                gesture.current = { type: "node", before: document, start: point, last: point, pointerId: event.pointerId, node: { index, handle, indices } }; return;
              }
              setSelectedNodes([index]);
              gesture.current = { type: "node", before: document, start: point, last: point, pointerId: event.pointerId, node: { index, handle } }; return;
            }
          }
        }
      }
      const found = pick(point);
      if (found) {
        const already = selections.some(entry => entry.id === found.id && entry.layerId === found.layerId);
        if (event.shiftKey) {
          setSelections(already ? selections.filter(entry => entry.id !== found.id || entry.layerId !== found.layerId) : [...selections, found]);
          return;
        }
        if (!already) {
          setSelection(found);
          const path = selectedPath(document, found);
          if (path?.geometry.type === "spline") {
            const index = path.geometry.nodes.findIndex(node => Math.hypot(point.x - node.position.x, point.y - node.position.y) < 8 / camera.cam.scale);
            setNodeSelection({ pathId: path.id, indices: index >= 0 ? [index] : [] });
          }
        }
        setActiveLayer(found.layerId);
        gesture.current = { type: "move", before: document, start: point, last: point, pointerId: event.pointerId };
      } else {
        const base = event.shiftKey ? selections : [];
        gesture.current = { type: "marquee", before: document, start: point, last: point, pointerId: event.pointerId, base, previous: selections };
        setMarquee(selectionRect(point, point)); setSelections(base);
      }
    } else if (BRUSH_TOOLS.includes(tool)) {
      try {
        const layer = document.layers.find(entry => entry.id === activeLayer);
        if ((tool === "brush" || tool === "eraser") && layer?.kind === "terrain" && layer.representation === "cells" && settings.cellMode === "area") {
          requireEditableLayer(document, activeLayer, "terrain");
          gesture.current = { type: "cell-area", start: point, last: point, pointerId: event.pointerId, layerId: activeLayer, material: tool === "eraser" ? null : settings.material };
          setPreview(roomRect(point, point, true)); return;
        }
        const next = applyBrush(document, point, point, 0);
        history.beginStroke(); gesture.current = { type: "paint", before: document, start: point, last: point, pointerId: event.pointerId };
        if (next !== document) { history.markStrokeChanged(); setDocument(next); }
      } catch (error) { showError(error); }
    } else if (tool === "road" || tool === "river") {
      try { requireEditableLayer(document, activeLayer, "path"); gesture.current = { type: "line", before: document, start: point, last: point, pointerId: event.pointerId, points: [point] }; setDraftLine([point]); } catch (error) { showError(error); }
    } else if (tool === "shape") gesture.current = { type: "room", before: document, start: point, last: point, pointerId: event.pointerId };
    else if (tool === "door") commit((before) => createDoor(before, activeLayer, crypto.randomUUID(), point, snap, settings.orientation));
    else if (tool === "label") {
      try { requireEditableLayer(document, activeLayer, "label"); onLabel(quantize(document, point, snap), activeLayer); }
      catch (error) { showError(error); }
    }
    else if (tool === "asset") commit((before) => addSymbol(before, activeLayer, crypto.randomUUID(), quantize(before, point, snap), settings.symbol));
  }
  function track(point: Vec2) {
    const grid = documentRef.current?.grid;
    const cell = grid ? pixelToCell(grid.type, point.x, point.y, grid.columns, grid.rows) : null;
    const text = cell ? coordLabel(cell.x, cell.y) : null;
    if (text !== cursorCell) setCursorCell(text);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const world = camera.toWorld(event), point = { x: world.wx, y: world.wy };
    track(point);
    if (tool === "surface" || tool === "scatter" || tool === "eraser" || tool === "brush" || tool === "asset" || tool === "wall") setBrushCursor(point);
    if (placement.pending && !gesture.current) { placement.move(point); return; }
    const current = gesture.current;
    if (current?.type === "wall-line") {
      const anchor = current.kind && current.kind !== "wall" ? quantize(current.before, point, snap) : wallPoint(current.before, point, snap);
      setDraftLine([...current.points, anchor]); return;
    }
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.type === "pan") {
      camera.setCam((cam) => ({ ...cam, ox: current.ox + event.clientX - current.start.x, oy: current.oy + event.clientY - current.start.y })); return;
    }
    if (current.type === "marquee") {
      current.last = point;
      const rect = selectionRect(current.start, point);
      setMarquee(rect);
      setSelections(mergeSelections(current.base, selectInRect(current.before, rect)));
      return;
    }
    if (current.type === "cell-area") { current.last = point; setPreview(roomRect(current.start, point, true)); return; }
    try {
      if (current.type === "line") {
        if (current.points!.length < 255 && Math.hypot(point.x - current.last.x, point.y - current.last.y) >= 0.75) {
          current.points!.push(point); setDraftLine([...current.points!]); current.last = point;
        }
        return;
      }
      if (current.type === "node" && selection && current.node) {
        const path = selectedPath(current.before, selection);
        const target = path?.kind === "wall" ? wallPoint(current.before, point, snap) : quantize(current.before, point, snap);
        if (path?.geometry.type === "spline" && current.node.indices) {
          const origin = path.geometry.nodes[current.node.index].position;
          let next = current.before;
          for (const index of current.node.indices) {
            const position = path.geometry.nodes[index]?.position;
            if (position) next = editPathNode(next, selection, index, "position", { x: position.x + target.x - origin.x, y: position.y + target.y - origin.y });
          }
          setDocument(next);
        } else setDocument(editPathNode(current.before, selection, current.node.index, current.node.handle, target));
        return;
      }
      if (current.type === "room") setPreview(roomRect(current.start, point, snap));
      else if (current.type === "paint" && documentRef.current) {
        const layer = documentRef.current.layers.find(entry => entry.id === activeLayer);
        if (tool === "surface" || tool === "eraser" && layer?.kind === "terrain" && layer.representation === "mask") {
          queueSurface(current, point); current.last = point; return;
        }
        if (tool === "scatter" && Math.hypot(point.x - current.last.x, point.y - current.last.y) < settings.radius * 0.9) return;
        const next = applyBrush(documentRef.current, current.last, point, current.stamps = (current.stamps ?? 0) + 1);
        if (next !== documentRef.current) { history.markStrokeChanged(); setDocument(next); }
      } else if (current.type === "move" && selections.length) {
        const origin = quantize(current.before, current.start, snap), end = quantize(current.before, point, snap);
        setDocument(moveSelections(current.before, selections, { x: end.x - origin.x, y: end.y - origin.y }));
      }
      current.last = point;
    } catch (error) { showError(error); finishGesture(true); }
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current?.type === "wall-line") return;
    if (gesture.current?.pointerId === event.pointerId) {
      move(event);
      if (gesture.current?.type === "line") { const world = camera.toWorld(event); if (Math.hypot(world.wx - gesture.current.last.x, world.wy - gesture.current.last.y) > 0.01) gesture.current.points!.push({ x: world.wx, y: world.wy }); }
      finishGesture();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cancel(event: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current?.type === "wall-line" && event.type === "lostpointercapture") return;
    if (gesture.current?.pointerId === event.pointerId) finishGesture(true);
  }
  function leave() {
    setBrushCursor(null); setCursorCell(null);
    if (gesture.current?.type === "wall-line") setDraftLine([...gesture.current.points]);
  }
  const layer = documentRef.current?.layers.find(entry => entry.id === activeLayer);
  const assetPreview = tool === "asset" && brushCursor && !busy && !doc.disabled && autosave.status.kind !== "conflict" && !placement.pending &&
    !gesture.current && layer?.kind === "object" && layer.visible && !layer.locked
    ? { position: quantize(documentRef.current!, brushCursor, snap), assetId: settings.symbol } : null;
  const cellBrush = brushCursor && documentRef.current && (tool === "brush" || tool === "eraser") && layer?.kind === "terrain" && layer.representation === "cells" &&
    settings.cellMode !== "area" && !busy && !doc.disabled && !placement.pending
    ? cellBrushFootprint(documentRef.current, brushCursor, settings.cellSize ?? 1) : null;
  const wallGesture = gesture.current?.type === "wall-line" ? gesture.current : null;
  const canCloseWall = !!wallGesture && wallGesture.points.length >= 3;
  const wallDraft = wallGesture ? { points: draftLine ?? wallGesture.points, kind: wallGesture.kind ?? "wall", width: wallGesture.kind && wallGesture.kind !== "wall" ? settings.lineWidth : settings.wallWidth ?? 0.36,
    pointCount: wallGesture.points.length,
    canClose: canCloseWall, closing: canCloseWall && !!draftLine && Math.hypot(draftLine.at(-1)!.x - wallGesture.points[0].x, draftLine.at(-1)!.y - wallGesture.points[0].y) <= Math.max(0.1, 8 / camera.cam.scale) } : null;
  const finishWall = (closed = false) => { if (gesture.current?.type === "wall-line") finishGesture(false, closed); };
  return { selectedNodes, setSelectedNodes, down, move, up, cancel, leave, finishGesture, finishWall, wallDraft, canCloseWall, cellBrush, preview, marquee, draftLine, brushCursor, cursorCell, assetPreview };
}
