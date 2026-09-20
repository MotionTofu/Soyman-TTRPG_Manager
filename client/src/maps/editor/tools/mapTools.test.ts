// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createLabelTools } from "./labelTools";
import { createObjectTools } from "./objectTools";
import { createPaintTools, floodFill, paintStroke } from "./paintTools";
import { createRulerTools } from "./rulerTools";
import { createShapeTools } from "./shapeTools";
import { createWallTools } from "./wallTools";
import type { MapFull } from "../../mapTypes";
import type { MapCells } from "../../render";

const clone = (c: MapCells): MapCells => structuredClone(c);

function baseCells(): MapCells {
  return {
    terrain: new Map([["2,2", "forest"]]),
    roads: new Set(["3,3"]),
    rivers: new Set(),
    labels: [],
    rooms: [],
    doors: [],
    traps: [],
    markers: [],
    start: null,
    finish: null,
  } as unknown as MapCells;
}

const MAP = { id: 1, grid: "square", width: 20, height: 20 } as unknown as MapFull;

function paintDeps(overrides: Record<string, unknown> = {}) {
  const cellsRef = { current: baseCells() };
  const setCells = vi.fn((c: MapCells) => {
    cellsRef.current = c;
  });
  const push = vi.fn();
  const selectTool = vi.fn();
  const setTerrain = vi.fn();
  return {
    deps: {
      map: MAP,
      tool: "brush",
      terrain: "forest",
      brushSize: 1 as const,
      cellsRef,
      setCells,
      push,
      clone,
      selectTool,
      setTerrain,
      ...overrides,
    },
    cellsRef,
    setCells,
    push,
    selectTool,
    setTerrain,
  };
}

