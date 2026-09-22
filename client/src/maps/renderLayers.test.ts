// Layer-driven renderer tests (Фаза 3A, §117–120): порядок слоёв,
// visibility-skip, opacity-умножение, items-order внутри gameplay.
// Mocked ctx с эмуляцией globalAlpha (как в renderParity.test.ts).

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { MapDocumentV5 } from "./core/types";
import { createV5RenderModel } from "./renderModel";
import { MAP_TERRAIN_FILL, renderMap, type MapChrome, type RenderOptions } from "./render";

const CHROME: MapChrome = { paper: "#fff", line: "#000", muted: "#666", ink: "#111" };

function makeCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  let alpha = 1;
  const stack: number[] = [];
  const fmt = (v: unknown): string => {
    if (typeof v === "number") {
      if (Object.is(v, -0)) return "0";
      return Number.isInteger(v) ? String(v) : v.toPrecision(12);
    }
    return JSON.stringify(v);
  };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "canvas") return null;
        if (prop === "globalAlpha") return alpha;
        return (...args: unknown[]) => {
          if (prop === "save") stack.push(alpha);
          if (prop === "restore") {
            const prev = stack.pop();
            if (prev !== undefined) alpha = prev;
          }
          calls.push(`${String(prop)}(${args.map(fmt).join(",")})`);
        };
      },
      set(_t, prop, value) {
        if (prop === "globalAlpha" && typeof value === "number") alpha = value;
        calls.push(`set:${String(prop)}=${fmt(value)}`);
        return true;
      },
      has() {
        return false;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function baseDoc(): MapDocumentV5 {
  return {
    v: 5,
    world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [],
    layers: [],
  };
}

function weirdDoc(): MapDocumentV5 {
  const base = baseDoc();
  return {
    ...base,
    layers: [
      {
        id: "l-labels",
        name: "Labels",
        visible: true,
        locked: false,
        opacity: 1,
        kind: "label",
        items: [{ id: "lbl-1", position: { x: 1.5, y: 1.5 }, text: "TOP" }],
      },
      {
        id: "l-terrain-1",
        name: "Terrain",
        visible: true,
        locked: false,
        opacity: 1,
        kind: "terrain",
        defaultMaterial: { type: "builtin", key: "terrain/forest" },
        representation: "cells",
        cells: [],
      },
      {
        id: "l-game",
        name: "Gameplay",
        visible: true,
        locked: false,
        opacity: 1,
        kind: "gameplay",
        items: [
          {
            id: "room-1",
            kind: "room",
            geometry: { type: "rect", x: 2, y: 0, w: 2, h: 2 },
            roomType: "treasury",
            name: "ROOMX",
          },
        ],
      },
      {
        id: "l-paths",
        name: "Roads",
        visible: true,
        locked: false,
        opacity: 1,
        kind: "path",
        paths: [
          {
            id: "river-1",
            kind: "river",
            geometry: { type: "cell-network", cells: [{ x: 4, y: 0 }, { x: 4, y: 1 }] },
            width: 1,
            styleRef: { type: "builtin", key: "river" },
          },
        ],
      },
      {
        id: "l-terrain-2",
        name: "Terrain 2",
        visible: true,
        locked: false,
        opacity: 1,
        kind: "terrain",
        defaultMaterial: { type: "builtin", key: "terrain/lava" },
        representation: "cells",
        cells: [],
      },
    ],
  };
}

function renderCalls(doc: MapDocumentV5, patch: Partial<RenderOptions> = {}): string[] {
  const { model } = createV5RenderModel(doc);
  const { ctx, calls } = makeCtx();
  renderMap(ctx, 400, 400, {
    grid: "square",
    width: 8,
    height: 8,
    model,
    scale: 24,
    ox: 10,
    oy: 10,
    showGrid: false,
    showCoords: false,
    hover: null,
    chrome: CHROME,
    playerView: false,
    selectedId: null,
    ...patch,
  });
  return calls;
}

const q = (s: string) => JSON.stringify(s);

describe("layer render order (§117)", () => {
  it("Labels → Terrain → Gameplay → Roads → Terrain 2 рисуются именно так", () => {
    const calls = renderCalls(weirdDoc());
    const idxLabel = calls.findIndex((c) => c.startsWith('fillText("TOP"'));
    const idxTerrain1 = calls.findIndex((c) => c === `set:fillStyle=${q(MAP_TERRAIN_FILL.forest)}`);
    const idxRoom = calls.findIndex((c) => c.startsWith('fillText("ROOMX"'));
    const idxRiver = calls.findIndex((c) => c === `set:strokeStyle=${q("#4E7E96")}`);
    const idxTerrain2 = calls.findIndex((c) => c === `set:fillStyle=${q(MAP_TERRAIN_FILL.lava)}`);
    expect([idxLabel, idxTerrain1, idxRoom, idxRiver, idxTerrain2].every((i) => i >= 0)).toBe(true);
    expect(idxLabel).toBeLessThan(idxTerrain1);
    expect(idxTerrain1).toBeLessThan(idxRoom);
    expect(idxRoom).toBeLessThan(idxRiver);
    expect(idxRiver).toBeLessThan(idxTerrain2);
  });

  it("перестановка слоёв меняет порядок отрисовки", () => {
    const doc = weirdDoc();
    const reversed: MapDocumentV5 = { ...doc, layers: [...doc.layers].reverse() };
    const calls = renderCalls(reversed);
    const idxLabel = calls.findIndex((c) => c.startsWith('fillText("TOP"'));
    const idxTerrain2 = calls.findIndex((c) => c === `set:fillStyle=${q(MAP_TERRAIN_FILL.lava)}`);
    expect(idxLabel).toBeGreaterThan(-1);
    expect(idxTerrain2).toBeGreaterThan(-1);
    // Теперь Terrain 2 нижний, Labels верхние.
    expect(idxTerrain2).toBeLessThan(idxLabel);
  });
});

describe("visibility (§119)", () => {
  it("hidden слой даёт 0 content draw calls", () => {
    const doc = weirdDoc();
    // Terrain 2 скрыт: его lava-заливки нет, forest нижнего — есть.
    const noT2: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "l-terrain-2" ? { ...l, visible: false } : l)),
    };
    const calls = renderCalls(noT2);
    expect(calls.some((c) => c === `set:fillStyle=${q(MAP_TERRAIN_FILL.lava)}`)).toBe(false);
    expect(calls.some((c) => c === `set:fillStyle=${q(MAP_TERRAIN_FILL.forest)}`)).toBe(true);
    // Скрытый label-слой: текста TOP нет.
    const noLabel: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "l-labels" ? { ...l, visible: false } : l)),
    };
    expect(renderCalls(noLabel).some((c) => c.startsWith('fillText("TOP"'))).toBe(false);
    // Скрытый gameplay: ROOMX нет.
    const noGame: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "l-game" ? { ...l, visible: false } : l)),
    };
    expect(renderCalls(noGame).some((c) => c.startsWith('fillText("ROOMX"'))).toBe(false);
    // Скрытый path: воды нет.
    const noPath: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "l-paths" ? { ...l, visible: false } : l)),
    };
    expect(renderCalls(noPath).some((c) => c === `set:strokeStyle=${q("#4E7E96")}`)).toBe(false);
  });
});

