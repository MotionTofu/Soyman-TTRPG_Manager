import { describe, expect, it } from "vitest";
import { rasterDensity } from "./rasterDensity";

describe("artwork backing density", () => {
  it("never falls below screen resolution throughout camera scales and DPRs", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) for (let scale = 4; scale <= 240; scale += .25) {
      const density = scale * dpr, backing = rasterDensity(density);
      expect(backing).toBeGreaterThanOrEqual(density);
      expect(backing / density).toBeLessThanOrEqual(2 ** (1 / 4) + 1e-12);
    }
  });
  it("reuses nearby scales and keeps exact powers of two", () => {
    expect(rasterDensity(54)).toBe(rasterDensity(55));
    expect(rasterDensity(64)).toBe(64);
    expect(rasterDensity(65)).toBeGreaterThan(64);
  });
});
