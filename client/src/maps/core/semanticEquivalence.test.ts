// Comparator tests (§48–51 ТЗ): мутации по одному полю, порядок, hex,
// отсутствие side effects. Доказывают независимость checker от migration.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import {
  compareLegacySemantics,
  type LegacyAuditInput,
} from "./semanticEquivalence";
import type {
  GameplayDoor,
  GameplayLayer,
  GameplayRoom,
  MapDocumentV5,
} from "./types";

function args(raw: string, width = 8, height = 8, grid: "square" | "hex" = "square"): LegacyAuditInput {
  return { grid, width, height, cells: parseFixture(raw) };
}

function migrated(a: LegacyAuditInput): MapDocumentV5 {
  return migrateLegacyMap({ grid: a.grid, width: a.width, height: a.height, cells: a.cells }).document;
}

function codes(a: LegacyAuditInput, doc: MapDocumentV5): string[] {
  return compareLegacySemantics(a, doc).map((i) => i.code);
}

function gameplay(doc: MapDocumentV5): GameplayLayer {
  const g = doc.layers.find((l) => l.id === "lyr-gameplay");
  if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
  return g;
}

describe("comparator: чистая миграция эквивалентна", () => {
  it("square full/dungeon/labels/empty → []", () => {
    for (const raw of [FIXTURES.fullV4Square, FIXTURES.dungeonV3, FIXTURES.labelsV2, FIXTURES.emptyV1, FIXTURES.pathsV4]) {
      const a = args(raw);
      expect(compareLegacySemantics(a, migrated(a))).toEqual([]);
    }
  });

  it("hex full → []", () => {
    const a = args(FIXTURES.fullV4Hex, 6, 6, "hex");
    expect(compareLegacySemantics(a, migrated(a))).toEqual([]);
  });

  it("пары (2/1/5) → [] (warning не mismatch)", () => {
    for (const raw of [FIXTURES.pair, FIXTURES.pairSingle, FIXTURES.pairBig]) {
      const a = args(raw);
      expect(compareLegacySemantics(a, migrated(a))).toEqual([]);
    }
  });
});

describe("comparator: mutation tests", () => {
  function tampered(raw: string, mut: (d: MapDocumentV5) => void): { a: LegacyAuditInput; d: MapDocumentV5 } {
    const a = args(raw);
    const d = migrated(a);
    mut(d);
    return { a, d };
  }

  it("удалили terrain cell → terrain-missing", () => {
    const { a, d } = tampered(FIXTURES.fullV4Square, (doc) => {
      const t = doc.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") t.cells.shift();
    });
    expect(codes(a, d)).toContain("terrain-missing");
  });

  it("добавили terrain cell → terrain-extra", () => {
    const { a, d } = tampered(FIXTURES.fullV4Square, (doc) => {
      const t = doc.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") {
        t.cells.push({ x: 7, y: 7, material: { type: "builtin", key: "terrain/lava" } });
      }
    });
    expect(codes(a, d)).toContain("terrain-extra");
  });

  it("сменили terrain material → terrain-material-mismatch", () => {
    const { a, d } = tampered(FIXTURES.fullV4Square, (doc) => {
      const t = doc.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") {
        t.cells[0].material = { type: "builtin", key: "terrain/lava" };
      }
    });
    expect(codes(a, d)).toContain("terrain-material-mismatch");
  });

  it("удалили road cell → road-cell-missing", () => {
    const { a, d } = tampered(FIXTURES.fullV4Square, (doc) => {
      const r = doc.layers.find((l) => l.id === "lyr-road");
      if (r && r.kind === "path") {
        const p = r.paths[0];
        if (p.geometry.type === "cell-network") p.geometry.cells.pop();
      }
    });
    expect(codes(a, d)).toContain("road-cell-missing");
  });

  it("добавили river cell → river-cell-extra", () => {
    const { a, d } = tampered(FIXTURES.fullV4Square, (doc) => {
      const r = doc.layers.find((l) => l.id === "lyr-river");
      if (r && r.kind === "path") {
        const p = r.paths[0];
        if (p.geometry.type === "cell-network") p.geometry.cells.push({ x: 0, y: 0 });
      }
    });
    expect(codes(a, d)).toContain("river-cell-extra");
  });

  it("сдвинули label → label-position-mismatch", () => {
    const { a, d } = tampered(FIXTURES.labelsV2, (doc) => {
      const l = doc.layers.find((x) => x.id === "lyr-labels");
      if (l && l.kind === "label") l.items[0].position.x += 0.5;
    });
    expect(codes(a, d)).toContain("label-position-mismatch");
  });

  it("сменили room type → room-type-mismatch", () => {
    const { a, d } = tampered(FIXTURES.dungeonV3, (doc) => {
      const room = gameplay(doc).items.find((e): e is GameplayRoom => e.kind === "room");
      if (room) room.roomType = "lab";
    });
    expect(codes(a, d)).toContain("room-type-mismatch");
  });

  it("сдвинули door → door-position-mismatch", () => {
    const { a, d } = tampered(FIXTURES.dungeonV3, (doc) => {
      const door = gameplay(doc).items.find((e): e is GameplayDoor => e.kind === "door");
      if (door) door.position.x += 1;
    });
    expect(codes(a, d)).toContain("door-position-mismatch");
  });

  it("сломали door pair → door-pair-mismatch", () => {
    const { a, d } = tampered(FIXTURES.pair, (doc) => {
      const door = gameplay(doc).items.find((e): e is GameplayDoor => e.kind === "door");
      if (door) door.pairedDoorId = null;
    });
    expect(codes(a, d)).toContain("door-pair-mismatch");
  });

  it("сменили trap kind → trap-kind-mismatch", () => {
    const { a, d } = tampered(FIXTURES.dungeonV3, (doc) => {
      const trap = gameplay(doc).items.find((e) => e.kind === "trap");
      if (trap && trap.kind === "trap") trap.trapKind = "gas";
    });
    expect(codes(a, d)).toContain("trap-kind-mismatch");
  });

  it("добавили marker → marker-count-mismatch", () => {
    const { a, d } = tampered(FIXTURES.dungeonV3, (doc) => {
      gameplay(doc).items.push({ id: "legacy-marker-0", kind: "marker", position: { x: 1, y: 1 }, markerKind: "chest" });
    });
    expect(codes(a, d)).toContain("marker-count-mismatch");
  });

  it("удалили start → start-count-mismatch", () => {
    const { a, d } = tampered(FIXTURES.dungeonV3, (doc) => {
      const g = gameplay(doc);
      g.items = g.items.filter((e) => e.kind !== "start");
    });
    expect(codes(a, d)).toContain("start-count-mismatch");
  });

  it("добавили лишний finish → finish-extra", () => {
    const { a, d } = tampered(FIXTURES.emptyV1, (doc) => {
      gameplay(doc).items.push({ id: "legacy-finish", kind: "finish", position: { x: 1, y: 1 } });
    });
    expect(codes(a, d)).toContain("finish-extra");
  });
});

