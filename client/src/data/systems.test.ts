import { describe, expect, it } from "vitest";
import { dataKeys, matchesAffect, type Affect } from "./entities";
import { systemFieldsAffects, systemGroupAffects, systemNameAffects, systemPaths, wholeSystemAffects } from "./systems";

function hits(affects: Affect[], path: string): boolean {
  return affects.some((a) => matchesAffect(dataKeys.resource(path), a));
}

describe("система в слое данных", () => {
  it("правка полей задевает карточку и список, но не разделы и не чужую систему", () => {
    const affects = systemFieldsAffects(7);
    expect(hits(affects, systemPaths.detail(7))).toBe(true);
    expect(hits(affects, systemPaths.list())).toBe(true);
    expect(hits(affects, systemPaths.sections(7))).toBe(false);
    expect(hits(affects, systemPaths.entryCounts(7))).toBe(false);
    expect(hits(affects, systemPaths.detail(70))).toBe(false);
    expect(hits(affects, "/systems/entries/7")).toBe(false);
    expect(hits(affects, systemPaths.campaigns(7))).toBe(false);
  });

  it("название задевает ещё и кампании — они показывают систему по имени", () => {
    const affects = systemNameAffects(7);
    expect(hits(affects, "/campaigns")).toBe(true);
    expect(hits(affects, "/campaigns/3")).toBe(true);
    expect(hits(affects, "/campaigns?system_id=7")).toBe(true);
    expect(hits(affects, "/campaigns/3/sessions")).toBe(false);
    expect(hits(affects, "/campaigns/3/calendar-events")).toBe(false);
    expect(hits(affects, "/campaign-groups")).toBe(false);
    expect(hits(affects, systemPaths.detail(7))).toBe(true);
  });

  it("группы задевают все группы и составы, но не сами системы", () => {
    const affects = systemGroupAffects();
    expect(hits(affects, systemPaths.groups())).toBe(true);
    expect(hits(affects, systemPaths.groupsOf(7))).toBe(true);
    expect(hits(affects, systemPaths.groupMembers(1))).toBe(true);
    expect(hits(affects, systemPaths.list())).toBe(false);
  });

  it("уборка справочника задевает всю систему и записи, но не другую систему", () => {
    const affects = wholeSystemAffects(7);
    expect(hits(affects, systemPaths.sections(7))).toBe(true);
    expect(hits(affects, systemPaths.entryCounts(7))).toBe(true);
    expect(hits(affects, "/systems/7/entries?section_id=3")).toBe(true);
    expect(hits(affects, "/systems/entries/55")).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.entity("compendium_entry", 55), a))).toBe(true);
    expect(hits(affects, systemPaths.sections(8))).toBe(false);
  });
});
