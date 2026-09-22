// Gameplay CRUD/move/pairs/setStart tests + validity property.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type {
  GameplayDoor,
  GameplayEntity,
  GameplayLayer,
  MapDocumentV5,
} from "../types";
import { validateMapDocument } from "../validate";
import { createGameplayLayer } from "./layers";
import type { MutationResult } from "./types";
import {
  createGameplayEntity,
  deleteGameplayEntity,
  moveGameplayEntity,
  pairDoors,
  setFinish,
  setStart,
  unpairDoor,
  updateGameplayEntity,
} from "./gameplay";

const LAYER = "lyr-gameplay";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function gameplay(doc: MapDocumentV5): GameplayLayer {
  const g = doc.layers.find((l) => l.id === LAYER);
  if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
  return g;
}

function door(doc: MapDocumentV5, id: string): GameplayDoor {
  const e = gameplay(doc).items.find((x) => x.id === id);
  if (!e || e.kind !== "door") throw new Error(`no door ${id}`);
  return e;
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

describe("gameplay create", () => {
  it("все 6 kinds создаются", () => {
    const entities: GameplayEntity[] = [
      { id: "r-new", kind: "room", geometry: { type: "rect", x: 0, y: 0, w: 1, h: 1 }, roomType: "lab", name: "L" },
      { id: "d-new", kind: "door", position: { x: 1.5, y: 1 }, orientation: 0, doorKind: "arch", secret: false, pairedDoorId: null },
      { id: "t-new", kind: "trap", position: { x: 1, y: 1 }, trapKind: "glyph" },
      { id: "m-new", kind: "marker", position: { x: 2, y: 2 }, markerKind: "obelisk" },
      { id: "s-new", kind: "start", position: { x: 3, y: 3 } },
      { id: "f-new", kind: "finish", position: { x: 4, y: 4 } },
    ];
    let doc = squareDoc();
    for (const e of entities) {
      const r = createGameplayEntity(doc, LAYER, e);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("create failed");
      expect(r.entityId).toBe(e.id);
      doc = r.document;
      expect(validateMapDocument(doc)).toEqual([]);
    }
    expect(gameplay(doc).items.length).toBeGreaterThan(entities.length);
  });

  it("duplicate ID (включая cross-layer с label) → error; пара при create → error", () => {
    const doc = squareDoc();
    const dup: GameplayEntity = {
      id: "legacy-room-0",
      kind: "trap",
      position: { x: 0, y: 0 },
      trapKind: "pit",
    };
    expectErr(createGameplayEntity(doc, LAYER, dup), "duplicate-id");
    const cross: GameplayEntity = {
      id: "legacy-label-0",
      kind: "trap",
      position: { x: 0, y: 0 },
      trapKind: "pit",
    };
    expectErr(createGameplayEntity(doc, LAYER, cross), "duplicate-id");
    const paired: GameplayEntity = {
      id: "d-x",
      kind: "door",
      position: { x: 0, y: 0 },
      orientation: 0,
      doorKind: "door",
      secret: false,
      pairedDoorId: "legacy-door-0",
    };
    expectErr(createGameplayEntity(doc, LAYER, paired), "pair-on-create");
    expectErr(createGameplayEntity(doc, "lyr-road", paired), "wrong-layer-kind");
  });
});

describe("gameplay update", () => {
  it("rename room; no-op; immutable id/kind/pair; unknown → error", () => {
    const doc = squareDoc();
    const renamed = expectOk(
      updateGameplayEntity(doc, "legacy-room-0", (e) =>
        e.kind === "room" ? { ...e, name: "Новое" } : e,
      ),
    );
    const room = gameplay(renamed).items.find((x) => x.id === "legacy-room-0");
    expect(room && room.kind === "room" && room.name).toBe("Новое");

    const same = updateGameplayEntity(renamed, "legacy-room-0", (e) => ({ ...e }));
    expect(same.ok && !same.changed && same.document === renamed).toBe(true);

    expectErr(
      updateGameplayEntity(doc, "legacy-room-0", (e) => ({ ...e, id: "other" })),
      "id-immutable",
    );
    expectErr(
      updateGameplayEntity(doc, "legacy-door-1", (e) =>
        e.kind === "door" ? { ...e, pairedDoorId: null } : e,
      ),
      "pair-immutable",
    );
    expectErr(updateGameplayEntity(doc, "nope", (e) => e), "unknown-id");
  });
});

describe("gameplay delete/move", () => {
  it("delete room; missing → no-op same ref", () => {
    const doc = squareDoc();
    const n0 = gameplay(doc).items.length;
    const next = expectOk(deleteGameplayEntity(doc, "legacy-room-1"));
    expect(gameplay(next).items.length).toBe(n0 - 1);
    const r = deleteGameplayEntity(next, "legacy-room-1");
    expect(r.ok && !r.changed && r.document === next).toBe(true);
  });

  it("delete двери чистит пару у партнёра", () => {
    const doc = squareDoc();
    expect(door(doc, "legacy-door-1").pairedDoorId).toBe("legacy-door-2");
    const next = expectOk(deleteGameplayEntity(doc, "legacy-door-1"));
    expect(gameplay(next).items.some((e) => e.id === "legacy-door-1")).toBe(false);
    expect(door(next, "legacy-door-2").pairedDoorId).toBeNull();
  });

  it("move trap/room (rect/polygon/ellipse); zero → no-op; missing → error", () => {
    const doc = squareDoc();
    const moved = expectOk(moveGameplayEntity(doc, "legacy-trap-0", { x: 1, y: -1 }));
    const trap = gameplay(moved).items.find((e) => e.id === "legacy-trap-0");
    expect(trap && trap.kind === "trap" && trap.position).toEqual({ x: 4.5, y: 0.5 });

    const zero = moveGameplayEntity(moved, "legacy-trap-0", { x: 0, y: 0 });
    expect(zero.ok && !zero.changed).toBe(true);
    expectErr(moveGameplayEntity(doc, "nope", { x: 1, y: 0 }), "unknown-id");
    expectErr(moveGameplayEntity(doc, "legacy-trap-0", { x: NaN, y: 0 }), "bad-delta");

    // Room shapes.
    const poly: GameplayEntity = {
      id: "poly",
      kind: "room",
      geometry: {
        type: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 2 },
        ],
      },
      roomType: "lab",
      name: "",
    };
    const withPoly = expectOk(createGameplayEntity(doc, LAYER, poly));
    const movedPoly = expectOk(moveGameplayEntity(withPoly, "poly", { x: 1, y: 1 }));
    const got = gameplay(movedPoly).items.find((e) => e.id === "poly");
    expect(got && got.kind === "room" && got.geometry).toEqual({
      type: "polygon",
      points: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 2, y: 3 },
      ],
    });

    const ell: GameplayEntity = {
      id: "ell",
      kind: "room",
      geometry: { type: "ellipse", center: { x: 1, y: 1 }, rx: 2, ry: 1 },
      roomType: "lab",
      name: "",
    };
    const withEll = expectOk(createGameplayEntity(doc, LAYER, ell));
    const movedEll = expectOk(moveGameplayEntity(withEll, "ell", { x: -1, y: 2 }));
    const gotEll = gameplay(movedEll).items.find((e) => e.id === "ell");
    expect(gotEll && gotEll.kind === "room" && gotEll.geometry).toEqual({
      type: "ellipse",
      center: { x: 0, y: 3 },
      rx: 2,
      ry: 1,
    });

    const rectMoved = expectOk(moveGameplayEntity(doc, "legacy-room-0", { x: 1, y: 1 }));
    const gotRect = gameplay(rectMoved).items.find((e) => e.id === "legacy-room-0");
    expect(gotRect && gotRect.kind === "room" && gotRect.geometry).toEqual({
      type: "rect",
      x: 3,
      y: 1,
      w: 2,
      h: 2,
    });
  });

  it("move сохраняет properties", () => {
    const doc = squareDoc();
    const trap: GameplayEntity = {
      id: "t-props",
      kind: "trap",
      position: { x: 0, y: 0 },
      trapKind: "pit",
      properties: { note: "hi" },
    } as GameplayEntity;
    const created = expectOk(createGameplayEntity(doc, LAYER, trap));
    const moved = expectOk(moveGameplayEntity(created, "t-props", { x: 1, y: 0 }));
    const got = gameplay(moved).items.find((e) => e.id === "t-props");
    expect(got && (got as { properties?: unknown }).properties).toEqual({ note: "hi" });
  });
});