describe("comparator: layer/order", () => {
  it("river/road переставлены → layer-id-mismatch", () => {
    const a = args(FIXTURES.fullV4Square);
    const d = migrated(a);
    [d.layers[1], d.layers[2]] = [d.layers[2], d.layers[1]];
    expect(codes(a, d)).toContain("layer-id-mismatch");
  });

  it("label/gameplay переставлены → layer-id-mismatch", () => {
    const a = args(FIXTURES.fullV4Square);
    const d = migrated(a);
    [d.layers[5], d.layers[6]] = [d.layers[6], d.layers[5]];
    expect(codes(a, d)).toContain("layer-id-mismatch");
  });

  it("trap перед door → gameplay-order-mismatch", () => {
    const a = args(FIXTURES.fullV4Square);
    const d = migrated(a);
    const g = gameplay(d);
    const doorIdx = g.items.findIndex((e) => e.kind === "door");
    const trapIdx = g.items.findIndex((e) => e.kind === "trap");
    [g.items[doorIdx], g.items[trapIdx]] = [g.items[trapIdx], g.items[doorIdx]];
    expect(codes(a, d)).toContain("gameplay-order-mismatch");
  });
});

describe("comparator: hex без square assumption", () => {
  it("сдвинутая hex label ловится", () => {
    const a = args(FIXTURES.fullV4Hex, 6, 6, "hex");
    const d = migrated(a);
    const l = d.layers.find((x) => x.id === "lyr-labels");
    if (l && l.kind === "label") l.items[0].position.x += 0.5;
    expect(codes(a, d)).toContain("label-position-mismatch");
  });

  it("испорченные hex bounds ловятся", () => {
    const a = args(FIXTURES.fullV4Hex, 6, 6, "hex");
    const d = migrated(a);
    d.world.bounds.maxX += 1;
    expect(codes(a, d)).toContain("grid-bounds-mismatch");
  });

  it("hex trap/marker/start позиции сверены с cellCenter", () => {
    const a = args(FIXTURES.fullV4Hex, 6, 6, "hex");
    const d = migrated(a);
    const g = gameplay(d);
    const trap = g.items.find((e) => e.kind === "trap");
    if (trap && trap.kind === "trap") trap.position.y += 0.001;
    expect(codes(a, d)).toContain("trap-position-mismatch");
  });
});

describe("comparator: no side effects", () => {
  it("входы deep-equal до/после", () => {
    const a = args(FIXTURES.fullV4Square);
    const d = migrated(a);
    const aBefore = structuredClone({ grid: a.grid, width: a.width, height: a.height, cells: a.cells });
    const dBefore = structuredClone(d);
    compareLegacySemantics(a, d);
    expect({ grid: a.grid, width: a.width, height: a.height, cells: a.cells }).toEqual(aBefore);
    expect(d).toEqual(dBefore);
  });
});
