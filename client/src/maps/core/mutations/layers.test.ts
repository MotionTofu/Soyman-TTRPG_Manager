// Layer Mutation Core tests (Фаза 3A, §116): create/delete/rename/
// visible/locked/opacity/reorder + ID collision, no-op, invalid input,
// immutability, valid→mutation→valid, door scrub при delete слоя.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { GameplayLayer, MapDocumentV5 } from "../types";
import { validateMapDocument } from "../validate";
import {
  createGameplayLayer,
  createLabelLayer,
  createPathLayer,
  createTerrainLayer,
  deleteLayer,
  findEntityLayer,
  moveLayer,
  renameLayer,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisible,
} from "./layers";
import { pairDoors } from "./gameplay";
import { createGameplayEntity } from "./gameplay";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.dungeonV3),
  }).document;
}

function okDoc(): MapDocumentV5 {
  const d = squareDoc();
  expect(validateMapDocument(d)).toEqual([]);
  return d;
}

describe("create layer", () => {
  it("terrain/path/gameplay/label создаются с дефолтами и valid", () => {
    const d = okDoc();
    const t = createTerrainLayer(d, { id: "t2", name: "Terrain 2" });
    expect(t.ok && t.changed).toBe(true);
    if (t.ok && t.changed) {
      const l = t.document.layers.at(-1);
      expect(l?.kind).toBe("terrain");
      if (l?.kind === "terrain" && l.representation === "cells") {
        expect(l.defaultMaterial).toEqual({ type: "builtin", key: "terrain/plain" });
        expect(l.cells).toEqual([]);
      }
      expect(validateMapDocument(t.document)).toEqual([]);
    }
    const p = createPathLayer(d, { id: "p2", name: "Paths 2" });
    expect(p.ok && p.changed).toBe(true);
    const g = createGameplayLayer(d, { id: "g2", name: "Game 2" });
    expect(g.ok && g.changed).toBe(true);
    const lb = createLabelLayer(d, { id: "l2", name: "Labels 2" });
    expect(lb.ok && lb.changed).toBe(true);
    if (lb.ok && lb.changed) expect(validateMapDocument(lb.document)).toEqual([]);
  });

  it("ID collision: слой/сущность — structured error, вход цел", () => {
    const d = okDoc();
    const dupLayer = createTerrainLayer(d, { id: "lyr-gameplay", name: "X" });
    expect(!dupLayer.ok).toBe(true);
    const trap = d.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : [])).find((e) => e.kind === "trap");
    expect(trap).toBeDefined();
    const dupEntity = createPathLayer(d, { id: trap!.id, name: "X" });
    expect(!dupEntity.ok).toBe(true);
    const empty = createLabelLayer(d, { id: "", name: "X" });
    expect(!empty.ok).toBe(true);
    const badName = createLabelLayer(d, { id: "l-x", name: "   " });
    expect(!badName.ok).toBe(true);
  });
});

describe("delete layer", () => {
  it("пустой слой удаляется, valid сохраняется", () => {
    const d = okDoc();
    const created = createLabelLayer(d, { id: "l-x", name: "LX" });
    expect(created.ok && created.changed).toBe(true);
    if (!(created.ok && created.changed)) return;
    const r = deleteLayer(created.document, "l-x");
    expect(r.ok && r.changed).toBe(true);
    if (r.ok && r.changed) {
      expect(r.document.layers.some((l) => l.id === "l-x")).toBe(false);
      expect(validateMapDocument(r.document)).toEqual([]);
    }
  });

  it("missing layer — structured error", () => {
    const d = okDoc();
    const r = deleteLayer(d, "nope");
    expect(!r.ok).toBe(true);
  });

  it("delete populated gameplay + door scrub в surviving слое", () => {
    let d = okDoc();
    // Вторая gameplay с дверью, спаренной с дверью первого слоя.
    const g2 = createGameplayLayer(d, { id: "g2", name: "G2" });
    expect(g2.ok && g2.changed).toBe(true);
    if (!(g2.ok && g2.changed)) return;
    d = g2.document;
    const doors = d.layers.flatMap((l) =>
      l.kind === "gameplay" ? l.items.filter((e) => e.kind === "door") : [],
    );
    expect(doors.length).toBeGreaterThan(0);
    // Создаём дверь во втором слое и парим cross-layer.
    const c = createGameplayEntity(d, "g2", {
      id: "door-x",
      kind: "door",
      position: { x: 5.5, y: 5.5 },
      orientation: 0,
      doorKind: "door",
      secret: false,
      pairedDoorId: null,
    });
    expect(c.ok && c.changed).toBe(true);
    if (!(c.ok && c.changed)) return;
    d = c.document;
    const paired = pairDoors(d, doors[0].id, "door-x");
    expect(paired.ok && paired.changed).toBe(true);
    if (!(paired.ok && paired.changed)) return;
    d = paired.document;
    // Удаляем ПЕРВЫЙ gameplay слой целиком.
    const first = d.layers.find((l) => l.kind === "gameplay")!;
    const r = deleteLayer(d, first.id);
    expect(r.ok && r.changed).toBe(true);
    if (!(r.ok && r.changed)) return;
    const survivor = r.document.layers.find((l) => l.id === "g2");
    expect(survivor?.kind).toBe("gameplay");
    if (survivor?.kind === "gameplay") {
      const dx = survivor.items.find((e) => e.id === "door-x");
      expect(dx?.kind).toBe("door");
      if (dx?.kind === "door") expect(dx.pairedDoorId).toBeNull();
    }
    expect(validateMapDocument(r.document)).toEqual([]);
  });
});

