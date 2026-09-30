// RenderModel tests (Фазы 2D/3A): legacy adapter reads, V5 adapter,
// unsupported diagnostics, legacy↔V5 equivalence, no mutation.
// 3A: модель layer-oriented — проверки идут через слои; legacy↔V5
// equivalence — через flatten (порядок content, не структура стека).

import { describe, expect, it } from "vitest";
import { migrateLegacyMap } from "./core/migrateLegacy";
import type { MapDocumentV5 } from "./core/types";
import { cellCenter } from "./grid";
import type { MapCells } from "./render";
import {
  createLegacyRenderModel,
  createV5RenderModel,
  type MapRenderLayer,
  type MapRenderModel,
} from "./renderModel";

function cells(patch: Partial<MapCells> = {}): MapCells {
  return {
    terrain: new Map(),
    roads: new Set(),
    rivers: new Set(),
    labels: [],
    rooms: [],
    doors: [],
    traps: [],
    markers: [],
    start: null,
    finish: null,
    ...patch,
  };
}

const FULL: MapCells = {
  terrain: new Map([
    ["1,1", "forest"],
    ["2,1", "wall"],
  ]),
  roads: new Set(["0,2", "1,2"]),
  rivers: new Set(["4,0", "4,1"]),
  labels: [{ x: 1, y: 1, text: "Лес" }],
  rooms: [{ x: 2, y: 0, w: 2, h: 2, type: "treasury", name: "Кладовая" }],
  doors: [
    { x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null },
    { x: 0, y: 0, edge: "e", kind: "secret", secret: true, pair: null },
  ],
  traps: [{ x: 3, y: 1, kind: "pit" }],
  markers: [{ x: 5, y: 5, kind: "chest" }],
  start: { x: 0, y: 5 },
  finish: { x: 5, y: 0 },
};

function kinds(m: MapRenderModel): string[] {
  return m.layers.map((l) => l.kind);
}

function gameplayItems(m: MapRenderModel) {
  return m.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : []));
}

function labelItems(m: MapRenderModel) {
  return m.layers.flatMap((l) => (l.kind === "label" ? l.labels : []));
}

