import { describe, it, expect } from "vitest";
import {
  LOCATION_CONTENT_KINDS,
  LOCATION_CONTENT_LABELS,
  validateContentInput,
} from "./locationContent";

// Чистая валидация без импорта роутера/db (у них побочный эффект —
// открытие базы): тот же приём, что locationRoles.test.ts.
describe("location content", () => {
  it("у каждого типа есть подпись", () => {
    for (const k of LOCATION_CONTENT_KINDS) {
      expect(LOCATION_CONTENT_LABELS[k].trim().length).toBeGreaterThan(0);
    }
  });

  it("принимает корректную строку", () => {
    expect(validateContentInput("secret", "тайник под плитой")).toBe(null);
  });

  it("режет тип, пустоту и длину", () => {
    expect(validateContentInput("mimic", "x")).toMatch(/kind must be/);
    expect(validateContentInput("loot", "   ")).toMatch(/must not be empty/);
    expect(validateContentInput("trap", "x".repeat(2001))).toMatch(/≤2000/);
    expect(validateContentInput("trap", "x".repeat(2000))).toBe(null);
  });
});
