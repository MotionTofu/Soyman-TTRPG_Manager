// Layer-driven renderer tests (Фаза 3A, §117–120): порядок слоёв,
// visibility-skip, opacity-умножение, items-order внутри gameplay.
// Mocked ctx с эмуляцией globalAlpha (как в renderParity.test.ts).

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { MapDocumentV5 } from "./core/types";
import { createTerrainMaskLayer } from "./core/mutations/layers";
import { floodTerrainMask, paintTerrainMask } from "./core/mutations/terrainMask";
import { projectMapDocumentForPlayer } from "./core/playerProjection";
import { createV5RenderModel } from "./renderModel";
import { MAP_TERRAIN_FILL, renderMap, type MapChrome, type RenderOptions } from "./render";

const CHROME: MapChrome = { paper: "#fff", line: "#000", muted: "#666", ink: "#111" };

function makeCtx(canvas: HTMLCanvasElement | null = null): { ctx: CanvasRenderingContext2D; calls: string[] } {
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
        if (prop === "canvas") return canvas;
        if (prop === "measureText") return (value: string) => ({ width: value.length * 7 });
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

function renderCalls(doc: MapDocumentV5, patch: Partial<RenderOptions> = {}, canvas: HTMLCanvasElement | null = null): string[] {
  const { model } = createV5RenderModel(doc);
  const { ctx, calls } = makeCtx(canvas);
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

describe("exploration overlay", () => {
  it("скрывает клетки у игрока и показывает полупрозрачную подсказку мастеру с инструментом тумана", () => {
    const doc: MapDocumentV5 = { ...baseDoc(), exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }] } };
    const master = renderCalls(doc);
    const player = renderCalls(doc, { playerView: true });
    const guide = renderCalls(doc, { fogGuide: true });
    expect(master).not.toContain('set:fillStyle="#17252A"');
    expect(player).toContain('set:fillStyle="#17252A"');
    expect(guide).toContain('set:fillStyle="#17252A"');
    const guideFog = guide.indexOf('set:fillStyle="#17252A"');
    expect(guide.slice(guideFog, guideFog + 4).some((call) => call.startsWith("set:globalAlpha=0.58"))).toBe(true);
    expect(player.filter((call) => call === "fill()").length).toBeGreaterThan(master.filter((call) => call === "fill()").length);
  });

  it("покрывает видимые гексы после сдвига камеры", () => {
    const doc: MapDocumentV5 = {
      ...baseDoc(),
      grid: { type: "hex", cellSize: 1, columns: 18, rows: 12, origin: { x: 0, y: 0 } },
      exploration: { enabled: true, revealedCells: [] },
    };
    const calls = renderCalls(doc, {
      grid: "hex", width: 18, height: 12, scale: 40, ox: -300, oy: -100, playerView: true,
    });
    // Верхняя вершина (5, 4) видна при x≈46, y=100. Старый квадратный
    // отсев начинал рисовать с колонки 6 и оставлял её открытой.
    expect(calls).toContain(`moveTo(${(Math.sqrt(3) * 5 * 40 - 300).toPrecision(12)},100)`);
  });
});

