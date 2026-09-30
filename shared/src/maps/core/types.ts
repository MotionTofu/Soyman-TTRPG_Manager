/**
 * TypeScript-модель Map Core V2 — дословно по ADR-0003 §A.
 * Чистые данные без React/Canvas/DOM. Single source of truth для
 * client и server (server импортирует собранный dist, клиент — исходники).
 * Grid/scale — нейтральные литералы из ./literals (не client mapTypes).
 */

import type { JsonObject } from "./json";
import type {
  MapDoorKind,
  MapGridType,
  MapMarkerKind,
  MapRoomType,
  MapScaleName,
  MapTrapKind,
} from "./literals";
import type { MaterialRef, ScatterProfileRef, StyleRef, VisualRef } from "./refs";

/** Совместимость со старым именем клиентского типа. */
export type MapGrid = MapGridType;
export type MapScale = MapScaleName;

/** Стабильный идентификатор сущности или слоя. Новые — UUID, legacy — детерминированные. */
export type EntityId = string;
export type LayerId = string;

/** Точка/вектор в world coordinates. Всегда конечные numbers. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface MapDocumentV5 {
  v: 5;
  world: MapWorld;
  /** null = карта без grid (режим «Красивости» без привязки). */
  grid: MapGridConfig | null;
  /** Отсутствует на старых картах: игрок видит всё. */
  exploration?: MapExploration;
  assetPacks: AssetPackRef[];
  layers: MapLayer[];
}

export interface MapExploration {
  /** Включённая маска скрывает от игроков все клетки вне revealedCells. */
  enabled: boolean;
  revealedCells: Array<{ x: number; y: number }>;
}

/** Метаданные записи (будущий MapRecordV5). Сервер на Фазе 2F не переключается. */
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

export interface MapWorld {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

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
  /** palette-index-v1: 256 индексов (0 = прозрачно, 1..N = materials).
   *  Другие JSON encoding остаются валидными для будущих версий. */
  payload: JsonObject;
}

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
  /** Branch start follows this node of another spline. */
  branchFrom?: { pathId: EntityId; nodeIndex: number };
  properties?: JsonObject;
}

export type PathGeometry =
  | { type: "cell-network"; cells: Array<{ x: number; y: number }> }
  | { type: "spline"; nodes: SplineNode[] };

export interface SplineNode {
  position: Vec2;
  in?: Vec2;
  out?: Vec2;
  /** Local stroke width in world units; falls back to MapPath.width. */
  width?: number;
}

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

export type ShapeGeometry =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: Vec2[] }
  | { type: "ellipse"; center: Vec2; rx: number; ry: number };

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

export interface GameplayRoom {
  id: EntityId;
  kind: "room";
  geometry: ShapeGeometry;
  roomType: MapRoomType;
  name: string;
}

export interface GameplayDoor {
  id: EntityId;
  kind: "door";
  position: Vec2;
  /** Градусы clockwise от севера (−Y): n=0, e=90, s=180, w=270. */
  orientation: number;
  doorKind: MapDoorKind;
  secret: boolean;
  pairedDoorId: EntityId | null;
}

export interface GameplayTrap {
  id: EntityId;
  kind: "trap";
  position: Vec2;
  trapKind: MapTrapKind;
}

export interface GameplayMarker {
  id: EntityId;
  kind: "marker";
  position: Vec2;
  markerKind: MapMarkerKind;
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

export interface AssetPackRef {
  id: string;
  version?: string;
}

/** soyman-map/2 envelope (import/export, НЕ DB format). */
export interface SoyMapV2Envelope {
  format: "soyman-map/2";
  /** Копия record metadata для импорта (канонически живёт в MapRecord). */
  name: string;
  scale: MapScale;
  cellLore: string;
  /** Необязательные настройки генератора для переноса между установками. */
  generator?: { seed: number; sea: number; mountains: number; forest: number };
  document: MapDocumentV5;
}
