// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSettingReaderGroups } from "./settingReaderEntries";

describe("события мира в читалке игрока", () => {
  it("выдача и флаг не дублируют событие сеттинга; тот же id события кампании не теряется", () => {
    const date = { id: 7, title: "Мировое", description: "Открыто", inworld_year: 1496, inworld_month: 6, inworld_day: 7 };
    const groups = buildSettingReaderGroups({ locations: [], beings: [], communities: [], artifacts: [], chronicleEvents: [{ ...date, access_level: "open" }] }, {
      locationArticles: [], beingArticles: [], chronicleEvents: [{ ...date, source: "setting" }, { ...date, title: "Кампанейское", source: "campaign" }],
    });
    const history = groups.find((group) => group.key === "setting-history");
    expect(history?.entries.map((entry) => entry.key)).toEqual(["setting-event-7", "campaign-event-7"]);
    expect(history?.entries.map((entry) => entry.title)).toEqual(["Мировое", "Кампанейское"]);
  });
});
