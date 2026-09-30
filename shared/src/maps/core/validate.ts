// Runtime-валидатор MapDocumentV5 (ADR-0003 §B, инварианты 1–19).
// V5 — strict canonical validation: битый документ возвращает ошибки,
// а не молча выкидывает entity (в отличие от forgiving legacy-парсера).
// Неизвестные ключи объектов допускаются при чтении (forward compatibility)
// и отбрасываются canonicalize — см. отчёт Фазы 2B.

import {
  MAP_DOOR_KINDS,
  MAP_MARKER_KINDS,
  MAP_ROOM_TYPES,
  MAP_TRAP_KINDS,
} from "./literals";
import { isJsonValue } from "./json";
import { isPaletteIndexMaskPayload, TERRAIN_MASK_ENCODING } from "./terrainMask";
import {
  isMaterialRef,
  isScatterProfileRef,
  isStyleRef,
  isVisualRef,
} from "./refs";
import type {
  GameplayDoor,
  MapDocumentV5,
  MapLayer,
  Vec2,
} from "./types";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

interface GridCtx {
  hasGrid: boolean;
  columns: number;
  rows: number;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkVec2(
  v: unknown,
  path: string,
  out: ValidationIssue[],
): v is Vec2 {
  if (!isRecord(v)) {
    out.push(issue("vec2.not-object", path, "expected { x, y }"));
    return false;
  }
  let ok = true;
  for (const k of ["x", "y"] as const) {
    if (!isFiniteNumber(v[k])) {
      out.push(issue("vec2.bad-coordinate", `${path}.${k}`, "expected finite number"));
      ok = false;
    }
  }
  return ok;
}

function checkCellIndex(
  v: unknown,
  path: string,
  out: ValidationIssue[],
): boolean {
  if (!Number.isInteger(v)) {
    out.push(issue("cell.not-integer", path, "cell index must be an integer"));
    return false;
  }
  return true;
}

function checkShape(
  v: unknown,
  path: string,
  out: ValidationIssue[],
): boolean {
  if (!isRecord(v)) {
    out.push(issue("shape.not-object", path, "expected shape object"));
    return false;
  }
  if (v.type === "rect") {
    let ok = true;
    for (const k of ["x", "y"] as const) {
      if (!isFiniteNumber(v[k])) {
        out.push(issue("shape.bad-rect", `${path}.${k}`, "expected finite number"));
        ok = false;
      }
    }
    for (const k of ["w", "h"] as const) {
      if (!isFiniteNumber(v[k]) || (v[k] as number) <= 0) {
        out.push(issue("shape.bad-rect", `${path}.${k}`, "expected number > 0"));
        ok = false;
      }
    }
    return ok;
  }
  if (v.type === "ellipse") {
    let ok = checkVec2(v.center, `${path}.center`, out);
    for (const k of ["rx", "ry"] as const) {
      if (!isFiniteNumber(v[k]) || (v[k] as number) <= 0) {
        out.push(issue("shape.bad-ellipse", `${path}.${k}`, "expected number > 0"));
        ok = false;
      }
    }
    return ok;
  }
  if (v.type === "polygon") {
    if (!Array.isArray(v.points) || v.points.length < 3) {
      out.push(issue("shape.bad-polygon", `${path}.points`, "polygon needs >= 3 points"));
      return false;
    }
    let ok = true;
    v.points.forEach((p, i) => {
      if (!checkVec2(p, `${path}.points[${i}]`, out)) ok = false;
    });
    return ok;
  }
  out.push(issue("shape.unknown-type", path, "expected rect | polygon | ellipse"));
  return false;
}

function checkPathGeometry(
  g: unknown,
  path: string,
  grid: GridCtx,
  out: ValidationIssue[],
): void {
  if (!isRecord(g)) {
    out.push(issue("path.geometry.not-object", path, "expected geometry object"));
    return;
  }
  if (g.type === "cell-network") {
    if (!grid.hasGrid) {
      out.push(issue("path.cell-network.no-grid", path, "cell-network requires document.grid"));
      return;
    }
    if (!Array.isArray(g.cells) || g.cells.length === 0) {
      out.push(issue("path.cell-network.empty", `${path}.cells`, "cell-network needs >= 1 cell"));
      return;
    }
    const seen = new Set<string>();
    g.cells.forEach((c, i) => {
      const cp = `${path}.cells[${i}]`;
      if (!isRecord(c)) {
        out.push(issue("path.cell-network.bad-cell", cp, "expected { x, y }"));
        return;
      }
      const xi = checkCellIndex(c.x, `${cp}.x`, out);
      const yi = checkCellIndex(c.y, `${cp}.y`, out);
      if (!xi || !yi) return;
      const x = c.x as number;
      const y = c.y as number;
      if (x < 0 || y < 0 || x >= grid.columns || y >= grid.rows) {
        out.push(issue("path.cell-network.out-of-grid", cp, `cell (${x},${y}) outside ${grid.columns}x${grid.rows}`));
        return;
      }
      const key = `${x},${y}`;
      if (seen.has(key)) {
        out.push(issue("path.cell-network.duplicate", cp, `duplicate cell ${key}`));
        return;
      }
      seen.add(key);
    });
    return;
  }
  if (g.type === "spline") {
    // ADR не задаёт минимум nodes — validator-level минимум 2 (путь из одной
    // точки не имеет геометрии; решение зафиксировано в отчёте Фазы 2B).
    if (!Array.isArray(g.nodes) || g.nodes.length < 2) {
      out.push(issue("path.spline.too-few-nodes", `${path}.nodes`, "spline needs >= 2 nodes"));
      return;
    }
    g.nodes.forEach((n, i) => {
      const np = `${path}.nodes[${i}]`;
      if (!isRecord(n)) {
        out.push(issue("path.spline.bad-node", np, "expected node object"));
        return;
      }
      checkVec2(n.position, `${np}.position`, out);
      if (n.in !== undefined && !checkVec2(n.in, `${np}.in`, out)) return;
      if (n.out !== undefined && !checkVec2(n.out, `${np}.out`, out)) return;
      if (n.width !== undefined && (!isFiniteNumber(n.width) || n.width <= 0))
        out.push(issue("path.spline.bad-node-width", `${np}.width`, "node width must be finite and > 0"));
    });
    return;
  }
  out.push(issue("path.geometry.unknown-type", path, "expected cell-network | spline"));
}

function checkLayerBase(
  layer: Record<string, unknown>,
  path: string,
  out: ValidationIssue[],
): boolean {
  let ok = true;
  if (typeof layer.id !== "string" || layer.id.length === 0) {
    out.push(issue("layer.bad-id", `${path}.id`, "layer id must be a non-empty string"));
    ok = false;
  }
  if (typeof layer.name !== "string") {
    out.push(issue("layer.bad-name", `${path}.name`, "layer name must be a string"));
    ok = false;
  }
  if (typeof layer.visible !== "boolean") {
    out.push(issue("layer.bad-visible", `${path}.visible`, "visible must be a boolean"));
    ok = false;
  }
  if (typeof layer.locked !== "boolean") {
    out.push(issue("layer.bad-locked", `${path}.locked`, "locked must be a boolean"));
    ok = false;
  }
  if (!isFiniteNumber(layer.opacity) || (layer.opacity as number) < 0 || (layer.opacity as number) > 1) {
    out.push(issue("layer.bad-opacity", `${path}.opacity`, "opacity must be a finite number in [0,1]"));
    ok = false;
  }
  return ok;
}

function claimId(
  ids: Set<string>,
  id: unknown,
  path: string,
  what: string,
  out: ValidationIssue[],
): void {
  if (typeof id !== "string" || id.length === 0) {
    out.push(issue("id.bad", path, `${what} id must be a non-empty string`));
    return;
  }
  if (ids.has(id)) {
    out.push(issue("id.duplicate", path, `duplicate id "${id}" (IDs are global across layers and entities)`));
    return;
  }
  ids.add(id);
}

function checkTerrainLayer(
  layer: Record<string, unknown>,
  path: string,
  grid: GridCtx,
  ids: Set<string>,
  out: ValidationIssue[],
): void {
  if (!isMaterialRef(layer.defaultMaterial)) {
    out.push(issue("terrain.bad-default-material", `${path}.defaultMaterial`, "expected builtin | asset material ref"));
  }
  if (layer.representation === "cells") {
    if (!grid.hasGrid) {
      out.push(issue("terrain.cells.no-grid", path, "TerrainCellLayer requires document.grid"));
      return;
    }
    if (!Array.isArray(layer.cells)) {
      out.push(issue("terrain.cells.not-array", `${path}.cells`, "expected cells array"));
      return;
    }
    const seen = new Set<string>();
    layer.cells.forEach((c, i) => {
      const cp = `${path}.cells[${i}]`;
      if (!isRecord(c)) {
        out.push(issue("terrain.cells.bad-entry", cp, "expected { x, y, material }"));
        return;
      }
      const xi = checkCellIndex(c.x, `${cp}.x`, out);
      const yi = checkCellIndex(c.y, `${cp}.y`, out);
      if (!isMaterialRef(c.material)) {
        out.push(issue("terrain.cells.bad-material", `${cp}.material`, "expected builtin | asset material ref"));
      }
      if (!xi || !yi) return;
      const x = c.x as number;
      const y = c.y as number;
      if (x < 0 || y < 0 || x >= grid.columns || y >= grid.rows) {
        out.push(issue("terrain.cells.out-of-grid", cp, `cell (${x},${y}) outside ${grid.columns}x${grid.rows}`));
        return;
      }
      const key = `${x},${y}`;
      if (seen.has(key)) {
        out.push(issue("terrain.cells.duplicate", cp, `duplicate coordinate ${key}`));
        return;
      }
      seen.add(key);
    });
    return;
  }
  if (layer.representation === "mask") {
    // Неизвестные encoding сохраняются; известный palette-index-v1 проверяется строго.
    const m = layer.mask;
    if (!isRecord(m)) {
      out.push(issue("terrain.mask.not-object", `${path}.mask`, "expected mask object"));
      return;
    }
    checkVec2(m.origin, `${path}.mask.origin`, out);
    if (!isFiniteNumber(m.sampleSize) || (m.sampleSize as number) <= 0) {
      out.push(issue("terrain.mask.bad-sample-size", `${path}.mask.sampleSize`, "sampleSize must be > 0"));
    }
    if (!Array.isArray(m.materials) || m.materials.length === 0) {
      out.push(issue("terrain.mask.bad-materials", `${path}.mask.materials`, "materials must be a non-empty array"));
    } else {
      m.materials.forEach((mat, i) => {
        if (!isMaterialRef(mat)) {
          out.push(issue("terrain.mask.bad-material", `${path}.mask.materials[${i}]`, "expected builtin | asset material ref"));
        }
      });
    }
    if (!Array.isArray(m.chunks)) {
      out.push(issue("terrain.mask.bad-chunks", `${path}.mask.chunks`, "expected chunks array"));
      return;
    }
    const chunkIds = new Set<string>();
    const chunkCoords = new Set<string>();
    m.chunks.forEach((ch, i) => {
      const chp = `${path}.mask.chunks[${i}]`;
      if (!isRecord(ch)) {
        out.push(issue("terrain.mask.bad-chunk", chp, "expected chunk object"));
        return;
      }
      claimId(chunkIds, ch.id, `${chp}.id`, "mask chunk", out);
      if (!Number.isInteger(ch.cx) || !Number.isInteger(ch.cy)) {
        out.push(issue("terrain.mask.bad-chunk-coords", chp, "chunk cx/cy must be integers"));
      } else {
        const coords = `${ch.cx},${ch.cy}`;
        if (chunkCoords.has(coords)) out.push(issue("terrain.mask.duplicate-chunk", chp, `duplicate chunk ${coords}`));
        chunkCoords.add(coords);
      }
      if (!isRecord(ch.payload) || !isJsonValue(ch.payload)) {
        out.push(issue("terrain.mask.bad-payload", `${chp}.payload`, "payload must be a JSON-safe object"));
      } else if (ch.payload.encoding === TERRAIN_MASK_ENCODING &&
        !isPaletteIndexMaskPayload(ch.payload, Array.isArray(m.materials) ? m.materials.length : 0)) {
        out.push(issue("terrain.mask.bad-index-payload", `${chp}.payload`, "expected 256 palette indexes within materials"));
      }
    });
    return;
  }
  out.push(issue("terrain.unknown-representation", `${path}.representation`, 'expected "cells" | "mask"'));
}

function checkPathLayer(
  layer: Record<string, unknown>,
  path: string,
  grid: GridCtx,
  ids: Set<string>,
  out: ValidationIssue[],
): void {
  if (!Array.isArray(layer.paths)) {
    out.push(issue("path.not-array", `${path}.paths`, "expected paths array"));
    return;
  }
  layer.paths.forEach((p, i) => {
    const pp = `${path}.paths[${i}]`;
    if (!isRecord(p)) {
      out.push(issue("path.not-object", pp, "expected path object"));
      return;
    }
    claimId(ids, p.id, `${pp}.id`, "path", out);
    if (typeof p.kind !== "string" || p.kind.length === 0) {
      out.push(issue("path.bad-kind", `${pp}.kind`, "path kind must be a non-empty string"));
    }
    checkPathGeometry(p.geometry, `${pp}.geometry`, grid, out);
    if (!isFiniteNumber(p.width) || (p.width as number) <= 0) {
      out.push(issue("path.bad-width", `${pp}.width`, "width must be > 0"));
    }
    if (!isStyleRef(p.styleRef)) {
      out.push(issue("path.bad-style-ref", `${pp}.styleRef`, "expected builtin | asset style ref"));
    }
    if (p.branchFrom !== undefined && (!isRecord(p.branchFrom) ||
      typeof p.branchFrom.pathId !== "string" || !p.branchFrom.pathId ||
      !Number.isInteger(p.branchFrom.nodeIndex) || (p.branchFrom.nodeIndex as number) < 0 ||
      !isRecord(p.geometry) || p.geometry.type !== "spline")) {
      out.push(issue("path.bad-branch", `${pp}.branchFrom`, "expected a spline parent path and node index"));
    }
    if (p.properties !== undefined && !isJsonValue(p.properties)) {
      out.push(issue("path.bad-properties", `${pp}.properties`, "properties must be JSON-safe"));
    }
  });
}

function checkObjectLayer(
  layer: Record<string, unknown>,
  path: string,
  ids: Set<string>,
  out: ValidationIssue[],
): void {
  if (!Array.isArray(layer.items)) {
    out.push(issue("object.not-array", `${path}.items`, "expected items array"));
    return;
  }
  layer.items.forEach((o, i) => {
    const op = `${path}.items[${i}]`;
    if (!isRecord(o)) {
      out.push(issue("object.not-object", op, "expected object entity"));
      return;
    }
    claimId(ids, o.id, `${op}.id`, "object", out);
    if (!isRecord(o.transform)) {
      out.push(issue("object.bad-transform", `${op}.transform`, "expected transform object"));
    } else {
      // Free objects могут стоять вне world.bounds — это НЕ ошибка (§21 ТЗ).
      checkVec2(o.transform.position, `${op}.transform.position`, out);
      if (!isFiniteNumber(o.transform.rotation)) {
        out.push(issue("object.bad-rotation", `${op}.transform.rotation`, "rotation must be finite"));
      }
      const s = o.transform.scale;
      if (!isRecord(s)) {
        out.push(issue("object.bad-scale", `${op}.transform.scale`, "expected { x, y }"));
      } else {
        for (const k of ["x", "y"] as const) {
          if (!isFiniteNumber(s[k]) || (s[k] as number) === 0) {
            out.push(issue("object.bad-scale", `${op}.transform.scale.${k}`, "scale must be finite and != 0"));
          }
        }
      }
    }
    if (!isVisualRef(o.visual)) {
      out.push(issue("object.bad-visual", `${op}.visual`, "expected builtin | asset visual ref"));
    }
    if (o.properties !== undefined && !isJsonValue(o.properties)) {
      out.push(issue("object.bad-properties", `${op}.properties`, "properties must be JSON-safe"));
    }
  });
}

function checkScatterLayer(
  layer: Record<string, unknown>,
  path: string,
  ids: Set<string>,
  out: ValidationIssue[],
): void {
  if (!Array.isArray(layer.areas)) {
    out.push(issue("scatter.not-array", `${path}.areas`, "expected areas array"));
    return;
  }
  layer.areas.forEach((a, i) => {
    const ap = `${path}.areas[${i}]`;
    if (!isRecord(a)) {
      out.push(issue("scatter.not-object", ap, "expected scatter area"));
      return;
    }
    claimId(ids, a.id, `${ap}.id`, "scatter area", out);
    checkShape(a.shape, `${ap}.shape`, out);
    if (!isScatterProfileRef(a.profileRef)) {
      out.push(issue("scatter.bad-profile-ref", `${ap}.profileRef`, "expected builtin | asset profile ref"));
    }
    if (!Number.isInteger(a.seed)) {
      out.push(issue("scatter.bad-seed", `${ap}.seed`, "seed must be an integer"));
    }
    if (!isFiniteNumber(a.density) || (a.density as number) < 0) {
      out.push(issue("scatter.bad-density", `${ap}.density`, "density must be >= 0"));
    }
    if (a.overrides !== undefined && !isJsonValue(a.overrides)) {
      out.push(issue("scatter.bad-overrides", `${ap}.overrides`, "overrides must be JSON-safe"));
    }
  });
}

function checkLabelLayer(
  layer: Record<string, unknown>,
  path: string,
  ids: Set<string>,
  out: ValidationIssue[],
): void {
  if (!Array.isArray(layer.items)) {
    out.push(issue("label.not-array", `${path}.items`, "expected items array"));
    return;
  }
  layer.items.forEach((l, i) => {
    const lp = `${path}.items[${i}]`;
    if (!isRecord(l)) {
      out.push(issue("label.not-object", lp, "expected label object"));
      return;
    }
    claimId(ids, l.id, `${lp}.id`, "label", out);
    checkVec2(l.position, `${lp}.position`, out);
    if (typeof l.text !== "string" || l.text.trim().length === 0) {
      out.push(issue("label.bad-text", `${lp}.text`, "text must be a non-empty string"));
    }
    if (l.styleRef !== undefined && typeof l.styleRef !== "string") {
      out.push(issue("label.bad-style-ref", `${lp}.styleRef`, "styleRef must be a string"));
    }
  });
}

const ROOM_TYPES: readonly string[] = MAP_ROOM_TYPES as readonly string[];
const DOOR_KINDS: readonly string[] = MAP_DOOR_KINDS as readonly string[];
const TRAP_KINDS: readonly string[] = MAP_TRAP_KINDS as readonly string[];
const MARKER_KINDS: readonly string[] = MAP_MARKER_KINDS as readonly string[];

function checkGameplayLayer(
  layer: Record<string, unknown>,
  path: string,
  ids: Set<string>,
  out: ValidationIssue[],
  doors: Map<string, { pairedDoorId: unknown; path: string }>,
): void {
  if (!Array.isArray(layer.items)) {
    out.push(issue("gameplay.not-array", `${path}.items`, "expected items array"));
    return;
  }
  layer.items.forEach((e, i) => {
    const ep = `${path}.items[${i}]`;
    if (!isRecord(e)) {
      out.push(issue("gameplay.not-object", ep, "expected gameplay entity"));
      return;
    }
    const kind = e.kind;
    if (kind === "room") {
      claimId(ids, e.id, `${ep}.id`, "room", out);
      checkShape(e.geometry, `${ep}.geometry`, out);
      if (typeof e.roomType !== "string" || !ROOM_TYPES.includes(e.roomType)) {
        out.push(issue("gameplay.bad-room-type", `${ep}.roomType`, `expected one of ${ROOM_TYPES.join(", ")}`));
      }
      if (typeof e.name !== "string") {
        out.push(issue("gameplay.bad-room-name", `${ep}.name`, "name must be a string"));
      }
      return;
    }
    if (kind === "door") {
      claimId(ids, e.id, `${ep}.id`, "door", out);
      checkVec2(e.position, `${ep}.position`, out);
      if (!isFiniteNumber(e.orientation)) {
        out.push(issue("gameplay.bad-orientation", `${ep}.orientation`, "orientation must be finite"));
      }
      if (typeof e.doorKind !== "string" || !DOOR_KINDS.includes(e.doorKind)) {
        out.push(issue("gameplay.bad-door-kind", `${ep}.doorKind`, `expected one of ${DOOR_KINDS.join(", ")}`));
      }
      if (typeof e.secret !== "boolean") {
        out.push(issue("gameplay.bad-secret", `${ep}.secret`, "secret must be a boolean"));
      }
      if (e.pairedDoorId !== null && (typeof e.pairedDoorId !== "string" || e.pairedDoorId.length === 0)) {
        out.push(issue("gameplay.bad-pair", `${ep}.pairedDoorId`, "pairedDoorId must be null or a non-empty string"));
      } else if (typeof e.id === "string") {
        doors.set(e.id, { pairedDoorId: e.pairedDoorId, path: ep });
      }
      return;
    }
    if (kind === "trap") {
      claimId(ids, e.id, `${ep}.id`, "trap", out);
      checkVec2(e.position, `${ep}.position`, out);
      if (typeof e.trapKind !== "string" || !TRAP_KINDS.includes(e.trapKind)) {
        out.push(issue("gameplay.bad-trap-kind", `${ep}.trapKind`, `expected one of ${TRAP_KINDS.join(", ")}`));
      }
      return;
    }
    if (kind === "marker") {
      claimId(ids, e.id, `${ep}.id`, "marker", out);
      checkVec2(e.position, `${ep}.position`, out);
      if (typeof e.markerKind !== "string" || !MARKER_KINDS.includes(e.markerKind)) {
        out.push(issue("gameplay.bad-marker-kind", `${ep}.markerKind`, `expected one of ${MARKER_KINDS.join(", ")}`));
      }
      return;
    }
    if (kind === "start" || kind === "finish") {
      claimId(ids, e.id, `${ep}.id`, kind, out);
      checkVec2(e.position, `${ep}.position`, out);
      return;
    }
    out.push(issue("gameplay.unknown-kind", `${ep}.kind`, "expected room | door | trap | marker | start | finish"));
  });
}

// --- Публичный API ---

/** Полная проверка документа. Пустой массив = валиден. */
export function validateMapDocument(doc: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!isRecord(doc)) {
    return [issue("root.not-object", "", "document must be an object")];
  }
  if (doc.v !== 5) {
    out.push(issue("version.invalid", "v", "expected v === 5"));
  }