describe("opacity (§120)", () => {
  it("layer opacity применяется ко всему content; внутренние alpha умножаются", () => {
    const doc = weirdDoc();
    const half: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) => (l.id === "l-game" ? { ...l, opacity: 0.5 } : l)),
    };
    const calls = renderCalls(half);
    // fmt пишет float через toPrecision(12): 0.5 → "0.500000000000".
    expect(calls.some((c) => c.startsWith("set:globalAlpha=0.5"))).toBe(true);
    // Имя комнаты рисуется с 0.8 внутри слоя 0.5 → effective 0.4.
    expect(calls).toContain(`set:globalAlpha=${(0.5 * 0.8).toPrecision(12)}`);
  });

  it("terrain opacity 0.5 + motif alpha 0.32 → 0.16", () => {
    const doc = weirdDoc();
    const half: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === "l-terrain-1" && l.kind === "terrain"
          ? {
              ...l,
              opacity: 0.5,
              cells: [{ x: 0, y: 0, material: { type: "builtin", key: "terrain/lava" } }],
            }
          : l,
      ),
    };
    const calls = renderCalls(half);
    expect(calls).toContain(`set:globalAlpha=${(0.5 * 0.32).toPrecision(12)}`);
  });
});

describe("gameplay items order (§16)", () => {
  it("сущности рисуются в порядке items[], без сортировки по kind", () => {
    const doc = weirdDoc();
    const two: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === "l-game" && l.kind === "gameplay"
          ? {
              ...l,
              items: [
                {
                  id: "trap-1",
                  kind: "trap",
                  position: { x: 5.5, y: 5.5 },
                  trapKind: "pit",
                },
                ...l.items,
              ],
            }
          : l,
      ),
    };
    const calls = renderCalls(two);
    // Глиф ловушки (fillText) идёт раньше имени комнаты — порядок items.
    const trapGlyph = calls.findIndex((c) => c.startsWith("fillText(") && !c.includes("ROOMX"));
    const room = calls.findIndex((c) => c.startsWith('fillText("ROOMX"'));
    expect(trapGlyph).toBeGreaterThan(-1);
    expect(room).toBeGreaterThan(-1);
    expect(trapGlyph).toBeLessThan(room);
  });
});
