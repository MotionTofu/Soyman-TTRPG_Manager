// V5 hit-test tests: priority, shapes, overlap, tolerance, stability, hex.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import { deleteGameplayEntity } from "../mutations/gameplay";
import type { GameplayLayer, MapDocumentV5 } from "../types";
import { hitTestGameplay } from "./hitTest";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

// fullV4Square геометрия: rooms (2,0,2,2)+...; doors: legacy-door-0 (2.5,0,0°),
// door-1/2 paired locked (6.5?/7.5? e/w); trap (3.5,1.5); markers (5.5,5.5),(0.5,7.5);
// start (0.5,7.5)!! — marker-1 и start в одной клетке (0,7): overlap для priority.

describe("hitTest priority и виды", () => {
  it("door hit по центру плашки; мимо — null", () => {
    const doc = squareDoc();
    expect(hitTestGameplay(doc, { x: 2.5, y: 0 })).toEqual({ entityId: "legacy-door-0", kind: "door" });
    expect(hitTestGameplay(doc, { x: 2.5, y: 0.1 })).toEqual({ entityId: "legacy-door-0", kind: "door" });
    // Далеко за пределами плашки (0.36/0.17): комната? (2.5,0.5) — внутри room-0!
    expect(hitTestGameplay(doc, { x: 0.5, y: 5.5 })).toBeNull();
  });

  it("e-door: повёрнутый бокс", () => {
    const doc = squareDoc();
    // legacy-door-1: locked e в (6,6) → позиция (7,6.5), vertical.
    expect(hitTestGameplay(doc, { x: 7, y: 6.5 })).toEqual({ entityId: "legacy-door-1", kind: "door" });
    expect(hitTestGameplay(doc, { x: 7, y: 6.8 })).toEqual({ entityId: "legacy-door-1", kind: "door" });
    // Вбок от vertical-плашки — мимо двери (там room-1? (7.4,6.5): room-1 rect (6,6,2,1) → комната).
    expect(hitTestGameplay(doc, { x: 7.4, y: 6.5 })).toEqual({ entityId: "legacy-room-1", kind: "room" });
  });

  it("trap/marker/start/finish", () => {
    const doc = squareDoc();
    expect(hitTestGameplay(doc, { x: 3.5, y: 1.5 })).toEqual({ entityId: "legacy-trap-0", kind: "trap" });
    expect(hitTestGameplay(doc, { x: 5.5, y: 5.5 })).toEqual({ entityId: "legacy-marker-0", kind: "marker" });
    expect(hitTestGameplay(doc, { x: 7, y: 0.5 })).toEqual({ entityId: "legacy-finish", kind: "finish" });
  });

  it("priority: marker бьёт start в той же клетке (0,7)", () => {
    const doc = squareDoc();
    // marker-1 (city) и start оба в (0.5,7.5): marker rank 2 < start rank 3.
    expect(hitTestGameplay(doc, { x: 0.5, y: 7.5 })).toEqual({ entityId: "legacy-marker-1", kind: "marker" });
  });

  it("priority: trap бьёт room; door бьёт всё рядом", () => {
    const doc = squareDoc();
    // trap (3.5,1.5) внутри room-0 (2,0,2,2).
    expect(hitTestGameplay(doc, { x: 3.5, y: 1.5 })?.kind).toBe("trap");
    // door-0 (2.5,0): над room-0.
    expect(hitTestGameplay(doc, { x: 2.5, y: 0 })?.kind).toBe("door");
  });

  it("room containment + reverse (верхняя побеждает)", () => {
    const doc = squareDoc();
    expect(hitTestGameplay(doc, { x: 2.5, y: 1 })).toEqual({ entityId: "legacy-room-0", kind: "room" });
  });

  it("tolerance расширяет (точка вне комнат)", () => {
    const doc = squareDoc();
    // (4.2,1.5): вне room-0 (x>4), мимо trap без tolerance.
    expect(hitTestGameplay(doc, { x: 4.2, y: 1.5 })).toBeNull();
    expect(hitTestGameplay(doc, { x: 4.2, y: 1.5 }, 0.5)).toEqual({
      entityId: "legacy-trap-0",
      kind: "trap",
    });
  });

  it("битая точка → null", () => {
    const doc = squareDoc();
    expect(hitTestGameplay(doc, { x: NaN, y: 0 })).toBeNull();
    expect(hitTestGameplay(doc, null as never)).toBeNull();
  });
});

