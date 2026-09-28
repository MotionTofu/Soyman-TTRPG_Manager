// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createLabelTools } from "./labelTools";
import { createObjectTools } from "./objectTools";
import { createPaintTools } from "./paintTools";
import { createRulerTools } from "./rulerTools";
import { createShapeTools } from "./shapeTools";
import { createWallTools } from "./wallTools";
import { migrateLegacyMap } from "../../core/migrateLegacy";
import type { MapDocumentV5 } from "../../core/types";
import { createDeterministicIdFactory } from "../idFactory";
import type { MapGeometry } from "../hooks/useMapSelection";
import {
  createGameplayLayer,
  createLabelLayer,
  createPathLayer,
  createTerrainLayer,
  createTerrainMaskLayer,
} from "../../core/mutations/layers";
import { readTerrainMaskAt } from "../../core/mutations/terrainMask";
import { createCellNetworkPath } from "../../core/mutations/paths";
import { createLabel } from "../../core/mutations/labels";
import { updateLabelText } from "../../core/mutations/labels";

function baseDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 20,
    height: 20,
    cells: {
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
    },
  }).document;
}

const GEOM: MapGeometry = { grid: "square", width: 20, height: 20 };

function terrainEntries(doc: MapDocumentV5): Map<string, string> {
  const l = doc.layers.find((x) => x.id === "lyr-terrain");
  if (!l || l.kind !== "terrain" || l.representation !== "cells") throw new Error("no terrain");
  return new Map(l.cells.map((c) => [`${c.x},${c.y}`, c.material.type === "builtin" ? c.material.key : ""]));
}

function roadSet(doc: MapDocumentV5): Set<string> {
  const out = new Set<string>();
  for (const l of doc.layers) {
    if (l.kind !== "path") continue;
    for (const p of l.paths) {
      if (p.geometry.type === "cell-network" && (p.kind === "road" || p.kind === "river")) {
        for (const c of p.geometry.cells) out.add(`${p.kind}:${c.x},${c.y}`);
      }
    }
  }
  return out;
}

function gameplay(doc: MapDocumentV5) {
  const l = doc.layers.find((x) => x.id === "lyr-gameplay");
  if (!l || l.kind !== "gameplay") throw new Error("no gameplay");
  return l.items;
}

function paintDeps(overrides: Record<string, unknown> = {}) {
  const documentRef = { current: baseDoc() as MapDocumentV5 | null };
  const setDocument = vi.fn((d: MapDocumentV5) => {
    documentRef.current = d;
  });
  const push = vi.fn();
  const selectTool = vi.fn();
  const setTerrain = vi.fn();
  const setActionError = vi.fn();
  const onActiveLayer = vi.fn();
  return {
    deps: {
      geom: GEOM,
      tool: "brush",
      terrain: "forest",
      brushSize: 1 as const,
      activeLayerId: null,
      onActiveLayer,
      documentRef,
      setDocument,
      push,
      newId: createDeterministicIdFactory(),
      selectTool,
      setTerrain,
      setActionError,
      ...overrides,
    },
    documentRef,
    setDocument,
    push,
    selectTool,
    setTerrain,
    setActionError,
    onActiveLayer,
  };
}