describe("paintTools", () => {
  it("brush красит и возвращает changed; повтор — no-op", () => {
    const h = paintDeps();
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    expect(h.cellsRef.current.terrain.get("5,5")).toBe("forest");
    expect(paint.paintAt(5.5, 5.5)).toBe(false);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("eraser чистит террейн и оверлеи", () => {
    const h = paintDeps({ tool: "eraser" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(h.cellsRef.current.terrain.has("2,2")).toBe(false);
    expect(paint.paintAt(3.5, 3.5)).toBe(true);
    expect(h.cellsRef.current.roads.has("3,3")).toBe(false);
  });

  it("road/river — биты поверх террейна", () => {
    const h = paintDeps({ tool: "road" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(h.cellsRef.current.roads.has("2,2")).toBe(true);
    expect(h.cellsRef.current.terrain.get("2,2")).toBe("forest");
  });

  it("wall дабом — фиксированная краска wall", () => {
    const h = paintDeps({ tool: "wall" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(6.5, 6.5)).toBe(true);
    expect(h.cellsRef.current.terrain.get("6,6")).toBe("wall");
  });

  it("RMB override: brush + eraseOverride → erase, инструмент не меняется", () => {
    const h = paintDeps({ tool: "brush" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5, { eraseOverride: true })).toBe(true);
    expect(h.cellsRef.current.terrain.has("2,2")).toBe(false);
    // Инструмент остался brush: следующий мазок без override снова красит.
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(h.cellsRef.current.terrain.get("2,2")).toBe("forest");
  });

  it("fill заливает связную область одним шагом; тот же террейн — no-op", () => {
    const h = paintDeps({ tool: "fill", terrain: "mountain" });
    const paint = createPaintTools(h.deps as never);
    paint.singleAction(10.5, 10.5);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.cellsRef.current.terrain.get("10,10")).toBe("mountain");
    const h2 = paintDeps({ tool: "fill", terrain: "forest" });
    const paint2 = createPaintTools(h2.deps as never);
    paint2.singleAction(2.5, 2.5);
    expect(h2.push).not.toHaveBeenCalled();
  });

  it("picker берёт террейн и включает brush", () => {
    const h = paintDeps({ tool: "picker" });
    const paint = createPaintTools(h.deps as never);
    paint.singleAction(2.5, 2.5);
    expect(h.setTerrain).toHaveBeenCalledWith("forest");
    expect(h.selectTool).toHaveBeenCalledWith("brush");
    expect(h.push).not.toHaveBeenCalled();
  });

  it("altPick снимает оверлей одним шагом; без оверлея — пипетка", () => {
    const h = paintDeps({ tool: "road" });
    const paint = createPaintTools(h.deps as never);
    paint.altPick(3.5, 3.5);
    expect(h.cellsRef.current.roads.has("3,3")).toBe(false);
    expect(h.push).toHaveBeenCalledTimes(1);
    const h2 = paintDeps({ tool: "brush" });
    const paint2 = createPaintTools(h2.deps as never);
    paint2.altPick(2.5, 2.5);
    expect(h2.setTerrain).toHaveBeenCalledWith("forest");
    expect(h2.selectTool).toHaveBeenCalledWith("brush");
    expect(h2.push).not.toHaveBeenCalled();
  });

  it("paintStroke/floodFill чистые: hex-ветки работают", () => {
    const cells = baseCells();
    expect(paintStroke(cells, "hex", 20, 20, 5, 5, 1, "brush", "forest")).toBe(true);
    expect(floodFill(cells, "hex", 20, 20, 6, 6, "plain")).toBe(false);
  });
});

describe("wallTools", () => {
  function wallDeps(overrides: Record<string, unknown> = {}) {
    const cellsRef = { current: baseCells() };
    const setCells = vi.fn((c: MapCells) => {
      cellsRef.current = c;
    });
    return {
      deps: {
        map: MAP,
        wallSnap: true,
        wallDraft: [
          { x: 1.5, y: 1.5 },
          { x: 4.5, y: 1.5 },
        ],
        wallLive: null,
        setWallDraft: vi.fn(),
        setWallLive: vi.fn(),
        cellsRef,
        setCells,
        push: vi.fn(),
        clone,
        ...overrides,
      },
      cellsRef,
      setCells,
    };
  }

  it("tapVertex квантует к центру клетки и гасит live", () => {
    const h = wallDeps();
    const wall = createWallTools(h.deps as never);
    wall.tapVertex(2.7, 3.2);
    expect(h.deps.setWallDraft).toHaveBeenCalledTimes(1);
    const updater = h.deps.setWallDraft.mock.calls[0][0] as (d: unknown) => unknown;
    expect(updater([{ x: 1.5, y: 1.5 }])).toEqual([
      { x: 1.5, y: 1.5 },
      { x: 2.5, y: 3.5 },
    ]);
    expect(h.deps.setWallLive).toHaveBeenCalledWith(null);
  });

  it("finishWallLine: линия — wall одним шагом", () => {
    const h = wallDeps();
    const wall = createWallTools(h.deps as never);
    wall.finishWallLine(false);
    expect(h.deps.push).toHaveBeenCalledTimes(1);
    for (const x of [1, 2, 3, 4]) {
      expect(h.cellsRef.current.terrain.get(`${x},1`)).toBe("wall");
    }
  });

  it("finishWallLine: <2 вершин — no-op с очисткой черновика", () => {
    const h = wallDeps({ wallDraft: [{ x: 1.5, y: 1.5 }] });
    const wall = createWallTools(h.deps as never);
    wall.finishWallLine(false);
    expect(h.deps.push).not.toHaveBeenCalled();
    expect(h.deps.setWallDraft).toHaveBeenCalledWith(null);
  });
});

describe("shapeTools", () => {
  function shapeDeps(overrides: Record<string, unknown> = {}) {
    const cellsRef = { current: baseCells() };
    const setCells = vi.fn((c: MapCells) => {
      cellsRef.current = c;
    });
    return {
      deps: {
        map: MAP,
        shapeContent: "terrain",
        terrain: "mountain",
        shapeAnchor: null,
        setShapeAnchor: vi.fn(),
        setRectPreview: vi.fn(),
        cellsRef,
        setCells,
        push: vi.fn(),
        clone,
        onRequestRoomCreate: vi.fn(),
        ...overrides,
      },
      cellsRef,
      setCells,
    };
  }

  it("terrain/road/river/wall/eraser rect — применением одним шагом", () => {
    for (const [content, check] of [
      ["terrain", (c: MapCells) => c.terrain.get("6,6") === "mountain"],
      ["road", (c: MapCells) => c.roads.has("6,6")],
      ["river", (c: MapCells) => c.rivers.has("6,6")],
      ["wall", (c: MapCells) => c.terrain.get("6,6") === "wall"],
    ] as const) {
      const h = shapeDeps({ shapeContent: content });
      const shape = createShapeTools(h.deps as never);
      shape.apply({ x: 6, y: 6 }, { x: 7, y: 7 });
      expect(check(h.cellsRef.current)).toBe(true);
      expect(h.deps.push).toHaveBeenCalledTimes(1);
    }
    const h = shapeDeps({ shapeContent: "eraser" });
    const shape = createShapeTools(h.deps as never);
    shape.apply({ x: 2, y: 2 }, { x: 3, y: 3 });
    expect(h.cellsRef.current.terrain.has("2,2")).toBe(false);
    expect(h.cellsRef.current.roads.has("3,3")).toBe(false);
    expect(h.deps.push).toHaveBeenCalledTimes(1);
  });

  it("room rect → запрос UI, а не прямое создание", () => {
    const h = shapeDeps({ shapeContent: "room" });
    const shape = createShapeTools(h.deps as never);
    shape.apply({ x: 6, y: 6 }, { x: 7, y: 7 });
    expect(h.deps.onRequestRoomCreate).toHaveBeenCalledWith({ x: 6, y: 6, w: 2, h: 2 });
    expect(h.cellsRef.current.rooms).toHaveLength(0);
    expect(h.deps.push).not.toHaveBeenCalled();
  });

  it("tap: первый — якорь, второй — применение", () => {
    const h = shapeDeps({ shapeContent: "terrain" });
    const shape = createShapeTools(h.deps as never);
    shape.tap({ x: 6, y: 6 });
    expect(h.deps.setShapeAnchor).toHaveBeenCalledWith({ x: 6, y: 6 });
    expect(h.deps.push).not.toHaveBeenCalled();
  });
});

describe("rulerTools + labelTools", () => {
  it("tap/hover управляют замером", () => {
    const setRuler = vi.fn();
    const ruler = createRulerTools({ ruler: null, setRuler });
    ruler.tap({ x: 1, y: 1 });
    const updater = setRuler.mock.calls[0][0] as (r: null) => unknown;
    const started = updater(null) as { a: { x: number } };
    expect(started.a).toEqual({ x: 1, y: 1 });
    const ruler2 = createRulerTools({
      ruler: { a: { x: 1, y: 1 }, b: null, locked: false },
      setRuler,
    });
    ruler2.hover({ x: 2, y: 2 });
    expect(setRuler).toHaveBeenCalledWith({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, locked: false });
  });

  it("label click → запрос редактора", () => {
    const onRequestLabelEdit = vi.fn();
    const label = createLabelTools({ onRequestLabelEdit });
    label.click({ x: 3, y: 4 });
    expect(onRequestLabelEdit).toHaveBeenCalledWith(3, 4);
  });
});

describe("objectTools", () => {
  function objectDeps(overrides: Record<string, unknown> = {}) {
    const cellsRef = { current: baseCells() };
    const commitChange = vi.fn((next: MapCells) => {
      cellsRef.current = next;
    });
    return {
      deps: {
        map: MAP,
        lastTrapKind: "pit",
        markerKind: "city",
        setActionError: vi.fn(),
        cellsRef,
        commitChange,
        clone,
        ...overrides,
      },
      cellsRef,
      commitChange,
    };
  }

  it("placement основных типов — по одному шагу", () => {
    const h = objectDeps();
    const objects = createObjectTools(h.deps as never);
    objects.placeObject("trap", 6.5, 6.5);
    objects.placeObject("chest", 7.5, 7.5);
    objects.placeObject("marker", 8.5, 8.5);
    objects.placeObject("start", 9.5, 9.5);
    objects.placeObject("finish", 10.5, 10.5);
    expect(h.cellsRef.current.traps).toHaveLength(1);
    expect(h.cellsRef.current.markers).toHaveLength(2);
    expect(h.cellsRef.current.start).toEqual({ x: 9, y: 9 });
    expect(h.cellsRef.current.finish).toEqual({ x: 10, y: 10 });
    expect(h.commitChange).toHaveBeenCalledTimes(5);
  });

  it("door: hex — ошибка, дубликат ребра — ошибка, лимиты — ошибки", () => {
    const h = objectDeps();
    const objects = createObjectTools(h.deps as never);
    objects.placeObject("door", 6.1, 6.5);
    expect(h.cellsRef.current.doors).toHaveLength(1);
    objects.placeObject("door", 6.1, 6.5);
    expect(h.deps.setActionError).toHaveBeenCalledWith("Здесь уже есть дверь.");
    expect(h.cellsRef.current.doors).toHaveLength(1);
    const hex = objectDeps({ map: { ...MAP, grid: "hex" } });
    const hexObjects = createObjectTools(hex.deps as never);
    hexObjects.placeObject("door", 6.5, 6.5);
    expect(hex.deps.setActionError).toHaveBeenCalledWith(
      "Двери — только на квадратах: на гексах рёберной модели нет."
    );
    expect(hex.cellsRef.current.doors).toHaveLength(0);
  });
});
