// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  deleteSelectedFromCells,
  hitObjectAt,
  moveSelectedInCells,
  selectedKeyOf,
  useMapSelection,
} from "./useMapSelection";
import { cellCenter } from "../../grid";
import type { MapCells } from "../../render";

const clone = (c: MapCells): MapCells => structuredClone(c);

function baseCells(): MapCells {
  return {
    terrain: new Map(),
    roads: new Set(),
    rivers: new Set(),
    labels: [],
    rooms: [
      { x: 2, y: 2, w: 3, h: 3, type: "empty", name: "" },
      { x: 2, y: 3, w: 1, h: 1, type: "empty", name: "" },
      { x: 9, y: 9, w: 3, h: 3, type: "empty", name: "" },
    ],
    doors: [
      { x: 2, y: 2, edge: "w", kind: "door", secret: false, pair: null },
      { x: 5, y: 5, edge: "e", kind: "door", secret: false, pair: "p1" },
      { x: 6, y: 6, edge: "n", kind: "door", secret: false, pair: "p1" },
    ],
    traps: [
      { x: 2, y: 2, kind: "pit" },
      { x: 8, y: 8, kind: "pit" },
    ],
    markers: [
      { x: 2, y: 2, kind: "chest" },
      { x: 3, y: 3, kind: "chest" },
      { x: 8, y: 8, kind: "altar" },
    ],
    start: { x: 4, y: 2 },
    finish: { x: 10, y: 10 },
  } as unknown as MapCells;
}

describe("hitObjectAt: приоритет door → trap → marker → start/finish → room", () => {
  it("1. обычная door у западного ребра", () => {
    const hit = hitObjectAt("square", 20, 20, baseCells(), 2.1, 2.5);
    expect(hit).toEqual({ sel: { kind: "door", index: 0 } });
  });

  it("2. door + trap в одной клетке → door", () => {
    const hit = hitObjectAt("square", 20, 20, baseCells(), 2.1, 2.5);
    expect(hit?.sel.kind).toBe("door");
  });

  it("3. trap + marker → trap", () => {
    const hit = hitObjectAt("square", 20, 20, baseCells(), 8.5, 8.5);
    expect(hit).toEqual({ sel: { kind: "trap", index: 1 } });
  });

  it("4. marker внутри room → marker", () => {
    const hit = hitObjectAt("square", 20, 20, baseCells(), 3.5, 3.5);
    expect(hit).toEqual({ sel: { kind: "marker", index: 1 } });
  });

  it("5. start/finish внутри room → start/finish", () => {
    expect(hitObjectAt("square", 20, 20, baseCells(), 4.5, 2.5)).toEqual({
      sel: { kind: "start", index: -1 },
    });
    expect(hitObjectAt("square", 20, 20, baseCells(), 10.5, 10.5)).toEqual({
      sel: { kind: "finish", index: -1 },
    });
  });

  it("6. room выбирается последним, верхняя — по обратному порядку", () => {
    const hit = hitObjectAt("square", 20, 20, baseCells(), 2.5, 3.5);
    expect(hit).toEqual({ sel: { kind: "room", index: 1 } });
  });

  it("мимо всех и вне поля → null", () => {
    expect(hitObjectAt("square", 20, 20, baseCells(), 15.5, 15.5)).toBeNull();
    expect(hitObjectAt("square", 20, 20, baseCells(), 99, 99)).toBeNull();
  });

  it("hex: дверная ветка пропускается, trap находится", () => {
    const cells = baseCells();
    const c = cellCenter("hex", 8, 8);
    const hit = hitObjectAt("hex", 20, 20, cells, c.cx, c.cy);
    expect(hit?.sel.kind).toBe("trap");
  });

  it("selectedKeyOf: start/finish без индекса, остальные с ним", () => {
    expect(selectedKeyOf(null)).toBeNull();
    expect(selectedKeyOf({ kind: "start", index: -1 })).toBe("start");
    expect(selectedKeyOf({ kind: "door", index: 2 })).toBe("door:2");
  });
});