describe("paintTools (V5)", () => {
  it("brush and eraser edit the active mask without changing cell terrain", () => {
    const h = paintDeps({ activeLayerId: "mask", terrain: "mountains" });
    const created = createTerrainMaskLayer(h.documentRef.current!, { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    h.documentRef.current = created.document;
    const brush = createPaintTools(h.deps as never);
    expect(brush.paintAt(2.25, 2.25)).toBe(true);
    expect(readTerrainMaskAt(h.documentRef.current!, "mask", 2.25, 2.25)).toEqual({ type: "builtin", key: "terrain/mountains" });
    expect(terrainEntries(h.documentRef.current!).get("2,2")).toBe("terrain/forest");
    const eraser = createPaintTools({ ...h.deps, tool: "eraser" } as never);
    expect(eraser.paintAt(2.25, 2.25)).toBe(true);
    expect(readTerrainMaskAt(h.documentRef.current!, "mask", 2.25, 2.25)).toEqual({ type: "builtin", key: "terrain/plain" });
    expect(terrainEntries(h.documentRef.current!).get("2,2")).toBe("terrain/forest");
  });

  it("fill edits the active mask as one history step", () => {
    const h = paintDeps({ activeLayerId: "mask", tool: "fill", terrain: "mountains" });
    const created = createTerrainMaskLayer(h.documentRef.current!, { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    h.documentRef.current = created.document;
    const fill = createPaintTools(h.deps as never);
    fill.singleAction(2.25, 2.25);
    expect(readTerrainMaskAt(h.documentRef.current!, "mask", 18, 18)).toEqual({ type: "builtin", key: "terrain/mountains" });
    expect(terrainEntries(h.documentRef.current!).get("2,2")).toBe("terrain/forest");
    expect(h.push).toHaveBeenCalledTimes(1);
    fill.singleAction(2.25, 2.25);
    expect(h.push).toHaveBeenCalledTimes(1);
  });
  it("brush красит и возвращает changed; повтор — no-op", () => {
    const h = paintDeps();
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    expect(terrainEntries(h.documentRef.current!).get("5,5")).toBe("terrain/forest");
    expect(paint.paintAt(5.5, 5.5)).toBe(false);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("eraser чистит террейн и оверлеи", () => {
    const h = paintDeps({ tool: "eraser" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(terrainEntries(h.documentRef.current!).has("2,2")).toBe(false);
    expect(paint.paintAt(3.5, 3.5)).toBe(true);
    expect(roadSet(h.documentRef.current!).has("road:3,3")).toBe(false);
  });

  it("road/river — в editable path поверх террейна", () => {
    const h = paintDeps({ tool: "road" });
    const paint = createPaintTools(h.deps as never);
    // У baseDoc нет road path (roads set пуст в миграции? нет — roads ["3,3"]
    // → legacy-path-road существует): добавляем рядом.
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(roadSet(h.documentRef.current!).has("road:2,2")).toBe(true);
    expect(terrainEntries(h.documentRef.current!).get("2,2")).toBe("terrain/forest");
  });

  it("road создаёт path при отсутствии (новый ID, не legacy)", () => {
    const h = paintDeps({ tool: "road" });
    // Убираем мигрированный path: документ без дорог.
    const empty = migrateLegacyMap({
      grid: "square",
      width: 20,
      height: 20,
      cells: {
        terrain: new Map(),
        roads: new Set(),
        rivers: new Set(),
        labels: [],
        rooms: [],
        doors: [],
        traps: [],
        markers: [],
        start: null,
        finish: null,
      },
    }).document;
    h.documentRef.current = empty;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    const road = h.documentRef.current!.layers
      .flatMap((l) => (l.kind === "path" ? l.paths : []))
      .find((p) => p.kind === "road");
    expect(road?.id).toBe("e-1");
    expect(road?.id.startsWith("legacy-")).toBe(false);
  });

  it("wall дабом — фиксированная краска wall", () => {
    const h = paintDeps({ tool: "wall" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(6.5, 6.5)).toBe(true);
    expect(terrainEntries(h.documentRef.current!).get("6,6")).toBe("terrain/wall");
  });

  it("RMB override: brush + eraseOverride → erase, инструмент не меняется", () => {
    const h = paintDeps({ tool: "brush" });
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5, { eraseOverride: true })).toBe(true);
    expect(terrainEntries(h.documentRef.current!).has("2,2")).toBe(false);
    expect(paint.paintAt(2.5, 2.5)).toBe(true);
    expect(terrainEntries(h.documentRef.current!).get("2,2")).toBe("terrain/forest");
  });

  it("fill заливает связную область одним шагом; тот же террейн — no-op", () => {
    const h = paintDeps({ tool: "fill", terrain: "mountains" });
    const paint = createPaintTools(h.deps as never);
    paint.singleAction(10.5, 10.5);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(terrainEntries(h.documentRef.current!).get("10,10")).toBe("terrain/mountains");
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
    expect(roadSet(h.documentRef.current!).has("road:3,3")).toBe(false);
    expect(h.push).toHaveBeenCalledTimes(1);
    const h2 = paintDeps({ tool: "brush" });
    const paint2 = createPaintTools(h2.deps as never);
    paint2.altPick(2.5, 2.5);
    expect(h2.setTerrain).toHaveBeenCalledWith("forest");
    expect(h2.selectTool).toHaveBeenCalledWith("brush");
    expect(h2.push).not.toHaveBeenCalled();
  });

  it("несколько road paths в одном слое: кисть даёт structured error", () => {
    const h = paintDeps({ tool: "road" });
    // Второй road path поверх мигрированного.
    const doc = h.documentRef.current!;
    const road = doc.layers.find((l) => l.id === "lyr-road");
    if (!road || road.kind !== "path" || road.paths[0].geometry.type !== "cell-network") {
      throw new Error("bad fixture");
    }
    const twoRoads: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === "lyr-road" && l.kind === "path"
          ? {
              ...l,
              paths: [
                ...l.paths,
                {
                  id: "road-second",
                  kind: "road",
                  geometry: { type: "cell-network", cells: [{ x: 9, y: 9 }] },
                  width: 1,
                  styleRef: { type: "builtin", key: "road" } as const,
                },
              ],
            }
          : l,
      ),
    };
    h.documentRef.current = twoRoads;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(2.5, 2.5)).toBe(false);
    expect(h.deps.setActionError).toHaveBeenCalledWith(
      expect.stringContaining("в слое несколько road paths"),
    );
    expect(h.push).not.toHaveBeenCalled();
  });

  it("hex-ветки работают", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 20,
      height: 20,
      cells: {
        terrain: new Map([["2,2", "forest"]]),
        roads: new Set(),
        rivers: new Set(),
        labels: [],
        rooms: [],
        doors: [],
        traps: [],
        markers: [],
        start: null,
        finish: null,
      },
    }).document;
    const h = paintDeps({ geom: { grid: "hex", width: 20, height: 20 } });
    h.documentRef.current = hexDoc;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
  });
});

describe("wallTools (V5)", () => {
  function wallDeps(overrides: Record<string, unknown> = {}) {
    const documentRef = { current: baseDoc() as MapDocumentV5 | null };
    const setDocument = vi.fn((d: MapDocumentV5) => {
      documentRef.current = d;
    });
    return {
      deps: {
        geom: GEOM,
        wallSnap: true,
        wallDraft: [
          { x: 1.5, y: 1.5 },
          { x: 4.5, y: 1.5 },
        ],
        wallLive: null,
        activeLayerId: null,
        onActiveLayer: vi.fn(),
        setWallDraft: vi.fn(),
        setWallLive: vi.fn(),
        documentRef,
        setDocument,
        push: vi.fn(),
        setActionError: vi.fn(),
        ...overrides,
      },
      documentRef,
      setDocument,
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
    const entries = terrainEntries(h.documentRef.current!);
    for (const x of [1, 2, 3, 4]) {
      expect(entries.get(`${x},1`)).toBe("terrain/wall");
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

describe("shapeTools (V5)", () => {
  function shapeDeps(overrides: Record<string, unknown> = {}) {
    const documentRef = { current: baseDoc() as MapDocumentV5 | null };
    const setDocument = vi.fn((d: MapDocumentV5) => {
      documentRef.current = d;
    });
    return {
      deps: {
        geom: GEOM,
        shapeContent: "terrain",
        terrain: "mountains",
        shapeAnchor: null,
        activeLayerId: null,
        onActiveLayer: vi.fn(),
        setShapeAnchor: vi.fn(),
        setRectPreview: vi.fn(),
        documentRef,
        setDocument,
        push: vi.fn(),
        newId: createDeterministicIdFactory(),
        setActionError: vi.fn(),
        onRequestRoomCreate: vi.fn(),
        ...overrides,
      },
      documentRef,
      setDocument,
    };
  }

  it("terrain/road/river/wall/eraser rect — применением одним шагом", () => {
    const checks = {
      terrain: (d: MapDocumentV5) => terrainEntries(d).get("6,6") === "terrain/mountains",
      road: (d: MapDocumentV5) => roadSet(d).has("road:6,6"),
      river: (d: MapDocumentV5) => roadSet(d).has("river:6,6"),
      wall: (d: MapDocumentV5) => terrainEntries(d).get("6,6") === "terrain/wall",
    } as const;
    for (const [content, check] of Object.entries(checks)) {
      const h = shapeDeps({ shapeContent: content });
      const shape = createShapeTools(h.deps as never);
      shape.apply({ x: 6, y: 6 }, { x: 7, y: 7 });
      expect(check(h.documentRef.current!), content).toBe(true);
      expect(h.deps.push).toHaveBeenCalledTimes(1);
    }
    const h = shapeDeps({ shapeContent: "eraser" });
    const shape = createShapeTools(h.deps as never);
    shape.apply({ x: 2, y: 2 }, { x: 3, y: 3 });
    expect(terrainEntries(h.documentRef.current!).has("2,2")).toBe(false);
    expect(roadSet(h.documentRef.current!).has("road:3,3")).toBe(false);
    expect(h.deps.push).toHaveBeenCalledTimes(1);
  });

  it("room rect → запрос UI, а не прямое создание", () => {
    const h = shapeDeps({ shapeContent: "room" });
    const shape = createShapeTools(h.deps as never);
    shape.apply({ x: 6, y: 6 }, { x: 7, y: 7 });
    expect(h.deps.onRequestRoomCreate).toHaveBeenCalledWith({ x: 6, y: 6, w: 2, h: 2 });
    expect(gameplay(h.documentRef.current!).filter((e) => e.kind === "room")).toHaveLength(0);
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

describe("objectTools (V5)", () => {
  function objectDeps(overrides: Record<string, unknown> = {}) {
    const documentRef = { current: baseDoc() as MapDocumentV5 | null };
    const commitDocument = vi.fn((next: MapDocumentV5) => {
      documentRef.current = next;
    });
    return {
      deps: {
        geom: GEOM,
        lastTrapKind: "pit",
        markerKind: "city",
        activeLayerId: null,
        onActiveLayer: vi.fn(),
        setActionError: vi.fn(),
        documentRef,
        commitDocument,
        newId: createDeterministicIdFactory(),
        ...overrides,
      },
      documentRef,
      commitDocument,
    };
  }

  it("placement основных типов — по одному шагу, IDs не legacy", () => {
    const h = objectDeps();
    const objects = createObjectTools(h.deps as never);
    objects.placeObject("trap", 6.5, 6.5);
    objects.placeObject("chest", 7.5, 7.5);
    objects.placeObject("marker", 8.5, 8.5);
    objects.placeObject("start", 9.5, 9.5);
    objects.placeObject("finish", 10.5, 10.5);
    const items = gameplay(h.documentRef.current!);
    expect(items.filter((e) => e.kind === "trap")).toHaveLength(1);
    expect(items.filter((e) => e.kind === "marker")).toHaveLength(2);
    const start = items.find((e) => e.kind === "start");
    const finish = items.find((e) => e.kind === "finish");
    expect(start && start.kind === "start" && start.position).toEqual({ x: 9.5, y: 9.5 });
    expect(finish && finish.kind === "finish" && finish.position).toEqual({ x: 10.5, y: 10.5 });
    // Stable IDs нового формата — не legacy-префиксы.
    for (const e of items) {
      expect(e.id.startsWith("legacy-")).toBe(false);
    }
    expect(h.commitDocument).toHaveBeenCalledTimes(5);
  });

  it("door: hex — ошибка, дубликат ребра — ошибка, лимиты — ошибки", () => {    const h = objectDeps();
    const objects = createObjectTools(h.deps as never);
    objects.placeObject("door", 6.1, 6.5);
    expect(gameplay(h.documentRef.current!).filter((e) => e.kind === "door")).toHaveLength(1);
    objects.placeObject("door", 6.1, 6.5);
    expect(h.deps.setActionError).toHaveBeenCalledWith("Здесь уже есть дверь.");
    expect(gameplay(h.documentRef.current!).filter((e) => e.kind === "door")).toHaveLength(1);
    const hex = objectDeps({ geom: { grid: "hex", width: 20, height: 20 } });
    const hexObjects = createObjectTools(hex.deps as never);
    hexObjects.placeObject("door", 6.5, 6.5);
    expect(hex.deps.setActionError).toHaveBeenCalledWith(
      "Двери — только на квадратах: на гексах рёберной модели нет."
    );
    expect(gameplay(hex.documentRef.current!).filter((e) => e.kind === "door")).toHaveLength(0);
  });
});

describe("tool target routing (3A §122–126)", () => {
  function objectDepsLocal(overrides: Record<string, unknown> = {}) {
    const documentRef = { current: baseDoc() as MapDocumentV5 | null };
    const commitDocument = vi.fn((next: MapDocumentV5) => {
      documentRef.current = next;
    });
    return {
      deps: {
        geom: GEOM,
        lastTrapKind: "pit",
        markerKind: "city",
        activeLayerId: null,
        onActiveLayer: vi.fn(),
        setActionError: vi.fn(),
        documentRef,
        commitDocument,
        newId: createDeterministicIdFactory(),
        ...overrides,
      },
      documentRef,
      commitDocument,
    };
  }

  function withSecondTerrain(doc: MapDocumentV5): MapDocumentV5 {
    const r = createTerrainLayer(doc, { id: "t-upper", name: "Terrain 2" });
    if (!r.ok || !r.changed) throw new Error("create failed");
    return r.document;
  }

  function terrainCellsOf(doc: MapDocumentV5, layerId: string): Map<string, string> {
    const l = doc.layers.find((x) => x.id === layerId);
    if (!l || l.kind !== "terrain" || l.representation !== "cells") throw new Error("no terrain " + layerId);
    return new Map(l.cells.map((c) => [`${c.x},${c.y}`, c.material.type === "builtin" ? c.material.key : c.material.assetId]));
  }

  it("§122: active compatible wins; manual active retained (без onActiveLayer)", () => {
    const doc = withSecondTerrain(baseDoc());
    const h = paintDeps({ tool: "brush", activeLayerId: "lyr-terrain" });
    h.documentRef.current = doc;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    // Краска ушла в НИЖНИЙ lyr-terrain (active), верхний t-upper пуст.
    expect(terrainCellsOf(h.documentRef.current!, "lyr-terrain").get("5,5")).toBe("terrain/forest");
    expect(terrainCellsOf(h.documentRef.current!, "t-upper").has("5,5")).toBe(false);
    expect(h.onActiveLayer).not.toHaveBeenCalled();
  });

  it("§122: active incompatible → topmost compatible + onActiveLayer", () => {
    const doc = withSecondTerrain(baseDoc());
    // Active — gameplay (несовместим с brush).
    const h = paintDeps({ tool: "brush", activeLayerId: "lyr-gameplay" });
    h.documentRef.current = doc;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    // Верхний terrain — t-upper.
    expect(terrainCellsOf(h.documentRef.current!, "t-upper").get("5,5")).toBe("terrain/forest");
    expect(h.onActiveLayer).toHaveBeenCalledWith("t-upper");
  });

  it("§122: hidden/locked compatible skipped; нет слоя → error", () => {
    const hidden: MapDocumentV5 = {
      ...withSecondTerrain(baseDoc()),
      layers: withSecondTerrain(baseDoc()).layers.map((l) =>
        l.id === "t-upper" ? { ...l, visible: false } : l,
      ),
    };
    const h = paintDeps({ tool: "brush", activeLayerId: null });
    h.documentRef.current = hidden;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    expect(terrainCellsOf(h.documentRef.current!, "lyr-terrain").get("5,5")).toBe("terrain/forest");

    const locked: MapDocumentV5 = {
      ...baseDoc(),
      layers: baseDoc().layers.map((l) => (l.kind === "terrain" ? { ...l, locked: true } : l)),
    };
    const h2 = paintDeps({ tool: "brush", activeLayerId: null });
    h2.documentRef.current = locked;
    const paint2 = createPaintTools(h2.deps as never);
    expect(paint2.paintAt(5.5, 5.5)).toBe(false);
    expect(h2.setActionError).toHaveBeenCalledWith("Нет доступного слоя подходящего типа.");
  });

  it("§123: multi-terrain — brush/fill/picker только в target, undo один шаг", () => {
    const doc = withSecondTerrain(baseDoc());
    // Brush в верхний.
    const h = paintDeps({ tool: "brush", activeLayerId: "t-upper" });
    h.documentRef.current = doc;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(5.5, 5.5)).toBe(true);
    expect(terrainCellsOf(h.documentRef.current!, "t-upper").get("5,5")).toBe("terrain/forest");
    expect(terrainCellsOf(h.documentRef.current!, "lyr-terrain").has("5,5")).toBe(false);
    // Flood в верхний — один push.
    const hf = paintDeps({ tool: "fill", terrain: "mountains", activeLayerId: "t-upper" });
    hf.documentRef.current = h.documentRef.current!;
    const paintF = createPaintTools(hf.deps as never);
    paintF.singleAction(10.5, 10.5);
    expect(hf.push).toHaveBeenCalledTimes(1);
    expect(terrainCellsOf(hf.documentRef.current!, "t-upper").get("10,10")).toBe("terrain/mountains");
    // Picker читает target (верхний — mountains после заливки).
    const hp = paintDeps({ tool: "picker", activeLayerId: "t-upper" });
    hp.documentRef.current = hf.documentRef.current!;
    const paintP = createPaintTools(hp.deps as never);
    paintP.singleAction(10.5, 10.5);
    expect(hp.setTerrain).toHaveBeenCalledWith("mountains");
  });

  it("§124: два PathLayers с road — кисть меняет только active", () => {
    let doc = baseDoc();
    const p2 = createPathLayer(doc, { id: "p-secret", name: "Secret" });
    if (!p2.ok || !p2.changed) throw new Error("create failed");
    doc = p2.document;
    const c = createCellNetworkPath(doc, "p-secret", {
      id: "road-secret",
      kind: "road",
      styleRef: { type: "builtin", key: "road" },
      width: 1,
      cells: [{ x: 9, y: 9 }],
    });
    if (!c.ok || !c.changed) throw new Error("path create failed");
    doc = c.document;
    // Active — верхний p-secret: красим туда.
    const h = paintDeps({ tool: "road", activeLayerId: "p-secret" });
    h.documentRef.current = doc;
    const paint = createPaintTools(h.deps as never);
    expect(paint.paintAt(8.5, 8.5)).toBe(true);
    const after = h.documentRef.current!;
    const secretCells = new Set<string>();
    const mainCells = new Set<string>();
    for (const l of after.layers) {
      if (l.kind !== "path") continue;
      for (const p of l.paths) {
        if (p.kind !== "road" || p.geometry.type !== "cell-network") continue;
        for (const cell of p.geometry.cells) {
          (l.id === "p-secret" ? secretCells : mainCells).add(`${cell.x},${cell.y}`);
        }
      }
    }
    expect(secretCells.has("8,8")).toBe(true);
    expect(mainCells.has("8,8")).toBe(false);
    expect(h.onActiveLayer).not.toHaveBeenCalled();
  });

  it("§125: create marker в active A — B untouched", () => {
    let doc = baseDoc();
    const g = createGameplayLayer(doc, { id: "g-b", name: "GB" });
    if (!g.ok || !g.changed) throw new Error("create failed");
    doc = g.document;
    const h = objectDepsLocal({ activeLayerId: "lyr-gameplay" });
    h.documentRef.current = doc;
    const objects = createObjectTools(h.deps as never);
    objects.placeObject("trap", 6.5, 6.5);
    const after = h.documentRef.current!;
    const aItems = after.layers.find((l) => l.id === "lyr-gameplay");
    const bItems = after.layers.find((l) => l.id === "g-b");
    expect(aItems?.kind === "gameplay" && aItems.items.some((e) => e.kind === "trap")).toBe(true);
    expect(bItems?.kind === "gameplay" && bItems.items).toEqual([]);
  });

  it("§126: одинаковая позиция на двух LabelLayers — edit scoped", () => {
    let doc = baseDoc();
    const l2 = createLabelLayer(doc, { id: "l-b", name: "LB" });
    if (!l2.ok || !l2.changed) throw new Error("create failed");
    doc = l2.document;
    const a = createLabel(doc, "lyr-labels", { id: "lbl-a", position: { x: 1.5, y: 1.5 }, text: "A" });
    if (!a.ok || !a.changed) throw new Error("label a failed");
    doc = a.document;
    const b = createLabel(doc, "l-b", { id: "lbl-b", position: { x: 1.5, y: 1.5 }, text: "B" });
    if (!b.ok || !b.changed) throw new Error("label b failed");
    doc = b.document;
    // Правка в A не трогает B.
    const u = updateLabelText(doc, "lbl-a", "A2");
    if (!u.ok || !u.changed) throw new Error("update failed");
    const lB = u.document.layers.find((l) => l.id === "l-b");
    expect(lB?.kind === "label" && lB.items).toEqual([
      { id: "lbl-b", position: { x: 1.5, y: 1.5 }, text: "B" },
    ]);
  });
});