describe("legacy adapter reads", () => {
  const m = createLegacyRenderModel("square", 8, 8, FULL);

  it("псевдо-стек повторяет старый draw order, флаги открыты", () => {
    expect(kinds(m)).toEqual(["terrain", "path", "gameplay", "label"]);
    for (const l of m.layers) {
      expect(l.visible).toBe(true);
      expect(l.locked).toBe(false);
      expect(l.opacity).toBe(1);
    }
  });

  it("terrain lookup + plain fallback (zero-copy refs)", () => {
    const t = m.layers[0];
    expect(t.kind).toBe("terrain");
    if (t.kind !== "terrain") return;
    expect(t.terrain.defaultCode).toBe("plain");
    expect(t.terrain.entries).toBe(FULL.terrain);
    expect(t.terrain.entries.get("1,1")).toBe("forest");
    expect(t.terrain.entries.get("0,0")).toBeUndefined();
  });

  it("paths: сначала реки, потом дороги (zero-copy)", () => {
    const p = m.layers[1];
    expect(p.kind).toBe("path");
    if (p.kind !== "path") return;
    expect(p.paths.map((x) => x.kind)).toEqual(["river", "road"]);
    expect(p.paths[0].cells).toBe(FULL.rivers);
    expect(p.paths[1].cells).toBe(FULL.roads);
  });

  it("labels: world positions + deterministic IDs", () => {
    expect(labelItems(m)).toEqual([{ id: "legacy-label-0", position: { x: 1.5, y: 1.5 }, text: "Лес" }]);
  });

  it("gameplay items в kind-порядке с ID", () => {
    const items = gameplayItems(m);
    expect(items.map((i) => i.kind)).toEqual([
      "room",
      "door",
      "door",
      "trap",
      "marker",
      "start",
      "finish",
    ]);
    const room = items[0];
    expect(room).toEqual({
      kind: "room",
      room: {
        id: "legacy-room-0",
        rect: { x: 2, y: 0, w: 2, h: 2 },
        type: "treasury",
        name: "Кладовая",
      },
    });
    expect(items[1]).toEqual({
      kind: "door",
      door: { id: "legacy-door-0", position: { x: 2.5, y: 0 }, horizontal: true, kind: "door", secret: false },
    });
    expect(items[2]).toEqual({
      kind: "door",
      door: { id: "legacy-door-1", position: { x: 1, y: 0.5 }, horizontal: false, kind: "secret", secret: true },
    });
    expect(items[3]).toEqual({
      kind: "trap",
      trap: { id: "legacy-trap-0", position: { x: 3.5, y: 1.5 }, kind: "pit" },
    });
    expect(items[4]).toEqual({
      kind: "marker",
      marker: { id: "legacy-marker-0", position: { x: 5.5, y: 5.5 }, kind: "chest" },
    });
    expect(items[5]).toEqual({
      kind: "start",
      start: { id: "legacy-start", position: { x: 0.5, y: 5.5 } },
    });
    expect(items[6]).toEqual({
      kind: "finish",
      finish: { id: "legacy-finish", position: { x: 5.5, y: 0.5 } },
    });
  });

  it("hex positions via cellCenter (no square assumption)", () => {
    const hx = cells({ labels: [{ x: 2, y: 2, text: "H" }], traps: [{ x: 1, y: 2, kind: "gas" }] });
    const mhex = createLegacyRenderModel("hex", 6, 6, hx);
    const c = cellCenter("hex", 2, 2);
    expect(labelItems(mhex)[0].position).toEqual({ x: c.cx, y: c.cy });
  });

  it("OOB entities отфильтрованы как у renderer", () => {
    const bad = cells({
      labels: [{ x: 99, y: 0, text: "x" }],
      traps: [{ x: 0, y: 99, kind: "pit" }],
      rooms: [{ x: 7, y: 7, w: 5, h: 5, type: "empty", name: "" }],
      doors: [{ x: 99, y: 0, edge: "n", kind: "door", secret: false, pair: null }],
      start: { x: 99, y: 99 },
    });
    const m2 = createLegacyRenderModel("square", 8, 8, bad);
    expect(labelItems(m2)).toEqual([]);
    expect(gameplayItems(m2)).toEqual([]);
  });
});

function migratedV5(rawCells: MapCells, grid: "square" | "hex" = "square", w = 8, h = 8): MapDocumentV5 {
  return migrateLegacyMap({ grid, width: w, height: h, cells: rawCells }).document;
}

describe("V5 adapter on migrated fixtures", () => {
  it("full square/hex/paths/pairs → 0 diagnostics", () => {
    const docs = [
      migratedV5(FULL),
      migratedV5(
        cells({ labels: [{ x: 2, y: 2, text: "H" }], traps: [{ x: 1, y: 2, kind: "gas" }] }),
        "hex",
        6,
        6,
      ),
      migratedV5(cells({ roads: new Set(["0,0"]), rivers: new Set(["1,1"]) })),
    ];
    for (const d of docs) {
      const r = createV5RenderModel(d);
      expect(r.diagnostics).toEqual([]);
    }
  });

  it("структура и порядок слоёв документа сохранены, флаги перенесены", () => {
    const doc = migratedV5(FULL);
    const { model } = createV5RenderModel(doc);
    expect(model.layers.map((l) => l.id)).toEqual(doc.layers.map((l) => l.id));
    model.layers.forEach((ml, i) => {
      expect(ml.visible).toBe(doc.layers[i].visible);
      expect(ml.locked).toBe(doc.layers[i].locked);
      expect(ml.opacity).toBe(doc.layers[i].opacity);
      expect(ml.name).toBe(doc.layers[i].name);
    });
  });

  it("V5 model равна legacy model (equivalence через flatten)", () => {
    for (const grid of ["square", "hex"] as const) {
      const w = grid === "square" ? 8 : 6;
      const legacy = createLegacyRenderModel(grid, w, w, FULL_HEX_SAFE);
      const { model } = createV5RenderModel(migratedV5(FULL_HEX_SAFE, grid, w, w));
      expect(compareRenderModels(legacy, model)).toEqual([]);
    }
  });
});

