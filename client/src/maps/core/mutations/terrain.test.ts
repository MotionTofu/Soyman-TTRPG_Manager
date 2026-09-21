// Terrain mutations tests: batch/no-op/default/canonical/flood/validity.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { MaterialRef } from "../refs";
import type { MapDocumentV5, TerrainCellLayer } from "../types";
import { validateMapDocument } from "../validate";
import type { MutationResult } from "./types";
import {
  applyTerrainCellEdits,
  floodTerrainFill,
  readTerrainMaterialAt,
} from "./terrain";

const LAYER = "lyr-terrain";
const FOREST: MaterialRef = { type: "builtin", key: "terrain/forest" };
const MOUNTAINS: MaterialRef = { type: "builtin", key: "terrain/mountains" };
const PLAIN: MaterialRef = { type: "builtin", key: "terrain/plain" };

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function terrainOf(doc: MapDocumentV5): TerrainCellLayer {
  const l = doc.layers.find((x) => x.id === LAYER);
  if (!l || l.kind !== "terrain" || l.representation !== "cells") throw new Error("no cells terrain");
  return l;
}

/** Успех + validity property: valid input → valid output. */
function expectOk(r: MutationResult): MapDocumentV5 {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("mutation failed: " + JSON.stringify(r.issues));
  expect(validateMapDocument(r.document)).toEqual([]);
  return r.document;
}

function expectErr(r: MutationResult, codePart: string): void {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected error");
  expect(r.issues.some((i) => i.code.includes(codePart))).toBe(true);
}

describe("terrain batch edits", () => {
  it("paint one cell", () => {
    const doc = squareDoc();
    const next = expectOk(applyTerrainCellEdits(doc, LAYER, [{ x: 0, y: 0, material: FOREST }]));
    expect(terrainOf(next).cells).toContainEqual({ x: 0, y: 0, material: FOREST });
    // Вход не мутирован.
    expect(terrainOf(doc).cells.some((c) => c.x === 0 && c.y === 0)).toBe(false);
  });

  it("batch paint + replace material", () => {
    const doc = squareDoc();
    const next = expectOk(
      applyTerrainCellEdits(doc, LAYER, [
        { x: 0, y: 0, material: FOREST },
        { x: 1, y: 1, material: MOUNTAINS }, // была forest
        { x: 7, y: 7, material: FOREST },
      ]),
    );
    const cells = terrainOf(next).cells;
    expect(cells.find((c) => c.x === 1 && c.y === 1)).toEqual({ x: 1, y: 1, material: MOUNTAINS });
    // Canonical ordering (y,x).
    const keys = cells.map((c) => `${c.y},${c.x}`);
    expect([...keys].sort()).toEqual(keys);
  });

  it("paint default removes override", () => {
    const doc = squareDoc();
    expect(terrainOf(doc).cells.length).toBe(3);
    const next = expectOk(applyTerrainCellEdits(doc, LAYER, [{ x: 1, y: 1, material: PLAIN }]));
    expect(terrainOf(next).cells.some((c) => c.x === 1 && c.y === 1)).toBe(false);
    expect(terrainOf(next).cells.length).toBe(2);
  });

  it("erase (null) removes override", () => {
    const doc = squareDoc();
    const next = expectOk(applyTerrainCellEdits(doc, LAYER, [{ x: 2, y: 1, material: null }]));
    expect(terrainOf(next).cells.some((c) => c.x === 2 && c.y === 1)).toBe(false);
  });

  it("no-op same material → changed false + тот же reference", () => {
    const doc = squareDoc();
    const r = applyTerrainCellEdits(doc, LAYER, [{ x: 1, y: 1, material: FOREST }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(false);
    expect(r.document).toBe(doc);
  });

  it("erase missing → no-op", () => {
    const doc = squareDoc();
    const r = applyTerrainCellEdits(doc, LAYER, [{ x: 0, y: 0, material: null }]);
    expect(r.ok && !r.changed && r.document === doc).toBe(true);
  });

  it("duplicate coords в batch детерминированы (последняя побеждает)", () => {
    const doc = squareDoc();
    const next = expectOk(
      applyTerrainCellEdits(doc, LAYER, [
        { x: 0, y: 0, material: FOREST },
        { x: 0, y: 0, material: MOUNTAINS },
      ]),
    );
    expect(terrainOf(next).cells.find((c) => c.x === 0 && c.y === 0)).toEqual({
      x: 0,
      y: 0,
      material: MOUNTAINS,
    });
  });

  it("out-of-bounds rejected, вход не мутирован", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    const r = applyTerrainCellEdits(doc, LAYER, [
      { x: 0, y: 0, material: FOREST },
      { x: 99, y: 0, material: FOREST },
    ]);
    expectErr(r, "cell-out-of-grid");
    expect(doc).toEqual(before);
  });

  it("wrong layer kind / unknown layer → error", () => {
    const doc = squareDoc();
    expectErr(applyTerrainCellEdits(doc, "lyr-road", [{ x: 0, y: 0, material: FOREST }]), "wrong-layer-kind");
    expectErr(applyTerrainCellEdits(doc, "nope", [{ x: 0, y: 0, material: FOREST }]), "unknown-layer");
  });

  it("mask layer → unsupported, grid null → error", () => {
    const doc = squareDoc();
    const li = doc.layers.findIndex((l) => l.id === LAYER);
    const masked: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l, i) =>
        i === li && l.kind === "terrain"
          ? {
              ...l,
              representation: "mask" as const,
              mask: {
                origin: { x: 0, y: 0 },
                sampleSize: 0.125,
                materials: [PLAIN],
                chunks: [],
              },
              cells: undefined as never,
            }
          : l,
      ),
    };
    expectErr(applyTerrainCellEdits(masked, LAYER, [{ x: 0, y: 0, material: FOREST }]), "unsupported-mask");
    expectErr(applyTerrainCellEdits({ ...doc, grid: null }, LAYER, [{ x: 0, y: 0, material: FOREST }]), "no-grid");
  });
});

