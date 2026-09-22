// Whole-document transforms tests: clear + resize (§61–63).

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { MapDocumentV5 } from "../types";
import { validateMapDocument } from "../validate";
import type { MutationResult } from "./types";
import { clearEditableContent, resizeGridDocument } from "./document";
import { createTerrainLayer } from "./layers";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

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

describe("clearEditableContent", () => {
  it("чистит контент, скелет/мир/сетка целы", () => {
    const doc = squareDoc();
    const next = expectOk(clearEditableContent(doc));
    expect(next.world).toEqual(doc.world);
    expect(next.grid).toEqual(doc.grid);
    expect(next.layers.map((l) => l.id)).toEqual(doc.layers.map((l) => l.id));
    const terrain = next.layers.find((l) => l.id === "lyr-terrain");
    expect(terrain && terrain.kind === "terrain" && terrain.representation === "cells" && terrain.cells).toEqual([]);
    expect(terrain && terrain.kind === "terrain" && terrain.defaultMaterial).toEqual({
      type: "builtin",
      key: "terrain/plain",
    });
    for (const l of next.layers) {
      if (l.kind === "path") expect(l.paths).toEqual([]);
      if (l.kind === "object" || l.kind === "label") expect(l.items).toEqual([]);
      if (l.kind === "scatter") expect(l.areas).toEqual([]);
      if (l.kind === "gameplay") expect(l.items).toEqual([]);
    }
  });

  it("пустая карта → no-op same ref", () => {
    const doc = squareDoc();
    const cleared = expectOk(clearEditableContent(doc));
    const r = clearEditableContent(cleared);
    expect(r.ok && !r.changed && r.document === cleared).toBe(true);
  });

  it("3A §95–96: Clear сохраняет layers/order/names/visible/locked/opacity, чистит всё включая locked", () => {
    let doc = squareDoc();
    // Второй terrain + lock gameplay для проверки.
    const t = createTerrainLayer(doc, { id: "t2", name: "T2" });
    if (!t.ok || !t.changed) throw new Error("create failed");
    doc = t.document;
    const locked: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.kind === "gameplay" ? { ...l, locked: true, visible: false, opacity: 0.5, name: "G-lock" } : l,
      ),
    };
    const next = expectOk(clearEditableContent(locked));
    // Порядок/имена/флаги целы.
    expect(next.layers.map((l) => l.id)).toEqual(locked.layers.map((l) => l.id));
    next.layers.forEach((l, i) => {
      expect(l.name).toBe(locked.layers[i].name);
      expect(l.visible).toBe(locked.layers[i].visible);
      expect(l.locked).toBe(locked.layers[i].locked);
      expect(l.opacity).toBe(locked.layers[i].opacity);
    });
    // Content вычищен везде, включая locked gameplay.
    for (const l of next.layers) {
      if (l.kind === "terrain" && l.representation === "cells") expect(l.cells).toEqual([]);
      if (l.kind === "path") expect(l.paths).toEqual([]);
      if (l.kind === "gameplay") expect(l.items).toEqual([]);
      if (l.kind === "label") expect(l.items).toEqual([]);
    }
  });
});

describe("resizeGridDocument", () => {
  function bigDoc(): MapDocumentV5 {
    return migrateLegacyMap({
      grid: "square",
      width: 10,
      height: 10,
      cells: {
        terrain: new Map([
          ["1,1", "forest"],
          ["9,9", "lava"],
        ]),
        roads: new Set(["0,0", "1,0"]),
        rivers: new Set(["9,9"]),
        labels: [{ x: 9, y: 9, text: "край" }],
        rooms: [{ x: 8, y: 8, w: 2, h: 2, type: "empty", name: "" }],
        doors: [{ x: 9, y: 0, edge: "n", kind: "door", secret: false, pair: null }],
        traps: [{ x: 0, y: 9, kind: "pit" }],
        markers: [],
        start: { x: 9, y: 9 },
        finish: { x: 0, y: 0 },
      },
    }).document;
  }

  it("shrink режет OOB по legacy-правилам", () => {
    // 10x10 → 8x8: лес (1,1) цел, lava (9,9) падает; дороги (0..1,0) целы,
    // река (9,9) падает → path удалён; подпись/комната/дверь/ловушка/старт падают;
    // финиш (0,0) цел. Комната (8,8,2,2) торчит — целиком.
    const next = expectOk(resizeGridDocument(bigDoc(), 8, 8));
    expect(next.grid && next.grid.columns).toBe(8);
    expect(next.world.bounds).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 8 });
    const terrain = next.layers.find((l) => l.id === "lyr-terrain");
    expect(
      terrain && terrain.kind === "terrain" && terrain.representation === "cells" && terrain.cells,
    ).toEqual([{ x: 1, y: 1, material: { type: "builtin", key: "terrain/forest" } }]);
    const river = next.layers.find((l) => l.id === "lyr-river");
    expect(river && river.kind === "path" && river.paths).toEqual([]);
    const road = next.layers.find((l) => l.id === "lyr-road");
    expect(road && road.kind === "path" && road.paths).toHaveLength(1);
    expect(next.layers.find((l) => l.id === "lyr-labels")).toMatchObject({ items: [] });
    const gameplay = next.layers.find((l) => l.id === "lyr-gameplay");
    const kinds =
      gameplay && gameplay.kind === "gameplay" ? gameplay.items.map((e) => `${e.kind}:${e.id}`) : [];
    expect(kinds).toEqual(["finish:legacy-finish"]);
  });

  it("grow меняет только dims", () => {
    const doc = squareDoc();
    const grown = expectOk(resizeGridDocument(doc, 10, 10));
    expect(grown.grid && grown.grid.columns).toBe(10);
    expect(grown.world.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const terrain = grown.layers.find((l) => l.id === "lyr-terrain");
    expect(terrain && terrain.kind === "terrain" && terrain.representation === "cells" && terrain.cells).toHaveLength(3);
  });

  it("same dims → no-op; ошибки не мутируют", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    const r = resizeGridDocument(doc, 8, 8);
    expect(r.ok && !r.changed && r.document === doc).toBe(true);
    expectErr(resizeGridDocument(doc, 7.5, 8), "bad-dims");
    expectErr(resizeGridDocument(doc, 4, 4), "out-of-range");
    expectErr(resizeGridDocument(doc, 200, 8), "out-of-range");
    expectErr(resizeGridDocument({ ...doc, grid: null }, 10, 10), "no-grid");
    expect(doc).toEqual(before);
  });

  it("hex resize пересчитывает bounds", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 6,
      height: 6,
      cells: parseFixture(FIXTURES.fullV4Hex),
    }).document;
    const next = expectOk(resizeGridDocument(hexDoc, 8, 8));
    expect(next.grid && next.grid.columns).toBe(8);
    const b = next.world.bounds;
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });
});