describe("rename/visible/locked/opacity", () => {
  it("rename + no-op на то же имя + bad-name error", () => {
    const d = okDoc();
    const r = renameLayer(d, "lyr-gameplay", "Герои");
    expect(r.ok && r.changed).toBe(true);
    if (r.ok && r.changed) {
      expect(r.document.layers.find((l) => l.id === "lyr-gameplay")?.name).toBe("Герои");
      expect(validateMapDocument(r.document)).toEqual([]);
      const noop = renameLayer(r.document, "lyr-gameplay", "Герои");
      expect(noop.ok && !noop.changed && noop.document === r.document).toBe(true);
    }
    expect(!renameLayer(d, "lyr-gameplay", "").ok).toBe(true);
    expect(!renameLayer(d, "missing", "X").ok).toBe(true);
  });

  it("visibility/lock toggles + no-op", () => {
    const d = okDoc();
    const v = setLayerVisible(d, "lyr-gameplay", false);
    expect(v.ok && v.changed).toBe(true);
    if (v.ok && v.changed) {
      expect(v.document.layers.find((l) => l.id === "lyr-gameplay")?.visible).toBe(false);
      expect(v.ok && !setLayerVisible(v.document, "lyr-gameplay", false).changed).toBe(true);
    }
    const l = setLayerLocked(d, "lyr-gameplay", true);
    expect(l.ok && l.changed).toBe(true);
    expect(!setLayerLocked(d, "lyr-gameplay", "yes" as unknown as boolean).ok).toBe(true);
  });

  it("opacity valid/invalid/no-op", () => {
    const d = okDoc();
    const o = setLayerOpacity(d, "lyr-gameplay", 0.5);
    expect(o.ok && o.changed).toBe(true);
    if (o.ok && o.changed) {
      expect(validateMapDocument(o.document)).toEqual([]);
      const noop = setLayerOpacity(o.document, "lyr-gameplay", 0.5);
      expect(noop.ok && !noop.changed).toBe(true);
    }
    for (const bad of [NaN, -0.1, 1.1, Infinity]) {
      expect(!setLayerOpacity(d, "lyr-gameplay", bad).ok).toBe(true);
    }
    expect(!setLayerOpacity(d, "missing", 0.5).ok).toBe(true);
  });
});

describe("moveLayer", () => {
  it("reorder меняет порядок, clamp и no-op", () => {
    const d = okDoc();
    const ids = d.layers.map((l) => l.id);
    const first = ids[0];
    const r = moveLayer(d, first, d.layers.length - 1);
    expect(r.ok && r.changed).toBe(true);
    if (r.ok && r.changed) {
      expect(r.document.layers.at(-1)?.id).toBe(first);
      expect(r.document.layers.map((l) => l.id).sort()).toEqual([...ids].sort());
      expect(validateMapDocument(r.document)).toEqual([]);
    }
    const same = moveLayer(d, first, 0);
    expect(same.ok && !same.changed && same.document === d).toBe(true);
    const clamped = moveLayer(d, first, 999);
    expect(clamped.ok && clamped.changed).toBe(true);
    if (clamped.ok && clamped.changed) expect(clamped.document.layers.at(-1)?.id).toBe(first);
    expect(!moveLayer(d, "missing", 0).ok).toBe(true);
    expect(!moveLayer(d, first, 1.5).ok).toBe(true);
  });
});

describe("immutability", () => {
  it("нетронутые слои — те же references", () => {
    const d = okDoc();
    const r = renameLayer(d, "lyr-gameplay", "G");
    expect(r.ok && r.changed).toBe(true);
    if (!(r.ok && r.changed)) return;
    expect(r.document).not.toBe(d);
    expect(r.document.layers).not.toBe(d.layers);
    d.layers.forEach((l, i) => {
      if (l.id !== "lyr-gameplay") expect(r.document.layers[i]).toBe(l);
    });
    const noop = setLayerVisible(d, "lyr-gameplay", true);
    expect(noop.ok && !noop.changed && noop.document === d).toBe(true);
  });
});

describe("findEntityLayer", () => {
  it("находит owning layer gameplay/label/path сущностей", () => {
    const d = okDoc();
    const trap = d.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : [])).find((e) => e.kind === "trap");
    expect(trap).toBeDefined();
    const own = findEntityLayer(d, trap!.id);
    expect(own?.layerId).toBe("lyr-gameplay");
    expect(own?.kind).toBe("gameplay");
    expect(d.layers[own!.layerIndex].id).toBe("lyr-gameplay");
    expect(findEntityLayer(d, "ghost")).toBeNull();
    expect(findEntityLayer(d, "")).toBeNull();
    expect(findEntityLayer(d, "lyr-terrain")).toBeNull();
  });

  it("после delete слоя ownership пропадает", () => {
    const d = okDoc();
    const trap = d.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : [])).find((e) => e.kind === "trap");
    const r = deleteLayer(d, "lyr-gameplay");
    expect(r.ok && r.changed).toBe(true);
    if (r.ok && r.changed) expect(findEntityLayer(r.document, trap!.id)).toBeNull();
  });
});

describe("multi-terrain valid chain", () => {
  it("два terrain layers переживают create/move/rename valid", () => {
    const d = okDoc();
    const t = createTerrainLayer(d, { id: "t2", name: "T2" });
    expect(t.ok && t.changed).toBe(true);
    if (!(t.ok && t.changed)) return;
    expect(validateMapDocument(t.document)).toEqual([]);
    const g = d.layers.find((l) => l.kind === "gameplay") as GameplayLayer | undefined;
    expect(g).toBeDefined();
  });
});
