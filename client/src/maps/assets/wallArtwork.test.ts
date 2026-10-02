import { afterEach, describe, expect, it, vi } from "vitest";
import { drawWallPolyline } from "./wallArtwork";

vi.mock("./artwork", () => ({ artworkImage: (key: string) => ({ naturalWidth: key === "wall-masonry" ? 204 : 256, naturalHeight: key === "wall-masonry" ? 128 : 256, key }) }));
afterEach(() => vi.unstubAllGlobals());
function context() {
  vi.stubGlobal("DOMMatrix", class { values: number[]; constructor(values: number[]) { this.values = values; } });
  const pattern = { setTransform: vi.fn() };
  const ctx = { createPattern: vi.fn(() => pattern), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), stroke: vi.fn() };
  return { ctx, canvas: ctx as unknown as CanvasRenderingContext2D };
}
describe("wall artwork", () => {
  it("warps the texture along a tapered wall and sizes each end cap to its endpoint", () => {
    const { ctx, canvas } = context();
    drawWallPolyline(canvas, [{ x: 1, y: 1, width: .2 }, { x: 5, y: 1, width: 1 }], .36, false, 50, 0, 0);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(2);
    const caps = ctx.drawImage.mock.calls as unknown[][];
    expect(caps.map(call => call[8])).toEqual([10, 50]);
    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
  });

  it("draws one clipped texture per straight segment and exactly two single end caps for an open wall", () => {
    const { ctx, canvas } = context();
    drawWallPolyline(canvas, [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }], 0.36, false, 50, 0, 0);
    expect(ctx.clip).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    for (const call of ctx.drawImage.mock.calls as unknown[][]) expect(call.slice(1, 5)).toEqual([10, 70, 106, 116]);
    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
  });
  it("keeps taper strips and texture phase identical while omitting strips outside a small tile", () => {
    const points = [{ x: 0, y: 0, width: .2 }, { x: 80, y: 0, width: 1 }];
    const full = context(), tile = context();
    drawWallPolyline(full.canvas, points, .36, false, 50, -1800, 100);
    drawWallPolyline(tile.canvas, points, .36, false, 50, -1800, 100, false, { width: 256, height: 256 });
    const visible = full.ctx.fillRect.mock.calls.filter(([x, , w]) => x + w >= 1800 && x <= 2056);
    expect(tile.ctx.fillRect.mock.calls).toEqual(visible);
    expect(tile.ctx.fillRect.mock.calls.length).toBeLessThan(full.ctx.fillRect.mock.calls.length / 10);
    const fullPattern = full.ctx.createPattern.mock.results[0].value;
    const tilePattern = tile.ctx.createPattern.mock.results[0].value;
    const start = full.ctx.fillRect.mock.calls.indexOf(visible[0]);
    expect(tilePattern.setTransform.mock.calls).toEqual(fullPattern.setTransform.mock.calls.slice(start, start + visible.length));
  });
  it("draws the closing segment without end caps for a closed room", () => {
    const { ctx, canvas } = context();
    drawWallPolyline(canvas, [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }], 0.36, true, 50, 0, 0);
    expect(ctx.clip).toHaveBeenCalledTimes(4);
    expect(ctx.fillRect).toHaveBeenCalledTimes(4);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
  });
});