describe("deleteSelectedFromCells", () => {
  it("7. delete trap/marker/room по индексу", () => {
    const d1 = deleteSelectedFromCells(baseCells(), { kind: "trap", index: 0 }, clone)!;
    expect(d1.next.traps).toHaveLength(1);
    expect(d1.next.traps[0].x).toBe(8);
    expect(d1.before.traps).toHaveLength(2);
    const d2 = deleteSelectedFromCells(baseCells(), { kind: "marker", index: 1 }, clone)!;
    expect(d2.next.markers.map((m) => m.x)).toEqual([2, 8]);
    const d3 = deleteSelectedFromCells(baseCells(), { kind: "room", index: 1 }, clone)!;
    expect(d3.next.rooms).toHaveLength(2);
  });

  it("8. delete start/finish → null", () => {
    const d1 = deleteSelectedFromCells(baseCells(), { kind: "start", index: -1 }, clone)!;
    expect(d1.next.start).toBeNull();
    expect(d1.next.finish).not.toBeNull();
    const d2 = deleteSelectedFromCells(baseCells(), { kind: "finish", index: -1 }, clone)!;
    expect(d2.next.finish).toBeNull();
  });

  it("9. delete paired door сносит всю пару; одиночная — только себя", () => {
    const paired = deleteSelectedFromCells(baseCells(), { kind: "door", index: 1 }, clone)!;
    expect(paired.next.doors).toHaveLength(1);
    expect(paired.next.doors[0].pair).toBeNull();
    const single = deleteSelectedFromCells(baseCells(), { kind: "door", index: 0 }, clone)!;
    expect(single.next.doors).toHaveLength(2);
  });

  it("битый индекс → null (no-op, как ветка else)", () => {
    expect(deleteSelectedFromCells(baseCells(), { kind: "trap", index: 99 }, clone)).toBeNull();
  });
});

describe("moveSelectedInCells", () => {
  it("10. move marker в новую клетку", () => {
    const next = moveSelectedInCells(
      baseCells(),
      { kind: "marker", index: 0 },
      { ox: 0, oy: 0 },
      "square",
      20,
      20,
      7.5,
      8.5,
      clone
    )!;
    expect(next.markers[0]).toMatchObject({ x: 7, y: 8 });
  });

  it("11. move room с clamp по границам", () => {
    const cells = baseCells();
    cells.rooms.push({ x: 18, y: 18, w: 3, h: 3, type: "empty", name: "" });
    const next = moveSelectedInCells(
      cells,
      { kind: "room", index: 3 },
      { ox: 1, oy: 1 },
      "square",
      20,
      20,
      19.5,
      19.5,
      clone
    )!;
    expect(next.rooms[3]).toMatchObject({ x: 17, y: 17 });
  });

  it("12. move door: dragged — на новое ребро, пара — тем же сдвигом", () => {
    const next = moveSelectedInCells(
      baseCells(),
      { kind: "door", index: 1 },
      { ox: 0, oy: 0 },
      "square",
      20,
      20,
      7.5,
      5.5,
      clone
    )!;
    expect(next.doors[1]).toMatchObject({ x: 7, y: 5, edge: "w" });
    expect(next.doors[2]).toMatchObject({ x: 8, y: 6, edge: "n" });
  });

  it("move door за границу → null (пара не влезает)", () => {
    const next = moveSelectedInCells(
      baseCells(),
      { kind: "door", index: 1 },
      { ox: 0, oy: 0 },
      "square",
      20,
      20,
      19.5,
      5.5,
      clone
    );
    expect(next).toBeNull();
  });

  it("move door на гексах → null", () => {
    const next = moveSelectedInCells(
      baseCells(),
      { kind: "door", index: 0 },
      { ox: 0, oy: 0 },
      "hex",
      20,
      20,
      2.5,
      2.5,
      clone
    );
    expect(next).toBeNull();
  });
});

describe("useMapSelection: select/clear/reset", () => {
  function setup(cells: MapCells) {
    const cellsRef = { current: cells };
    const setCells = vi.fn((c: MapCells) => {
      cellsRef.current = c;
    });
    const commitChange = vi.fn();
    const utils = renderHook((p: { cells: MapCells }) =>
      useMapSelection({
        cells: p.cells,
        cellsRef,
        setCells,
        commitChange,
        clone,
      })
    , { initialProps: { cells } });
    return { ...utils, cellsRef, setCells, commitChange };
  }

  it("13. select/clearSelection + deleteSelected пишет через commitChange", () => {
    const h = setup(baseCells());
    act(() => {
      h.result.current.select({ kind: "trap", index: 0 });
    });
    expect(h.result.current.selected).toEqual({ kind: "trap", index: 0 });
    act(() => {
      h.result.current.deleteSelected();
    });
    expect(h.commitChange).toHaveBeenCalledTimes(1);
    const [next, before] = h.commitChange.mock.calls[0];
    expect(next.traps).toHaveLength(1);
    expect(before.traps).toHaveLength(2);
    expect(h.result.current.selected).toBeNull();
  });

  it("14. замена cells сбрасывает selection, как раньше", () => {
    const h = setup(baseCells());
    act(() => {
      h.result.current.select({ kind: "marker", index: 0 });
    });
    expect(h.result.current.selected).not.toBeNull();
    act(() => {
      h.rerender({ cells: baseCells() });
    });
    expect(h.result.current.selected).toBeNull();
  });
});
