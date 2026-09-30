// MapRenderModel — read-only runtime view для Canvas renderer (Фазы 2D/3A).
// НЕ формат хранения и НЕ source of truth: не сериализуется, не сохраняется,
// не мутируется, не входит в History/Autosave.
//
// 3A: layer-oriented model. document.layers[] — canonical composition order
// (первый = самый нижний); адаптеры сохраняют реальную структуру и порядок
// слоёв, renderer обходит их последовательно. Никаких hardcoded render slots.
//
//   MapCells ──→ MapRenderModel ──┐
//                                 ▼
//   MapDocumentV5 ─→ MapRenderModel → renderMap
//
// Production использует только V5-ветку; legacy-адаптер — для тестов/parity.

import {
  LEGACY_FINISH_ID,
  LEGACY_START_ID,
  legacyDoorId,
  legacyLabelId,
  legacyMarkerId,
  legacyRoomId,
  legacyTrapId,
} from "./core/ids";
import type { MaterialRef } from "./core/refs";
import type { LayerId, MapDocumentV5, MapObject, SplineNode } from "./core/types";
import { mapAssetPackForId, resolveMapSymbol, type MapVisualAsset } from "./assets/registry";
import { isPaletteIndexMaskPayload, TERRAIN_MASK_CHUNK_SIDE } from "@shared/maps/core/terrainMask";
import { cellCenter } from "./grid";
import type { GameplayToken } from "@shared/maps/core";
import type { MapGrid } from "./mapTypes";
import type {
  MapCells,
  MapDoor,
  MapDoorKind,
  MapMarkerKind,
  MapRoomType,
  MapTrapKind,
} from "./render";

export interface RenderPoint {
  x: number;
  y: number;
}

export interface RenderLabel {
  id: string;
  position: RenderPoint;
  text: string;
}

export interface RenderRoom {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  type: MapRoomType;
  name: string;
}

export interface RenderDoor {
  id: string;
  /** Мировые координаты середины ребра (legacy) или V5 position. */
  position: RenderPoint;
  /** n/s (orientation 0/180) — линия вдоль X; e/w — вдоль Y. */
  horizontal: boolean;
  kind: MapDoorKind;
  secret: boolean;
}

export interface RenderTrap {
  id: string;
  position: RenderPoint;
  kind: MapTrapKind;
}

export interface RenderMarker {
  id: string;
  position: RenderPoint;
  kind: MapMarkerKind;
}

export interface RenderStartFinish {
  id: string;
  position: RenderPoint;
}

/** Gameplay-сущность в порядке items[] слоя — render order внутри layer (§16).
 *  По kind НЕ сортируется. */
export type RenderGameplayItem =
  | { kind: "token"; token: GameplayToken; display?: { name: string; state: "active" | "missing"; portrait?: HTMLImageElement | null } }
  | { kind: "room"; room: RenderRoom }
  | { kind: "door"; door: RenderDoor }
  | { kind: "trap"; trap: RenderTrap }
  | { kind: "marker"; marker: RenderMarker }
  | { kind: "start"; start: RenderStartFinish }
  | { kind: "finish"; finish: RenderStartFinish };

export interface RenderTerrainView {
  /** Код террейна по умолчанию (legacy: "plain"). */
  readonly defaultCode: string;
  /** Только non-default клетки "x,y" → код (legacy: тот же Map без копирования). */
  readonly entries: ReadonlyMap<string, string>;
  /** World-space samples for a denser mask layer; absent for cell terrain. */
  readonly mask?: { origin: RenderPoint; sampleSize: number; entries: ReadonlyMap<string, string> };
}

export interface RenderLayerBase {
  id: LayerId;
  name: string;
  /** false → renderer полностью пропускает слой (§21). */
  visible: boolean;
  /** На rendering не влияет; сохраняется для editor consumers. */
  locked: boolean;
  /** 0..1; применяется ко всему content слоя (§22). */
  opacity: number;
}

/** Полный terrain surface со своим default/entries/opacity (§12). */
export interface RenderTerrainLayer extends RenderLayerBase {
  kind: "terrain";
  terrain: RenderTerrainView;
}

/** Path-слой со своим paths[]; порядок paths[] = render order (§14). */
/** Один рисуемый путь: legacy cell network или свободная мировая линия. */
export interface RenderPath {
  kind: "road" | "river";
  cells: ReadonlySet<string>;
  nodes?: readonly SplineNode[];
  width?: number;
}

export interface RenderPathLayer extends RenderLayerBase {
  kind: "path";
  /** paths[] order = render order (§14). */
  paths: readonly RenderPath[];
}

