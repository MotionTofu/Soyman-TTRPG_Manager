import fixtureText from "./__fixtures__/archetypes.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapeArchetypeSection, parseArchetypePresentation } from "./archetypePresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(fixtureText);
const card = (name: string) => cards.find(item => item.name_original === name)!;
const parse = (name: string) => parseArchetypePresentation(card(name).description, name)!;

describe("Otherscape character tropes as dossiers", () => {
  it("scopes to the system and section names without database IDs", () => {
    expect(isOtherscapeArchetypeSection("Otherscape", " Типажи персонажей ")).toBe(true);
    expect(isOtherscapeArchetypeSection("otherscape", "Character Tropes")).toBe(true);
    expect(isOtherscapeArchetypeSection("dnd", "Типажи персонажей")).toBe(false);
    expect(isOtherscapeArchetypeSection("otherscape", "Темы персонажа")).toBe(false);
    expect(parseArchetypePresentation("Произвольный текст", "Example")).toBeNull();
  });

  it.each(cards)("retains the complete description and every link of $name_original", item => {
    const view = parseArchetypePresentation(item.description, item.name_original)!;
    const profile = view.profile!;
    expect(profile).not.toBeNull();
    expect(profile.base.kits).toHaveLength(3);
    expect(profile.choice.kits).toHaveLength(3);
    const list = (value: typeof profile.base) => value.kits.map(kit => kit.raw).join("\n") + (value.after ? `\n\n${value.after}` : "");
    const reconstructed = `**Концепция — Concept**\n\n${profile.concept}\n\n**Три основных набора — Base Theme Kits**\n\n${list(profile.base)}\n\n**Четвёртый набор: выберите один — Choose One**\n\n${list(profile.choice)}\n\n**Начальное снаряжение — Loadout**\n\n${profile.loadout.translation}\n\n*Оригинал: ${profile.loadout.original}*\n\n${profile.loadout.notes}\n\n**Создание тем — Rapid Creation**\n\n${profile.creation}`;
    expect(reconstructed).toBe(view.body);
    expect(item.description).toBe(`**${item.name_original}**\n\n${reconstructed}\n\nИсточник: ${view.source}`);
    expect(view.pages).toHaveLength(1);
    expect(view.pages[0].page).toBeGreaterThanOrEqual(178);
    expect(view.pages[0].page).toBeLessThanOrEqual(188);
    for (const kit of [...profile.base.kits, ...profile.choice.kits]) {
      expect(kit.raw).toBe(`- ${kit.link} — ${kit.theme}; ${kit.page}.`);
      expect(kit.link).toContain("[[compendium_entry@");
      expect(kit.page).toContain("soyman:resource/323df0dc-1d4a-40ef-a35f-8603b6a9ceaf#page=");
    }
  });

  it("keeps 99 base and 99 optional references, all 112 distinct kits and the fourth-theme restriction", () => {
    const profiles = cards.map(item => parse(item.name_original).profile!);
    expect(profiles).toHaveLength(33);
    expect(profiles.flatMap(profile => profile.base.kits)).toHaveLength(99);
    expect(profiles.flatMap(profile => profile.choice.kits)).toHaveLength(99);
    expect(new Set(profiles.flatMap(profile => [...profile.base.kits, ...profile.choice.kits]).map(kit => kit.link.split("|")[0])).size).toBe(112);
    for (const profile of profiles) {
      expect(profile.choice.after).toContain("три альтернативы для одной четвёртой темы");
      expect(profile.choice.after).toContain("если его тип не повторяет тип одной из трёх основных тем");
      expect(profile.loadout.notes).toContain("пометка «для всех» распространяется на все перечисленные там теги");
      expect(profile.creation).toContain("первый power tag, ещё два power tags, один weakness tag");
    }
  });

  it("keeps shared Loadout weaknesses, English spelling and editorial notes", () => {
    const spy = parse("FARSEEING SPY").profile!;
    expect(spy.loadout.translation).toContain("Для всех трёх: уличающие (incriminating)");
    expect(spy.loadout.original).toBe("powder of inconspicuousness, digital lockpick, concealed pistol (all: incriminating)");
    expect(parse("CORPO-WAR SNIPER").profile!.loadout.original).toContain("sniper rifle (requires setup) with AR sight");
    const shinobi = parse("HIGH-TECH SHINOBI").profile!;
    expect(shinobi.base.kits[0].link).toContain("Animated Shadows");
    expect(shinobi.creation).toContain("**Animate Shadows**");
    expect(shinobi.loadout.original).toContain("all: short ranged");
  });

  it("preserves unfamiliar or partially changed descriptions in full", () => {
    const sniper = card("CORPO-WAR SNIPER");
    for (const description of [
      sniper.description.replace("**Концепция — Concept**", "**Новая концепция**"),
      sniper.description.replace("- [[compendium_entry@", "- Новый формат [[compendium_entry@"),
      sniper.description.replace("*Оригинал:", "*Другой оригинал:"),
      sniper.description.replace("\n\nЭто три альтернативы", "\n- Неизвестный четвёртый набор\n\nЭто три альтернативы"),
    ]) {
      const view = parseArchetypePresentation(description, sniper.name_original)!;
      expect(view.profile).toBeNull();
      expect(description).toContain(view.body);
      expect(view.body).toContain("requires setup");
    }
    expect(parseArchetypePresentation(sniper.description.replaceAll("\n", "\r\n"), sniper.name_original)!.profile).not.toBeNull();
  });
});
