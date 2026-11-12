// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LitmRich } from "./LitmBook";
import { litmCatalogOf, splitConsequence } from "./litmBookText";
import { challengeProfile, emptyChallengeProfile, profileFromContent, structuredFromLegacy, toEntryData, toStatblockContent } from "./litmChallenge";
import { cleanProfile } from "./litmChallengeSave";
import type { SystemSection } from "../../types";

const html = (text: string) => renderToStaticMarkup(<LitmRich text={text} />);
const section = (kind: string, name = "X") => ({ id: 1, system_id: 1, position: 0, name, kind, created_at: "" }) as SystemSection;

describe("«сказочная книга» LitM", () => {
  it("renders book markup as statuses, tags, named consequences and threat references", () => {
    expect(html("получить *настороже-1*")).toContain('<span class="lb-st">настороже<b>1</b></span>');
    expect(html("*меч*, *булава* или *копьё*")).toBe('<span class="lb-tg">меч</span>, <span class="lb-tg">булава</span> или <span class="lb-tg">копьё</span>');
    expect(html("(**Заблокировано**)")).toBe('(<span class="lb-cq">Заблокировано</span>)');
    expect(html("действия **ДУЭЛЬ**")).toContain('<b class="lb-ref">ДУЭЛЬ</b>');
    // статус без уровня в ссылке на него — статус, а не тег
    expect(html("снять два уровня с *ублажён*")).toContain('<span class="lb-st">ублажён</span>');
    expect(html("сбросить *сбежал* и **Заблокировано**")).toContain('<span class="lb-st">сбежал</span>');
  });

  it("moves the effect in trailing brackets out of the consequence", () => {
    expect(splitConsequence("Пригрозить смертью (*запуган-4*)")).toEqual({ lead: "Пригрозить смертью", effect: "*запуган-4*" });
    expect(splitConsequence("Ударить (*ранен-3* и, если не смягчено (полностью), ещё *прижат-2*)").effect).toBe("*ранен-3* и, если не смягчено (полностью), ещё *прижат-2*");
    expect(splitConsequence("Обезоружить врага")).toEqual({ lead: "Обезоружить врага", effect: null });
  });

  it("picks the catalog only for LitM sections with an accepted board", () => {
    expect(litmCatalogOf("litm", section("monster"))).toBe("challenges");
    expect(litmCatalogOf("litm", section("trope"))).toBe("tropes");
    expect(litmCatalogOf("litm", section("mechanics", "Могущество и Темы"))).toBe("themes");
    expect(litmCatalogOf("litm", section("mechanics", "Справочник"))).toBe("rules");
    expect(litmCatalogOf("phb", section("monster"))).toBeNull();
  });

  it("reads marked book challenges and the GM's own text challenges", () => {
    const entry = { name: "Пылкий рыцарь", name_original: "Ardent Knight", description: "", data: { location: "Замок", rating: 3, roles: ["Агрессор"], page: "B168" } };
    const marked = challengeProfile(entry, { content: JSON.stringify({ threatList: [{ name: "Дуэль", lead: "Биться", consequences: ["x"] }], limitList: [{ name: "Ранить", max: "3" }] }) });
    expect(marked).toMatchObject({ location: "Замок", rating: 3, roles: ["Агрессор"], page: "B168", legacy: null });
    expect(marked.threatList).toHaveLength(1);
    const own = profileFromContent({ name: "Туман отчаяния", name_original: "", description: "", data: { location: "Свои" } },
      { role: "Преграда", might: 3, limits: "**Изгнан-6**\nПробитая броня 4\nСбежать - 2", threatsConsequences: "Туман…" });
    expect(own.rating).toBe(3);
    expect(own.roles).toEqual(["Преграда"]);
    expect(own.limitList).toEqual([{ name: "Изгнан", max: "6" }, { name: "Пробитая броня", max: "4" }, { name: "Сбежать", max: "2" }]);
    expect(own.legacy?.threats).toBe("Туман…");
    expect(challengeProfile(entry, { content: "не json" }).legacy).not.toBeNull();
  });

  it("turns the GM's text challenge into book lists and writes both shapes back", () => {
    const own = profileFromContent({ name: "Туман", name_original: "", description: "", data: { location: "Свои" } }, {
      role: "Преграда", might: 3, tagsAndStatuses: "Сильный туман\nЛипкий", limits: "Изгнан-6",
      threatsConsequences: "*Туман проникает в сознание*\n**тревога-2**\n\nТуман вымывает воспоминания\n**забвение-2**",
      specialFeatures: "**Усилить атаки**\nКогда стоит на круге",
    });
    const s = structuredFromLegacy(own);
    expect(s.legacy).toBeNull();
    expect(s.tagList.map((t) => t.text)).toEqual(["Сильный туман", "Липкий"]);
    expect(s.threatList).toEqual([
      { name: "", lead: "Туман проникает в сознание", consequences: ["**тревога-2**"] },
      { name: "", lead: "Туман вымывает воспоминания", consequences: ["**забвение-2**"] },
    ]);
    expect(s.specialList).toEqual([{ name: "Усилить атаки", text: "Когда стоит на круге" }]);
    const content = toStatblockContent(s, { theme: "noir" });
    expect(content).toMatchObject({ theme: "noir", role: "Преграда", might: 3, limits: "Изгнан 6", threatList: s.threatList });
    expect(content).not.toHaveProperty("legacy");
    // записанное читается обратно размеченным профилем
    expect(profileFromContent({ name: "Туман", name_original: "", description: "", data: {} }, content).legacy).toBeNull();
    expect(toEntryData(s, { size: "Средний" })).toEqual({ size: "Средний", location: "Свои", page: "", rating: 3, roles: ["Преграда"], addon: false });
  });

  it("drops empty form rows and keeps roles in book order", () => {
    const p = cleanProfile({ ...emptyChallengeProfile("Новый"), roles: ["Влияние", "Агрессор"],
      limitList: [{ name: " Ранить ", max: "" }, { name: "", max: "3" }],
      threatList: [{ name: "Ударить", lead: "", consequences: ["Ранить (*ранен-2*)", "", " "] }, { name: "", lead: "", consequences: [""] }] });
    expect(p.roles).toEqual(["Агрессор", "Влияние"]);
    expect(p.limitList).toEqual([{ name: "Ранить", max: "-", note: "" }]);
    expect(p.threatList).toEqual([{ name: "Ударить", lead: "", consequences: ["Ранить (*ранен-2*)"] }]);
  });
});
