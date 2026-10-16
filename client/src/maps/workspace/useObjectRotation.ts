import { useRef, type PointerEvent } from "react";
import type { MapDocumentV6, MapObject, Vec2 } from "@shared/maps/core";
import { transformMapObject } from "../core/mutations/mapObjects";
import { editGeometry } from "./editDocument";
import type { WorkspaceSelection } from "./editorCommands";

type Edit = (operation: (before: MapDocumentV6) => MapDocumentV6) => void;
type Camera = { cam: { scale: number }; toWorld: (event: { clientX: number; clientY: number }) => { wx: number; wy: number } };

/** Кружок поворота над предметом (П15): отступ — в точках экрана, чтобы ручка не липла к мелкому знаку. */
export function objectKnob(object: MapObject, scale: number): { knob: Vec2; top: Vec2 } {
  const half = Math.max(Math.abs(object.transform.scale.x), Math.abs(object.transform.scale.y)) / 2, a = object.transform.rotation * Math.PI / 180;
  const at = (d: number) => ({ x: object.transform.position.x + d * Math.sin(a), y: object.transform.position.y - d * Math.cos(a) });
  return { knob: at(half + 28 / scale), top: at(half) };
}
export function selectedObject(document: MapDocumentV6 | null, selection: WorkspaceSelection | null): MapObject | null {
  if (!document || selection?.kind !== "object") return null;
  const layer = document.layers.find((entry) => entry.id === selection.layerId);
  return layer?.kind === "object" && layer.visible && !layer.locked ? layer.items.find((item) => item.id === selection.id) ?? null : null;
}

/** Поворот выбранного предмета ручкой: Shift — шагом 15°. */
export function useObjectRotation({ object, camera, live, settle, space }: {
  object: MapObject | null; camera: Camera; live: Edit; settle: () => void; space: { current: boolean };
}) {
  const turn = useRef<{ start: MapObject; from: number } | null>(null);
  const angle = (p: Vec2, o: MapObject) => Math.atan2(p.y - o.transform.position.y, p.x - o.transform.position.x) * 180 / Math.PI;
  const world = (event: { clientX: number; clientY: number }) => { const p = camera.toWorld(event); return { x: p.wx, y: p.wy }; };
  function down(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (!object || event.button !== 0 || space.current) return false;
    const p = world(event), { knob } = objectKnob(object, camera.cam.scale);
    if (Math.hypot(knob.x - p.x, knob.y - p.y) * camera.cam.scale > 9) return false;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    turn.current = { start: object, from: angle(p, object) };
    return true;
  }
  function move(event: PointerEvent<HTMLCanvasElement>): boolean {
    const current = turn.current;
    if (!current) return false;
    let rotation = current.start.transform.rotation + angle(world(event), current.start) - current.from;
    rotation = event.shiftKey ? Math.round(rotation / 15) * 15 : Math.round(rotation);
    rotation = ((rotation % 360) + 540) % 360 - 180;
    const { id, transform } = current.start;
    live((before) => editGeometry(before, (view) => transformMapObject(view, id, rotation, Math.abs(transform.scale.x))));
    return true;
  }
  function up(): boolean {
    if (!turn.current) return false;
    turn.current = null; settle();
    return true;
  }
  return { down, move, up };
}