describe("hitTest shapes", () => {
  function roomDoc(): MapDocumentV5 {
    const doc = squareDoc();
    const g = doc.layers.find((l) => l.id === "lyr-gameplay");
    if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
    const items: GameplayLayer["items"] = [
      {
        id: "room-ellipse",
        kind: "room",
        geometry: { type: "ellipse", center: { x: 5, y: 5 }, rx: 2, ry: 1 },
        roomType: "lab",
        name: "",
      },
      {
        id: "room-poly",
        kind: "room",
        geometry: {
          type: "polygon",
          points: [
            { x: 0, y: 4 },
            { x: 2, y: 4 },
            { x: 1, y: 6 },
          ],
        },
        roomType: "lab",
        name: "",
      },
    ];
    return {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "lyr-gameplay" && l.kind === "gameplay" ? { ...l, items } : l)),
    };
  }

  it("ellipse и polygon", () => {
    const doc = roomDoc();
    expect(hitTestGameplay(doc, { x: 5, y: 5 })).toEqual({ entityId: "room-ellipse", kind: "room" });
    expect(hitTestGameplay(doc, { x: 5 + 2.1, y: 5 })).toBeNull();
    expect(hitTestGameplay(doc, { x: 1, y: 5 })).toEqual({ entityId: "room-poly", kind: "room" });
    expect(hitTestGameplay(doc, { x: 0.1, y: 5.9 })).toBeNull();
  });
});

describe("hitTest stability", () => {
  it("stable ID после удаления sibling", () => {
    const doc = squareDoc();
    // Выбрана marker-1 (city в 0,7). Удаляем marker-0.
    const sel = hitTestGameplay(doc, { x: 0.5, y: 7.5 });
    expect(sel?.entityId).toBe("legacy-marker-1");
    const r = deleteGameplayEntity(doc, "legacy-marker-0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hitTestGameplay(r.document, { x: 0.5, y: 7.5 })?.entityId).toBe("legacy-marker-1");
  });

  it("stable ID после reorder", () => {
    const doc = squareDoc();
    const g = doc.layers.find((l) => l.id === "lyr-gameplay");
    if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
    const reordered: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === "lyr-gameplay" && l.kind === "gameplay" ? { ...l, items: [...l.items].reverse() } : l,
      ),
    };
    // Дверь всё ещё бьётся по ID (приоритет door держится).
    expect(hitTestGameplay(reordered, { x: 2.5, y: 0 })).toEqual({
      entityId: "legacy-door-0",
      kind: "door",
    });
    // Комната: порядок — render semantics, верхняя теперь room-1;
    // identity резолвится по ID, без путаницы индексов.
    const hit = hitTestGameplay(reordered, { x: 6.5, y: 6.5 });
    expect(hit?.entityId).toBe("legacy-room-1");
  });

  it("hex позиции", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 6,
      height: 6,
      cells: parseFixture(FIXTURES.fullV4Hex),
    }).document;
    // fullV4Hex: trap (1,2) gas; marker village (5,1); label; start (0,0).
    const g = hexDoc.layers.find((l) => l.id === "lyr-gameplay");
    if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
    const trap = g.items.find((e) => e.kind === "trap");
    if (!trap || trap.kind !== "trap") throw new Error("no trap");
    expect(hitTestGameplay(hexDoc, { x: trap.position.x, y: trap.position.y })).toEqual({
      entityId: trap.id,
      kind: "trap",
    });
  });

  it("вход не мутируется", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    hitTestGameplay(doc, { x: 2.5, y: 0 });
    hitTestGameplay(doc, { x: 0.5, y: 7.5 }, 1);
    expect(doc).toEqual(before);
  });
});
