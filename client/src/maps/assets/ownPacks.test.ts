import { describe, expect, it } from "vitest";
import { ownImageId, ownObjectSize, ownRandomId, pickOwnVariant, registerOwnPacks, type OwnPack, type OwnPackImage } from "./ownPacks";
import { allPacks, connectedPacks, packName } from "./packs";
import { getMapImageAsset } from "./registry";

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
  it("набор в архиве уходит из библиотеки, его размеры забываются — на карте заглушка", () => {
    const archived = pack({ archived: true });
    registerOwnPacks([archived]);
    expect(allPacks().map((entry) => entry.name)).not.toContain("Порт");
    expect(ownObjectSize(ownImageId(archived.items[0].images[0]))).toBeNull();
    // Имя набора остаётся известным: по нему подписывается заглушка.
    expect(packName(archived.uid)).toBe("Порт");
  });
});
