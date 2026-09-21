// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  deleteSelectedFromDocument,
  moveSelectedInDocument,
  useMapSelection,
} from "./useMapSelection";
import { FIXTURES, parseFixture } from "../../core/fixtures";
import { migrateLegacyMap } from "../../core/migrateLegacy";
import type { MapDocumentV5 } from "../../core/types";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

const GEOM = { grid: "square" as const, width: 8, height: 8 };

function setup(doc: MapDocumentV5) {
  const documentRef = { current: doc as MapDocumentV5 | null };
  const setDocument = vi.fn((d: MapDocumentV5) => {
    documentRef.current = d;
  });
  const commitDocument = vi.fn();
  const utils = renderHook(
    (p: { document: MapDocumentV5 | null }) =>
      useMapSelection({ document: p.document, documentRef, setDocument, commitDocument }),
    { initialProps: { document: doc } },
  );
  return { ...utils, documentRef, setDocument, commitDocument };
}

describe("useMapSelection (V5 stable IDs)", () => {
  it("select хранит entityId, а не индекс", () => {
    const h = setup(squareDoc());
    act(() => {
      h.result.current.select({ entityId: "legacy-trap-0", kind: "trap" });
    });
    expect(h.result.current.selected).toEqual({ entityId: "legacy-trap-0", kind: "trap" });
  });

  it("select C + delete B: C резолвится тем же ID (hitAt после чужой правки)", () => {
    const h = setup(squareDoc());
    act(() => {
      h.result.current.select({ entityId: "legacy-marker-1", kind: "marker" });
    });
    expect(h.result.current.selected?.entityId).toBe("legacy-marker-1");
    // Внешнее удаление sibling + замена документа: hitAt той же точки
    // возвращает тот же EntityId (индексы бы съехали).
    const doc = h.documentRef.current!;
    const g = doc.layers.find((l) => l.id === "lyr-gameplay");
    const next: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.kind === "gameplay" && l.id === "lyr-gameplay"
          ? { ...l, items: l.items.filter((e) => e.id !== "legacy-marker-0") }
          : l,
      ),
    };
    expect(g && g.kind === "gameplay" && g.items.some((e) => e.id === "legacy-marker-0")).toBe(true);
    h.documentRef.current = next;
    expect(h.result.current.hitAt(0.5, 7.5)).toEqual({
      sel: { entityId: "legacy-marker-1", kind: "marker" },
    });
  });

  it("reorder sibling: hit возвращает тот же EntityId", () => {
    const h = setup(squareDoc());
    const doc = h.documentRef.current!;
    const next: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.kind === "gameplay" ? { ...l, items: [...l.items].reverse() } : l,
      ),
    };
    h.documentRef.current = next;
    // Дверь держит приоритет и identity после reorder.
    expect(h.result.current.hitAt(2.5, 0)).toEqual({
      sel: { entityId: "legacy-door-0", kind: "door" },
    });
  });

  it("deleteSelected удаляет выбранную и чистит выбор", () => {
    const h = setup(squareDoc());
    act(() => {
      h.result.current.select({ entityId: "legacy-trap-0", kind: "trap" });
    });
    act(() => {
      h.result.current.deleteSelected();
    });
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    const [next] = h.commitDocument.mock.calls[0];
    const g = (next as MapDocumentV5).layers.find((l) => l.id === "lyr-gameplay");
    expect(g && g.kind === "gameplay" && g.items.some((e) => e.id === "legacy-trap-0")).toBe(false);
    expect(h.result.current.selected).toBeNull();
  });

  it("замена документа сбрасывает выбор (legacy parity)", () => {
    const h = setup(squareDoc());
    act(() => {
      h.result.current.select({ entityId: "legacy-trap-0", kind: "trap" });
    });
    h.rerender({ document: squareDoc() });
    expect(h.result.current.selected).toBeNull();
  });
});

