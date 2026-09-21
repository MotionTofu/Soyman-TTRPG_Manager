// Канонизация MapDocumentV5 (§12 ТЗ).
// Приводит документ к сериализуемому каноническому виду, не меняя semantics:
// - фиксированный порядок ключей объектов (схема);
// - сортировка там, где порядок НЕ несёт визуальной семантики:
//   TerrainCellEntry[] и cell-network cells[] по (y, x);
// - layers[]/items[]/paths[]/areas[] НЕ сортируются (порядок = рендер);
// - без генерации новых IDs;
// - неизвестные ключи отбрасываются (forward-compatible чтение);
// - undefined отбрасывается (в массивах → null, как у JSON.stringify).

import type { JsonObject, JsonValue } from "./json";
import type {
  AssetPackRef,
  GameplayEntity,
  MapDocumentV5,
  MapGridConfig,
  MapLabel,
  MapLayer,
  MapObject,
  MapPath,
  MaterialRef,
  ScatterArea,
  ScatterProfileRef,
  ShapeGeometry,
  StyleRef,
  TerrainCellEntry,
  TerrainLayer,
  TerrainMask,
  TerrainMaskChunk,
  Vec2,
  VisualRef,
} from "./types";

function canonVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

function canonJson(value: JsonValue): JsonValue {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean" || t === "number") return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonJson(item as JsonValue),
    );
  }
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value as JsonObject)) {
    if (v === undefined) continue;
    out[k] = canonJson(v as JsonValue);
  }
  return out;
}

function canonOptJson<T>(v: T | undefined): JsonObject | undefined {
  if (v === undefined) return undefined;
  return canonJson(v as unknown as JsonValue) as JsonObject;
}

