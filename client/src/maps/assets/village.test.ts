import { describe, expect, it } from "vitest";
import { hasRasterAsset } from "../../rasterAssets";
import { VILLAGE_OBJECTS, VILLAGE_ROAD_KEYS, VILLAGE_SCATTER, VILLAGE_SURFACE_KEYS, pickVariant, randomVariantId, variantKeys, villageObject, villageSurfaceKey } from "./village";
import { mapAssetPackForId } from "./registry";

describe("набор «Местность»", () => {
  it("у каждого варианта предмета, поверхности и россыпи есть файл", () => {
    const keys = [...VILLAGE_OBJECTS.flatMap((item) => variantKeys(item.key, item.variants)), ...VILLAGE_SURFACE_KEYS, ...VILLAGE_ROAD_KEYS,
      ...VILLAGE_SCATTER.flatMap((item) => item.assetIds.map((id) => id.split(":")[1]))];
    for (const key of keys) expect(hasRasterAsset("village", key), key).toBe(true);
  });

  it("«случайный» разворачивается в конкретный вариант семейства, конкретный не меняется", () => {
    expect(pickVariant(randomVariantId("well"), () => 0)).toBe("soyman-village:well");
    expect(pickVariant(randomVariantId("well"), () => 0.99)).toBe("soyman-village:well-2");
    expect(pickVariant(randomVariantId("hut"), () => 0.99)).toBe("soyman-village:hut");
    expect(pickVariant("soyman-village:well-2")).toBe("soyman-village:well-2");
    expect(pickVariant("soyman-crypt:throne")).toBe("soyman-crypt:throne");
  });

  it("вариант знает своё семейство и набор; код поверхности не путается с общими", () => {
    expect(villageObject("soyman-village:cart-2")?.cells).toEqual([1, 2]);
    expect(mapAssetPackForId("soyman-village:cart-2")).toEqual({ id: "soyman-village", version: "1" });
    expect(villageSurfaceKey("village-grass-2")).toBe("grass-2");
    expect(villageSurfaceKey("plain")).toBeNull();
  });
});