describe("moveSelectedInDocument", () => {
  it("trap едет в центр клетки; мимо поля — null", () => {
    const doc = squareDoc();
    // trap-0 в (3.5,1.5); тянем в клетку (5,5) — мир (5.5,5.5).
    const next = moveSelectedInDocument(
      doc,
      { entityId: "legacy-trap-0", kind: "trap" },
      { ox: 0, oy: 0 },
      GEOM,
      5.2,
      5.7,
    )!;
    const trap = next.layers
      .flatMap((l) => (l.kind === "gameplay" ? l.items : []))
      .find((e) => e.id === "legacy-trap-0");
    expect(trap && trap.kind === "trap" && trap.position).toEqual({ x: 5.5, y: 5.5 });
    expect(moveSelectedInDocument(doc, { entityId: "legacy-trap-0", kind: "trap" }, { ox: 0, oy: 0 }, GEOM, 99, 99)).toBeNull();
  });

  it("door: ребро из указателя + пара жёстко", () => {
    const doc = squareDoc();
    // door-1 (locked e, 7,6.5) ↔ door-2 (7,6.5)w; тянем door-1 в клетку (5,5),
    // указатель у западного края → ребро w.
    const next = moveSelectedInDocument(
      doc,
      { entityId: "legacy-door-1", kind: "door" },
      { ox: 0, oy: 0 },
      GEOM,
      5.05,
      5.5,
    )!;
    const items = next.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : []));
    const d1 = items.find((e) => e.id === "legacy-door-1");
    const d2 = items.find((e) => e.id === "legacy-door-2");
    expect(d1 && d1.kind === "door" && d1.position).toEqual({ x: 5, y: 5.5 });
    expect(d1 && d1.kind === "door" && d1.orientation).toBe(270);
    // Пара сдвинута той же дельтой (-2,-1): (7,6.5) → (5,5.5), связь цела
    // (legacy rigid group move — та же семантика, включая наложение).
    expect(d2 && d2.kind === "door" && d2.position).toEqual({ x: 5, y: 5.5 });
    expect(d2 && d2.kind === "door" && d2.pairedDoorId).toBe("legacy-door-1");
  });

  it("door на гексах — null (legacy-ограничение)", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 6,
      height: 6,
      cells: parseFixture(FIXTURES.fullV4Hex),
    }).document;
    const r = moveSelectedInDocument(
      hexDoc,
      { entityId: "legacy-door-0", kind: "door" },
      { ox: 0, oy: 0 },
      { grid: "hex", width: 6, height: 6 },
      1,
      1,
    );
    expect(r).toBeNull();
  });

  it("room: абсолютный origo от anchor с клампом", () => {
    const doc = squareDoc();
    // room-0 rect (2,0,2,2); anchor ox=0,oy=0; тянем в клетку (4,4).
    const next = moveSelectedInDocument(
      doc,
      { entityId: "legacy-room-0", kind: "room" },
      { ox: 0, oy: 0 },
      GEOM,
      4.5,
      4.5,
    )!;
    const room = next.layers
      .flatMap((l) => (l.kind === "gameplay" ? l.items : []))
      .find((e) => e.id === "legacy-room-0");
    expect(room && room.kind === "room" && room.geometry).toEqual({ type: "rect", x: 4, y: 4, w: 2, h: 2 });
  });
});

describe("deleteSelectedFromDocument", () => {
  it("парная дверь чистит партнёра; start/finish удаляются", () => {
    const doc = squareDoc();
    const paired = deleteSelectedFromDocument(doc, { entityId: "legacy-door-1", kind: "door" })!;
    const ids = paired.next.layers.flatMap((l) => (l.kind === "gameplay" ? l.items.map((e) => e.id) : []));
    expect(ids).not.toContain("legacy-door-1");
    const partner = paired.next.layers
      .flatMap((l) => (l.kind === "gameplay" ? l.items : []))
      .find((e) => e.id === "legacy-door-2");
    expect(partner && partner.kind === "door" && partner.pairedDoorId).toBeNull();

    const noStart = deleteSelectedFromDocument(doc, { entityId: "legacy-start", kind: "start" })!;
    expect(
      noStart.next.layers.flatMap((l) => (l.kind === "gameplay" ? l.items.map((e) => e.id) : [])),
    ).not.toContain("legacy-start");
  });

  it("нечего удалять → null", () => {
    const doc = squareDoc();
    expect(deleteSelectedFromDocument(doc, { entityId: "nope", kind: "trap" })).toBeNull();
  });
});