function sortCells<T extends { x: number; y: number }>(cells: T[]): T[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

function canonMaterialRef(m: MaterialRef): MaterialRef {
  if (m.type === "asset") return { type: "asset", assetId: m.assetId };
  return { type: "builtin", key: m.key };
}

function canonStyleRef(m: StyleRef): StyleRef {
  return canonMaterialRef(m);
}

function canonProfileRef(m: ScatterProfileRef): ScatterProfileRef {
  return canonMaterialRef(m);
}

function canonVisualRef(m: VisualRef): VisualRef {
  return canonMaterialRef(m);
}

function canonShape(s: ShapeGeometry): ShapeGeometry {
  if (s.type === "rect") return { type: "rect", x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.type === "ellipse") {
    return { type: "ellipse", center: canonVec2(s.center), rx: s.rx, ry: s.ry };
  }
  return { type: "polygon", points: s.points.map(canonVec2) };
}

function canonGrid(g: MapGridConfig | null): MapGridConfig | null {
  if (g === null) return null;
  const out: MapGridConfig = {
    type: g.type,
    cellSize: g.cellSize,
    columns: g.columns,
    rows: g.rows,
    origin: canonVec2(g.origin),
  };
  if (g.type === "hex") {
    out.hex = { orientation: "pointy", offset: "odd-q" };
  }
  return out;
}

function canonPack(p: AssetPackRef): AssetPackRef {
  const out: AssetPackRef = { id: p.id };
  if (p.version !== undefined) out.version = p.version;
  return out;
}

function canonTerrainCell(e: TerrainCellEntry): TerrainCellEntry {
  return { x: e.x, y: e.y, material: canonMaterialRef(e.material) };
}

function canonMaskChunk(c: TerrainMaskChunk): TerrainMaskChunk {
  return {
    id: c.id,
    cx: c.cx,
    cy: c.cy,
    payload: canonJson(c.payload) as JsonObject,
  };
}

function canonMask(m: TerrainMask): TerrainMask {
  return {
    origin: canonVec2(m.origin),
    sampleSize: m.sampleSize,
    materials: m.materials.map(canonMaterialRef),
    chunks: m.chunks.map(canonMaskChunk),
  };
}

function canonTerrainLayer(l: TerrainLayer): TerrainLayer {
  const base = {
    id: l.id,
    name: l.name,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
    kind: l.kind,
    defaultMaterial: canonMaterialRef(l.defaultMaterial),
  } as const;
  if (l.representation === "mask") {
    return { ...base, representation: "mask", mask: canonMask(l.mask) };
  }
  return {
    ...base,
    representation: "cells",
    cells: sortCells(l.cells).map(canonTerrainCell),
  };
}

function canonPath(p: MapPath): MapPath {
  const geometry: MapPath["geometry"] =
    p.geometry.type === "spline"
      ? {
          type: "spline",
          nodes: p.geometry.nodes.map((n) => ({
            position: canonVec2(n.position),
            ...(n.in !== undefined ? { in: canonVec2(n.in) } : {}),
            ...(n.out !== undefined ? { out: canonVec2(n.out) } : {}),
          })),
        }
      : {
          type: "cell-network",
          cells: sortCells(p.geometry.cells).map((c) => ({ x: c.x, y: c.y })),
        };
  const out: MapPath = {
    id: p.id,
    kind: p.kind,
    geometry,
    width: p.width,
    styleRef: canonStyleRef(p.styleRef),
  };
  const props = canonOptJson(p.properties);
  if (props !== undefined) out.properties = props;
  return out;
}

function canonObject(o: MapObject): MapObject {
  const out: MapObject = {
    id: o.id,
    transform: {
      position: canonVec2(o.transform.position),
      rotation: o.transform.rotation,
      scale: canonVec2(o.transform.scale),
    },
    visual: canonVisualRef(o.visual),
  };
  const props = canonOptJson(o.properties);
  if (props !== undefined) out.properties = props;
  return out;
}

function canonScatter(a: ScatterArea): ScatterArea {
  const out: ScatterArea = {
    id: a.id,
    shape: canonShape(a.shape),
    profileRef: canonProfileRef(a.profileRef),
    seed: a.seed,
    density: a.density,
  };
  const overrides = canonOptJson(a.overrides);
  if (overrides !== undefined) out.overrides = overrides;
  return out;
}

function canonLabel(l: MapLabel): MapLabel {
  const out: MapLabel = { id: l.id, position: canonVec2(l.position), text: l.text };
  if (l.styleRef !== undefined) out.styleRef = l.styleRef;
  return out;
}

function canonGameplay(e: GameplayEntity): GameplayEntity {
  if (e.kind === "room") {
    return {
      id: e.id,
      kind: "room",
      geometry: canonShape(e.geometry),
      roomType: e.roomType,
      name: e.name,
    };
  }
  if (e.kind === "door") {
    return {
      id: e.id,
      kind: "door",
      position: canonVec2(e.position),
      orientation: e.orientation,
      doorKind: e.doorKind,
      secret: e.secret,
      pairedDoorId: e.pairedDoorId,
    };
  }
  if (e.kind === "trap") {
    return { id: e.id, kind: "trap", position: canonVec2(e.position), trapKind: e.trapKind };
  }
  if (e.kind === "marker") {
    return { id: e.id, kind: "marker", position: canonVec2(e.position), markerKind: e.markerKind };
  }
  if (e.kind === "start") {
    return { id: e.id, kind: "start", position: canonVec2(e.position) };
  }
  return { id: e.id, kind: "finish", position: canonVec2(e.position) };
}

function canonLayer(l: MapLayer): MapLayer {
  const base = {
    id: l.id,
    name: l.name,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
  };
  if (l.kind === "terrain") {
    return canonTerrainLayer(l);
  }
  if (l.kind === "path") {
    return { ...base, kind: "path", paths: l.paths.map(canonPath) };
  }
  if (l.kind === "object") {
    return { ...base, kind: "object", items: l.items.map(canonObject) };
  }
  if (l.kind === "scatter") {
    return { ...base, kind: "scatter", areas: l.areas.map(canonScatter) };
  }
  if (l.kind === "label") {
    return { ...base, kind: "label", items: l.items.map(canonLabel) };
  }
  return { ...base, kind: "gameplay", items: l.items.map(canonGameplay) };
}

/** Канонический вид документа: фиксированный порядок ключей, сортировка
 *  только клеточных массивов, порядок layers/items — untouched. */
export function canonicalizeMapDocument(doc: MapDocumentV5): MapDocumentV5 {
  return {
    v: 5,
    world: {
      bounds: {
        minX: doc.world.bounds.minX,
        minY: doc.world.bounds.minY,
        maxX: doc.world.bounds.maxX,
        maxY: doc.world.bounds.maxY,
      },
    },
    grid: canonGrid(doc.grid),
    assetPacks: doc.assetPacks.map(canonPack),
    layers: doc.layers.map(canonLayer),
  };
}
