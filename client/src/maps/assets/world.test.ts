import { expect, it } from "vitest";
import { rasterAsset } from "../../rasterAssets";
import { packOfAsset } from "./packs";
import { WORLD_OBJECT_KEYS, WORLD_SURFACES, pickVariant, worldId, worldSurfaceCode, worldSurfaceKey } from "./world";

it("«Мир»: у каждой вещи и поверхности есть картинка, вариант выбирается из семейства, вещь числится за набором", () => {
  for (const key of [...WORLD_OBJECT_KEYS, ...WORLD_SURFACES.map((item) => item.key)]) expect(rasterAsset("world", key), key).toBeTruthy();
  expect(pickVariant(`${worldId("mountains")}*`, () => 0.99)).toBe(worldId("mountains-3"));
  expect(pickVariant(`${worldId("capital")}*`, () => 0.99)).toBe(worldId("capital"));
  expect(pickVariant("soyman-village:well*", () => 0.99)).toBe("soyman-village:well-2");
  expect(worldSurfaceKey(worldSurfaceCode("forest-floor"))).toBe("forest-floor");
  expect(worldSurfaceKey("world-lava")).toBeNull();
  expect(packOfAsset(worldId("tower"))).toBe("world");
});
