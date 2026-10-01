import { useState, type MutableRefObject, type PointerEvent } from "react";
import type { MapDocumentV6, Vec2 } from "@shared/maps/core";
import { hitTestGameplay } from "../core";
import { coordLabel, pixelToCell } from "../grid";
import { shapeContains } from "../scatter";
import type { useMapCamera } from "../editor/hooks/useMapCamera";
import { addFreePath, addScatter, editPathNode, paintSurface, pathHit, selectedPath } from "./artisticCommands";
import { geometryView } from "./editDocument";
import { createDoor, createRoom, moveSelection, paintSegment, quantize, requireEditableLayer, roomRect, addSymbol,
  type WorkspaceSelection, type WorkspaceTool } from "./editorCommands";
import type { BrushSettings } from "./ToolSettings";
import type { WorkspaceDocument } from "./useWorkspaceDocument";
import type { useTokenPlacement } from "./useTokenPlacement";

export type Gesture = { type: "paint" | "room" | "move" | "line" | "node"; before: MapDocumentV6; start: Vec2; last: Vec2; pointerId: number; points?: Vec2[]; node?: { index: number; handle: "position" | "in" | "out" }; stamps?: number }
  | { type: "pan"; start: Vec2; ox: number; oy: number; pointerId: number };
const BRUSH_TOOLS: WorkspaceTool[] = ["surface", "scatter", "brush", "wall", "eraser"];

/** Pointer work on the canvas: strokes, drags, picking and the brush cursor. */
export function useWorkspaceGestures({ doc, gesture, space, camera, tool, activeLayer, setActiveLayer, snap, settings, selection, setSelection,
  placement, busy, onLabel }: {
  doc: WorkspaceDocument; gesture: MutableRefObject<Gesture | null>; space: MutableRefObject<boolean>;
  camera: ReturnType<typeof useMapCamera>; tool: WorkspaceTool; activeLayer: string; setActiveLayer: (id: string) => void;
  snap: boolean; settings: BrushSettings; selection: WorkspaceSelection | null; setSelection: (selection: WorkspaceSelection | null) => void;
  placement: ReturnType<typeof useTokenPlacement>;
  /** Leaving, a dialog open: the canvas ignores presses. */
  busy: boolean; onLabel: (position: Vec2, layerId: string) => void;
}) {
  const { documentRef, setDocument, history, autosave, commit, showError } = doc;
  const [preview, setPreview] = useState<ReturnType<typeof roomRect> | null>(null);
  const [draftLine, setDraftLine] = useState<Vec2[] | null>(null);
  const [brushCursor, setBrushCursor] = useState<Vec2 | null>(null);
  const [cursorCell, setCursorCell] = useState<string | null>(null);

  function finishGesture(cancel = false) {
    const current = gesture.current;
    gesture.current = null;
    setPreview(null); setDraftLine(null);
    if (!current || current.type === "pan") return;
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
          if (path.geometry.type === "spline" && pathHit(path.geometry.nodes, point, path.width / 2 + slack)) return { id: path.id, layerId: layer.id, kind: "path" };
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
          if (hit) return { id: item.id, layerId: layer.id, kind: layer.kind };
        }
      }
    }
    return roomHit;
  }
  function applyBrush(document: MapDocumentV6, a: Vec2, b: Vec2, stamp: number) {
    if (tool === "scatter") return addScatter(document, activeLayer, b, settings.radius, settings.scatterProfile, settings.density, settings.scatterSize, settings.scatterSeed + stamp);
    const color = tool === "eraser" ? null : tool === "wall" ? "wall" : settings.material;
    const layer = document.layers.find((entry) => entry.id === activeLayer);
    return tool === "surface" || layer?.kind === "terrain" && layer.representation === "mask" && tool === "eraser"
      ? paintSurface(document, activeLayer, a, b, settings.radius, color) : paintSegment(document, activeLayer, a, b, color);
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current || busy) return;
    const world = camera.toWorld(event), point = { x: world.wx, y: world.wy };
    event.currentTarget.focus();
    if (event.button === 1 || (event.button === 0 && space.current)) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { type: "pan", start: { x: event.clientX, y: event.clientY }, ox: camera.cam.ox, oy: camera.cam.oy, pointerId: event.pointerId }; return;
    }
    if (event.button !== 0 || doc.disabled || autosave.status.kind === "conflict") return;
    if (placement.pending) { placement.confirm(point); return; }
    const document = documentRef.current;
    if (!document) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const path = selectedPath(document, selection), layer = document.layers.find((entry) => entry.id === selection?.layerId);
      if (path?.geometry.type === "spline" && selection && layer?.visible && !layer.locked) {
        for (let index = 0; index < path.geometry.nodes.length; index++) {
          const node = path.geometry.nodes[index];
          for (const handle of ["position", "in", "out"] as const) {
            const target = node[handle];
            if (target && Math.hypot(point.x - target.x, point.y - target.y) < 8 / camera.cam.scale) {
              gesture.current = { type: "node", before: document, start: point, last: point, pointerId: event.pointerId, node: { index, handle } }; return;
            }
          }
        }
      }
      const found = pick(point); setSelection(found);
      if (found) { setActiveLayer(found.layerId); gesture.current = { type: "move", before: document, start: point, last: point, pointerId: event.pointerId }; }
    } else if (BRUSH_TOOLS.includes(tool)) {
      try {
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
    if (tool === "surface" || tool === "scatter" || tool === "eraser") setBrushCursor(point);
    if (placement.pending && !gesture.current) { placement.move(point); return; }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.type === "pan") {
      camera.setCam((cam) => ({ ...cam, ox: current.ox + event.clientX - current.start.x, oy: current.oy + event.clientY - current.start.y })); return;
    }
    try {
      if (current.type === "line") {
        if (current.points!.length < 255 && Math.hypot(point.x - current.last.x, point.y - current.last.y) >= 0.75) {
          current.points!.push(point); setDraftLine([...current.points!]); current.last = point;
        }
        return;
      }
      if (current.type === "node" && selection && current.node) {
        setDocument(editPathNode(current.before, selection, current.node.index, current.node.handle, quantize(current.before, point, snap))); return;
      }
      if (current.type === "room") setPreview(roomRect(current.start, point, snap));
      else if (current.type === "paint" && documentRef.current) {
        if (tool === "scatter" && Math.hypot(point.x - current.last.x, point.y - current.last.y) < settings.radius * 0.9) return;
        const next = applyBrush(documentRef.current, current.last, point, current.stamps = (current.stamps ?? 0) + 1);
        if (next !== documentRef.current) { history.markStrokeChanged(); setDocument(next); }
      } else if (current.type === "move" && selection) {
        const origin = quantize(current.before, current.start, snap), end = quantize(current.before, point, snap);
        setDocument(moveSelection(current.before, selection, { x: end.x - origin.x, y: end.y - origin.y }));
      }
      current.last = point;
    } catch (error) { showError(error); finishGesture(true); }
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current?.pointerId === event.pointerId) {
      move(event);
      if (gesture.current?.type === "line") { const world = camera.toWorld(event); if (Math.hypot(world.wx - gesture.current.last.x, world.wy - gesture.current.last.y) > 0.01) gesture.current.points!.push({ x: world.wx, y: world.wy }); }
      finishGesture();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cancel(event: PointerEvent<HTMLCanvasElement>) { if (gesture.current?.pointerId === event.pointerId) finishGesture(true); }
  function leave() { setBrushCursor(null); setCursorCell(null); }
  return { down, move, up, cancel, leave, finishGesture, preview, draftLine, brushCursor, cursorCell };
}