  // World bounds.
  if (!isRecord(doc.world) || !isRecord(doc.world.bounds)) {
    out.push(issue("world.bad-bounds", "world.bounds", "expected world.bounds object"));
  } else {
    const b = doc.world.bounds;
    let boundsOk = true;
    for (const k of ["minX", "minY", "maxX", "maxY"] as const) {
      if (!isFiniteNumber(b[k])) {
        out.push(issue("world.bad-bounds", `world.bounds.${k}`, "expected finite number"));
        boundsOk = false;
      }
    }
    if (boundsOk && !((b.maxX as number) > (b.minX as number) && (b.maxY as number) > (b.minY as number))) {
      out.push(issue("world.bad-bounds", "world.bounds", "expected maxX > minX and maxY > minY"));
    }
  }

  // Grid.
  const grid: GridCtx = { hasGrid: false, columns: 0, rows: 0 };
  if (doc.grid !== null) {
    if (!isRecord(doc.grid)) {
      out.push(issue("grid.not-object", "grid", "grid must be null or a config object"));
    } else {
      const g = doc.grid;
      if (g.type !== "square" && g.type !== "hex") {
        out.push(issue("grid.bad-type", "grid.type", 'expected "square" | "hex"'));
      }
      if (!isFiniteNumber(g.cellSize) || (g.cellSize as number) <= 0) {
        out.push(issue("grid.bad-cell-size", "grid.cellSize", "cellSize must be > 0"));
      }
      let dimsOk = true;
      for (const k of ["columns", "rows"] as const) {
        if (!Number.isInteger(g[k]) || (g[k] as number) < 1) {
          out.push(issue("grid.bad-dims", `grid.${k}`, "columns/rows must be integers >= 1"));
          dimsOk = false;
        }
      }
      checkVec2(g.origin, "grid.origin", out);
      if (g.type === "hex") {
        if (!isRecord(g.hex) || g.hex.orientation !== "pointy" || g.hex.offset !== "odd-q") {
          out.push(issue("grid.bad-hex", "grid.hex", 'hex requires { orientation: "pointy", offset: "odd-q" }'));
        }
      }
      if (dimsOk && (g.type === "square" || g.type === "hex")) {
        grid.hasGrid = true;
        grid.columns = g.columns as number;
        grid.rows = g.rows as number;
      }
    }
  }

