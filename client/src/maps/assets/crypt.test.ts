import { describe, expect, it } from "vitest";
import { hasRasterAsset } from "../../rasterAssets";
import { CRYPT_OBJECTS, CRYPT_SIDES, CRYPT_STYLE_KEYS, cryptObject, cryptSide } from "./crypt";
import { mapAssetPackForId } from "./registry";

describe("набор «Склеп»", () => {
  it("у каждого предмета есть файл, у поворотного — все четыре вида", () => {
    for (const item of CRYPT_OBJECTS) {
      const keys = item.directional ? CRYPT_SIDES.map((side) => `${item.key}-${side}`) : [item.key];
      for (const key of keys) expect(hasRasterAsset("crypt", key), key).toBe(true);
    }
    for (const key of CRYPT_STYLE_KEYS) expect(hasRasterAsset("crypt", key), key).toBe(true);
  });

  it("поворот выбирает сторону шагом 90°", () => {
    expect([0, 90, 180, 270, 360, -90, 44, 46].map(cryptSide)).toEqual(["s", "w", "n", "e", "s", "e", "s", "w"]);
  });

  it("предмет набора ссылается на свой набор, а не на «Бумагу и тушь»", () => {
    expect(mapAssetPackForId("soyman-crypt:throne")).toEqual({ id: "soyman-crypt", version: "1" });
    expect(cryptObject("soyman-crypt:altar")?.cells).toEqual([2, 1]);
    expect(cryptObject("soyman-cartography:altar")).toBeNull();
  });
});
