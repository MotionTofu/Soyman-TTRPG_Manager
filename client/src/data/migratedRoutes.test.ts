import { describe, it, expect } from "vitest";
import { isMigratedRoute } from "./migratedRoutes";

describe("переведённые страницы", () => {
  it("профиль персонажа и чарник на весь экран — переведены", () => {
    expect(isMigratedRoute("/characters/7")).toBe(true);
    expect(isMigratedRoute("/characters/7/")).toBe(true);
    expect(isMigratedRoute("/characters/7/sheet")).toBe(true);
  });

  it("профиль сессии, пульт и вынесенная панель — переведены, окно показа — нет", () => {
    expect(isMigratedRoute("/sessions/15")).toBe(true);
    expect(isMigratedRoute("/sessions/15/live")).toBe(true);
    expect(isMigratedRoute("/sessions/15/live/panel/plotCharacters")).toBe(true);
    expect(isMigratedRoute("/sessions/15/live/show")).toBe(false);
    expect(isMigratedRoute("/sessions")).toBe(false);
  });

  it("карточки сущностей сеттинга и сам сеттинг — переведены, список сеттингов — нет", () => {
    for (const base of ["locations", "beings", "artifacts", "communities", "events", "compendium", "scenes", "adventures"]) {
      expect(isMigratedRoute(`/${base}/12`)).toBe(true);
    }
    expect(isMigratedRoute("/settings/1")).toBe(true);
    expect(isMigratedRoute("/settings")).toBe(false);
    expect(isMigratedRoute("/canvas")).toBe(true);
    expect(isMigratedRoute("/canvas/board")).toBe(false);
  });

  it("список и профиль кампании переведены", () => {
    expect(isMigratedRoute("/campaigns")).toBe(true);
    expect(isMigratedRoute("/campaigns/")).toBe(true);
    expect(isMigratedRoute("/campaigns/3")).toBe(true);
    expect(isMigratedRoute("/campaigns/3/extra")).toBe(false);
  });

  it("соседние адреса не цепляются префиксом", () => {
    expect(isMigratedRoute("/characters")).toBe(false);
    expect(isMigratedRoute("/characters/7/sheet/extra")).toBe(false);
    expect(isMigratedRoute("/beings")).toBe(false);
    expect(isMigratedRoute("/beings/7/extra")).toBe(false);
  });
});
