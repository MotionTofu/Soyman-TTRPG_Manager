// MapRenderModel — read-only runtime view для Canvas renderer (Фаза 2D).
// НЕ формат хранения и НЕ source of truth: не сериализуется, не сохраняется,
// не мутируется, не входит в History/Autosave. Два адаптера сводят оба
// storage-формата к одному read contract, renderer не знает источника.
//
//   MapCells ──→ MapRenderModel ──┐
//                                 ▼
//   MapDocumentV5 ─→ MapRenderModel → renderMap
//
// Production 2D использует только legacy-ветку; V5-адаптер — для тестов.

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
import type { MapDocumentV5 } from "./core/types";
import { cellCenter } from "./grid";
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

export interface RenderTerrainView {
  /** Код террейна по умолчанию (legacy: "plain"). */
  readonly defaultCode: string;
  /** Только non-default клетки "x,y" → код (legacy: тот же Map без копирования). */
  readonly entries: ReadonlyMap<string, string>;
}

export interface MapRenderModel {
  readonly terrain: RenderTerrainView;
  readonly roads: ReadonlySet<string>;
  readonly rivers: ReadonlySet<string>;
  readonly labels: readonly RenderLabel[];
  readonly rooms: readonly RenderRoom[];
  readonly doors: readonly RenderDoor[];
  readonly traps: readonly RenderTrap[];
  readonly markers: readonly RenderMarker[];
  readonly start: RenderStartFinish | null;
  readonly finish: RenderStartFinish | null;
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

/**
 * Legacy adapter: MapCells → read view без семантических изменений.
 * Terrain/roads/rivers — zero-copy (те же Map/Set); entity-массивы
 * пересобираются (координаты клеток → world), порядок сохраняется.
 * Identity — deterministic-compatible `legacy-<kind>-N`.
 * Применяется та же отбраковка границ, что делал renderer (OOB-сущности
 * он пропускал): модель содержит ровно то, что было бы нарисовано.
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
  const rooms: RenderRoom[] = [];
  cells.rooms.forEach((r, i) => {
    if (!Number.isInteger(r.x) || !Number.isInteger(r.y) || !Number.isInteger(r.w) || !Number.isInteger(r.h)) return;
    if (r.w < 1 || r.h < 1 || r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) return;
    rooms.push({ id: legacyRoomId(i), rect: { x: r.x, y: r.y, w: r.w, h: r.h }, type: r.type, name: r.name });
  });
  const doors: RenderDoor[] = [];
  cells.doors.forEach((d, i) => {
    if (!inCell(d.x, d.y)) return;
    if (d.edge !== "n" && d.edge !== "s" && d.edge !== "e" && d.edge !== "w") return;
    const c = cellCenter(grid, d.x, d.y);
    const off = EDGE_OFFSET[d.edge];
    doors.push({
      id: legacyDoorId(i),
      position: { x: c.cx + off.dx, y: c.cy + off.dy },
      horizontal: d.edge === "n" || d.edge === "s",
      kind: d.kind,
      secret: d.secret,
    });
  });
  const traps: RenderTrap[] = [];
  cells.traps.forEach((t, i) => {
    if (!inCell(t.x, t.y)) return;
    traps.push({ id: legacyTrapId(i), position: toWorld(grid, t.x, t.y), kind: t.kind });
  });
  const markers: RenderMarker[] = [];
  cells.markers.forEach((m, i) => {
    if (!inCell(m.x, m.y)) return;
    markers.push({ id: legacyMarkerId(i), position: toWorld(grid, m.x, m.y), kind: m.kind });
  });
  return {
    terrain: { defaultCode: "plain", entries: cells.terrain },
    roads: cells.roads,
    rivers: cells.rivers,
    labels,
    rooms,
    doors,
    traps,
    markers,
    start:
      cells.start && inCell(cells.start.x, cells.start.y)
        ? { id: LEGACY_START_ID, position: toWorld(grid, cells.start.x, cells.start.y) }
        : null,
    finish:
      cells.finish && inCell(cells.finish.x, cells.finish.y)
        ? { id: LEGACY_FINISH_ID, position: toWorld(grid, cells.finish.x, cells.finish.y) }
        : null,
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

/**
 * V5 adapter: valid MapDocumentV5 → read view (только legacy-compatible subset).
 * Не валидирует документ (предполагает valid V5) и не дублирует validator:
 * diagnostics — только про unsupported rendering, не про corruption.
 */
export function createV5RenderModel(doc: MapDocumentV5): V5RenderModelResult {
  const diagnostics: RenderModelDiagnostic[] = [];
  const diag = (code: string, message: string) => diagnostics.push({ code, message });

  let defaultCode = "plain";
  let entries: ReadonlyMap<string, string> = new Map();
  const roads = new Set<string>();
  const rivers = new Set<string>();
  const labels: RenderLabel[] = [];
  const rooms: RenderRoom[] = [];
  const doors: RenderDoor[] = [];
  const traps: RenderTrap[] = [];
  const markers: RenderMarker[] = [];
  let start: RenderStartFinish | null = null;
  let finish: RenderStartFinish | null = null;
  let nonTerrainMaterials = 0;

  for (const layer of doc.layers) {
    if (layer.kind === "terrain") {
      const dm = materialCode(layer.defaultMaterial);
      defaultCode = dm ?? "plain";
      if (dm === null) {
        nonTerrainMaterials++;
        diag("unsupported-material", "terrain defaultMaterial is not a builtin terrain: rendered as plain");
      }
      if (layer.representation === "mask") {
        diag("unsupported-terrain-mask", `layer ${layer.id}: mask terrain rendered as default`);
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
      entries = map;
    } else if (layer.kind === "path") {
      for (const p of layer.paths) {
        if (p.geometry.type === "spline") {
          diag("unsupported-spline-path", `path ${p.id}: spline not rendered`);
          continue;
        }
        const target = p.kind === "road" ? roads : p.kind === "river" ? rivers : null;
        if (target === null) {
          diag("unsupported-path-kind", `path ${p.id}: kind "${p.kind}" not rendered`);
          continue;
        }
        for (const c of p.geometry.cells) target.add(`${c.x},${c.y}`);
      }
    } else if (layer.kind === "label") {
      for (const l of layer.items) {
        labels.push({ id: l.id, position: { x: l.position.x, y: l.position.y }, text: l.text });
      }
    } else if (layer.kind === "gameplay") {
      for (const e of layer.items) {
        if (e.kind === "room") {
          if (e.geometry.type !== "rect") {
            diag("unsupported-room-geometry", `room ${e.id}: ${e.geometry.type} not rendered`);
            continue;
          }
          rooms.push({
            id: e.id,
            rect: { x: e.geometry.x, y: e.geometry.y, w: e.geometry.w, h: e.geometry.h },
            type: e.roomType,
            name: e.name,
          });
        } else if (e.kind === "door") {
          if (!isCardinalOrientation(e.orientation)) {
            diag("unsupported-door-orientation", `door ${e.id}: orientation ${e.orientation} rendered axis-aligned`);
          }
          doors.push({
            id: e.id,
            position: { x: e.position.x, y: e.position.y },
            horizontal: e.orientation % 180 === 0,
            kind: e.doorKind,
            secret: e.secret,
          });
        } else if (e.kind === "trap") {
          traps.push({ id: e.id, position: { x: e.position.x, y: e.position.y }, kind: e.trapKind });
        } else if (e.kind === "marker") {
          markers.push({ id: e.id, position: { x: e.position.x, y: e.position.y }, kind: e.markerKind });
        } else if (e.kind === "start") {
          if (start === null) start = { id: e.id, position: { x: e.position.x, y: e.position.y } };
        } else if (e.kind === "finish") {
          if (finish === null) finish = { id: e.id, position: { x: e.position.x, y: e.position.y } };
        }
      }
    } else if (layer.kind === "object") {
      if (layer.items.length > 0) {
        diag("unsupported-object-layer", `layer ${layer.id}: ${layer.items.length} object(s) not rendered`);
      }
    } else if (layer.kind === "scatter") {
      if (layer.areas.length > 0) {
        diag("unsupported-scatter-layer", `layer ${layer.id}: ${layer.areas.length} area(s) not rendered`);
      }
    }
  }

  if (nonTerrainMaterials > 0) {
    diag("unsupported-material", `${nonTerrainMaterials} cell(s) use non-terrain materials: rendered as default`);
  }

  return {
    model: {
      terrain: { defaultCode, entries },
      roads,
      rivers,
      labels,
      rooms,
      doors,
      traps,
      markers,
      start,
      finish,
    },
    diagnostics,
  };
}
