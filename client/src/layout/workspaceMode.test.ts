import { describe, expect, it } from "vitest";
import { workspaceMode } from "./workspaceMode";

describe("workspaceMode", () => {
  it.each(["/maps", "/maps/", "/maps/1", "/maps/42/", "/maps/42/workspace", "/maps/42/workspace/"])("восстанавливает карты из %s", (path) => {
    expect(workspaceMode(path, "gm")).toBe("maps");
  });
  it.each(["/maps-old", "/maps/foo", "/maps/42/preview", "/campaigns/1"])("оставляет обычную оболочку для %s", (path) => {
    expect(workspaceMode(path, "gm")).toBe("standard");
  });
  it("не открывает инструменты мастера игроку или при загрузке роли", () => {
    expect(workspaceMode("/maps/1", "player")).toBe("standard");
    expect(workspaceMode("/maps/1")).toBe("standard");
  });
  it("отличает пульт от отдельного окна панели", () => {
    expect(workspaceMode("/sessions/1/live", "gm")).toBe("session");
    expect(workspaceMode("/sessions/1/live/panel/map", "gm")).toBe("standard");
  });
});
