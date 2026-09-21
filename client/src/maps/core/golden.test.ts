// Golden migration tests (§47 ТЗ): legacy input → migrate → serialize →
// EXACT expected JSON. Фиксируют deterministic migration байт в байт.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import { serializeMapDocument } from "./serialize";
import type { MapDocumentV5 } from "./types";

function golden(raw: string, width: number, height: number, grid: "square" | "hex"): string {
  const { document, warnings } = migrateLegacyMap({ grid, width, height, cells: parseFixture(raw) });
  expect(warnings).toEqual([]);
  return serializeMapDocument(document);
}

describe("golden: v4 square dungeon 4x3 (пример I из ADR)", () => {
  const RAW = JSON.stringify({
    v: 4,
    cells: { "1,1": "forest", "2,1": "forest" },
    roads: ["0,2", "1,2"],
    rivers: [],
    labels: [{ x: 1, y: 1, text: "Тёмный лес" }],
    rooms: [{ x: 2, y: 0, w: 2, h: 2, type: "treasury", name: "Кладовая" }],
    doors: [{ x: 2, y: 0, edge: "n", kind: "door", secret: false, pair: null }],
    traps: [],
    markers: [],
    start: null,
    finish: null,
  });

  const EXPECTED: MapDocumentV5 = {
    v: 5,
    world: { bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 } },
    grid: { type: "square", cellSize: 1, columns: 4, rows: 3, origin: { x: 0, y: 0 } },
    assetPacks: [],
    layers: [
      {
        id: "lyr-terrain",
        name: "Terrain",
        kind: "terrain",
        visible: true,
        locked: false,
        opacity: 1,
        representation: "cells",
        defaultMaterial: { type: "builtin", key: "terrain/plain" },
        cells: [
          { x: 1, y: 1, material: { type: "builtin", key: "terrain/forest" } },
          { x: 2, y: 1, material: { type: "builtin", key: "terrain/forest" } },
        ],
      },
      { id: "lyr-river", name: "Rivers", kind: "path", visible: true, locked: false, opacity: 1, paths: [] },
      {
        id: "lyr-road",
        name: "Roads",
        kind: "path",
        visible: true,
        locked: false,
        opacity: 1,
        paths: [
          {
            id: "legacy-path-road",
            kind: "road",
            geometry: { type: "cell-network", cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }] },
            width: 1,
            styleRef: { type: "builtin", key: "road" },
          },
        ],
      },
      { id: "lyr-objects", name: "Objects", kind: "object", visible: true, locked: false, opacity: 1, items: [] },
      { id: "lyr-scatter", name: "Scatter", kind: "scatter", visible: true, locked: false, opacity: 1, areas: [] },
      {
        id: "lyr-gameplay",
        name: "Gameplay",
        kind: "gameplay",
        visible: true,
        locked: false,
        opacity: 1,
        items: [
          {
            id: "legacy-room-0",
            kind: "room",
            geometry: { type: "rect", x: 2, y: 0, w: 2, h: 2 },
            roomType: "treasury",
            name: "Кладовая",
          },
          {
            id: "legacy-door-0",
            kind: "door",
            position: { x: 2.5, y: 0 },
            orientation: 0,
            doorKind: "door",
            secret: false,
            pairedDoorId: null,
          },
        ],
      },
      {
        id: "lyr-labels",
        name: "Labels",
        kind: "label",
        visible: true,
        locked: false,
        opacity: 1,
        items: [{ id: "legacy-label-0", position: { x: 1.5, y: 1.5 }, text: "Тёмный лес" }],
      },
    ],
  };

  it("exact serialized JSON", () => {
    expect(golden(RAW, 4, 3, "square")).toBe(serializeMapDocument(EXPECTED));
  });

  it("exact string literal (порядок ключей зафиксирован)", () => {
    const s = golden(RAW, 4, 3, "square");
    expect(s.startsWith('{"v":5,"world":{"bounds":{"minX":0,"minY":0,"maxX":4,"maxY":3}}')).toBe(true);
    // Канонический JSON собирается без пробелов и с фиксированным порядком
    // ключей: id, name, visible, locked, opacity, kind, ... (см. canonicalize).
    expect(s).toContain('"id":"lyr-terrain","name":"Terrain","visible":true,"locked":false,"opacity":1,"kind":"terrain"');
    expect(s).toContain('"id":"legacy-path-road","kind":"road"');
  });
});

describe("golden: full v4 square + hex + pairs + paths", () => {
  it("full v4 square deterministic", () => {
    const a = golden(FIXTURES.fullV4Square, 8, 8, "square");
    const b = golden(FIXTURES.fullV4Square, 8, 8, "square");
    expect(a).toBe(b);
    expect(a).toContain('"id":"legacy-door-1"');
    expect(a).toContain('"pairedDoorId":"legacy-door-2"');
  });

  it("full v4 hex deterministic", () => {
    const a = golden(FIXTURES.fullV4Hex, 6, 6, "hex");
    const b = golden(FIXTURES.fullV4Hex, 6, 6, "hex");
    expect(a).toBe(b);
    expect(a).toContain('"type":"hex"');
  });

  it("door pair golden: взаимные ссылки в строке", () => {
    const s = golden(FIXTURES.pair, 8, 8, "square");
    expect(s).toContain('"id":"legacy-door-0"');
    expect(s).toContain('"pairedDoorId":"legacy-door-1"');
    expect(s).toContain('"pairedDoorId":"legacy-door-0"');
  });

  it("paths golden: отсортированные клетки в строке", () => {
    const s = golden(FIXTURES.pathsV4, 8, 8, "square");
    expect(s).toContain('"cells":[{"x":0,"y":0},{"x":1,"y":0},{"x":2,"y":0}]');
    expect(s).toContain('"cells":[{"x":0,"y":1},{"x":1,"y":1}]');
  });
});
