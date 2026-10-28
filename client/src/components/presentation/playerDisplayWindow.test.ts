// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePlayerDisplayWindow, isPlayerDisplayRoute, openPlayerDisplayWindow } from "./playerDisplayWindow";

afterEach(() => { vi.restoreAllMocks(); delete window.electronAPI; });
describe("управляемое окно игроков", () => {
  it("распознаёт общий и прежний маршрут, оставляет предпросмотр самостоятельным", () => {
    expect(isPlayerDisplayRoute("/player-display")).toBe(true);
    expect(isPlayerDisplayRoute("/sessions/12/live/show")).toBe(true);
    expect(isPlayerDisplayRoute("/presentation-preview")).toBe(false);
  });
  it("сообщает блокировку окна вызывающему коду", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(await openPlayerDisplayWindow(null)).toMatchObject({ ok: false });
  });
  it("новое окно получает идентичность, повторное открытие не перезагружает кадр", async () => {
    const ref = { closed: false, location: { href: "about:blank", replace: vi.fn() }, focus: vi.fn(), close: vi.fn() };
    ref.location.replace.mockImplementation(url => { ref.location.href = new URL(url, "http://localhost").href; });
    vi.spyOn(window, "open").mockReturnValue(ref as unknown as Window);
    const first = await openPlayerDisplayWindow(null);
    const second = await openPlayerDisplayWindow(null);
    expect(first).toMatchObject({ ok: true, wasOpen: false, openedByCall: true });
    expect(second).toMatchObject({ ok: true, wasOpen: true, openedByCall: false });
    expect(ref.location.replace).toHaveBeenCalledTimes(1);
    expect(await closePlayerDisplayWindow(second)).toBe(false);
    expect(await closePlayerDisplayWindow(first)).toBe(true);
    expect(ref.close).toHaveBeenCalledTimes(1);
  });
  it("Electron возвращает собственный результат и не открывает browser popup", async () => {
    const open = vi.spyOn(window, "open");
    const closePlayerDisplay = vi.fn().mockResolvedValue(true);
    window.electronAPI = { openPlayerDisplay: vi.fn().mockResolvedValue({ ok: true, wasOpen: false, openedByCall: true, windowId: "42", screenId: null }),
      closePlayerDisplay } as unknown as NonNullable<Window["electronAPI"]>;
    const opened = await openPlayerDisplayWindow(null);
    expect(open).not.toHaveBeenCalled();
    expect(await closePlayerDisplayWindow(opened)).toBe(true); expect(closePlayerDisplay).toHaveBeenCalledWith("42");
  });
});