export interface RenderGameplayLayer extends RenderLayerBase {
  kind: "gameplay";
  items: readonly RenderGameplayItem[];
}

export interface RenderLabelLayer extends RenderLayerBase {
  kind: "label";
  labels: readonly RenderLabel[];
}

export interface RenderMapObject {
  object: MapObject;
  asset: MapVisualAsset;
}

export interface RenderObjectLayer extends RenderLayerBase {
  kind: "object";
  items: readonly RenderMapObject[];
}

export interface RenderScatterLayer extends RenderLayerBase {
  kind: "scatter";
}

export type MapRenderLayer =
  | RenderTerrainLayer
  | RenderPathLayer
  | RenderGameplayLayer
  | RenderLabelLayer
  | RenderObjectLayer
  | RenderScatterLayer;

export interface MapRenderModel {
  /** Canonical composition order документа: первый = самый нижний (§3). */
  readonly layers: readonly MapRenderLayer[];
  readonly exploration?: { enabled: boolean; revealedCells: ReadonlySet<string> };
}

// ADR §D.1 (независимая копия правила, см. migrateLegacy/comparator):
// середина ребра = центр клетки + оффсет; n/s — горизонтальная линия.
const EDGE_OFFSET: Record<MapDoor["edge"], { dx: number; dy: number }> = {
  n: { dx: 0, dy: -0.5 },
  s: { dx: 0, dy: 0.5 },
  w: { dx: -0.5, dy: 0 },
  e: { dx: 0.5, dy: 0 },
};

function toWorld(grid: MapGrid, x: number, y: number): RenderPoint {
  const c = cellCenter(grid, x, y);
  return { x: c.cx, y: c.cy };
}

function openLayer(id: string, name: string): RenderLayerBase {
  return { id, name, visible: true, locked: false, opacity: 1 };
}

/**
 * Legacy adapter: MapCells → layered read view без семантических изменений.
 * Псевдо-стек повторяет старый draw order: terrain → path(rivers,roads) →
 * gameplay(rooms,doors,traps,markers,start,finish) → labels.
 * Terrain/roads/rivers — zero-copy; entity-массивы пересобираются, порядок
 * сохраняется; та же отбраковка границ, что делал renderer.
 */
export function createLegacyRenderModel(
  grid: MapGrid,
  width: number,
  height: number,
  cells: MapCells,
): MapRenderModel {
  const inCell = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const labels: RenderLabel[] = [];
  cells.labels.forEach((l, i) => {
    if (!inCell(l.x, l.y)) return;
    labels.push({ id: legacyLabelId(i), position: toWorld(grid, l.x, l.y), text: l.text });
  });
  const items: RenderGameplayItem[] = [];
  cells.rooms.forEach((r, i) => {
    if (!Number.isInteger(r.x) || !Number.isInteger(r.y) || !Number.isInteger(r.w) || !Number.isInteger(r.h)) return;
    if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) return;
    items.push({
      kind: "room",
      room: {
        id: legacyRoomId(i),
        rect: { x: r.x, y: r.y, w: r.w, h: r.h },
        type: r.type,
        name: r.name,
      },
    });
  });
  cells.doors.forEach((d, i) => {
    if (!inCell(d.x, d.y)) return;
    if (d.edge !== "n" && d.edge !== "s" && d.edge !== "e" && d.edge !== "w") return;
    const c = cellCenter(grid, d.x, d.y);
    const off = EDGE_OFFSET[d.edge];
    items.push({
      kind: "door",
      door: {
        id: legacyDoorId(i),
        position: { x: c.cx + off.dx, y: c.cy + off.dy },
        horizontal: d.edge === "n" || d.edge === "s",
        kind: d.kind,
        secret: d.secret,
      },
    });
  });
  cells.traps.forEach((t, i) => {
    if (!inCell(t.x, t.y)) return;
    items.push({ kind: "trap", trap: { id: legacyTrapId(i), position: toWorld(grid, t.x, t.y), kind: t.kind } });
  });
  cells.markers.forEach((m, i) => {
    if (!inCell(m.x, m.y)) return;
    items.push({
      kind: "marker",
      marker: { id: legacyMarkerId(i), position: toWorld(grid, m.x, m.y), kind: m.kind },
    });
  });
  if (cells.start && inCell(cells.start.x, cells.start.y)) {
    items.push({
      kind: "start",
      start: { id: LEGACY_START_ID, position: toWorld(grid, cells.start.x, cells.start.y) },
    });
  }
  if (cells.finish && inCell(cells.finish.x, cells.finish.y)) {
    items.push({
      kind: "finish",
      finish: { id: LEGACY_FINISH_ID, position: toWorld(grid, cells.finish.x, cells.finish.y) },
    });
  }
  return {
    layers: [
      {
        ...openLayer("legacy-terrain", "Terrain"),
        kind: "terrain",
        terrain: { defaultCode: "plain", entries: cells.terrain },
      },
      {
        ...openLayer("legacy-paths", "Paths"),
        kind: "path",
        // Старый draw order: сначала все реки, потом все дороги.
        paths: [
          { kind: "river", cells: cells.rivers },
          { kind: "road", cells: cells.roads },
        ],
      },
      { ...openLayer("legacy-gameplay", "Gameplay"), kind: "gameplay", items },
      { ...openLayer("legacy-labels", "Labels"), kind: "label", labels },
    ],
  };
}

