import type { Dispatch, SetStateAction } from "react";
import type { MapInputTools } from "../tools/types";
import type { ObjSel } from "./useMapSelection";
import type { MapFull } from "../../mapTypes";
import type { MapCells, MapMarkerKind, MapTrapKind } from "../../render";
import type { BrushSize, PaintTool } from "../editorTypes";
import { createLabelTools } from "../tools/labelTools";
import { createObjectTools } from "../tools/objectTools";
import { createPaintTools } from "../tools/paintTools";
import { createRulerTools, type RulerState } from "../tools/rulerTools";
import { createShapeTools, type ShapeContent } from "../tools/shapeTools";
import { createWallTools } from "../tools/wallTools";

// Фасад инструментов (Фаза 1, Tool Controller): собирает тематические группы
// и отдаёт наружу практически тот же объект tools, который получает useMapInput.
// НЕ один огромный класс, знающий всё: paint/wall/shape/ruler/label/objects
// живут в tools/*, здесь только композиция. Возврат типизирован контрактом
// MapInputTools — маршрутизация Input при выносе не меняется по построению.

interface UseMapToolsArgs {
  map: MapFull | null;
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
  cellsRef: { current: MapCells };
  setCells: (c: MapCells) => void;
  clone: (c: MapCells) => MapCells;
  push: (before: MapCells) => void;
  commitChange: (next: MapCells, before: MapCells) => void;
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
  openObjectPanel: (sel: NonNullable<ObjSel>) => void;
  openCreate: (cell: { x: number; y: number }, wx: number, wy: number) => void;
  openRoomDraft: () => void;
  cancelObjectDrag: (before: MapCells) => void;
}

export function useMapTools(a: UseMapToolsArgs): MapInputTools {
  const paint = createPaintTools({
    map: a.map,
    tool: a.tool,
    terrain: a.terrain,
    brushSize: a.brushSize,
    cellsRef: a.cellsRef,
    setCells: a.setCells,
    push: a.push,
    clone: a.clone,
    selectTool: a.selectTool,
    setTerrain: a.setTerrain,
  });
  const ruler = createRulerTools({ ruler: a.ruler, setRuler: a.setRuler });
  const wall = createWallTools({
    map: a.map,
    wallSnap: a.wallSnap,
    wallDraft: a.wallDraft,
    wallLive: a.wallLive,
    setWallDraft: a.setWallDraft,
    setWallLive: a.setWallLive,
    cellsRef: a.cellsRef,
    setCells: a.setCells,
    push: a.push,
    clone: a.clone,
  });
  const shape = createShapeTools({
    map: a.map,
    shapeContent: a.shapeContent,
    terrain: a.terrain,
    shapeAnchor: a.shapeAnchor,
    setShapeAnchor: a.setShapeAnchor,
    setRectPreview: a.setRectPreview,
    cellsRef: a.cellsRef,
    setCells: a.setCells,
    push: a.push,
    clone: a.clone,
    onRequestRoomCreate: a.onRequestRoomCreate,
  });
  const label = createLabelTools({ onRequestLabelEdit: a.onRequestLabelEdit });
  const objects = createObjectTools({
    map: a.map,
    lastTrapKind: a.lastTrapKind,
    markerKind: a.markerKind,
    setActionError: a.setActionError,
    cellsRef: a.cellsRef,
    commitChange: a.commitChange,
    clone: a.clone,
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