  if (doc.exploration !== undefined) {
    const exploration = doc.exploration;
    if (!isRecord(exploration) || typeof exploration.enabled !== "boolean" || !Array.isArray(exploration.revealedCells)) {
      out.push(issue("exploration.bad-shape", "exploration", "expected enabled and revealedCells"));
    } else {
      if (!grid.hasGrid) out.push(issue("exploration.no-grid", "exploration", "exploration requires a grid"));
      if (grid.hasGrid && exploration.revealedCells.length > grid.columns * grid.rows) {
        out.push(issue("exploration.too-many-cells", "exploration.revealedCells", "more cells than grid size"));
      }
      const seen = new Set<string>();
      exploration.revealedCells.forEach((cell, index) => {
        const path = `exploration.revealedCells[${index}]`;
        if (!isRecord(cell) || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
          (cell.x as number) < 0 || (cell.y as number) < 0 ||
          (grid.hasGrid && ((cell.x as number) >= grid.columns || (cell.y as number) >= grid.rows))) {
          out.push(issue("exploration.bad-cell", path, "expected an in-bounds integer cell"));
          return;
        }
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key)) out.push(issue("exploration.duplicate-cell", path, "duplicate revealed cell"));
        seen.add(key);
      });
    }
  }

  // Asset packs (только ссылки; unresolved — не corruption, инвариант 14).
  if (!Array.isArray(doc.assetPacks)) {
    out.push(issue("packs.not-array", "assetPacks", "expected assetPacks array"));
  } else {
    doc.assetPacks.forEach((p, i) => {
      const pp = `assetPacks[${i}]`;
      if (!isRecord(p) || typeof p.id !== "string" || p.id.length === 0) {
        out.push(issue("packs.bad-ref", pp, "pack ref needs a non-empty string id"));
        return;
      }
      if (p.version !== undefined && typeof p.version !== "string") {
        out.push(issue("packs.bad-version", `${pp}.version`, "version must be a string"));
      }
    });
  }

  // Layers.
  if (!Array.isArray(doc.layers)) {
    out.push(issue("layers.not-array", "layers", "expected layers array"));
    return out;
  }

  const ids = new Set<string>();
  const doors = new Map<string, { pairedDoorId: unknown; path: string }>();

  doc.layers.forEach((l, i) => {
    const lp = `layers[${i}]`;
    if (!isRecord(l)) {
      out.push(issue("layer.not-object", lp, "expected layer object"));
      return;
    }
    checkLayerBase(l, lp, out);
    claimId(ids, l.id, `${lp}.id`, "layer", out);
    const kind = l.kind;
    if (kind === "terrain") {
      checkTerrainLayer(l, lp, grid, ids, out);
    } else if (kind === "path") {
      checkPathLayer(l, lp, grid, ids, out);
    } else if (kind === "object") {
      checkObjectLayer(l, lp, ids, out);
    } else if (kind === "scatter") {
      checkScatterLayer(l, lp, ids, out);
    } else if (kind === "label") {
      checkLabelLayer(l, lp, ids, out);
    } else if (kind === "gameplay") {
      checkGameplayLayer(l, lp, ids, out, doors);
    } else {
      out.push(issue("layer.unknown-kind", `${lp}.kind`, "expected terrain | path | object | scatter | label | gameplay"));
    }
  });

  const splines = new Map<string, { path: Record<string, unknown>; location: string }>();
  doc.layers.forEach((layer, layerIndex) => {
    if (!isRecord(layer) || layer.kind !== "path" || !Array.isArray(layer.paths)) return;
    layer.paths.forEach((path, pathIndex) => {
      if (isRecord(path) && typeof path.id === "string" && isRecord(path.geometry) &&
        path.geometry.type === "spline") {
        splines.set(path.id, { path, location: `layers[${layerIndex}].paths[${pathIndex}]` });
      }
    });
  });
  for (const [id, entry] of splines) {
    const source = entry.path.branchFrom;
    if (!isRecord(source) || typeof source.pathId !== "string" ||
      !Number.isInteger(source.nodeIndex)) continue;
    const parent = splines.get(source.pathId);
    const parentNodes = parent && isRecord(parent.path.geometry) &&
      Array.isArray(parent.path.geometry.nodes) ? parent.path.geometry.nodes : null;
    const childNodes = isRecord(entry.path.geometry) && Array.isArray(entry.path.geometry.nodes)
      ? entry.path.geometry.nodes : null;
    const parentNode = parentNodes?.[source.nodeIndex as number];
    const childNode = childNodes?.[0];
    if (!parent || parent.path.kind !== entry.path.kind ||
      !isRecord(parentNode) || !isRecord(parentNode.position) ||
      !isRecord(childNode) || !isRecord(childNode.position) ||
      parentNode.position.x !== childNode.position.x ||
      parentNode.position.y !== childNode.position.y) {
      out.push(issue("path.branch-detached", `${entry.location}.branchFrom`,
        "branch must begin at a matching spline node"));
      continue;
    }
    const seen = new Set([id]);
    let current: string | null = source.pathId;
    while (current) {
      if (seen.has(current)) {
        out.push(issue("path.branch-cycle", `${entry.location}.branchFrom`, "branch links cannot form a cycle"));
        break;
      }
      seen.add(current);
      const next: unknown = splines.get(current)?.path.branchFrom;
      current = isRecord(next) && typeof next.pathId === "string" ? next.pathId : null;
    }
  }

  // Инвариант 16 снят в Фазе 3A (§10 ТЗ): 0..N TerrainLayer валидны
  // (multi-terrain compositing, terrain-less compositions). Был ограничением
  // ранней реализации, не фундаментальным invariant ADR.

  // Door relations (§17 ТЗ): null | существующая дверь, симметрия, без self-pair.
  for (const [id, d] of doors) {
    const target = d.pairedDoorId;
    if (target === null || target === undefined) continue;
    if (typeof target !== "string") continue; // bad-pair уже зафиксирован
    if (target === id) {
      out.push(issue("door.self-pair", `${d.path}.pairedDoorId`, "door cannot pair with itself"));
      continue;
    }
    const other = doors.get(target);
    if (!other) {
      out.push(issue("door.pair-missing", `${d.path}.pairedDoorId`, `target door "${target}" does not exist`));
      continue;
    }
    if (other.pairedDoorId !== id) {
      out.push(issue("door.pair-asymmetric", `${d.path}.pairedDoorId`, `pair with "${target}" is not symmetric`));
    }
  }

  return out;
}

export function isValidMapDocument(doc: unknown): doc is MapDocumentV5 {
  return validateMapDocument(doc).length === 0;
}