// --- V5 adapter ---

export interface RenderModelDiagnostic {
  code: string;
  message: string;
}

export interface V5RenderModelResult {
  model: MapRenderModel;
  /** Только unsupported rendering (не validation errors). Stable codes,
   *  порядок детерминирован (порядок слоёв/сущностей), без giant payload. */
  diagnostics: RenderModelDiagnostic[];
}

const TERRAIN_PREFIX = "terrain/";

/** builtin:terrain/<code> → code; всё остальное renderer показать не может. */
function materialCode(m: MaterialRef): string | null {
  if (m.type === "builtin" && typeof m.key === "string" && m.key.startsWith(TERRAIN_PREFIX)) {
    return m.key.slice(TERRAIN_PREFIX.length);
  }
  return null;
}

function isCardinalOrientation(o: number): boolean {
  return o === 0 || o === 90 || o === 180 || o === 270;
}

function baseOf(layer: { id: string; name: string; visible: boolean; locked: boolean; opacity: number }): RenderLayerBase {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  };
}

/**
 * V5 adapter: valid MapDocumentV5 → layered read view (только legacy-compatible
 * subset). Сохраняет реальную структуру и порядок document.layers (§75):
 * никаких flatten по semantic category. Не валидирует документ (предполагает
 * valid V5) и не дублирует validator: diagnostics — только про unsupported
 * rendering, не про corruption.
 */
