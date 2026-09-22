import type { Dispatch, SetStateAction } from "react";
import type { MapInputTools } from "../tools/types";
import type { MapGeometry, V5Selection } from "./useMapSelection";
import type { LayerId, MapDocumentV5 } from "../../core/types";
import type { MapMarkerKind, MapTrapKind } from "../../render";
import type { BrushSize, PaintTool } from "../editorTypes";
import { createLabelTools } from "../tools/labelTools";
import { createObjectTools } from "../tools/objectTools";
import { createPaintTools } from "../tools/paintTools";
import { createRulerTools, type RulerState } from "../tools/rulerTools";
import { createShapeTools, type ShapeContent } from "../tools/shapeTools";
import { createWallTools } from "../tools/wallTools";

// Фасад инструментов (Фаза 2G): композиция тематических групп поверх V5.
// Страница хранит editor/UI state и связывает колбэки; доменные мутации —
// через V5 Mutation Core в tools/*.

interface UseMapToolsArgs {
  geom: MapGeometry | null;
  tool: PaintTool;
  terrain: string;
  brushSize: BrushSize;
  wallSnap: boolean;
  wallDraft: { x: number; y: number }[] | null;
  wallLive: { x: number; y: number } | null;
  shapeContent: ShapeContent;
  shapeAnchor: { x: number; y: number } | null;
  ruler: RulerState | null;
  lastTrapKind: MapTrapKind;
  markerKind: MapMarkerKind;
  // 3A: resolver target слоёв читает active и переключает его при auto-pick.
  activeLayerId: LayerId | null;
  onActiveLayer: (id: LayerId) => void;
  documentRef: { current: MapDocumentV5 | null };
  setDocument: (d: MapDocumentV5) => void;
  push: (before: MapDocumentV5) => void;
  commitDocument: (next: MapDocumentV5, before: MapDocumentV5) => void;
  newId: () => string;
  selectTool: (t: PaintTool) => void;
  setTerrain: (t: string) => void;
  setRuler: (updater: (r: RulerState | null) => RulerState | null) => void;
  setWallDraft: Dispatch<SetStateAction<{ x: number; y: number }[] | null>>;
  setWallLive: (v: { x: number; y: number } | null) => void;
  setShapeAnchor: (v: { x: number; y: number } | null) => void;
  setRectPreview: (r: { x: number; y: number; w: number; h: number } | null) => void;
  setActionError: (e: string | null) => void;
  onRequestRoomCreate: (rect: { x: number; y: number; w: number; h: number }) => void;
  onRequestLabelEdit: (x: number, y: number) => void;
  // UI-потоки создания (панели/модалки остаются у страницы): фасад только
  // пробрасывает их в контракт tools без изменений.
  openObjectPanel: (sel: NonNullable<V5Selection>) => void;
  openCreate: (cell: { x: number; y: number }, wx: number, wy: number) => void;
  openRoomDraft: () => void;
  cancelObjectDrag: (before: MapDocumentV5) => void;
}

export function useMapTools(a: UseMapToolsArgs): MapInputTools {
  const paint = createPaintTools({
    geom: a.geom,
    tool: a.tool,
    terrain: a.terrain,
    brushSize: a.brushSize,
    activeLayerId: a.activeLayerId,
    onActiveLayer: a.onActiveLayer,
    documentRef: a.documentRef,
    setDocument: a.setDocument,
    push: a.push,
    newId: a.newId,
    selectTool: a.selectTool,
    setTerrain: a.setTerrain,
    setActionError: a.setActionError,
  });
  const ruler = createRulerTools({ ruler: a.ruler, setRuler: a.setRuler });
  const wall = createWallTools({
    geom: a.geom,
    wallSnap: a.wallSnap,
    wallDraft: a.wallDraft,
    wallLive: a.wallLive,
    activeLayerId: a.activeLayerId,
    onActiveLayer: a.onActiveLayer,
    setWallDraft: a.setWallDraft,
    setWallLive: a.setWallLive,
    documentRef: a.documentRef,
    setDocument: a.setDocument,
    push: a.push,
    setActionError: a.setActionError,
  });
  const shape = createShapeTools({
    geom: a.geom,
    shapeContent: a.shapeContent,
    terrain: a.terrain,
    shapeAnchor: a.shapeAnchor,
    activeLayerId: a.activeLayerId,
    onActiveLayer: a.onActiveLayer,
    setShapeAnchor: a.setShapeAnchor,
    setRectPreview: a.setRectPreview,
    documentRef: a.documentRef,
    setDocument: a.setDocument,
    push: a.push,
    newId: a.newId,
    setActionError: a.setActionError,
    onRequestRoomCreate: a.onRequestRoomCreate,
  });
  const label = createLabelTools({ onRequestLabelEdit: a.onRequestLabelEdit });
  const objects = createObjectTools({
    geom: a.geom,
    lastTrapKind: a.lastTrapKind,
    markerKind: a.markerKind,
    activeLayerId: a.activeLayerId,
    onActiveLayer: a.onActiveLayer,
    setActionError: a.setActionError,
    documentRef: a.documentRef,
    commitDocument: a.commitDocument,
    newId: a.newId,
  });

  return {
    paint: {
      paintAt: paint.paintAt,
      singleAction: paint.singleAction,
      altPick: paint.altPick,
      placeObject: objects.placeObject,
    },
    ruler: {
      tap: ruler.tap,
      hover: ruler.hover,
    },
    wall: {
      tapVertex: wall.tapVertex,
      hoverLive: wall.hoverLive,
      // finishWallLine чинил предсуществующий обрыв фасада (page/hotkeys
      // вызывают, контракт не отдавал): поведение не меняем, только чиним тип.
      finishWallLine: wall.finishWallLine,
    },
    shape: {
      startDrag: shape.startDrag,
      moveDrag: shape.moveDrag,
      apply: shape.apply,
      tap: shape.tap,
    },
    label: {
      open: (x, y) => label.click({ x, y }),
    },
    objects: {
      openPanel: a.openObjectPanel,
      create: a.openCreate,
      roomRect: () => a.openRoomDraft(),
      cancelDrag: a.cancelObjectDrag,
    },
  };
}