describe("free roads and rivers", () => {
  it("renders Bézier road segments as curves", () => {
    const doc: MapDocumentV5 = { ...baseDoc(), layers: [{
      id: "curves", name: "Curves", kind: "path", visible: true, locked: false, opacity: 1,
      paths: [{ id: "curve", kind: "road", width: 0.22,
        styleRef: { type: "builtin", key: "road" }, geometry: { type: "spline", nodes: [
          { position: { x: 1, y: 1 }, out: { x: 1.5, y: 1 } },
          { position: { x: 2, y: 2 }, in: { x: 1.5, y: 2 } },
        ] } }],
    }] };
    expect(createV5RenderModel(doc).diagnostics).toEqual([]);
    expect(renderCalls(doc).some((call) => call.startsWith("bezierCurveTo("))).toBe(true);
  });

  it("smoothly changes the drawn width between spline points", () => {
    const doc: MapDocumentV5 = { ...baseDoc(), layers: [{
      id: "paths", name: "Paths", kind: "path", visible: true, locked: false, opacity: 1,
      paths: [{ id: "varying-road", kind: "road", width: 0.2,
        styleRef: { type: "builtin", key: "road" }, geometry: { type: "spline", nodes: [
          { position: { x: 1, y: 1 }, width: 0.2 },
          { position: { x: 3, y: 1 }, width: 0.8 },
        ] } }],
    }] };
    const calls = renderCalls(doc);
    const widths = calls.filter((call) => call.startsWith("set:lineWidth="))
      .map((call) => Number(call.slice("set:lineWidth=".length)));
    expect(widths.some((width) => width > 5 && width < 19)).toBe(true);
    expect(widths.some((width) => width > 17)).toBe(true);
  });

  it("renders world-coordinate lines with the chosen width and keeps paths on their layer", () => {
    const doc: MapDocumentV5 = { ...baseDoc(), layers: [{
      id: "free-paths", name: "Paths", kind: "path", visible: true, locked: false, opacity: 1,
      paths: [
        { id: "road", kind: "road", geometry: { type: "spline", nodes: [
          { position: { x: 1.2, y: 1.3 } }, { position: { x: 2.2, y: 1.8 } },
        ] }, width: 0.3, styleRef: { type: "builtin", key: "road" } },
        { id: "river", kind: "river", geometry: { type: "spline", nodes: [
          { position: { x: 3.2, y: 2.3 } }, { position: { x: 4.2, y: 2.8 } },
        ] }, width: 0.22, styleRef: { type: "builtin", key: "river" } },
      ],
    }] };
    const { diagnostics } = createV5RenderModel(doc);
    expect(diagnostics).toEqual([]);
    const calls = renderCalls(doc);
    expect(calls).toContain("moveTo(38.8000000000,41.2000000000)");
    expect(calls).toContain("lineTo(62.8000000000,53.2000000000)");
    expect(calls).toContain("set:lineWidth=7.20000000000");
    expect(calls).toContain(`set:strokeStyle=${q("#4E7E96")}`);
  });
});