export function createV5RenderModel(doc: MapDocumentV5): V5RenderModelResult {
  const diagnostics: RenderModelDiagnostic[] = [];
  const diag = (code: string, message: string) => diagnostics.push({ code, message });

  const layers: MapRenderLayer[] = [];
  let nonTerrainMaterials = 0;

  for (const layer of doc.layers) {
    if (layer.kind === "terrain") {
      const dm = materialCode(layer.defaultMaterial);
      const defaultCode = dm ?? "plain";
      if (dm === null) {
        nonTerrainMaterials++;
        diag("unsupported-material", "terrain defaultMaterial is not a builtin terrain: rendered as plain");
      }
      if (layer.representation === "mask") {
        if (doc.grid?.type !== "square")
          diag("unsupported-terrain-mask", `layer ${layer.id}: dense terrain currently requires a square grid`);
        const maskEntries = new Map<string, string>();
        const materialCodes = layer.mask.materials.map(materialCode);
        if (materialCodes.some((code) => code === null))
          diag("unsupported-material", `layer ${layer.id}: mask uses unavailable material`);
        for (const chunk of layer.mask.chunks) {
          if (!isPaletteIndexMaskPayload(chunk.payload, layer.mask.materials.length)) {
            diag("unsupported-terrain-mask", `layer ${layer.id}: unknown mask encoding`);
            continue;
          }
          chunk.payload.values.forEach((paletteIndex, index) => {
            if (paletteIndex === 0) return;
            const code = materialCodes[paletteIndex - 1];
            if (code === null || code === undefined) return;
            const sx = chunk.cx * TERRAIN_MASK_CHUNK_SIDE + index % TERRAIN_MASK_CHUNK_SIDE;
            const sy = chunk.cy * TERRAIN_MASK_CHUNK_SIDE + Math.floor(index / TERRAIN_MASK_CHUNK_SIDE);
            maskEntries.set(`${sx},${sy}`, code);
          });
        }
        layers.push({
          ...baseOf(layer),
          kind: "terrain",
          terrain: { defaultCode, entries: new Map(), mask: {
            origin: layer.mask.origin, sampleSize: layer.mask.sampleSize, entries: maskEntries,
          } },
        });
        continue;
      }
      const map = new Map<string, string>();
      for (const c of layer.cells) {
        const code = materialCode(c.material);
        if (code === null) {
          nonTerrainMaterials++;
          continue;
        }
        map.set(`${c.x},${c.y}`, code);
      }
      layers.push({ ...baseOf(layer), kind: "terrain", terrain: { defaultCode, entries: map } });
    } else if (layer.kind === "path") {
      const paths: RenderPath[] = [];
      for (const p of layer.paths) {
        if (p.kind !== "road" && p.kind !== "river") {
          diag("unsupported-path-kind", `path ${p.id}: kind "${p.kind}" not rendered`);
          continue;
        }
        if (p.geometry.type === "spline") {
          paths.push({ kind: p.kind, cells: new Set(), nodes: p.geometry.nodes, width: p.width });
          continue;
        }
        const cells = new Set<string>();
        for (const c of p.geometry.cells) cells.add(`${c.x},${c.y}`);
        paths.push({ kind: p.kind, cells });
      }
      layers.push({ ...baseOf(layer), kind: "path", paths });
    } else if (layer.kind === "label") {
      const labels: RenderLabel[] = [];
      for (const l of layer.items) {
        labels.push({ id: l.id, position: { x: l.position.x, y: l.position.y }, text: l.text });
      }
      layers.push({ ...baseOf(layer), kind: "label", labels });
    } else if (layer.kind === "gameplay") {
      const items: RenderGameplayItem[] = [];
      // items[] = render order внутри layer (§16): порядок документа, без
      // сортировки по kind. Start/finish — первый в своём слое.
      let startTaken = false;
      let finishTaken = false;
      for (const e of layer.items) {
        if (e.kind === "room") {
          if (e.geometry.type !== "rect") {
            diag("unsupported-room-geometry", `room ${e.id}: ${e.geometry.type} not rendered`);
            continue;
          }
          items.push({
            kind: "room",
            room: {
              id: e.id,
              rect: { x: e.geometry.x, y: e.geometry.y, w: e.geometry.w, h: e.geometry.h },
              type: e.roomType,
              name: e.name,
            },
          });
        } else if (e.kind === "door") {
          if (!isCardinalOrientation(e.orientation)) {
            diag("unsupported-door-orientation", `door ${e.id}: orientation ${e.orientation} rendered axis-aligned`);
          }
          items.push({
            kind: "door",
            door: {
              id: e.id,
              position: { x: e.position.x, y: e.position.y },
              horizontal: e.orientation % 180 === 0,
              kind: e.doorKind,
              secret: e.secret,
            },
          });
        } else if (e.kind === "trap") {
          items.push({
            kind: "trap",
            trap: { id: e.id, position: { x: e.position.x, y: e.position.y }, kind: e.trapKind },
          });
        } else if (e.kind === "marker") {
          items.push({
            kind: "marker",
            marker: { id: e.id, position: { x: e.position.x, y: e.position.y }, kind: e.markerKind },
          });
        } else if (e.kind === "start") {
          if (startTaken) continue;
          startTaken = true;
          items.push({
            kind: "start",
            start: { id: e.id, position: { x: e.position.x, y: e.position.y } },
          });
        } else if (e.kind === "finish") {
          if (finishTaken) continue;
          finishTaken = true;
          items.push({
            kind: "finish",
            finish: { id: e.id, position: { x: e.position.x, y: e.position.y } },
          });
        }
      }
      layers.push({ ...baseOf(layer), kind: "gameplay", items });
    } else if (layer.kind === "object") {
      const items: RenderMapObject[] = [];
      for (const object of layer.items) {
        const asset = resolveMapSymbol(object.visual);
        const requiredPack = mapAssetPackForId(object.visual.type === "asset" ? object.visual.assetId : "");
        if (!asset || !requiredPack || !doc.assetPacks.some((pack) => pack.id === requiredPack.id && pack.version === requiredPack.version)) {
          diag("unsupported-object-layer", `object ${object.id}: asset or pack unavailable`);
          continue;
        }
        items.push({ object, asset });
      }
      layers.push({ ...baseOf(layer), kind: "object", items });
    } else if (layer.kind === "scatter") {
      if (layer.areas.length > 0) {
        diag("unsupported-scatter-layer", `layer ${layer.id}: ${layer.areas.length} area(s) not rendered`);
      }
      layers.push({ ...baseOf(layer), kind: "scatter" });
    }
  }

  if (nonTerrainMaterials > 0) {
    diag("unsupported-material", `${nonTerrainMaterials} cell(s) use non-terrain materials: rendered as default`);
  }

  return { model: {
    layers,
    ...(doc.exploration === undefined ? {} : { exploration: {
      enabled: doc.exploration.enabled,
      revealedCells: new Set(doc.exploration.revealedCells.map((cell) => `${cell.x},${cell.y}`)),
    } }),
  }, diagnostics };
}
