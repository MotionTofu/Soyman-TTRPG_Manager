import { describe, expect, it, vi } from "vitest";
import { drawCachedMapImage } from "./draw";

describe("prefiltered map artwork", () => {
  it("reuses an appropriate image level and preserves the cutout aspect ratio", () => {
    const filtered = vi.fn(), drawImage = vi.fn();
    const canvases: { width: number; height: number; getContext: () => object }[] = [];
    vi.stubGlobal("document", { createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: filtered }) }; canvases.push(canvas); return canvas;
    } });
    try {
      const image = { naturalWidth: 512, naturalHeight: 128 } as HTMLImageElement;
      const ctx = { canvas: {}, drawImage } as unknown as CanvasRenderingContext2D;
      drawCachedMapImage(ctx, image, 20); drawCachedMapImage(ctx, image, 24);
      expect(filtered).toHaveBeenCalledOnce();
      expect(canvases[0]).toMatchObject({ width: 32, height: 8 });
      expect(drawImage).toHaveBeenLastCalledWith(canvases[0], -0.5, -0.125, 1, 0.25);
      drawCachedMapImage(ctx, image, 70);
      expect(filtered).toHaveBeenCalledTimes(2);
      expect(canvases[1]).toMatchObject({ width: 128, height: 32 });
    } finally { vi.unstubAllGlobals(); }
  });
  it("evicts old large levels rather than retaining unlimited image canvases", () => {
    const filtered = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: filtered }) }) });
    try {
      const images = Array.from({ length: 3 }, () => ({ naturalWidth: 4096, naturalHeight: 4096 } as HTMLImageElement));
      const ctx = { canvas: {}, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
      for (const image of images) drawCachedMapImage(ctx, image, 1500);
      expect(filtered).toHaveBeenCalledTimes(3);
      drawCachedMapImage(ctx, images[0], 1500);
      expect(filtered).toHaveBeenCalledTimes(4);
    } finally { vi.unstubAllGlobals(); }
  });
});
