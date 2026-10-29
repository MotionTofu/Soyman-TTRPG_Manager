import fixtureText from "./__fixtures__/development.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapeDevelopmentSection, parseDevelopmentPresentation } from "./developmentPresentation";

const cards: { name: string; name_original: string; description: string; role: string }[] = JSON.parse(fixtureText);
const card = (name: string) => cards.find(item => item.name_original === name)!;
const parse = (name: string) => parseDevelopmentPresentation(card(name).description, name)!;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

describe("Character development as a read-only Otherscape reference", () => {
  it("scopes by system and section, independently of installation IDs", () => {
    expect(isOtherscapeDevelopmentSection("Otherscape", "Развитие персонажа")).toBe(true);
    expect(isOtherscapeDevelopmentSection("otherscape", "Character Development")).toBe(true);
    expect(isOtherscapeDevelopmentSection("dnd", "Развитие персонажа")).toBe(false);
    expect(isOtherscapeDevelopmentSection("otherscape", "Снаряжение")).toBe(false);
    expect(parseDevelopmentPresentation("Произвольный текст", "Example")).toBeNull();
  });

  it.each(cards)("preserves the complete rule, originals and every page of $name_original", item => {
    const view = parseDevelopmentPresentation(item.description, item.name_original)!;
    expect(view).not.toBeNull();
    expect(view.variant).toBe(item.role);
    expect(view.pages.length).toBe([...item.description.matchAll(/soyman:resource\/[^)]+#page=\d+/g)].length);
    expect(view.source).toContain("323df0dc-1d4a-40ef-a35f-8603b6a9ceaf");
    const body = item.description.slice(`**${item.name_original}**\n\n`.length).split("\n\nИсточник:")[0];
    if (view.variant === "essence") {
      expect(body).toContain(`**Состав тем:** ${view.condition}`);
      expect(body).toContain(`**Essence Special**\n\n${view.body}\n\n**Оригинал**\n\n${view.original}`);
      if (body.includes("Связанное правило:")) expect(view.related).toContain("[[compendium_entry@");
    } else if (view.variant === "veteran") {
      expect(body).toBe(`${view.body}\n\n**Оригинал правила**\n\n${view.original}`);
    } else {
      expect(view.body).toBe(body);
      const reconstructed = view.blocks.map(block => block.kind === "heading" ? `**${block.text}**` : block.kind === "formula" ? `**Формула:** ${block.text}` : block.text).join("\n\n");
      expect(normalize(reconstructed)).toBe(normalize(body));
    }
  });

  it("covers eight essences, fourteen veteran Specials and twenty-four rules", () => {
    const views = cards.map(item => parseDevelopmentPresentation(item.description, item.name_original)!);
    expect(views).toHaveLength(46);
    expect(views.filter(view => view.variant === "essence")).toHaveLength(8);
    expect(views.filter(view => view.variant === "veteran")).toHaveLength(14);
    expect(views.filter(view => view.variant === "rule")).toHaveLength(24);
  });

  it("keeps composition conditions distinct and preserves replacement restrictions", () => {
    expect(parse("Avatar").condition).toContain("одного и того же Source");
    expect(parse("Conduit").condition).toContain("разными Sources");
    expect(parse("Spiritualist").condition).toContain("тем Noise нет");
    expect(parse("Nexus").body).toContain("сохранить все три категории после замены");
    expect(parse("Spiritualist").body).toContain("одна общая возможность за сессию");
    expect(parse("Avatar").body).toContain("Даже одно игнорирование или нарушение Agenda");
    expect(parse("Conduit").body).toContain("новая тема будет Mythos");
  });

  it("retains the formula, partial-track exclusion, example and overflow rule", () => {
    const evolution = parse("Gain Evolution Points");
    const formula = evolution.blocks.find(block => block.kind === "formula")!;
    expect(formula.text).toContain("`1 + max(0, P − 3) + max(0, W − 1) + S`");
    expect(formula.text).toContain("Частично заполненный Upgrade track отдельно очков не даёт");
    expect(evolution.body).toContain("1 + 1 + 1 + 0 = 3 Evolution");
    expect(parse("Evolution Points").body).toContain("оставшееся 1 очко");
    expect(parse("Evolution Points").body).toContain("до трёх Veteran Specials");
    expect(parse("Total Reconstitution").body).toContain("не добавляет по одному Evolution point");
    expect(parse("Total Reconstitution").body).toContain("список однократных выборов не начинается заново");
  });

  it("keeps nascent-theme timing and Veteran exceptions rather than inventing track state", () => {
    expect(parse("Create a New Theme / Nascent Theme").body).toContain("двух таких событий, не двух полных треков");
    expect(parse("Slow & Steady").body).toContain("5 клеток вместо 3");
    expect(parse("Slow & Steady").body).toContain("получите два улучшения");
    expect(parse("Experienced Efficiency").body).toContain("Выбор отметки Upgrade не даёт одновременно");
    expect(parse("Backup Clones").body).toContain("После третьего использования удалите эту Special");
    expect(parse("Willpower Over Chance").body).toContain("snake eyes");
  });

  it("preserves unknown sections and falls back for a partially understood essence", () => {
    const text = card("Marking Decay").description.replace("\n\nИсточник:", "\n\n**Новая оговорка**\n\nНовый порядок и ограничение.\n\nИсточник:");
    const view = parseDevelopmentPresentation(text, "Marking Decay")!;
    expect(view.blocks.find(block => block.kind === "heading")?.text).toBe("Новая оговорка");
    expect(view.blocks.at(-1)?.text).toBe("Новый порядок и ограничение.");
    expect(parseDevelopmentPresentation(card("Avatar").description.replace("**Состав тем:**", "**Неизвестный состав:**"), "Avatar")).toBeNull();
    expect(parseDevelopmentPresentation(card("Avatar").description.replace("**Оригинал**", "**Неизвестная секция**"), "Avatar")).toBeNull();
  });
});
