import { describe, it, expect } from "vitest";
import { dataKeys, entityKindByEndpoint, matchesAffect, type Affect } from "./entities";
import { beingAffects, galleryAffects, locationPaths, relationAffects, settingPaths } from "./settingEntities";
import { compendiumAffects, compendiumPaths } from "./compendiumEntries";

const hits = (path: string, affects: Affect[]) => affects.some((a) => matchesAffect(dataKeys.resource(path), a));

describe("что задевает правка сущности сеттинга", () => {
  it("связь — отношения обеих сторон, а не только открытой", () => {
    const affects = relationAffects();
    expect(hits(settingPaths.relations("being", 416), affects)).toBe(true);
    expect(hits(settingPaths.relations("location", 408), affects)).toBe(true);
    // Зона связей с секцией — тот же ресурс с параметром.
    expect(hits(`${settingPaths.relations("setting_event", 3)}&section=participants`, affects)).toBe(true);
    expect(hits("/entity-relationships", affects)).toBe(false);
    expect(hits(settingPaths.inSetting("being", 1), affects)).toBe(false);
  });

  it("существо — его карточка, подресурсы и списки существ, но не соседнее существо", () => {
    const affects = beingAffects(40);
    expect(matchesAffect(dataKeys.entity("being", 40), affects[0])).toBe(true);
    expect(matchesAffect(dataKeys.entity("being", 408), affects[0])).toBe(false);
    expect(hits("/setting-beings/40", affects)).toBe(true);
    expect(hits(settingPaths.inSetting("being", 1), affects)).toBe(true);
    expect(hits("/setting-beings/408", affects)).toBe(false);
    expect(hits(settingPaths.inSetting("community", 1), affects)).toBe(false);
  });

  it("список вида в сеттинге и карточка локации — пути, которые узнаёт правило вида", () => {
    const location: Affect[] = [{ kind: "location", id: 7 }];
    expect(hits(locationPaths.detail(7), location)).toBe(true);
    expect(hits(locationPaths.plan(7), location)).toBe(true);
    expect(hits(locationPaths.allInSetting(1), location)).toBe(true);
    expect(hits(locationPaths.detail(70), location)).toBe(false);
  });

  it("галерея — только галерея этого владельца", () => {
    const affects = galleryAffects("being", 4);
    expect(hits(settingPaths.gallery("being", 4), affects)).toBe(true);
    expect(hits(settingPaths.gallery("being", 40), affects)).toBe(false);
    expect(hits(settingPaths.gallery("location", 4), affects)).toBe(false);
  });
});

describe("что задевает правка записи компендиума", () => {
  it("карточку записи и записи её системы, но не другую систему", () => {
    const affects = compendiumAffects({ id: 12, system_id: 1 });
    expect(matchesAffect(dataKeys.entity("compendium_entry", 12), affects[0])).toBe(true);
    expect(hits(compendiumPaths.sectionEntries(1, 5), affects)).toBe(true);
    expect(hits(compendiumPaths.sectionEntries(10, 5), affects)).toBe(false);
    expect(hits(compendiumPaths.sections(1), affects)).toBe(false);
  });
});

describe("вид по базовому маршруту", () => {
  it("общий компонент получает маршрут, а правка задевает карточку по виду", () => {
    expect(entityKindByEndpoint("/setting-beings")).toBe("being");
    expect(entityKindByEndpoint("/systems/entries")).toBe("compendium_entry");
    expect(entityKindByEndpoint("/characters")).toBe("character");
    expect(entityKindByEndpoint("/nope")).toBeNull();
  });
});