// Подмножество FULL без дверей на несуществующих рёбрах — валидно и для hex.
const FULL_HEX_SAFE: MapCells = {
  ...FULL,
  doors: [{ x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null }],
};

/** Test-only flatten (§26 ТЗ, 3A): content модели в порядке слоёв. */
export function flattenRenderModel(m: MapRenderModel): {
  terrain: { defaultCode: string; entries: [string, string][] };
  rivers: string[];
  roads: string[];
  labels: unknown[];
  items: unknown[];
} {
  const terrains = m.layers.filter((l): l is Extract<MapRenderLayer, { kind: "terrain" }> => l.kind === "terrain");
  const entries = new Map<string, string>();
  let defaultCode = "plain";
  for (const t of terrains) {
    defaultCode = t.terrain.defaultCode;
    for (const [k, v] of t.terrain.entries) entries.set(k, v);
  }
  const rivers: string[] = [];
  const roads: string[] = [];
  for (const l of m.layers) {
    if (l.kind !== "path") continue;
    for (const p of l.paths) {
      if (p.kind === "river") rivers.push(...p.cells);
      else roads.push(...p.cells);
    }
  }
  return {
    terrain: { defaultCode, entries: [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : 1)) },
    rivers: [...rivers].sort(),
    roads: [...roads].sort(),
    labels: labelItems(m),
    items: gameplayItems(m),
  };
}

/** Test-only comparator: семантическое равенство read models через flatten. */
export function compareRenderModels(a: MapRenderModel, b: MapRenderModel): string[] {
  const diffs: string[] = [];
  const fa = flattenRenderModel(a);
  const fb = flattenRenderModel(b);
  for (const k of ["terrain", "rivers", "roads", "labels", "items"] as const) {
    if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) diffs.push(k);
  }
  return diffs;
}

