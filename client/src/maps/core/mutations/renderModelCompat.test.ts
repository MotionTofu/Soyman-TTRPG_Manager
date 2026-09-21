// Mutation → V5 RenderModel integration: mutated legacy-compatible
// document читается рендер-моделью с ожидаемой семантикой.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { MapDocumentV5 } from "../types";
import { createV5RenderModel } from "../../renderModel";
import { addPathCells } from "./paths";
import { createGameplayEntity, moveGameplayEntity } from "./gameplay";
import { deleteLabel } from "./labels";
import { applyTerrainCellEdits } from "./terrain";
import type { MutationResult } from "./types";

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
  if (!r.ok) throw new Error("mutation failed");
  return r.document;
}

describe("mutation → render model", () => {
  it("painted terrain виден в модели без diagnostics", () => {
    const doc = squareDoc();
    const next = expectOk(
      applyTerrainCellEdits(doc, "lyr-terrain", [{ x: 0, y: 0, material: { type: "builtin", key: "terrain/lava" } }]),
    );
    const { model, diagnostics } = createV5RenderModel(next);
    expect(diagnostics).toEqual([]);
    expect(model.terrain.entries.get("0,0")).toBe("lava");
  });

  it("added road cell видна в модели", () => {
    const doc = squareDoc();
    const next = expectOk(addPathCells(doc, "legacy-path-road", [{ x: 3, y: 2 }]));
    const { model, diagnostics } = createV5RenderModel(next);
    expect(diagnostics).toEqual([]);
    expect(model.roads.has("3,2")).toBe(true);
  });

  it("created door/moved trap/deleted label отражены", () => {
    const doc = squareDoc();
    const withDoor = expectOk(
      createGameplayEntity(doc, "lyr-gameplay", {
        id: "d-smoke",
        kind: "door",
        position: { x: 4.5, y: 4 },
        orientation: 0,
        doorKind: "door",
        secret: false,
        pairedDoorId: null,
      }),
    );
    const moved = expectOk(moveGameplayEntity(withDoor, "legacy-trap-0", { x: 1, y: 0 }));
    const cleaned = expectOk(deleteLabel(moved, "legacy-label-0"));
    const { model, diagnostics } = createV5RenderModel(cleaned);
    expect(diagnostics).toEqual([]);
    expect(model.doors.some((d) => d.id === "d-smoke" && d.position.x === 4.5)).toBe(true);
    expect(model.traps.find((t) => t.id === "legacy-trap-0")?.position).toEqual({ x: 4.5, y: 1.5 });
    expect(model.labels).toEqual([]);
  });
});