describe("door pairs", () => {
  it("pair двух unpaired; уже связанные → no-op", () => {
    const doc = squareDoc();
    const next = expectOk(pairDoors(doc, "legacy-door-0", "legacy-door-4"));
    expect(door(next, "legacy-door-0").pairedDoorId).toBe("legacy-door-4");
    expect(door(next, "legacy-door-4").pairedDoorId).toBe("legacy-door-0");
    const same = pairDoors(next, "legacy-door-0", "legacy-door-4");
    expect(same.ok && !same.changed).toBe(true);
  });

  it("re-pair разрывает старые пары", () => {
    const doc = squareDoc();
    // door-1 ↔ door-2 (gate). Связываем door-0 ↔ door-1.
    const next = expectOk(pairDoors(doc, "legacy-door-0", "legacy-door-1"));
    expect(door(next, "legacy-door-0").pairedDoorId).toBe("legacy-door-1");
    expect(door(next, "legacy-door-1").pairedDoorId).toBe("legacy-door-0");
    expect(door(next, "legacy-door-2").pairedDoorId).toBeNull();
  });

  it("self/missing/non-door → error", () => {
    const doc = squareDoc();
    expectErr(pairDoors(doc, "legacy-door-0", "legacy-door-0"), "self-pair");
    expectErr(pairDoors(doc, "legacy-door-0", "nope"), "unknown-id");
    expectErr(pairDoors(doc, "legacy-door-0", "legacy-trap-0"), "wrong-entity-kind");
    expectErr(unpairDoor(doc, "legacy-trap-0"), "wrong-entity-kind");
  });

  it("unpair обеих сторон; уже без пары → no-op", () => {
    const doc = squareDoc();
    const next = expectOk(unpairDoor(doc, "legacy-door-1"));
    expect(door(next, "legacy-door-1").pairedDoorId).toBeNull();
    expect(door(next, "legacy-door-2").pairedDoorId).toBeNull();
    const same = unpairDoor(next, "legacy-door-1");
    expect(same.ok && !same.changed).toBe(true);
  });
});

