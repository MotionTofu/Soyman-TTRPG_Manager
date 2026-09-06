import { describe, it, expect } from "vitest";
import { matchCreatureType, parseCreatureMeta } from "./creatureMeta";
import { DND_CREATURE_TYPES } from "./creatureMeta";

describe("matchCreatureType legacy alias", () => {
  it("maps бестия to Исчадие", () => {
    expect(matchCreatureType("бестия", DND_CREATURE_TYPES)).toBe("Исчадие");
    expect(matchCreatureType("Бестий", DND_CREATURE_TYPES)).toBe("Исчадие");
  });
  it("does not map бестиарий", () => {
    expect(matchCreatureType("бестиарий", DND_CREATURE_TYPES)).toBe("");
  });
  it("parses legacy type line", () => {
    const m = parseCreatureMeta("Средняя бестия, нейтрально-злая");
    expect(m.type).toBe("Исчадие");
    expect(m.unknownType).toBe("");
  });
});