describe("unsupported V5 content", () => {
  function richDoc(): MapDocumentV5 {
    const base = migratedV5(FULL);
    const layers = base.layers.map((l) => {
      if (l.id === "lyr-road" && l.kind === "path") {
        return {
          ...l,
          paths: [
            ...l.paths,
            {
              id: "path-spline-1",
              kind: "route",
              geometry: {
                type: "spline" as const,
                nodes: [{ position: { x: 1, y: 1 } }, { position: { x: 3, y: 2 } }],
              },
              width: 0.5,
              styleRef: { type: "builtin" as const, key: "route" },
            },
          ],
        };
      }
      if (l.id === "lyr-objects" && l.kind === "object") {
        return {
          ...l,
          items: [
            {
              id: "obj-1",
              transform: { position: { x: 1, y: 1 }, rotation: 0, scale: { x: 1, y: 1 } },
              visual: { type: "builtin" as const, key: "chest" },
            },
          ],
        };
      }
      if (l.id === "lyr-scatter" && l.kind === "scatter") {
        return {
          ...l,
          areas: [
            {
              id: "sc-1",
              shape: { type: "ellipse" as const, center: { x: 1, y: 1 }, rx: 1, ry: 1 },
              profileRef: { type: "builtin" as const, key: "p" },
              seed: 1,
              density: 1,
            },
          ],
        };
      }
      if (l.kind === "gameplay") {
        return {
          ...l,
          items: [
            ...l.items,
            {
              id: "room-poly",
              kind: "room" as const,
              geometry: {
                type: "polygon" as const,
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 },
                  { x: 0, y: 1 },
                ],
              },
              roomType: "lab" as const,
              name: "Poly",
            },
          ],
        };
      }
      if (l.id === "lyr-terrain" && l.kind === "terrain" && l.representation === "cells") {
        return {
          ...l,
          representation: "mask" as const,
          mask: {
            origin: { x: 0, y: 0 },
            sampleSize: 0.125,
            materials: [{ type: "builtin" as const, key: "terrain/plain" }],
            chunks: [],
          },
          cells: undefined as never,
        };
      }
      return l;
    });
    return { ...base, layers };
  }

  it("не падает, diagnostics по кодам, model не corrupt", () => {
    const { model, diagnostics } = createV5RenderModel(richDoc());
    const codes = diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual([
      "unsupported-object-layer",
      "unsupported-path-kind",
      "unsupported-room-geometry",
      "unsupported-scatter-layer",
    ]);
    // Пустая маска поддерживается; пути/комнаты неподдерживаемых форм пропущены.
    const flat = flattenRenderModel(model);
    expect(flat.terrain.defaultCode).toBe("plain");
    expect(flat.terrain.entries).toEqual([]);
    expect(flat.items.map((i) => (i as { room?: { id: string } }).room?.id)).not.toContain("room-poly");
    expect(flat.items.length).toBeGreaterThan(0);
  });

  it("не-terrain material клетки → unsupported-material, клетка как default", () => {
    const base = migratedV5(FULL);
    const layers = base.layers.map((l) => {
      if (l.kind !== "terrain" || l.representation !== "cells") return l;
      return {
        ...l,
        cells: [
          ...l.cells,
          { x: 0, y: 0, material: { type: "asset" as const, assetId: "pack:grass" } },
        ],
      };
    });
    const { model, diagnostics } = createV5RenderModel({ ...base, layers });
    expect(diagnostics.map((d) => d.code)).toContain("unsupported-material");
    const flat = flattenRenderModel(model);
    expect(flat.terrain.entries.find(([k]) => k === "0,0")).toBeUndefined();
    expect(flat.terrain.defaultCode).toBe("plain");
  });

  it("некардинальная ориентация двери → diagnostic, дверь всё равно в модели", () => {
    const base = migratedV5(FULL);
    const layers = base.layers.map((l) => {
      if (l.kind !== "gameplay") return l;
      return {
        ...l,
        items: l.items.map((e) =>
          e.kind === "door" ? { ...e, orientation: 45 } : e,
        ),
      };
    });
    const { model, diagnostics } = createV5RenderModel({ ...base, layers });
    // Обе двери фикстуры → 2 diagnostics (по одной на дверь).
    expect(diagnostics.filter((d) => d.code === "unsupported-door-orientation")).toHaveLength(2);
    expect(gameplayItems(model).filter((i) => i.kind === "door")).toHaveLength(2);
  });

  it("неизвестный kind пути → unsupported-path-kind", () => {
    const base = migratedV5(FULL);
    const layers = base.layers.map((l) => {
      if (l.id !== "lyr-road" || l.kind !== "path") return l;
      return {
        ...l,
        paths: [
          {
            id: "path-wall-1",
            kind: "wall",
            geometry: { type: "cell-network" as const, cells: [{ x: 0, y: 0 }] },
            width: 1,
            styleRef: { type: "builtin" as const, key: "wall" },
          },
        ],
      };
    });
    const { diagnostics } = createV5RenderModel({ ...base, layers });
    expect(diagnostics.map((d) => d.code)).toContain("unsupported-path-kind");
  });
});

describe("no mutation", () => {
  it("адаптеры не мутируют входы", () => {
    const before = structuredClone({
      terrain: [...FULL.terrain],
      roads: [...FULL.roads],
      rivers: [...FULL.rivers],
      labels: FULL.labels,
      rooms: FULL.rooms,
      doors: FULL.doors,
      traps: FULL.traps,
      markers: FULL.markers,
      start: FULL.start,
      finish: FULL.finish,
    });
    createLegacyRenderModel("square", 8, 8, FULL);
    expect({
      terrain: [...FULL.terrain],
      roads: [...FULL.roads],
      rivers: [...FULL.rivers],
      labels: FULL.labels,
      rooms: FULL.rooms,
      doors: FULL.doors,
      traps: FULL.traps,
      markers: FULL.markers,
      start: FULL.start,
      finish: FULL.finish,
    }).toEqual(before);

    const doc = migratedV5(FULL);
    const docBefore = structuredClone(doc);
    createV5RenderModel(doc);
    expect(doc).toEqual(docBefore);
  });
});
