import { describe, it, expect } from "vitest";
import { isMigratedRoute } from "./migratedRoutes";

describe("переведённые страницы", () => {
  it("профиль персонажа и чарник на весь экран — переведены", () => {
    expect(isMigratedRoute("/characters/7")).toBe(true);
    expect(isMigratedRoute("/characters/7/")).toBe(true);
    expect(isMigratedRoute("/characters/7/sheet")).toBe(true);
  });

  it("соседние адреса не цепляются префиксом", () => {
    expect(isMigratedRoute("/characters")).toBe(false);
    expect(isMigratedRoute("/characters/7/sheet/extra")).toBe(false);
    expect(isMigratedRoute("/beings/7")).toBe(false);
    expect(isMigratedRoute("/campaigns/3")).toBe(false);
  });
});
