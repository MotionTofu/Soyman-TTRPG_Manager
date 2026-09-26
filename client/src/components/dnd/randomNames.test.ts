import { describe, expect, it } from "vitest";
import { RANDOM_NAMES, randomName } from "./randomNames";

describe("randomNames", () => {
  it("у каждого вида 30 имён без повторов", () => {
    for (const [key, list] of Object.entries(RANDOM_NAMES)) {
      const all = [...list.male, ...list.female, ...(list.nick ?? [])];
      expect(all.length, key).toBe(30);
      expect(new Set(all).size, key).toBe(30);
    }
  });
  it("незнакомый вид — имя из людей", () => {
    const human = new Set([...RANDOM_NAMES.Human.male, ...RANDOM_NAMES.Human.female]);
    expect(human.has(randomName("Nope", () => 0.5))).toBe(true);
    expect(human.has(randomName(null))).toBe(true);
  });
});