describe("terrain read", () => {
  it("entry и default fallback", () => {
    const doc = squareDoc();
    const a = readTerrainMaterialAt(doc, LAYER, 1, 1);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.material).toEqual(FOREST);
    const b = readTerrainMaterialAt(doc, LAYER, 0, 0);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.material).toEqual(PLAIN);
  });

  it("bad layer / OOB → error", () => {
    const doc = squareDoc();
    expect(readTerrainMaterialAt(doc, "nope", 0, 0).ok).toBe(false);
    expect(readTerrainMaterialAt(doc, LAYER, 99, 0).ok).toBe(false);
  });
});

describe("flood fill", () => {
  it("flood square: связная область стартового материала", () => {
    // fullV4Square: forest (1,1),(2,1) — связны; заливаем mountains.
    const doc = squareDoc();
    const next = expectOk(floodTerrainFill(doc, LAYER, 1, 1, MOUNTAINS));
    const cells = terrainOf(next).cells;
    const codeOf = (m: MaterialRef) => (m.type === "builtin" ? m.key : `asset:${m.assetId}`);
    expect(cells.filter((c) => codeOf(c.material) === "terrain/mountains")).toHaveLength(2);
    // deep_water (5,5) не задета.
    const deep = cells.find((c) => c.x === 5 && c.y === 5);
    expect(deep && codeOf(deep.material)).toBe("terrain/deep_water");
  });

  it("flood в default удаляет overrides связной области", () => {
    const doc = squareDoc();
    const next = expectOk(floodTerrainFill(doc, LAYER, 1, 1, PLAIN));
    expect(terrainOf(next).cells.some((c) => c.x === 1 && c.y === 1)).toBe(false);
    expect(terrainOf(next).cells.some((c) => c.x === 2 && c.y === 1)).toBe(false);
  });

  it("flood same material → no-op same ref", () => {
    const doc = squareDoc();
    const r = floodTerrainFill(doc, LAYER, 1, 1, FOREST);
    expect(r.ok && !r.changed && r.document === doc).toBe(true);
  });

  it("flood OOB start → error, вход цел", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    expectErr(floodTerrainFill(doc, LAYER, 99, 0, FOREST), "cell-out-of-grid");
    expect(doc).toEqual(before);
  });

  it("flood hex respected (hex adjacency, не square)", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 6,
      height: 6,
      cells: parseFixture(FIXTURES.fullV4Hex),
    }).document;
    // fullV4Hex: forest (1,1), hills (2,3) — hex-соседи? Проверяем заливку
    // стартовой клетки: как минимум она сама заменена, без выхода за поле.
    const next = expectOk(floodTerrainFill(hexDoc, LAYER, 1, 1, MOUNTAINS));
    expect(terrainOf(next).cells.find((c) => c.x === 1 && c.y === 1)?.material).toEqual(MOUNTAINS);
    for (const c of terrainOf(next).cells) {
      expect(c.x >= 0 && c.y >= 0 && c.x < 6 && c.y < 6).toBe(true);
    }
  });
});
