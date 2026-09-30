import { putGameplayToken, removeGameplayToken, type GameplayToken, type MapDocumentV6, type Vec2 } from "@shared/maps/core";
import { applyTerrainCellEdits, builtinMaterial, createGameplayEntity, createLabel, deleteGameplayEntity,
  deleteLabel, moveGameplayEntity, moveLabel } from "../core";
import { addMapObject, deleteMapObject, moveMapObject } from "../core/mutations/mapObjects";
import { MAP_SYMBOL_PACK } from "../assets/registry";
import { cellCenter, pixelToCell } from "../grid";
import { editGeometry } from "./editDocument";

export type WorkspaceTool = "select" | "brush" | "eraser" | "shape" | "wall" | "door" | "label" | "asset";
export type WorkspaceSelection = { id: string; layerId: string; kind: "gameplay" | "token" | "label" | "object" };
export const TOOL_LABELS: Record<WorkspaceTool, string> = { select: "Выбор", brush: "Пол", eraser: "Ластик",
  shape: "Комната", wall: "Стена", door: "Дверь", label: "Подпись", asset: "Объект" };
export const toolLayerKind = (tool: WorkspaceTool) => tool === "brush" || tool === "eraser" || tool === "wall"
  ? "terrain" : tool === "label" ? "label" : tool === "asset" ? "object" : "gameplay";

export function requireEditableLayer(document: MapDocumentV6, id: string, kind?: string) {
  const layer = document.layers.find((entry) => entry.id === id);
  if (!layer || (kind && layer.kind !== kind)) throw new Error("Выберите подходящий слой в окне «Слои»");
  if (!layer.visible || layer.locked) throw new Error("Слой скрыт или заблокирован. Измените его настройки в окне «Слои»");
  return layer;
}

export function quantize(document: MapDocumentV6, point: Vec2, snap: boolean): Vec2 {
  if (!snap || !document.grid) return point;
  const cell = pixelToCell(document.grid.type, point.x, point.y, document.grid.columns, document.grid.rows);
  if (!cell) return point;
  const center = cellCenter(document.grid.type, cell.x, cell.y);
  return { x: center.cx, y: center.cy };
}

/** Sample a segment at half-cell intervals so fast strokes do not leave gaps. */
export function paintSegment(document: MapDocumentV6, layerId: string, a: Vec2, b: Vec2, material: string | null): MapDocumentV6 {
  const layer = requireEditableLayer(document, layerId, "terrain");
  if (layer.kind !== "terrain" || layer.representation !== "cells" || !document.grid) throw new Error("Для этой кисти нужен клеточный слой поверхности");
  const grid = document.grid;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  const cells = new Map<string, { x: number; y: number; material: ReturnType<typeof builtinMaterial> | null }>();
  for (let i = 0; i <= steps; i++) {
    const cell = pixelToCell(grid.type, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, grid.columns, grid.rows);
    if (cell) cells.set(`${cell.x},${cell.y}`, { ...cell, material: material === null ? null : builtinMaterial(material) });
  }
  return editGeometry(document, (view) => applyTerrainCellEdits(view, layerId, [...cells.values()]));
}

export function roomRect(a: Vec2, b: Vec2, snap: boolean) {
  const x = snap ? Math.floor(Math.min(a.x, b.x)) : Math.min(a.x, b.x);
  const y = snap ? Math.floor(Math.min(a.y, b.y)) : Math.min(a.y, b.y);
  return { x, y, w: Math.max(snap ? 1 : 0.1, (snap ? Math.ceil(Math.max(a.x, b.x)) : Math.max(a.x, b.x)) - x),
    h: Math.max(snap ? 1 : 0.1, (snap ? Math.ceil(Math.max(a.y, b.y)) : Math.max(a.y, b.y)) - y) };
}

