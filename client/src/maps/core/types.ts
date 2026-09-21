// TypeScript-модель Map Core V2 — дословно по ADR-0003 §A.
// Чистые данные: без React, Canvas, хуков и API. Модель не расширять
// «на будущее» — только принятое в ADR.

import type { MapGrid, MapScale } from "../mapTypes";
import type { JsonObject } from "./json";
import type {
  AssetRef,
  MaterialRef,
  ScatterProfileRef,
  StyleRef,
  VisualRef,
} from "./refs";

export type { MapGrid, MapScale };
export type { JsonObject };
export type { AssetRef, MaterialRef, ScatterProfileRef, StyleRef, VisualRef };

// --- Примитивы (§A.1) ---

/** Стабильный идентификатор сущности или слоя. Новые — UUID, legacy — детерминированные. */
export type EntityId = string;
export type LayerId = string;

/** Точка/вектор в world coordinates. Всегда конечные numbers. */
export interface Vec2 {
  x: number;
  y: number;
}

// --- Top level (§A.2) ---

export interface MapDocumentV5 {
  v: 5;
  world: MapWorld;
  /** null = карта без grid (режим «Красивости» без привязки). */
  grid: MapGridConfig | null;
  assetPacks: AssetPackRef[];
  layers: MapLayer[];
}

/** Метаданные записи (будущий MapRecordV5, §40 ТЗ). Сервер пока не переключается. */
export interface MapRecordV5 {
  id: number;
  name: string;
  scale: MapScale;
  /** Подпись «1 клетка = …»: display-metadata записи, не геометрия. */
  cellLore: string;
  playerVisible: boolean;
  parentMapId: number | null;
  createdAt: string;
  updatedAt: string;
  provenance?: MapProvenance;
  document: MapDocumentV5;
}

/** Генераторный provenance — metadata записи, не документ (§D.8). */
export interface MapProvenance {
  preset?: string;
  seed?: number;
  params?: {
    sea?: number;
    mountains?: number;
    forest?: number;
  };
}

// --- World (§A.3) ---

export interface MapWorld {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

// --- Grid (§A.4) ---

export interface MapGridConfig {
  type: "square" | "hex";
  /** Размер клетки в world units (для legacy = 1). */
  cellSize: number;
  columns: number;
  rows: number;
  origin: Vec2;
  hex?: {
    orientation: "pointy";
    offset: "odd-q";
  };
}

// --- Layers (§A.5) ---

export interface MapLayerBase {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 включительно. */
  opacity: number;
}

export type MapLayer =
  | TerrainLayer
  | PathLayer
  | ObjectLayer
  | ScatterLayer
  | LabelLayer
  | GameplayLayer;

// --- Terrain (§A.6) ---

export interface TerrainLayerBase extends MapLayerBase {
  kind: "terrain";
  defaultMaterial: MaterialRef;
}

export interface TerrainCellEntry {
  x: number;
  y: number;
  material: MaterialRef;
}

/** Клеточный террейн. ТРЕБУЕТ document.grid !== null. */
export interface TerrainCellLayer extends TerrainLayerBase {
  representation: "cells";
  /** Разреженно, canonical-сортировка (y, x). */
  cells: TerrainCellEntry[];
}

/** Масочный террейн. НЕ зависит от grid — собственная геометрия origin + sampleSize. */
export interface TerrainMaskLayer extends TerrainLayerBase {
  representation: "mask";
  mask: TerrainMask;
}

export type TerrainLayer = TerrainCellLayer | TerrainMaskLayer;

export interface TerrainMask {
  origin: Vec2;
  /** World units на один terrain sample (> 0). */
  sampleSize: number;
  /** Палитра слоя: sample логически = индекс в этот массив. */
  materials: MaterialRef[];
  chunks: TerrainMaskChunk[];
}

export interface TerrainMaskChunk {
  id: EntityId;
  cx: number;
  cy: number;
  /** Непрозрачная нагрузка; логические требования — в ADR, encoding — Terrain Phase. */
  payload: JsonObject;
}

// --- Paths (§A.7) ---

export interface PathLayer extends MapLayerBase {
  kind: "path";
  paths: MapPath[];
}

export interface MapPath {
  id: EntityId;
  /** "road" | "river" | "wall" | ... — открытый набор. */
  kind: string;
  geometry: PathGeometry;
  /** Для cell-network — в клетках; для spline — в world units. > 0. */
  width: number;
  styleRef: StyleRef;
  properties?: JsonObject;
}

export type PathGeometry =
  | { type: "cell-network"; cells: Array<{ x: number; y: number }> }
  | { type: "spline"; nodes: SplineNode[] };

export interface SplineNode {
  position: Vec2;
  in?: Vec2;
  out?: Vec2;
}

// --- Objects (§A.8) ---

export interface MapObject {
  id: EntityId;
  transform: {
    position: Vec2;
    /** Градусы, clockwise (Canvas: ось Y вниз). */
    rotation: number;
    scale: Vec2;
  };
  visual: VisualRef;
  properties?: JsonObject;
}

export interface ObjectLayer extends MapLayerBase {
  kind: "object";
  items: MapObject[];
}

// --- Scatter (§A.9) ---

export interface ScatterLayer extends MapLayerBase {
  kind: "scatter";
  areas: ScatterArea[];
}

export interface ScatterArea {
  id: EntityId;
  shape: ShapeGeometry;
  profileRef: ScatterProfileRef;
  seed: number;
  density: number;
  overrides?: JsonObject;
}

// --- Shapes (§A.10) ---

export type ShapeGeometry =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: Vec2[] }
  | { type: "ellipse"; center: Vec2; rx: number; ry: number };

