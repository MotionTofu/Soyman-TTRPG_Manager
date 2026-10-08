import { describe, expect, it } from "vitest";
import { ownImageId, ownObjectSize, ownRandomId, pickOwnVariant, registerOwnPacks, type OwnPack, type OwnPackImage } from "./ownPacks";
import { allPacks, connectedPacks, packName, packOfAsset } from "./packs";
import { getMapImageAsset, ownSurfaceCode } from "./registry";
import { ownSurface, ownSurfaceFills } from "./ownPacks";
import { usedPacks } from "./packs";
import type { MapDocumentV6 } from "@shared/maps/core";

const image = (n: number, archived = false): OwnPackImage => ({ id: n, uid: `00000000-0000-4000-8000-00000000000${n}`, role: "variant", width: 768, height: 512, archived, file_url: `/files/MapPacks/p/${n}.webp?sig=x&exp=1` });
const pack = (patch: Partial<OwnPack> = {}): OwnPack => ({ id: 1, uid: "11111111-1111-4111-8111-111111111111", name: "Порт", kinds: ["city"], genres: [], native_style: "comic-punk", archived: false, updated_at: "",
  items: [{ id: 1, uid: "22222222-2222-4222-8222-222222222222", kind: "object", name: "Склад", section: "Постройки", tags: "порт", archived: false, w: 3, h: 2, blocks_sight: false, light: null,
    images: [image(1), image(2), image(3, true)] }], ...patch });

describe("свои наборы ассетов", () => {
  it("картинки набора встают в реестр, размер — длинная сторона в клетках, случайный вариант — только из живых", () => {
    const own = pack(), [first, second, removed] = own.items[0].images.map(ownImageId);
    registerOwnPacks([own]);
    expect(getMapImageAsset(first)?.name).toBe("Склад");
    expect(ownObjectSize(first)).toBe(3);
    // Убранный вариант в каталог не попадает, но карта, где он стоит, по-прежнему знает его размер и картинку.
    expect(ownObjectSize(removed)).toBe(3);
    expect(getMapImageAsset(removed)).not.toBeNull();
    const random = ownRandomId(own.items[0]);
    expect(pickOwnVariant(random, () => 0)).toBe(first);
    expect(pickOwnVariant(random, () => 0.99)).toBe(second);
    expect(pickOwnVariant(first)).toBe(first);
  });
  it("свой набор стоит в библиотеке рядом со встроенными и подходит только своим видам карт", () => {
    registerOwnPacks([pack()]);
    expect(allPacks().map((entry) => entry.name)).toContain("Порт");
    expect(connectedPacks(undefined, "city")).toContain("11111111-1111-4111-8111-111111111111");
    expect(connectedPacks(undefined, "tactical")).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(packName("11111111-1111-4111-8111-111111111111")).toBe("Порт");
  });
  it("вид по стороне подменяет поворот картинки; убранный вид не используется", () => {
    const side = (n: number, role: string, archived = false): OwnPackImage => ({ ...image(n, archived), role });
    const own = pack();
    own.items[0].images.push(side(4, "w"), side(5, "e", true));
    registerOwnPacks([own]);
    const views = getMapImageAsset(ownImageId(own.items[0].images[0]))?.views;
    expect(views?.w?.id).toBe(ownImageId(own.items[0].images[3]));
    expect(views?.e).toBeUndefined();
    // Вид стороны — не вариант: случайный выбор его не берёт.
    expect(pickOwnVariant(ownRandomId(own.items[0]), () => 0.99)).toBe(ownImageId(own.items[0].images[1]));
    expect(packOfAsset("soyman-village:hut")).toBe("village");
    expect(packOfAsset("soyman-symbols:tree")).toBe("ink");
    expect(packOfAsset("soyman-resource-images:99999999-9999-4999-8999-999999999999")).toBeNull();
  });
  it("поверхность своего набора — материал `own-<uid>`: период, цвет и набор, которому она принадлежит", () => {
    const own = pack();
    own.items.push({ ...own.items[0], id: 2, uid: "33333333-3333-4333-8333-333333333333", kind: "surface", name: "Плитка", cells: 2, fill: "#445566", images: [image(7)] });
    registerOwnPacks([own]);
    const code = ownSurfaceCode(image(7).uid);
    expect(ownSurface(code)).toEqual({ assetId: ownImageId(image(7)), cells: 2 });
    expect(ownSurfaceFills()[code]).toBe("#445566");
    // Карта, закрашенная этой поверхностью и травой «Деревни», числит за собой оба набора; вода набором не считается.
    const layer = (keys: string[]) => ({ kind: "terrain", defaultMaterial: { type: "builtin", key: "terrain/plain" }, representation: "mask", mask: { materials: keys.map((key) => ({ type: "builtin", key: `terrain/${key}` })) } });
    expect(usedPacks({ layers: [layer([code, "village-grass-2", "village-water-3"])] } as unknown as MapDocumentV6).sort()).toEqual([own.uid, "village"].sort());
    // В архиве поверхность не красится картинкой, но цвет остаётся.
    registerOwnPacks([{ ...own, archived: true }]);
    expect(ownSurface(code)).toBeNull();
    expect(ownSurfaceFills()[code]).toBe("#445566");
  });
  it("набор в архиве уходит из библиотеки, его размеры забываются — на карте заглушка", () => {
    const archived = pack({ archived: true });
    registerOwnPacks([archived]);
    expect(allPacks().map((entry) => entry.name)).not.toContain("Порт");
    expect(ownObjectSize(ownImageId(archived.items[0].images[0]))).toBeNull();
    // Картинка остаётся в реестре заглушкой с названием набора и помнит свой набор; вернули набор — заглушка снята.
    expect(getMapImageAsset(ownImageId(archived.items[0].images[0]))).toMatchObject({ missing: "«Порт» в архиве", image: null });
    expect(packOfAsset(ownImageId(archived.items[0].images[0]))).toBe(archived.uid);
    registerOwnPacks([pack()]);
    expect(getMapImageAsset(ownImageId(archived.items[0].images[0]))?.missing).toBeUndefined();
    registerOwnPacks([archived]);
    // Имя набора остаётся известным: по нему подписывается заглушка.
    expect(packName(archived.uid)).toBe("Порт");
  });
});
