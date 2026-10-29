import fixtureText from "./__fixtures__/powerSets.json?raw";
import { describe, expect, it } from "vitest";
import { isOtherscapePowerSetsSection, parsePowerSetPresentation } from "./powerSetPresentation";

const cards: { name: string; name_original: string; description: string }[] = JSON.parse(
  fixtureText
);
function card(name: string) { return cards.find(item => item.name_original === name)!; }
function parse(name: string) { const item = card(name); return parsePowerSetPresentation(item.description, item.name_original)!; }

describe("Otherscape power-set presentation without rewriting stored rules", () => {
  it("is scoped by system code and section, independently of installation IDs", () => {
    expect(isOtherscapePowerSetsSection("otherscape", "Наборы сил")).toBe(true);
    expect(isOtherscapePowerSetsSection("OTHERSCAPE", "Power Sets")).toBe(true);
    expect(isOtherscapePowerSetsSection("otherscape", "Испытания")).toBe(false);
    expect(isOtherscapePowerSetsSection("dnd", "Наборы сил")).toBe(false);
  });

  it.each(cards)("retains the original, every section and the source of $name_original", item => {
    const view = parsePowerSetPresentation(item.description, item.name_original);
    expect(view).not.toBeNull();
    const original = /### Английский оригинал — Original\n\n([\s\S]*?)\n\n\*\*Связанные правила/.exec(item.description)![1];
    expect(view!.original).toBe(original);
    const headings = [...item.description.matchAll(/^### (.+)$/gm)].map(match => match[1]);
    expect([...view!.sections.map(section => section.title), "Английский оригинал — Original"]).toEqual(headings);
    expect(view!.pages).toHaveLength(1);
    expect(view!.pages[0].target).toMatch(/^soyman:resource\/[0-9a-f-]+#page=33[0-3]$|^soyman:resource\/[0-9a-f-]+#page=32[89]$/);
    expect(view!.related).toContain("[[compendium_entry@");
  });

  it("shows Lucky's progress threshold and full veto/reset rule without a current-state counter", () => {
    const lucky = parse("Lucky");
    expect(lucky.bonus).toBe(2);
    expect(lucky.limits?.label).toBe("Предел прогресса");
    expect(lucky.limits?.values).toEqual([{ name: "OUT OF LUCK", value: 3 }]);
    expect(lucky.limits?.text).toContain("один раз запретить применение Stolen Fortune");
    expect(lucky.limits?.text).toContain("сбросьте предел");
    expect(lucky.specials?.[0].title).toBe("Stolen Fortune");
    expect(lucky.specials?.[0].text).toContain("stretched-luck-1");
    expect(lucky.sections.find(section => section.key === "Consequences")?.text).not.toContain("**Original:**");
  });

  it("does not turn holographic immunities into zero or numeric hit points", () => {
    const holographic = parse("Holographic");
    expect(holographic.limits?.values).toEqual([]);
    expect(holographic.limits?.text).toContain("Все Limits голографического испытания: –");
    expect(holographic.limits?.text).toContain("иммунитеты");
    expect(holographic.description).toContain("gun-wounds");
  });

  it("keeps polar limits and both possessed-spirit limits", () => {
    expect(parse("Sought After").limits?.values).toEqual([{ name: "catch/escape", value: 3 }]);
    expect(parse("Sought After").limits?.label).toBe("Полярный предел");
    expect(parse("Spirit-Possessed").limits?.values).toEqual([{ name: "EXORCISE", value: 3 }, { name: "BANISH", value: 3 }]);
    expect(parse("Spirit-Possessed").limits?.text).toContain("Present a New Challenge — Ghost");
  });

  it.each(["Nature Kissed", "Inhumanly Fast"])("does not apply the optional +1 to %s unconditionally", name => {
    const view = parse(name);
    expect(view.introduction).toContain("Необязательное усиление");
    expect(view.introduction).toContain(`суммарная прибавка +${view.bonus + 1}`);
  });

  it("keeps both drone variants, their limits, Scale and per-scene restrictions", () => {
    const drone = parse("Drone Deploying");
    expect(drone.specials?.map(special => special.title)).toEqual(["Bodyguards", "Drone", "Combat Drone", "Surveillance Swarm"]);
    expect(drone.specials?.[1].text).toContain("за сцену");
    expect(drone.specials?.[2].text).toContain("take-over-or-shutdown:2");
    expect(drone.specials?.[3].text).toContain("Scale 1");
  });

  it("preserves unfamiliar sections and unmatched English instead of silently hiding them", () => {
    const view = parsePowerSetPresentation(card("Lucky").description.replace(
      "### Особые правила — Specials", "### Новая оговорка\n\nВажное исключение.\n\n### Особые правила — Specials"
    ).replace("A car or passerby ‘just happens’", "An edited English consequence"), "Lucky")!;
    expect(view.sections.find(section => section.title === "Новая оговорка")?.text).toBe("Важное исключение.");
    expect(view.sections.find(section => section.key === "Consequences")?.text).toContain("An edited English consequence");
    expect(parsePowerSetPresentation("Новое описание без опознаваемой структуры", "Lucky")).toBeNull();
  });
});