// --- Labels (§A.11) ---

export interface MapLabel {
  id: EntityId;
  position: Vec2;
  text: string;
  styleRef?: string;
}

export interface LabelLayer extends MapLayerBase {
  kind: "label";
  items: MapLabel[];
}

// --- Gameplay (§A.12) ---

export interface GameplayRoom {
  id: EntityId;
  kind: "room";
  geometry: ShapeGeometry;
  roomType: "empty" | "barracks" | "temple" | "treasury" | "prison" | "lab";
  name: string;
}

export interface GameplayDoor {
  id: EntityId;
  kind: "door";
  position: Vec2;
  /** Градусы clockwise от севера (−Y): n=0, e=90, s=180, w=270. */
  orientation: number;
  doorKind: "arch" | "door" | "locked" | "trapped" | "secret" | "portc";
  secret: boolean;
  pairedDoorId: EntityId | null;
}

export interface GameplayTrap {
  id: EntityId;
  kind: "trap";
  position: Vec2;
  trapKind: "pit" | "arrow" | "gas" | "glyph";
}

export interface GameplayMarker {
  id: EntityId;
  kind: "marker";
  position: Vec2;
  markerKind:
    | "chest"
    | "altar"
    | "city"
    | "village"
    | "camp"
    | "metro"
    | "battle"
    | "obelisk";
}

export interface GameplayStart {
  id: EntityId;
  kind: "start";
  position: Vec2;
}

export interface GameplayFinish {
  id: EntityId;
  kind: "finish";
  position: Vec2;
}

export type GameplayEntity =
  | GameplayRoom
  | GameplayDoor
  | GameplayTrap
  | GameplayMarker
  | GameplayStart
  | GameplayFinish;

export interface GameplayLayer extends MapLayerBase {
  kind: "gameplay";
  items: GameplayEntity[];
}

// --- Assets (§A.13) ---

export interface AssetPackRef {
  id: string;
  version?: string;
}

// --- soyman-map/2 envelope (ADR §D.6) ---

export interface SoyMapV2Envelope {
  format: "soyman-map/2";
  /** Копия record metadata для импорта (канонически живёт в MapRecord). */
  name: string;
  scale: MapScale;
  cellLore: string;
  document: MapDocumentV5;
}
