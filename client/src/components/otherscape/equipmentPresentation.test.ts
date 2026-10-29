import fixtureText from "./__fixtures__/equipment.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapeEquipmentSection, parseEquipmentPresentation } from "./equipmentPresentation";

const cards: { name: string; name_original: string; description: string; role: string }[] = JSON.parse(fixtureText);
const card = (name: string) => cards.find(item => item.name_original === name)!;
const parse = (name: string) => parseEquipmentPresentation(card(name).description, name)!;

describe("Otherscape equipment as a reference, without changing its stored data", () => {
  it("scopes by system and section and falls back for unfamiliar descriptions", () => {
    expect(isOtherscapeEquipmentSection("Otherscape", "Снаряжение")).toBe(true);
    expect(isOtherscapeEquipmentSection("otherscape", "Equipment")).toBe(true);
    expect(isOtherscapeEquipmentSection("dnd", "Снаряжение")).toBe(false);
    expect(isOtherscapeEquipmentSection("otherscape", "Испытания")).toBe(false);
    expect(parseEquipmentPresentation("Произвольное описание", "Example")).toBeNull();
    expect(parseEquipmentPresentation("**Example**\n\nБез известной структуры источника.", "Example")).toBeNull();
  });

  it.each(cards)("preserves source links and content of $name_original", item => {
    const view = parseEquipmentPresentation(item.description, item.name_original)!;
    expect(view).not.toBeNull();
    expect(view.variant).toBe(item.role);
    expect(view.pages.length).toBe([...item.description.matchAll(/soyman:resource\/[^)]+#page=\d+/g)].length);
    expect(view.source).toContain("323df0dc-1d4a-40ef-a35f-8603b6a9ceaf");
    if (view.variant === "item") {
      expect(view.tags).not.toBeNull();
      expect(view.tags!.filter(tag => tag.primary)).toHaveLength(1);
      expect(view.tags![0].primary).toBe(true);
      expect(view.weakness).not.toBeNull();
      expect(view.body).toContain("Каждый тег набора загружается отдельно; основной — первым.");
      expect(view.body).toContain("[[compendium_entry@");
      expect(item.description).toContain(view.original);
      for (const tag of view.tags!) {
        expect(item.description).toContain(`**${tag.translation}**`);
        expect(item.description).toContain(`*${tag.original}*`);
      }
      expect(item.description).toContain(view.weakness!.translation);
      expect(item.description).toContain(`*${view.weakness!.original}*`);
    } else if (view.variant === "generic") {
      expect(view.sections.length).toBeGreaterThan(0);
      for (const section of view.sections) {
        expect(section.tags).not.toBeNull();
        for (const tag of section.tags!) expect(item.description).toContain(`**${tag.translation}** — *${tag.original}*`);
      }
    } else if (view.variant === "special") {
      const body = item.description.split("\n\n**Оригинал правила**\n\n");
      expect(view.body).toBe(body[0].slice(`**${item.name_original}**\n\n`.length));
      expect(view.original).toBe(body[1].split("\n\nИсточник:")[0]);
    } else {
      expect(view.body).toBe(item.description.slice(`**${item.name_original}**\n\n`.length).split("\n\nИсточник:")[0]);
    }
  });

  it("retains all 337 item tags, 94 weaknesses, 305 general options and eight Specials", () => {
    const views = cards.map(item => parseEquipmentPresentation(item.description, item.name_original)!);
    expect(views).toHaveLength(129);
    expect(views.filter(view => view.variant === "item")).toHaveLength(94);
    expect(views.reduce((sum, view) => sum + (view.tags?.length ?? 0), 0)).toBe(337);
    expect(views.filter(view => view.weakness)).toHaveLength(94);
    expect(views.flatMap(view => view.sections).reduce((sum, section) => sum + (section.tags?.length ?? 0), 0)).toBe(305);
    expect(views.filter(view => view.variant === "special")).toHaveLength(8);
    expect(views.filter(view => view.variant === "rule")).toHaveLength(14);
  });

  it("keeps printed typos and their explanations", () => {
    const exploit = parse("Shever Brute Force Exploit");
    expect(exploit.tags?.at(-1)?.original).toBe("ollateral damage");
    expect(exploit.body).toContain("без начальной c");
    const vehicles = parse("General Items / Vehicles");
    expect(vehicles.sections[0].tags?.find(tag => tag.translation === "дельтаплан")?.original).toBe("hand glider");
    expect(vehicles.sections.at(-1)?.after).toContain("по смыслу речь о дельтаплане");
  });

  it("keeps exact frequency, set requirements, wildcard cost and optional-rule conditions", () => {
    expect(parse("Deeply Customizable").body).toContain("Один раз за Downtime");
    expect(parse("Fully Decked").body).toContain("не означает, что все они сразу загружены");
    expect(parse("Fully Decked").body).toContain("неоднократно для разных категорий");
    expect(parse("Modded Out").body).toContain("из одного и того же набора");
    expect(parse("Synergetic Gear").body).toContain("разные предметы");
    expect(parse("Wildcard Loadout Tags").body).toContain("**2 Power за wildcard loadout tag**");
    expect(parse("Wildcard Loadout Tags").body).toContain("снижает цену wildcard до 1 Power");
    expect(parse("Optional Rule: Removing Loadout Tags as a Consequence").body).toContain("**Optional Rule.**");
  });

  it("retains unrecognized tag lines, weakness syntax and additional rules in full", () => {
    const text = card("Certified corp ID").description.replace("  *certified corp ID*", "  Новый формат тега").replace("*full authentication also requires PIN*", "Новое условие слабости");
    const view = parseEquipmentPresentation(text, "Certified corp ID")!;
    expect(view.tags).toBeNull();
    expect(view.tagText).toContain("Новый формат тега");
    expect(view.weakness).toBeNull();
    expect(view.weaknessText).toContain("Новое условие слабости");
    expect(view.weaknessText).toContain("Каждый тег набора загружается отдельно");
    expect(parseEquipmentPresentation(card("Certified corp ID").description.replace("**Слабость — Weakness**", "**Новая секция**"), "Certified corp ID")).toBeNull();
  });
});
