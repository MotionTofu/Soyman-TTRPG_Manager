// Load normalization tests (Фаза 2G, §10–12, §82).

import { describe, expect, it } from "vitest";
import { serializeCells } from "../render";
import { FIXTURES, parseFixture } from "../core/fixtures";
import { migrateLegacyMap } from "../core/migrateLegacy";
import { serializeMapDocument } from "../core/serialize";
import type { MapDocumentV5 } from "../core/types";
import { validateMapDocument } from "../core/validate";
import { loadStoredEditorDocument, loadStoredWorkspaceDocument } from "./loadDocument";

function legacyBlob(): string {
  return serializeCells(parseFixture(FIXTURES.dungeonV3));
}

describe("loadStoredEditorDocument", () => {
  it("V6/future versions are unsupported in V5 editor, never corrupt-overwrite candidates", () => {
    for (const v of [6, 7, 99, "6"]) {
      const raw = ` { "v": ${JSON.stringify(v)}, "private": "Test raw" } \n`;
      const loaded = loadStoredEditorDocument({ cells: raw, grid: "square", width: 8, height: 8 });
      expect(loaded).toMatchObject({ sourceFormat: "unsupported", status: "unsupported", raw, corrupt: false });
      expect(loaded.compatibility.compatible).toBe(false);
    }
  });
  it("new reader upgrades legacy/V5 in memory, returns no saving fallback for future bytes", () => {
    const stored = { cells: legacyBlob(), grid: "square" as const, width: 8, height: 8 };
    const upgraded = loadStoredWorkspaceDocument(stored);
    expect(upgraded.status).toBe("supported");
    expect(upgraded.document?.v).toBe(6);
    expect(stored.cells).toBe(legacyBlob());
    const future = { ...stored, cells: ' {"v":7} \n' };
    expect(loadStoredWorkspaceDocument(future)).toEqual({ status: "unsupported", document: null, raw: future.cells });
    expect(loadStoredWorkspaceDocument({ ...stored, cells: "garbage" })).toMatchObject({ status: "corrupt", document: null });
    const gridless = { ...stored, cells: JSON.stringify({ v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } }, grid: null, layers: [], assetPacks: [] }) };
    expect(loadStoredEditorDocument(gridless).status).toBe("unsupported");
    // The new pure reader understands the full V5 schema, not just old UI tools.
    expect(loadStoredWorkspaceDocument(gridless)).toMatchObject({ status: "supported", document: { v: 6, grid: null } });
  });
  it("legacy load → V5 state, sourceFormat legacy, baseline canonical", () => {
    const r = loadStoredEditorDocument({ cells: legacyBlob(), grid: "square", width: 8, height: 8 });
    expect(r.sourceFormat).toBe("legacy");
    expect(r.corrupt).toBe(false);
    expect(validateMapDocument(r.document)).toEqual([]);
    expect(r.compatibility.compatible).toBe(true);
    // Baseline совпадает с миграцией (не сырой blob).
    const expected = migrateLegacyMap({
      grid: "square",
      width: 8,
      height: 8,
      cells: parseFixture(FIXTURES.dungeonV3),
    }).document;
    expect(serializeMapDocument(r.document)).toBe(serializeMapDocument(expected));
  });

  it("V5 load напрямую, без миграции", () => {
    const doc: MapDocumentV5 = migrateLegacyMap({
      grid: "square",
      width: 8,
      height: 8,
      cells: parseFixture(FIXTURES.fullV4Square),
    }).document;
    const r = loadStoredEditorDocument({
      cells: serializeMapDocument(doc),
      grid: "square",
      width: 8,
      height: 8,
    });
    expect(r.sourceFormat).toBe("v5");
    expect(r.corrupt).toBe(false);
    expect(serializeMapDocument(r.document)).toBe(serializeMapDocument(doc));
  });

  it("corrupt legacy → fallback + corrupt, autosave baseline — fallback", () => {
    const r = loadStoredEditorDocument({ cells: "garbage{{{", grid: "square", width: 8, height: 8 });
    expect(r.sourceFormat).toBe("legacy");
    expect(r.corrupt).toBe(true);
    expect(validateMapDocument(r.document)).toEqual([]);
    expect(r.document.grid && r.document.grid.columns).toBe(8);
  });

  it("invalid V5 → corrupt fallback", () => {
    const r = loadStoredEditorDocument({
      cells: JSON.stringify({ v: 5, world: {}, grid: null, assetPacks: [], layers: [] }),
      grid: "square",
      width: 8,
      height: 8,
    });
    expect(r.sourceFormat).toBe("v5");
    expect(r.corrupt).toBe(true);
    expect(validateMapDocument(r.document)).toEqual([]);
  });

  it("migration warnings пробрасываются", () => {
    const blob = JSON.stringify({
      v: 3,
      cells: {},
      roads: [],
      labels: [],
      rooms: [],
      doors: [{ x: 1, y: 1, edge: "n", kind: "door", secret: false, pair: "ghost" }],
      traps: [],
    });
    const r = loadStoredEditorDocument({ cells: blob, grid: "square", width: 8, height: 8 });
    expect(r.corrupt).toBe(false);
    expect(r.migrationWarnings).toHaveLength(1);
    expect(r.compatibility.compatible).toBe(true);
  });

  it("не бросает на любом мусоре", () => {
    for (const garbage of ["", "null", "[]", "42", '{"v":99}']) {
      const r = loadStoredEditorDocument({ cells: garbage, grid: "hex", width: 10, height: 10 });
      expect(validateMapDocument(r.document)).toEqual([]);
    }
  });

  it("generator normalization (§89): transient → V5 valid, square+hex", async () => {
    const { generateCells } = await import("../generate");
    const { generateDungeon } = await import("../dungeon");
    const gen = { seed: 7, sea: 55, mountains: 12, forest: 30 };
    for (const grid of ["square", "hex"] as const) {
      const migrated = migrateLegacyMap({
        grid,
        width: 20,
        height: 20,
        cells: generateCells(grid, 20, 20, gen),
      });
      expect(validateMapDocument(migrated.document)).toEqual([]);
      expect(migrated.document.grid?.type).toBe(grid);
    }
    const dungeon = migrateLegacyMap({
      grid: "square",
      width: 30,
      height: 30,
      cells: generateDungeon(30, 30, { seed: 7, rooms: 5, corrWidth: 1, loops: 25, secrets: true, traps: "some" }),
    });
    expect(validateMapDocument(dungeon.document)).toEqual([]);
  });
});
