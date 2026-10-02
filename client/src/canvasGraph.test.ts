// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearColorCache, drawGrid, drawNode, drawEdge, fitGraphTitle } from "./canvasGraph";

class TestMatrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
  constructor([a, b, c, d, e, f]: number[]) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }
}

describe("фон графа", () => {
  beforeEach(() => {
    clearColorCache();
    vi.stubGlobal("DOMMatrix", TestMatrix);
    vi.stubGlobal("devicePixelRatio", 1);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--line");
  });

  function setup() {
    const tileCtx = { fillRect: vi.fn(), fillStyle: "" };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(tileCtx as unknown as CanvasRenderingContext2D);
    const pattern = { setTransform: vi.fn() };
    const ctx = {
      fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      createPattern: vi.fn((_tile: CanvasImageSource, _repeat: string) => pattern), fillStyle: "",
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: ctx, pattern, tileCtx };
  }

  it("рисует большой отдалённый граф двумя заливками и переиспользует плитку при движении камеры", () => {
    const { ctx, calls, tileCtx } = setup();
    drawGrid(ctx, 900, 640, 0, 0, 1, 0.046);
    expect(calls.fillRect).toHaveBeenCalledTimes(2);
    drawGrid(ctx, 900, 640, -10000, 800, 6, 0.046);
    expect(calls.fillRect).toHaveBeenCalledTimes(4);
    expect(calls.createPattern).toHaveBeenCalledTimes(1);
    expect(tileCtx.fillRect).toHaveBeenCalledTimes(1);
  });

  it.each([0.001, 0.046, 0.21, 0.5, 1, 4])("при масштабе %s сохраняет шаг от 8 px и привязку точек к миру", (scale) => {
    const { ctx, calls, pattern } = setup();
    const panX = -127.25, panY = 37.5;
    drawGrid(ctx, 900, 640, panX, panY, 1, scale);
    const tile = calls.createPattern.mock.calls[0][0] as HTMLCanvasElement;
    const matrix = pattern.setTransform.mock.calls[0][0] as TestMatrix;
    const step = tile.width * matrix.a;
    expect(step).toBeGreaterThanOrEqual(8);
    const worldStride = step / (8 * scale);
    expect(Math.log2(worldStride)).toBeCloseTo(Math.round(Math.log2(worldStride)));
    expect((matrix.e + step / 2 - panX) / step).toBeCloseTo(Math.round((matrix.e + step / 2 - panX) / step));
    expect((matrix.f + step / 2 - panY) / step).toBeCloseTo(Math.round((matrix.f + step / 2 - panY) / step));
  });

  it("пересоздаёт плитку при смене цвета темы или плотности экрана", () => {
    const { ctx, calls } = setup();
    drawGrid(ctx, 900, 640, 0, 0, 1, 1);
    document.documentElement.style.setProperty("--line", "#123456");
    clearColorCache();
    drawGrid(ctx, 900, 640, 0, 0, 1, 1);
    vi.stubGlobal("devicePixelRatio", 1.5);
    drawGrid(ctx, 900, 640, 0, 0, 1, 1);
    expect(calls.createPattern).toHaveBeenCalledTimes(3);
    const tile = calls.createPattern.mock.calls[2][0] as HTMLCanvasElement;
    expect(tile.width).toBe(24);
  });
});

describe("названия на карточках графа миров", () => {
  const ctx = { measureText: (text: string) => ({ width: Array.from(text).length * 10 }) } as CanvasRenderingContext2D;
  it("сохраняет короткое имя и сокращает длинное до доступной ширины", () => {
    expect(fitGraphTitle(ctx, "Мирт", 100)).toBe("Мирт");
    const title = "Очень длинное название локации";
    const fitted = fitGraphTitle(ctx, title, 120);
    expect(fitted.endsWith("…")).toBe(true);
    expect(ctx.measureText(fitted).width).toBeLessThanOrEqual(120);
    expect(title.startsWith(fitted.slice(0, -1))).toBe(true);
  });
  it("сокращает по символам Unicode, не разрезая знак пополам", () => {
    expect(fitGraphTitle(ctx, "🐉🐉🐉🐉", 30)).toBe("🐉🐉…");
  });
});

