// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme, findTheme, loadCardBorders, migrateThemeId, saveCardBorders,
} from "./themes";

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

describe("обводки карточек — пользовательский тумблер", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-card-borders");
  });

  it("по умолчанию включены", () => {
    expect(loadCardBorders()).toBe(true);
  });

  it("выключение пишет 0px в пару толщин и флаг на <html>", () => {
    saveCardBorders(false);
    applyTheme(findTheme("light"));
    const root = document.documentElement;
    expect(loadCardBorders()).toBe(false);
    expect(root.getAttribute("data-card-borders")).toBe("off");
    expect(root.style.getPropertyValue("--card-border-width")).toBe("0px");
    expect(root.style.getPropertyValue("--card-border-width-strong")).toBe("0px");
  });

  it("включение возвращает 1px и снимает прошлое усиление", () => {
    saveCardBorders(false);
    applyTheme(findTheme("light"));
    saveCardBorders(true);
    applyTheme(findTheme("light"));
    const root = document.documentElement;
    expect(loadCardBorders()).toBe(true);
    expect(root.getAttribute("data-card-borders")).toBe("on");
    expect(root.style.getPropertyValue("--card-border-width")).toBe("1px");
    expect(root.style.getPropertyValue("--card-border-width-strong")).toBe("");
  });
});
