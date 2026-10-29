import { describe, expect, it } from "vitest";
import { findTheme, migrateThemeId } from "./themes";

describe("migrateThemeId — перевод старого выбора на две темы v2", () => {
  it("новые id остаются", () => {
    expect(migrateThemeId("light", undefined)).toBe("light");
    expect(migrateThemeId("dark", undefined)).toBe("dark");
  });
  it("тёмные встроенные → тёмная, светлые → светлая", () => {
    for (const id of ["peace", "neon", "aberrant", "riot"]) expect(migrateThemeId(id, [])).toBe("dark");
    for (const id of ["noir", "zine", "classic"]) expect(migrateThemeId(id, [])).toBe("light");
  });
  it("своя тема — по сохранённому режиму", () => {
    const custom = [{ id: "custom-1", name: "Моя", mode: "dark", vars: {} }];
    expect(migrateThemeId("custom-1", custom)).toBe("dark");
    expect(migrateThemeId("custom-2", custom)).toBe("light");
  });
  it("мусор → тема по умолчанию", () => {
    expect(migrateThemeId(42, null)).toBe("light");
    expect(findTheme("нет такой").id).toBe("light");
  });
});