export function createRoom(document: MapDocumentV6, layerId: string, id: string, a: Vec2, b: Vec2, snap: boolean) {
  requireEditableLayer(document, layerId, "gameplay");
  return editGeometry(document, (view) => createGameplayEntity(view, layerId, { id, kind: "room", roomType: "empty", name: "",
    geometry: { type: "rect", ...roomRect(a, b, snap) } }));
}
export function createDoor(document: MapDocumentV6, layerId: string, id: string, point: Vec2, snap: boolean, orientation: number) {
  requireEditableLayer(document, layerId, "gameplay");
  const position = snap && document.grid?.type === "square"
    ? orientation === 0 ? { x: Math.floor(point.x) + 0.5, y: Math.round(point.y) }
      : { x: Math.round(point.x), y: Math.floor(point.y) + 0.5 }
    : quantize(document, point, snap);
  return editGeometry(document, (view) => createGameplayEntity(view, layerId,
    { id, kind: "door", position, orientation, doorKind: "door", secret: false, pairedDoorId: null }));
}
export function addLabel(document: MapDocumentV6, layerId: string, id: string, position: Vec2, text: string) {
  requireEditableLayer(document, layerId, "label");
  return editGeometry(document, (view) => createLabel(view, layerId, { id, position, text }));
}
export function addSymbol(document: MapDocumentV6, layerId: string, id: string, position: Vec2, assetId: string) {
  requireEditableLayer(document, layerId, "object");
  const installed = document.assetPacks.find((pack) => pack.id === MAP_SYMBOL_PACK.id);
  if (installed && installed.version !== MAP_SYMBOL_PACK.version) throw new Error("Эта карта использует другую версию набора символов");
  const base = document.assetPacks.some((pack) => pack.id === MAP_SYMBOL_PACK.id) ? document
    : { ...document, assetPacks: [...document.assetPacks, MAP_SYMBOL_PACK] };
  return editGeometry(base, (view) => addMapObject(view, layerId, { id, visual: { type: "asset", assetId },
    transform: { position, rotation: 0, scale: { x: 1, y: 1 } } }));
}
export function moveSelection(document: MapDocumentV6, selection: WorkspaceSelection, delta: Vec2): MapDocumentV6 {
  const layer = requireEditableLayer(document, selection.layerId);
  if (delta.x === 0 && delta.y === 0) return document;
  if (selection.kind === "token") return updateToken(document, selection, (token) => ({ ...token, position: { x: token.position.x + delta.x, y: token.position.y + delta.y } }));
  return editGeometry(document, (view) => {
    if (selection.kind === "gameplay") return moveGameplayEntity(view, selection.id, delta);
    if (selection.kind === "label" && layer.kind === "label") {
      const item = layer.items.find((entry) => entry.id === selection.id)!;
      return moveLabel(view, item.id, delta);
    }
    if (layer.kind === "object") {
      const item = layer.items.find((entry) => entry.id === selection.id)!;
      return moveMapObject(view, item.id, { x: item.transform.position.x + delta.x, y: item.transform.position.y + delta.y });
    }
    throw new Error("Объект больше не существует");
  });
}
export function removeSelection(document: MapDocumentV6, selection: WorkspaceSelection) {
  requireEditableLayer(document, selection.layerId);
  if (selection.kind === "token") return removeGameplayToken(document, selection.id);
  return editGeometry(document, (view) => selection.kind === "gameplay" ? deleteGameplayEntity(view, selection.id)
    : selection.kind === "label" ? deleteLabel(view, selection.id) : deleteMapObject(view, selection.id));
}

export function updateToken(document: MapDocumentV6, selection: WorkspaceSelection, edit: (token: GameplayToken) => GameplayToken) {
  const layer = requireEditableLayer(document, selection.layerId, "gameplay");
  const token = layer.kind === "gameplay" ? layer.items.find((item) => item.id === selection.id && item.kind === "token") : null;
  if (!token || token.kind !== "token") throw new Error("Токен больше не существует");
  const next = edit(token);
  if (next.id !== token.id) throw new Error("Нельзя менять идентификатор токена");
  return putGameplayToken(document, layer.id, next);
}
