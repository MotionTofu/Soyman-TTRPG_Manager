import { describe, expect, it } from "vitest";
import { dataKeys, matchesAffect, type Affect } from "./entities";
import {
  campaignAdventureAffects,
  campaignEntryAffects,
  campaignEventAffects,
  campaignFieldsAffects,
  campaignPaths,
  milestoneAffects,
  sceneStatusAffects,
  secretAffects,
} from "./campaigns";
import { sessionPaths } from "./sessions";

const hits = (affects: Affect[], path: string) => affects.some((a) => matchesAffect(dataKeys.resource(path), a));

describe("кампания в слое данных", () => {
  it("тайны профиля и пульта — один ключ", () => {
    expect(campaignPaths.secrets(2)).toBe(sessionPaths.campaignSecrets(2));
  });

  it("отметка тайны доходит до списка тайн на пульте, но не до остальных его панелей", () => {
    const affects = secretAffects(2);
    expect(hits(affects, sessionPaths.campaignSecrets(2))).toBe(true);
    expect(hits(affects, sessionPaths.campaignSecrets(20))).toBe(false);
    for (const path of [
      sessionPaths.stage(142),
      sessionPaths.journal(142),
      sessionPaths.castUnion(142),
      sessionPaths.campaignSessions(2),
      campaignPaths.detail(2),
      campaignPaths.calendarEvents(2),
    ]) {
      expect(hits(affects, path)).toBe(false);
    }
  });

  it("отметка сцены задевает дерево кампании и дерево пульта", () => {
    const affects = sceneStatusAffects(2, 114);
    expect(hits(affects, campaignPaths.tree(2))).toBe(true);
    expect(hits(affects, sessionPaths.storyTree(142, false))).toBe(true);
    expect(hits(affects, sessionPaths.stage(142))).toBe(false);
    expect(hits(milestoneAffects(2), campaignPaths.milestones(2))).toBe(true);
    expect(hits(milestoneAffects(2), campaignPaths.secrets(2))).toBe(false);
  });

  it("поля кампании не перечитывают её сессии и хронику", () => {
    const affects = campaignFieldsAffects(2);
    expect(hits(affects, campaignPaths.detail(2))).toBe(true);
    expect(hits(affects, campaignPaths.debts(2))).toBe(true);
    expect(hits(affects, campaignPaths.list())).toBe(true);
    expect(hits(affects, campaignPaths.sessions(2))).toBe(false);
    expect(hits(affects, campaignPaths.calendarEvents(2))).toBe(false);
    expect(hits(affects, sessionPaths.campaignCover(2))).toBe(false);
  });

  it("событие хроники и записи задевают только свою кампанию", () => {
    expect(hits(campaignEventAffects(2, 50), campaignPaths.calendarEvents(2))).toBe(true);
    expect(hits(campaignEventAffects(2, 50), campaignPaths.calendarEvents(20))).toBe(false);
    expect(hits(campaignEntryAffects(2), campaignPaths.entries(2, "tasks"))).toBe(true);
    expect(hits(campaignEntryAffects(2), campaignPaths.entries(20, "tasks"))).toBe(false);
  });

  it("привязка приключения задевает весь сюжет кампании и выбор доступных", () => {
    const affects = campaignAdventureAffects(2);
    for (const path of [
      campaignPaths.tree(2),
      campaignPaths.milestones(2),
      campaignPaths.secrets(2),
      campaignPaths.adventures(2),
      campaignPaths.availableAdventures(2),
      "/canvas/index",
    ]) {
      expect(hits(affects, path)).toBe(true);
    }
    expect(hits(affects, campaignPaths.sessions(2))).toBe(false);
  });
});
