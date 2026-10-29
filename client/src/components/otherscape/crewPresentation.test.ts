import fixtureText from "./__fixtures__/crew.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapeCrewSection, parseCrewPresentation } from "./crewPresentation";

const cards: { name: string; name_original: string; description: string; role: string }[] = JSON.parse(fixtureText);
const card = (name: string) => cards.find(item => item.name_original === name)!;
const parse = (name: string) => parseCrewPresentation(card(name).description, name)!;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

describe("Crew as an Otherscape reference", () => {
  it("scopes by system code and section name without installation IDs", () => {
    expect(isOtherscapeCrewSection("Otherscape", " Команда ")).toBe(true);
    expect(isOtherscapeCrewSection("otherscape", "Crew")).toBe(true);
    expect(isOtherscapeCrewSection("dnd", "Команда")).toBe(false);
    expect(isOtherscapeCrewSection("otherscape", "Развитие персонажа")).toBe(false);
    expect(parseCrewPresentation("Произвольный текст", "Example")).toBeNull();
  });

  it.each(cards)("retains all source text and pages of $name_original", item => {
    const view = parseCrewPresentation(item.description, item.name_original)!;
    expect(view).not.toBeNull();
    expect(view.variant).toBe(item.role);
    expect(view.pages.length).toBe([...item.description.matchAll(/soyman:resource\/[^)]+#page=\d+/g)].length);
    expect(view.pages.every(page => page.target.includes("323df0dc-1d4a-40ef-a35f-8603b6a9ceaf"))).toBe(true);
    const body = item.description.slice(`**${item.name_original}**\n\n`.length).split("\n\nИсточник:")[0];
    if (view.variant === "special") {
      expect(body).toBe(`${view.body}\n\n**Оригинал правила**\n\n${view.original}`);
    } else if (view.variant === "kit") {
      const tags = (list: NonNullable<typeof view.power>) => list.pairs.map(pair => `- **${pair.translation}**${pair.primary ? " — титульный тег" : ""}\n  *${pair.original}*`).join("\n");
      const motivation = view.motivation!;
      expect(normalize(body)).toBe(normalize(`${view.instructions}\n\n**Теги силы — Power Tags**\n\n${tags(view.power!)}\n\n**Теги слабости — Weakness Tags**\n\n${tags(view.weakness!)}\n\n**${motivation.kind}**\n\n${motivation.text}\n\n*${motivation.original}*\n\n${motivation.after}`));
    } else {
      expect(view.body).toBe(body);
      const reconstructed = view.sections.map(section => `${section.heading ? `**${section.heading}**\n\n` : ""}${section.text}`).join("\n\n");
      expect(normalize(reconstructed)).toBe(normalize(body));
      for (const section of view.sections) {
        if (!section.list) continue;
        for (const pair of section.list.pairs) {
          expect(section.text).toContain(`**${pair.translation}**`);
          expect(section.text).toContain(`*${pair.original}*`);
        }
      }
    }
  });

  it("keeps all eight unselected kits, eighty powers and thirty-two weaknesses", () => {
    const kits = cards.filter(item => item.role === "kit").map(item => parse(item.name_original));
    expect(kits).toHaveLength(8);
    expect(kits.flatMap(kit => kit.power!.pairs)).toHaveLength(80);
    expect(kits.flatMap(kit => kit.weakness!.pairs)).toHaveLength(32);
    for (const kit of kits) {
      expect(kit.power!.pairs.filter(pair => pair.primary)).toHaveLength(1);
      expect(kit.power!.pairs[0].primary).toBe(true);
      expect(kit.instructions).toContain("выберите ещё два power tags, один weakness tag");
      expect(kit.motivation!.kind).toBe("Identity");
      expect(kit.motivation!.after).toContain("[[compendium_entry@");
    }
    const family = parse("Found Family");
    expect(family.power!.pairs[1].original).toBe("OUR SHARED APARTMENTMENT BASE");
    expect(family.motivation!.after).toContain("опечатка сохранена");
    expect(family.motivation!.original).toBe("We’re in this together.");
  });

  it("keeps the repeated A/I question, fourteen tag questions and six concept questions", () => {
    const questions = parse("Power Tag Questions / Weakness Tag Questions");
    const power = questions.sections[0].list!;
    expect(power.pairs).toHaveLength(10);
    expect(power.pairs[0].original).toBe(power.pairs[8].original);
    expect(questions.sections[1].list!.pairs).toHaveLength(4);
    expect(questions.sections[1].list!.after).toContain("вопросы силы A и I совпадают");
    const concept = parse("The Crew / Concept").sections[0].list!;
    expect(concept.pairs).toHaveLength(6);
    expect(concept.before).toContain("Обсудите концепцию команды");
    expect(concept.after).toContain("персонажи уже знакомы");
    const relationships = parse("Crew Relationship Tags");
    expect(relationships.sections[1].list!.pairs).toHaveLength(35);
    expect(relationships.sections[0].text).toContain("ровно один crew relationship tag к каждому другому PC");
  });

  it("retains the five Special frequencies, triggers, costs and complete English originals", () => {
    expect(parse("Huddle").body).toContain("игнорируя её Scale 1");
    expect(parse("Last Second Leap").body).toContain("те же Consequences");
    expect(parse("Last Second Leap").original).toContain("Both players can Mitigate as usual");
    expect(parse("Sacrifice").body).toContain("вместо собственных");
    expect(parse("Strong Bonds").body).toContain("ещё 1 Power");
    expect(parse("United By The Cause").body).toContain("вся команда сотрудничала в одной сцене");
  });

  it("retains shared-theme restrictions, recovery limits and growth without Evolution", () => {
    expect(parse("Using Crew Theme Tags").body).toContain("Burning for Power) нельзя");
    expect(parse("Using Crew Relationship Tags").body).toContain("После применения тег сжигается");
    expect(parse("Recovering Crew Theme Power Tags").body).toContain("один такой тег за 2 Power");
    expect(parse("Recovering Crew Theme Power Tags").body).toContain("1 Power за тег");
    expect(parse("Credit Roll / Crew Relationships").body).toContain("они восстанавливаются все");
    expect(parse("Choosing Crew Theme Upgrades").body).toContain("кроме Mark Evolution");
    expect(parse("Crew Motivation, Decay, and Replacement").body).toContain("вместо неё добавьте power tag");
    expect(parse("Crew Motivation, Decay, and Replacement").body).toContain("команда не получает Evolution");
  });

  it("falls back losslessly when a kit or bilingual list is partly unfamiliar", () => {
    const family = card("Found Family");
    const description = family.description.replace("  *FOUND FAMILY*", "  Неизвестная форма тега");
    const view = parseCrewPresentation(description, family.name_original)!;
    expect(view.variant).toBe("rule");
    expect(view.sections.find(section => section.heading.startsWith("Теги силы"))!.list).toBeNull();
    expect(view.body).toContain("Неизвестная форма тега");
    expect(view.body).toContain("OUR SHARED APARTMENTMENT BASE");
    const unknown = parseCrewPresentation(family.description.replace("**Identity**", "**Новая мотивация**"), family.name_original)!;
    expect(unknown.variant).toBe("rule");
    expect(unknown.body).toContain("**Новая мотивация**");
    expect(parseCrewPresentation(family.description.replaceAll("\n", "\r\n"), family.name_original)!.variant).toBe("kit");
  });
});
