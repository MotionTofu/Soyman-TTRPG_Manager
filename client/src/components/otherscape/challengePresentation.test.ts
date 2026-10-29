import fixtureText from "./__fixtures__/challenges.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapeChallengesSection, parseChallengePresentation } from "./challengePresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
const card = (name: string) => cards.find(item => item.name_original === name)!;
const parse = (name: string) => parseChallengePresentation(card(name).description, name)!;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

describe("Otherscape Challenge directory presentation", () => {
  it("scopes by system and section rather than installation IDs", () => {
    expect(isOtherscapeChallengesSection("Otherscape", "Испытания")).toBe(true);
    expect(isOtherscapeChallengesSection("otherscape", "Challenges")).toBe(true);
    expect(isOtherscapeChallengesSection("dnd", "Испытания")).toBe(false);
    expect(isOtherscapeChallengesSection("otherscape", "Наборы сил")).toBe(false);
    expect(parseChallengePresentation("Описание произвольного правила", "Example")).toBeNull();
  });

  it.each(cards)("preserves mechanics, paired threats, originals and UID sources of $name_original", item => {
    const view = parseChallengePresentation(item.description, item.name_original)!;
    expect(view).not.toBeNull();
    expect(view.limits?.length).toBe([...item.description.matchAll(/^- .+ — \*\*.+: (?:\d+|– \(иммунитет\))\*\*\.$/gm)].length);
    expect(view.pages.length).toBeGreaterThan(0);
    expect(view.source).toContain("soyman:resource/");
    expect(view.related).toContain("|otherscape|Scale]]");
    const rawSpecials = view.sections.find(section => section.key === "Specials")?.text;
    if (rawSpecials && view.specials) expect(normalize([view.specialIntroduction, ...view.specials.map(special => `${special.title}: ${special.text}`)].join(" "))).toBe(normalize(rawSpecials));
    const russianThreats = [...item.description.matchAll(/^\*\*\d+\.\*\* (.+)$/gm)].map(match => match[1]);
    expect(view.threats).toHaveLength(russianThreats.length);
    russianThreats.forEach((text, index) => {
      const threat = view.threats![index];
      expect(`${threat.threat}${threat.consequences ? ` → ${threat.consequences}` : ""}`).toContain(text);
    });
    for (const english of item.description.matchAll(/(?:\*\*Original — (?:Limit rules|Specials):\*\* |\*\*(?:Threat|Consequence) \(original\):\*\* )([^\n]+)/g)) expect(view.original).toContain(english[1]);
    const lore = /### Описание и варианты — Original\n\n([\s\S]+?)(?=\n\n\*\*(?:Связанные профили|Общие правила):)/.exec(item.description)![1];
    expect(view.original).toContain(lore);
  });

  it("distinguishes 41 actual difficulties from The Lady's modifier and Scale", () => {
    expect(cards).toHaveLength(42);
    expect(cards.filter(item => parseChallengePresentation(item.description, item.name_original)?.isPowerSet)).toHaveLength(1);
    expect(parse("Corporate Executive").difficulty).toBe(4);
    expect(parse("Corporate Executive").scale).toBeNull(); // Bodyguards' Scale is not the executive's.
    expect(parse("The Lady")).toMatchObject({ isPowerSet: true, difficulty: 2, scale: 3 });
    expect(parse("Nomadic Transport Caravan").difficulty).toBe(2);
    expect(parse("Nomadic Transport Caravan").introduction).toContain("Scouting Party: +1");
    expect(parse("Intrusion Countermeasure AI").specialIntroduction).toContain("каждое свойство повышает Difficulty на 1");
  });

  it("keeps immunity distinct from zero and polar/progress rules distinct from hit points", () => {
    expect(parse("Ghost").limits?.[0]).toMatchObject({ name: "HURT OR SUBDUE", value: null });
    expect(parse("Riot").limits).toEqual([{ label: "Эскалация / деэскалация", name: "ESCALATE/DE-ESCALATE", value: 2 }]);
    expect(parse("Riot").limitNotes).toContain("полярный предел прогресса");
    expect(parse("Riot").limitNotes).toContain("DE-ESCALATE при заполнении");
    expect(parse("Investigator").limitNotes).toContain("Следующее заполнение раскрывает");
    expect(parse("Crumbling Building").limitNotes).toContain("buried-by-debris-5");
    expect(parse("Hacker").limitNotes).toContain("примените одно последствие и сбросьте предел");
    expect(parse("The Lady").limitNotes).toContain("до конца следующего Downtime");
  });

  it("preserves counterattack timing, optional rules, printed names and standalone threats", () => {
    expect(parse("Electricity Elemental").specials?.map(special => special.title)).toEqual(["Amp It Up", "Feedback"]);
    expect(parse("Electricity Elemental").specials?.[1].text).toContain("сначала получает jolted-2");
    expect(parse("Mama Diwa").specials?.at(-1)?.title).toBe("Neigborhood Muscle (так напечатано)");
    expect(parse("The Lady").specials?.at(-1)).toMatchObject({ title: "Unleash Hell!" });
    expect(parse("The Lady").specials?.at(-1)?.text).toContain("раз за сцену");
    expect(parse("Surveillance Drone").threats?.find(item => item.threat.includes("самостоятельная угроза"))?.consequences).toBe("");
  });

  it("retains unknown sections and unrecognized limit syntax verbatim", () => {
    const description = card("Ghost").description.replace("### Базовые теги", "### Исключение\n\nНеизвестная механика.\n\n### Базовые теги").replace("**BANISH: 2**.", "**BANISH: Special rule**.");
    const view = parseChallengePresentation(description, "Ghost")!;
    expect(view.sections.find(section => section.title === "Исключение")?.text).toBe("Неизвестная механика.");
    expect(view.limits).toBeNull();
    expect(view.limitNotes).toContain("BANISH: Special rule");
    expect(view.original).toContain("Ghosts are");
  });
});
