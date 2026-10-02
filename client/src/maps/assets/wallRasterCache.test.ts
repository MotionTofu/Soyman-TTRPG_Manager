import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderPath } from "../renderModel";
import { drawCachedWalls } from "./wallRasterCache";
import { drawWallPolyline } from "./wallArtwork";

vi.mock("./wallArtwork", () => ({ drawWallPolyline: vi.fn() }));
vi.mock("./artwork", () => ({ artworkImage: () => null }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("wall viewport cache", () => {
  it("keeps five unchanged walls cached at DPR 2, including overlapping translucent walls", () => {
    const pens: { globalAlpha: number }[] = [];
    const createElement = vi.fn(() => {
      const pen = { setTransform: vi.fn(), globalAlpha: 1 }; pens.push(pen);
      return { width: 0, height: 0, getContext: () => pen };
    });
    vi.stubGlobal("document", { createElement });
    const stack: number[] = [];
    const ctx = { canvas: {}, globalAlpha: .4, getTransform: () => ({ a: 2, b: 0, c: 0, d: 2 }), drawImage: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop()!; } };
    const paths: RenderPath[] = Array.from({ length: 5 }, (_, i) => ({ kind: "wall", width: .36, closed: false,
      cells: new Set<string>(), nodes: [{ position: { x: i, y: 0 } }, { position: { x: i, y: 8 } }] }));
    const draw = (walls: RenderPath[], scale = 54) => drawCachedWalls(ctx as unknown as CanvasRenderingContext2D, walls, scale, 0, 0, 1600, 900, 2);
    draw(paths);
    const initialTiles = createElement.mock.calls.length;
    expect(initialTiles).toBeGreaterThan(0);
    expect(createElement.mock.results.reduce((sum, result) => sum + result.value.width * result.value.height * 4, 0)).toBeLessThan(64 * 1024 * 1024);
    expect(pens.every(pen => pen.globalAlpha === .4)).toBe(true);
    expect(ctx.globalAlpha).toBe(.4);
    draw(paths.map(path => ({ ...path })));
    drawCachedWalls(ctx as unknown as CanvasRenderingContext2D, paths, 54, -20, -20, 1600, 900, 2);
    expect(createElement).toHaveBeenCalledTimes(initialTiles);
    expect(drawWallPolyline).toHaveBeenCalledTimes(initialTiles * 5);
    expect(ctx.drawImage).toHaveBeenCalledTimes(initialTiles * 3);
    // Continuous camera scales in the same backing level reuse every tile.
    draw(paths, 55);
    expect(createElement).toHaveBeenCalledTimes(initialTiles);
    draw(paths, 65);
    const zoomedTiles = createElement.mock.calls.length;
    expect(zoomedTiles).toBeGreaterThan(initialTiles);
    draw(paths);
    expect(createElement).toHaveBeenCalledTimes(zoomedTiles);
    // Editing another wall in the group must invalidate it, despite the stable first wall.
    const beforeEdit = vi.mocked(drawWallPolyline).mock.calls.length;
    draw(paths.map((path, i) => i === 4 ? { ...path, width: .8 } : path));
    expect(vi.mocked(drawWallPolyline).mock.calls.length).toBeGreaterThan(beforeEdit);
    expect(ctx.globalAlpha).toBe(.4);
  });
});