describe("setStart/setFinish", () => {
  it("заменяет синглтон; same → no-op; ошибки", () => {
    const doc = squareDoc();
    const next = expectOk(setStart(doc, LAYER, { id: "start-new", position: { x: 1, y: 1 } }));
    const starts = gameplay(next).items.filter((e) => e.kind === "start");
    expect(starts).toHaveLength(1);
    expect(starts[0].id).toBe("start-new");

    const same = setStart(next, LAYER, { id: "start-new", position: { x: 1, y: 1 } });
    expect(same.ok && !same.changed).toBe(true);

    const fin = expectOk(setFinish(next, LAYER, { id: "fin-new", position: { x: 2, y: 2 } }));
    expect(gameplay(fin).items.filter((e) => e.kind === "finish")).toHaveLength(1);

    expectErr(setStart(doc, LAYER, { id: "legacy-room-0", position: { x: 0, y: 0 } }), "duplicate-id");
    expectErr(setStart(doc, LAYER, { id: "x", position: { x: NaN, y: 0 } }), "bad-position");
    expectErr(setStart(doc, "lyr-road", { id: "x", position: { x: 0, y: 0 } }), "wrong-layer-kind");
  });

  it("3A §43: start в другом слое удаляется, новый — в target", () => {
    const doc = squareDoc();
    const g2 = createGameplayLayer(doc, { id: "g2", name: "G2" });
    expect(g2.ok && g2.changed).toBe(true);
    if (!(g2.ok && g2.changed)) return;
    const next = expectOk(setStart(g2.document, "g2", { id: "start-b", position: { x: 3, y: 3 } }));
    const allStarts = next.layers.flatMap((l) =>
      l.kind === "gameplay" ? l.items.filter((e) => e.kind === "start") : [],
    );
    expect(allStarts).toHaveLength(1);
    expect(allStarts[0].id).toBe("start-b");
    const g2layer = next.layers.find((l) => l.id === "g2");
    expect(g2layer?.kind === "gameplay" && g2layer.items.some((e) => e.id === "start-b")).toBe(true);
    expect(validateMapDocument(next)).toEqual([]);
  });
});

describe("immutability", () => {
  it("failed mutation не мутирует вход", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    expectErr(pairDoors(doc, "legacy-door-0", "legacy-door-0"), "self-pair");
    expectErr(createGameplayEntity(doc, LAYER, {
      id: "legacy-room-0",
      kind: "trap",
      position: { x: 0, y: 0 },
      trapKind: "pit",
    }), "duplicate-id");
    expect(doc).toEqual(before);
  });
});
