import { describe, it, expect } from "vitest";
import { LOCATION_ROLES, LOCATION_ROLE_LABELS, isLocationRole } from "./locationRoles";

// Чистая валидация без импорта роутера/db (у них побочный эффект —
// открытие базы): тот же приём, что maps.test.ts.
describe("location roles", () => {
  it("принимает ровно три веса", () => {
    expect([...LOCATION_ROLES]).toEqual(["location", "sector", "spot"]);
  });

  it("у каждого веса есть подпись", () => {
    for (const r of LOCATION_ROLES) {
      expect(LOCATION_ROLE_LABELS[r].trim().length).toBeGreaterThan(0);
    }
  });

  it("валидирует значения", () => {
    expect(isLocationRole("location")).toBe(true);
    expect(isLocationRole("sector")).toBe(true);
    expect(isLocationRole("spot")).toBe(true);
    expect(isLocationRole("dungeon")).toBe(false);
    expect(isLocationRole("")).toBe(false);
    expect(isLocationRole(undefined)).toBe(false);
    expect(isLocationRole(null)).toBe(false);
    expect(isLocationRole(42)).toBe(false);
  });
});