describe("шрифт настоящего рендерера карточек", () => {
  afterEach(() => { clearColorCache(); document.documentElement.style.removeProperty("--font-display"); });
  it.each([1, 2, 4])("передаёт готовую строку шрифта с размером %s × 10 px", scale => {
    document.documentElement.style.setProperty("--font-display", '"Graph Font", sans-serif');
    const canvas = document.createElement("canvas");
    const drawn: { text: string; font: string }[] = [];
    const ctx = {
      canvas, font: "10px sans-serif", fillRect() {}, strokeRect() {}, beginPath() {},
      moveTo() {}, lineTo() {}, closePath() {}, fill() {}, rect() {},
      fillText(this: { font: string }, text: string) { drawn.push({ text, font: this.font }); },
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as unknown as CanvasRenderingContext2D;
    drawNode(ctx, { key: "resource:1", type: "resource", id: 1, title: "Название" },
      { x: 400, y: 130, vx: 0, vy: 0 },
      { foldedCount: 0, onPath: false, offPath: false, dim: false, pinned: false, scale, focused: false, fitScale: 1, clipTitle: true });
    expect(drawn).toEqual([{ text: "Название", font: `400 ${10 * scale}px "Graph Font", sans-serif` }]);
    expect(drawn[0].font).not.toContain("var(");
  });
});

describe("читаемые подписи отношений", () => {
  afterEach(() => clearColorCache());
  it.each([
    [1, 0.05, 16, 1000, 1000, Math.PI / 4],
    [1, 1, 16, 1000, 1000, Math.PI / 4],
    [4, 1, 24, 1000, 1000, Math.PI / 4],
    [100, 0.1, 24, 1000, 1000, Math.PI / 4],
    [4, 1, 24, -1000, 1000, -Math.PI / 4],
    [4, 1, 24, -1000, -1000, Math.PI / 4],
    [4, 1, 24, -1000, 0, 0],
  ])(
    "при zoom=%s и fit=%s рисует текст %s px вдоль линии без переворота",
    (zoom, fitScale, expectedSize, toX, toY, expectedAngle) => {
      const texts: { text: string; font: string }[] = [];
      const fills: number[][] = [];
      const rotations = vi.fn(), scales = vi.fn();
      const ctx = {
        font: "10px sans-serif", beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        setLineDash() {}, save() {}, restore() {}, translate() {}, rotate: rotations,
        scale: scales, strokeRect() {},
        fillRect(...args: number[]) { fills.push(args); },
        fillText(this: { font: string }, text: string) { texts.push({ text, font: this.font }); },
        measureText: (text: string) => ({ width: text.length * expectedSize * 0.6 }),
      } as unknown as CanvasRenderingContext2D;
      drawEdge(ctx, { from: "being:1", to: "community:1", kind: "membership", tone: null, section: "участник" },
        { x: 0, y: 0, vx: 0, vy: 0 }, { x: toX, y: toY, vx: 0, vy: 0 }, new Map(), new Map(),
        { onPath: false, offPath: false, dim: false, focused: true, showLabel: true, zoom, fitScale,
          vpMinX: -2000, vpMaxX: 2000, vpMinY: -2000, vpMaxY: 2000 });
      expect(texts).toEqual([{ text: "УЧАСТНИК", font: `600 ${expectedSize}px sans-serif` }]);
      expect(fills[0][3]).toBe(expectedSize + 10);
      expect(rotations).toHaveBeenCalledTimes(1);
      expect(rotations.mock.calls[0][0]).toBeCloseTo(expectedAngle);
      expect(scales).toHaveBeenCalledWith(1 / (zoom * fitScale), 1 / (zoom * fitScale));
    },
  );

  it.each([[1000, 1000], [-1000, 1000], [-1000, -1000], [1000, -1000]])(
    "разносит подписи встречных связей по внешним сторонам при направлении (%s, %s)",
    (x, y) => {
      const centers: number[] = [];
      const a = { x: 0, y: 0, vx: 0, vy: 0 }, b = { x, y, vx: 0, vy: 0 };
      const length = Math.hypot(x, y), nx = -y / length, ny = x / length;
      const options = { onPath: false, offPath: false, dim: false, focused: true, showLabel: true,
        zoom: 4, fitScale: 1, vpMinX: -2000, vpMaxX: 2000, vpMinY: -2000, vpMaxY: 2000 };
      for (const reversed of [false, true]) {
        let originX = 0, originY = 0, rotation = 0;
        const ctx = {
          font: "10px sans-serif", beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {},
          setLineDash() {}, save() {}, restore() {}, scale() {}, strokeRect() {}, fillText() {},
          translate(tx: number, ty: number) { originX = tx; originY = ty; },
          rotate(angle: number) { rotation = angle; },
          fillRect(_left: number, top: number, _width: number, height: number) {
            const offset = (top + height / 2) / options.zoom;
            const cx = originX - Math.sin(rotation) * offset;
            const cy = originY + Math.cos(rotation) * offset;
            centers.push((cx * nx + cy * ny) * options.zoom);
          },
          measureText: () => ({ width: 120 }),
        } as unknown as CanvasRenderingContext2D;
        drawEdge(ctx, { from: reversed ? "being:2" : "being:1", to: reversed ? "being:1" : "being:2",
          kind: "relation", tone: "positive", section: "уважает" }, reversed ? b : a, reversed ? a : b,
          new Map(), new Map([["being:1|being:2", 2]]), options);
      }
      expect(centers[0]).toBeGreaterThan(34 / 2 + 6);
      expect(centers[1]).toBeLessThan(-34 / 2 - 6);
    },
  );
});