describe("terrain mask overlay", () => {
  it("covers detailed terrain on hidden player cells", () => {
    const created = createTerrainMaskLayer(baseDoc(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    const painted = paintTerrainMask(created.document, "mask", 1.25, 1.25, 0.2,
      { type: "builtin", key: "terrain/forest" }, () => "chunk");
    if (!painted.ok) throw new Error("fixture failed");
    const doc: MapDocumentV5 = {
      ...painted.document,
      exploration: { enabled: true, revealedCells: [] },
    };
    const master = renderCalls(doc);
    const player = renderCalls(projectMapDocumentForPlayer(doc), { playerView: true });
    const terrainIndex = master.indexOf(`set:fillStyle=${q(MAP_TERRAIN_FILL.forest)}`);
    const fogIndex = player.indexOf('set:fillStyle="#17252A"');
    expect(terrainIndex).toBeGreaterThan(-1);
    expect(player).not.toContain(`set:fillStyle=${q(MAP_TERRAIN_FILL.forest)}`);
    expect(fogIndex).toBeGreaterThan(-1);
    expect(master).not.toContain('set:fillStyle="#17252A"');
    expect(player.slice(fogIndex).filter((call) => call === "fill()")).toHaveLength(64);
  });

  it("uses a cached, smoothed bitmap in a browser canvas", () => {
    const created = createTerrainMaskLayer(baseDoc(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    const painted = paintTerrainMask(created.document, "mask", 1.25, 1.25, 0.2,
      { type: "builtin", key: "terrain/forest" }, () => "chunk");
    if (!painted.ok) throw new Error("fixture failed");
    const putImageData = vi.fn();
    const source = {
      width: 0, height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData,
      }),
    } as unknown as HTMLCanvasElement;
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(source);
    try {
      const { model } = createV5RenderModel(painted.document);
      const surface = {} as HTMLCanvasElement;
      const run = () => {
        const { ctx, calls } = makeCtx(surface);
        renderMap(ctx, 400, 400, {
          grid: "square", width: 8, height: 8, model, scale: 24, ox: 10, oy: 10,
          showGrid: false, showCoords: false, hover: null, chrome: CHROME,
          playerView: false, selectedId: null,
        });
        return calls;
      };
      const first = run();
      const second = run();
      expect(first).toContain("set:imageSmoothingEnabled=true");
      expect(first).toContain('set:imageSmoothingQuality="high"');
      expect(first).toContain("clip()");
      expect(first.some((call) => call.startsWith("drawImage("))).toBe(true);
      expect(second.some((call) => call.startsWith("drawImage("))).toBe(true);
      expect(createElement).toHaveBeenCalledTimes(1);
      expect(putImageData).toHaveBeenCalledTimes(1);
      const playerCalls = renderCalls(projectMapDocumentForPlayer(painted.document), {}, surface);
      expect(playerCalls.some((call) => call.startsWith("drawImage("))).toBe(true);
    } finally {
      createElement.mockRestore();
    }
  });

  it("draws a dense fill as row runs rather than one rectangle per sample", () => {
    const created = createTerrainMaskLayer(baseDoc(), { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    let chunk = 0;
    const filled = floodTerrainMask(created.document, "mask", 4, 4,
      { type: "builtin", key: "terrain/forest" }, () => `chunk-${++chunk}`);
    if (!filled.ok) throw new Error("fixture failed");
    const calls = renderCalls(filled.document);
    expect(calls.filter((call) => call.startsWith("fillRect("))).toHaveLength(34);
  });
  it("paints finer samples while unpainted areas keep the lower terrain", () => {
    const base: MapDocumentV5 = { ...baseDoc(), layers: [{
      id: "base", name: "Base", kind: "terrain", representation: "cells",
      defaultMaterial: { type: "builtin", key: "terrain/lava" }, cells: [],
      visible: true, locked: false, opacity: 1,
    }] };
    const created = createTerrainMaskLayer(base, { id: "mask", name: "Mask" });
    if (!created.ok) throw new Error("fixture failed");
    const painted = paintTerrainMask(created.document, "mask", 1.25, 1.25, 0.2,
      { type: "builtin", key: "terrain/forest" }, () => "chunk");
    if (!painted.ok) throw new Error("fixture failed");
    const calls = renderCalls(painted.document);
    expect(calls.filter((call) => call === "fillRect(10,10,192,192)")).toHaveLength(1);
    expect(calls).toContain(`set:fillStyle=${q(MAP_TERRAIN_FILL.lava)}`);
    expect(calls).toContain(`set:fillStyle=${q(MAP_TERRAIN_FILL.forest)}`);
    expect(renderCalls(projectMapDocumentForPlayer(painted.document)).filter((call) => call === "fillRect(10,10,192,192)")).toHaveLength(1);
  });
});

describe("layer render order (§117)", () => {
  it("draws a registered symbol in its object layer", () => {
    const doc: MapDocumentV5 = {
      ...baseDoc(),
      assetPacks: [{ id: "soyman-symbols", version: "1" }],
      layers: [{
        id: "symbols", name: "Symbols", kind: "object", visible: true, locked: false, opacity: 0.5,
        items: [{ id: "symbol-1", transform: { position: { x: 2.25, y: 3.5 }, rotation: 45, scale: { x: 2, y: 2 } }, visual: { type: "asset", assetId: "soyman-symbols:tree" } }],
      }],
    };
    const calls = renderCalls(doc, { selectedId: "symbol-1" });
    expect(calls).toContain("rotate(0.785398163397)");
    expect(calls).toContain("scale(48,48)");
    expect(calls).toContain("strokeRect(-24,-24,48,48)");
    const outline = calls.indexOf("strokeRect(-24,-24,48,48)");
    expect(calls.slice(outline - 5, outline)).toContain("set:lineWidth=2");
    const enlarged: MapDocumentV5 = { ...doc, layers: doc.layers.map(layer => layer.kind === "object"
      ? { ...layer, items: layer.items.map(item => ({ ...item, transform: { ...item.transform, scale: { x: 4, y: 8 } } })) } : layer) };
    const largeCalls = renderCalls(enlarged, { selectedId: "symbol-1", scale: 48 });
    const largeOutline = largeCalls.indexOf("strokeRect(-96,-192,192,384)");
    expect(largeOutline).toBeGreaterThan(-1);
    expect(largeCalls.slice(largeOutline - 5, largeOutline)).toContain("set:lineWidth=2");
    expect(largeCalls.slice(largeOutline - 5, largeOutline).some(call => call.startsWith("scale("))).toBe(false);
  });
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


describe("grid and token stacking", () => {
  it("places the grid between terrain/paths and foreground artwork", () => {
    const calls = renderCalls(weirdDoc(), { showGrid: true, gridColor: "#ffe14a" });
    const grid = calls.indexOf('set:strokeStyle="#ffe14a"');
    const room = calls.findIndex(call => call.includes('"ROOMX"'));
    expect(grid).toBeGreaterThan(-1);
    expect(room).toBeGreaterThan(grid);
    const strokes = calls.slice(0, grid).filter(call => call === "stroke()");
    expect(strokes.length).toBeGreaterThan(0);
  });

  it.each([[100, 1, .5], [200, 1, 1], [100, 2, 1], [50, 2, .5], [100, .5, .375], [100, .75, .375], [100, 3, 1], [200, 3, 2]])("scales the label with zoom %s and token size %s, bounded to 0.75–2 cells", (zoom, size, expectedScale) => {
    const { model } = createV5RenderModel(baseDoc());
    const token = { id: "sizing", kind: "token" as const, sourceRef: null, position: { x: 1, y: 1 }, size, rotation: 0,
      appearance: { shape: "circle" as const, visual: { type: "builtin" as const, key: "being" as const } },
      label: { mode: "custom" as const, text: "NAME" }, playerVisibility: "public" as const };
    const { ctx, calls } = makeCtx();
    renderMap(ctx, 400, 400, { grid: "square", width: 8, height: 8,
      model: { ...model, layers: [{ id: "tokens", name: "Tokens", kind: "gameplay", visible: true, locked: false, opacity: 1, items: [{ kind: "token", token }] }] },
      scale: zoom, ox: 0, oy: 0, showGrid: false, showCoords: false, hover: null, chrome: CHROME, playerView: false, selectedId: null });
    const font = calls.findIndex(call => call.startsWith('set:font="700 24px'));
    const transform = calls.slice(0, font).findLast(call => call.startsWith("scale("))!;
    const factors = JSON.parse("[" + transform.slice(6, -1) + "]");
    expect(factors[0]).toBeCloseTo(expectedScale);
    expect(factors[1]).toBeCloseTo(expectedScale);
    const anchorCall = calls.slice(0, font).findLast(call => call.startsWith("translate("))!;
    const anchor = JSON.parse("[" + anchorCall.slice(10, -1) + "]");
    expect(anchor[0]).toBeCloseTo(zoom);
    expect(anchor[1]).toBeCloseTo(zoom + size * zoom / 2);
    const angleCall = calls.slice(0, font).findLast(call => call.startsWith("rotate("))!;
    expect(Math.abs(Number(angleCall.slice(7, -1)))).toBeLessThanOrEqual(6 * Math.PI / 180);
  });

  it("draws token portraits and tape labels after the grid, and fog above them", () => {
    const { model } = createV5RenderModel(baseDoc());
    const token = { id: "token-test", kind: "token" as const, sourceRef: null, position: { x: 3, y: 3 }, size: 1, rotation: 0,
      appearance: { shape: "circle" as const, visual: { type: "builtin" as const, key: "being" as const } },
      label: { mode: "custom" as const, text: "TOKEN_NAME" }, playerVisibility: "public" as const };
    const { ctx, calls } = makeCtx();
    renderMap(ctx, 400, 400, { grid: "square", width: 8, height: 8,
      model: { ...model, layers: [...model.layers, { id: "tokens", name: "Tokens", kind: "gameplay", visible: true, locked: false, opacity: .5, items: [{ kind: "token", token }] }], exploration: { enabled: true, revealedCells: new Set() } },
      scale: 24, ox: 10, oy: 10, showGrid: true, gridColor: "#ffe14a", gridOpacity: .7, showCoords: false, hover: null, chrome: CHROME, playerView: true, selectedId: null });
    const grid = calls.indexOf('set:strokeStyle="#ffe14a"');
    const name = calls.findIndex(call => call.startsWith('fillText("TOKEN_NAME"'));
    const fog = calls.indexOf('set:fillStyle="#17252A"');
    expect(grid).toBeGreaterThan(-1);
    expect(Number(calls[grid + 1].split("=")[1])).toBeCloseTo(.7);
    expect(name).toBeGreaterThan(grid);
    expect(calls.slice(grid, name)).toContain('translate(82,94)');
    expect(calls.slice(grid, name).some(call => call.startsWith('set:font="700 24px'))).toBe(true);
    expect(calls[name]).toMatch(/^fillText\("TOKEN_NAME",0,0,/);
    expect(fog).toBeGreaterThan(name);
    expect(calls.slice(grid, name).filter(call => call.startsWith("set:globalAlpha=")).some(call => Number(call.split("=")[1]) === .5)).toBe(true);
  });
});
