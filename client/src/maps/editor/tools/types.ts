import type { V5Selection } from "../hooks/useMapSelection";
import type { MapDocumentV5 } from "../../core/types";
import type { PaintTool } from "../editorTypes";

// Контракт tools { paint, ruler, wall, shape, label, objects } (Фаза 2G):
// вместо MapCells — documentRef/setDocument/push/commit по V5.
// useMapTools его собирает, useMapInput потребляет. Клеточные входы
// (MapInputCell) сохранены: snapping остаётся grid-based.

export interface MapInputCell {
  x: number;
  y: number;
}

export interface MapInputTools {
  paint: {
    paintAt: (wx: number, wy: number, opts?: { eraseOverride?: boolean }) => boolean;
    singleAction: (wx: number, wy: number) => void;
    altPick: (wx: number, wy: number) => void;
    placeObject: (kind: PaintTool, wx: number, wy: number) => void;
  };
  ruler: {
    tap: (cell: MapInputCell) => void;
    hover: (cell: MapInputCell | null) => void;
  };
  wall: {
    tapVertex: (wx: number, wy: number) => void;
    hoverLive: (wx: number, wy: number) => void;
    finishWallLine: (includeLive: boolean) => void;
  };
  shape: {
    startDrag: (cell: MapInputCell) => void;
    moveDrag: (anchor: MapInputCell, cell: MapInputCell) => void;
    apply: (a: MapInputCell, b: MapInputCell) => void;
    tap: (cell: MapInputCell) => void;
  };
  label: {
    open: (x: number, y: number) => void;
  };
  objects: {
    openPanel: (sel: NonNullable<V5Selection>) => void;
    create: (cell: MapInputCell, wx: number, wy: number) => void;
    roomRect: (rect: { x: number; y: number; w: number; h: number }) => void;
    cancelDrag: (before: MapDocumentV5) => void;
  };
}
