// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageHit } from "./imageHit";

afterEach(() => vi.restoreAllMocks());
describe("image selection", () => {
  it("lets the transparent interior of a wall frame pass through, while keeping its edges selectable", () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i++) data[i * 4 + 3] = i === 4 ? 0 : 255;
    const getImageData = vi.fn(() => ({ width: 3, height: 3, data }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D);
    const image = { complete: true, naturalWidth: 3, naturalHeight: 3 } as HTMLImageElement;
    expect(imageHit(image, .5, .5)).toBe(false);
    expect(imageHit(image, 0, .5)).toBe(true);
    expect(imageHit(image, 1, .5)).toBe(true);
    expect(imageHit(image, 1.1, .5)).toBe(false);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });
  it("keeps images selectable while loading or when pixel access is unavailable", () => {
    expect(imageHit(null, .5, .5)).toBe(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw Error("cross-origin"); });
    expect(imageHit({ complete: true, naturalWidth: 3, naturalHeight: 3 } as HTMLImageElement, .5, .5)).toBe(true);
  });
});
