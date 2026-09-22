// Mutation → V5 RenderModel integration: mutated legacy-compatible
// document читается рендер-моделью с ожидаемой семантикой.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { MapDocumentV5 } from "../types";
import { createV5RenderModel, type MapRenderLayer } from "../../renderModel";
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

function terrainEntriesOf(model: { layers: readonly MapRenderLayer[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of model.layers) {
    if (l.kind !== "terrain") continue;
    for (const [k, v] of l.terrain.entries) out.set(k, v);
  }
  return out;
}

function roadCellsOf(model: { layers: readonly MapRenderLayer[] }): Set<string> {
  const out = new Set<string>();
  for (const l of model.layers) {
    if (l.kind !== "path") continue;
    for (const p of l.paths) {
      if (p.kind === "road") for (const c of p.cells) out.add(c);
    }
  }
  return out;
}

function gameplayItemsOf(model: { layers: readonly MapRenderLayer[] }) {
  return model.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : []));
}

function labelItemsOf(model: { layers: readonly MapRenderLayer[] }) {
  return model.layers.flatMap((l) => (l.kind === "label" ? l.labels : []));
}

describe("mutation → render model", () => {
  it("painted terrain виден в модели без diagnostics", () => {
    const doc = squareDoc();
    const next = expectOk(
      applyTerrainCellEdits(doc, "lyr-terrain", [{ x: 0, y: 0, material: { type: "builtin", key: "terrain/lava" } }]),
    );
    const { model, diagnostics } = createV5RenderModel(next);
    expect(diagnostics).toEqual([]);
    expect(terrainEntriesOf(model).get("0,0")).toBe("lava");
  });

  it("added road cell видна в модели", () => {
    const doc = squareDoc();
    const next = expectOk(addPathCells(doc, "legacy-path-road", [{ x: 3, y: 2 }]));
    const { model, diagnostics } = createV5RenderModel(next);
    expect(diagnostics).toEqual([]);
    expect(roadCellsOf(model).has("3,2")).toBe(true);
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
    const items = gameplayItemsOf(model);
    expect(items.some((i) => i.kind === "door" && i.door.id === "d-smoke" && i.door.position.x === 4.5)).toBe(true);
    const trap = items.find((i) => i.kind === "trap" && i.trap.id === "legacy-trap-0");
    expect(trap?.kind === "trap" ? trap.trap.position : null).toEqual({ x: 4.5, y: 1.5 });
    expect(labelItemsOf(model)).toEqual([]);
  });
});
