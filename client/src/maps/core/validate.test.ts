// Negative validation tests (§50 ТЗ): каждая поломка даёт ошибку валидатора.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import type { MapDocumentV5 } from "./types";
import { validateMapDocument } from "./validate";

function base(): MapDocumentV5 {
  const { document } = migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  });
  return structuredClone(document);
}

function codes(doc: MapDocumentV5): string[] {
  return validateMapDocument(doc).map((i) => i.code);
}

function expectBad(mut: (d: MapDocumentV5) => void, codePart: string) {
  const d = base();
  mut(d);
  const found = codes(d);
  expect(found.some((c) => c.includes(codePart))).toBe(true);
}

function gameplay0(d: MapDocumentV5) {
  const g = d.layers.find((l) => l.id === "lyr-gameplay");
  if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
  return g;
}

describe("validate: negative", () => {
  it("валидный документ — ноль ошибок", () => {
    expect(validateMapDocument(base())).toEqual([]);
  });

  it("duplicate layer ID", () => {
    expectBad((d) => {
      d.layers[1].id = "lyr-terrain";
    }, "id.duplicate");
  });

  it("duplicate entity ID across layers (obj + door)", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const door = g.items.find((e) => e.kind === "door");
      if (door) door.id = "legacy-room-0";
    }, "id.duplicate");
  });

  it("NaN coordinate", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const door = g.items.find((e) => e.kind === "door");
      if (door && door.kind === "door") door.position.x = NaN;
    }, "vec2");
  });

  it("Infinity opacity", () => {
    expectBad((d) => {
      d.layers[0].opacity = Infinity;
    }, "layer.bad-opacity");
  });

  it("bad world bounds (maxX <= minX)", () => {
    expectBad((d) => {
      d.world.bounds.maxX = d.world.bounds.minX;
    }, "world.bad-bounds");
  });

  it("bad grid (columns 0)", () => {
    expectBad((d) => {
      if (d.grid) d.grid.columns = 0;
    }, "grid.bad-dims");
  });

  it("cell terrain without grid", () => {
    expectBad((d) => {
      d.grid = null;
    }, "terrain.cells.no-grid");
  });

  it("cell outside grid", () => {
    expectBad((d) => {
      const t = d.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") {
        t.cells.push({ x: 99, y: 0, material: { type: "builtin", key: "terrain/forest" } });
      }
    }, "terrain.cells.out-of-grid");
  });

  it("duplicate terrain coordinate", () => {
    expectBad((d) => {
      const t = d.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") {
        t.cells.push({ ...t.cells[0] });
      }
    }, "terrain.cells.duplicate");
  });

  it("cell-network without grid", () => {
    expectBad((d) => {
      d.grid = null;
      const r = d.layers.find((l) => l.id === "lyr-road");
      if (r && r.kind === "path") r.paths = r.paths.filter((p) => p.geometry.type === "cell-network");
    }, "path.cell-network.no-grid");
  });

  it("duplicate path cell", () => {
    expectBad((d) => {
      const r = d.layers.find((l) => l.id === "lyr-road");
      if (r && r.kind === "path") {
        const p = r.paths[0];
        if (p.geometry.type === "cell-network") p.geometry.cells.push({ ...p.geometry.cells[0] });
      }
    }, "path.cell-network.duplicate");
  });

  it("path width <= 0", () => {
    expectBad((d) => {
      const r = d.layers.find((l) => l.id === "lyr-road");
      if (r && r.kind === "path") r.paths[0].width = 0;
    }, "path.bad-width");
  });

  it("zero object scale", () => {
    const d = base();
    d.layers[3] = {
      ...d.layers[3],
      kind: "object",
      items: [
        {
          id: "obj-1",
          transform: { position: { x: 1, y: 1 }, rotation: 0, scale: { x: 0, y: 1 } },
          visual: { type: "builtin", key: "chest" },
        },
      ],
    } as MapDocumentV5["layers"][number];
    expect(codes(d).some((c) => c.includes("object.bad-scale"))).toBe(true);
  });

  it("invalid shape (rect w 0)", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const room = g.items.find((e) => e.kind === "room");
      if (room && room.kind === "room" && room.geometry.type === "rect") room.geometry.w = 0;
    }, "shape.bad-rect");
  });

  it("broken pairedDoorId (missing target)", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const door = g.items.find((e) => e.kind === "door");
      if (door && door.kind === "door") door.pairedDoorId = "no-such-door";
    }, "door.pair-missing");
  });

  it("asymmetric door pair", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const doors = g.items.filter((e) => e.kind === "door");
      // legacy-door-1 ↔ legacy-door-2 в фикстуре; ломаем одну сторону
      const second = doors.find((e) => e.id === "legacy-door-2");
      if (second && second.kind === "door") second.pairedDoorId = null;
    }, "door.pair-asymmetric");
  });

  it("self pair", () => {
    expectBad((d) => {
      const g = gameplay0(d);
      const door = g.items.find((e) => e.kind === "door");
      if (door && door.kind === "door") door.pairedDoorId = door.id;
    }, "door.self-pair");
  });

  it("bad resource ref (builtin без key)", () => {
    expectBad((d) => {
      const t = d.layers[0];
      if (t.kind === "terrain" && t.representation === "cells") {
        t.cells[0].material = { type: "builtin" } as unknown as { type: "builtin"; key: string };
      }
    }, "terrain.cells.bad-material");
  });

  it("invalid JSON property (function)", () => {
    expectBad((d) => {
      const r = d.layers.find((l) => l.id === "lyr-road");
      if (r && r.kind === "path") {
        (r.paths[0] as unknown as Record<string, unknown>).properties = { fn: () => 1 };
      }
    }, "path.bad-properties");
  });

  it("mask sampleSize <= 0", () => {
    const d = base();
    d.layers[0] = {
      ...d.layers[0],
      kind: "terrain",
      representation: "mask",
      mask: {
        origin: { x: 0, y: 0 },
        sampleSize: 0,
        materials: [{ type: "builtin", key: "terrain/plain" }],
        chunks: [],
      },
      cells: undefined,
    } as unknown as MapDocumentV5["layers"][number];
    expect(codes(d).some((c) => c.includes("terrain.mask.bad-sample-size"))).toBe(true);
  });

  it("duplicate mask chunk ID", () => {
    const d = base();
    d.layers[0] = {
      ...d.layers[0],
      kind: "terrain",
      representation: "mask",
      mask: {
        origin: { x: 0, y: 0 },
        sampleSize: 0.125,
        materials: [{ type: "builtin", key: "terrain/plain" }],
        chunks: [
          { id: "ch-1", cx: 0, cy: 0, payload: {} },
          { id: "ch-1", cx: 1, cy: 0, payload: {} },
        ],
      },
      cells: undefined,
    } as unknown as MapDocumentV5["layers"][number];
    expect(codes(d).some((c) => c.includes("id.duplicate"))).toBe(true);
  });

  it("ноль terrain layers", () => {
    expectBad((d) => {
      d.layers = d.layers.filter((l) => l.kind !== "terrain");
    }, "terrain.count");
  });

  it("spline с одной node", () => {
    const d = base();
    const r = d.layers.find((l) => l.id === "lyr-road");
    if (r && r.kind === "path") {
      r.paths.push({
        id: "bad-spline",
        kind: "route",
        geometry: { type: "spline", nodes: [{ position: { x: 1, y: 1 } }] },
        width: 1,
        styleRef: { type: "builtin", key: "route" },
      });
    }
    expect(codes(d).some((c) => c.includes("path.spline.too-few-nodes"))).toBe(true);
  });

  it("пустой label text", () => {
    expectBad((d) => {
      const l = d.layers.find((x) => x.id === "lyr-labels");
      if (l && l.kind === "label") l.items.push({ id: "lbl-x", position: { x: 0, y: 0 }, text: "   " });
    }, "label.bad-text");
  });
});
