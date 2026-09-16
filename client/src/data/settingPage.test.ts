import { describe, expect, it } from "vitest";
import { matchesAffect, dataKeys } from "./entities";
import { chronicleEventAffects, chroniclePaths, populationPaths, wizardAffects } from "./settingPage";

describe("страница Сеттинга в слое данных", () => {
  it("списки «Населения» без фильтров совпадают с путями счётчиков на вкладках", () => {
    expect(populationPaths.beings(3)).toBe("/setting-beings?setting_id=3&exclude_category=bestiary");
    expect(populationPaths.bestiary(3)).toBe("/setting-beings?setting_id=3&category=bestiary");
    expect(populationPaths.communities(3)).toBe("/setting-communities?setting_id=3&parent_id=null");
  });

  it("клиентские сортировки не попадают в путь, серверные — попадают", () => {
    expect(populationPaths.beings(3, { sort: "community" })).toBe(populationPaths.beings(3));
    expect(populationPaths.bestiary(3, { sort: "creature_type" })).toBe(populationPaths.bestiary(3));
    expect(populationPaths.beings(3, { sort: "recent", dir: "desc" })).toContain("sort=recent&dir=desc");
  });

  it("фильтр сообществ по локации или поиску ищет по всем уровням", () => {
    expect(populationPaths.communities(3, { locationId: "7" })).not.toContain("parent_id");
    expect(populationPaths.communities(3, { query: "гильдия" })).not.toContain("parent_id");
  });

  it("правка события задевает список хроники и карточку события, но не другие сеттинги", () => {
    const affects = chronicleEventAffects(3, 4);
    const hit = (key: readonly unknown[]) => affects.some((a) => matchesAffect(key, a));
    expect(hit(dataKeys.resource(chroniclePaths.events(3)))).toBe(true);
    expect(hit(dataKeys.entity("setting_event", 4))).toBe(true);
    expect(hit(dataKeys.resource(chroniclePaths.events(30)))).toBe(false);
    expect(hit(dataKeys.resource(chroniclePaths.cycles(3)))).toBe(false);
  });

  it("мастер создания обновляет списки «Населения» и хронику", () => {
    const affects = wizardAffects(3);
    const hit = (key: readonly unknown[]) => affects.some((a) => matchesAffect(key, a));
    expect(hit(dataKeys.resource(populationPaths.bestiary(3)))).toBe(true);
    expect(hit(dataKeys.resource(chroniclePaths.events(3)))).toBe(true);
  });
});
