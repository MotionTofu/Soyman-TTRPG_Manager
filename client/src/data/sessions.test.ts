import { describe, it, expect } from "vitest";
import { dataKeys, matchesAffect, type Affect } from "./entities";
import {
  launchAffects,
  linkAffects,
  linksPath,
  secretStateAffects,
  sessionAffects,
  sessionMoneyAffects,
  sessionPaths,
} from "./sessions";

const hits = (path: string, affects: Affect[]) => affects.some((a) => matchesAffect(dataKeys.resource(path), a));

describe("что задевает правка сессии", () => {
  it("поля сессии — её подресурсы и список сессий кампании, но не соседнюю сессию и не кампанию", () => {
    const affects = sessionAffects(15, 2);
    expect(matchesAffect(dataKeys.entity("session", 15), affects[0])).toBe(true);
    expect(hits(sessionPaths.castUnion(15), affects)).toBe(true);
    expect(hits(sessionPaths.summary(15), affects)).toBe(true);
    expect(hits(sessionPaths.campaignSessions(2), affects)).toBe(true);
    expect(hits(sessionPaths.summary(150), affects)).toBe(false);
    expect(hits(sessionPaths.campaignCover(2), affects)).toBe(false);
    expect(hits("/campaigns/2", affects)).toBe(false);
  });

  it("деньги и статус задевают и кампанию целиком", () => {
    const affects = sessionMoneyAffects(15, 2);
    expect(affects.some((a) => matchesAffect(dataKeys.entity("campaign", 2), a))).toBe(true);
    expect(hits(sessionPaths.campaignSessions(2), affects)).toBe(true);
    expect(hits("/campaigns/20", affects)).toBe(false);
  });

  it("запуск сцены перечитывает все секции связей сессии — и только её", () => {
    const affects = launchAffects(15);
    expect(hits(linksPath("session", 15, "loot"), affects)).toBe(true);
    expect(hits(linksPath("session", 15, "enemies"), affects)).toBe(true);
    expect(hits(sessionPaths.stage(15), affects)).toBe(true);
    expect(hits(sessionPaths.showState(15), affects)).toBe(true);
    expect(hits(linksPath("session", 150, "loot"), affects)).toBe(false);
    expect(hits(linksPath("scene", 15, "loot"), affects)).toBe(false);
  });

  it("связь в секции задевает все секции своей сущности", () => {
    const affects = linkAffects("scene", 7);
    expect(hits(linksPath("scene", 7, "locations"), affects)).toBe(true);
    expect(hits(linksPath("scene", 70, "locations"), affects)).toBe(false);
    expect(hits(linksPath("session", 7, "locations"), affects)).toBe(false);
  });

  it("отметка тайны задевает тайны кампании, итог сессии — только если отметка в неё пишется", () => {
    expect(hits(sessionPaths.campaignSecrets(2), secretStateAffects(2))).toBe(true);
    expect(hits(sessionPaths.campaignSecrets(20), secretStateAffects(2))).toBe(false);
    expect(hits(sessionPaths.summary(15), secretStateAffects(2))).toBe(false);
    expect(hits(sessionPaths.summary(15), secretStateAffects(2, 15))).toBe(true);
  });
});
