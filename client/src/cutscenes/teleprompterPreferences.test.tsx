// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { readTeleprompterFont, saveTeleprompterFont, teleprompterFontKey } from "./teleprompterPreferences";
import { useTeleprompterFont } from "./useTeleprompterFont";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("личный размер текста ведущего", () => {
  it("начинается с согласованных 32 px", () => { expect(readTeleprompterFont(1)).toBe(32); });
  it("разделён между ведущими", () => {
    saveTeleprompterFont(1, 42); expect(readTeleprompterFont(1)).toBe(42); expect(readTeleprompterFont(2)).toBe(32);
  });
  it("не записывает настройку до определения пользователя", () => {
    saveTeleprompterFont(null, 42); expect(localStorage.length).toBe(0); expect(readTeleprompterFont(null)).toBe(32);
  });
  it("повреждённые значения не ломают размер и не перезаписывают последнюю настройку", () => {
    for (const value of ["", "NaN", "Infinity", "0", "-32", "bad"]) {
      localStorage.setItem(teleprompterFontKey(1)!, value); expect(readTeleprompterFont(1)).toBe(32);
    }
    saveTeleprompterFont(1, 40); saveTeleprompterFont(1, -20); expect(readTeleprompterFont(1)).toBe(40);
  });
  it("сохраняется после перемонтирования и меняется вместе с пользователем", () => {
    const a = renderHook(({ userId }) => useTeleprompterFont(userId), { initialProps: { userId: 1 } });
    act(() => a.result.current[1](44)); a.rerender({ userId: 2 }); expect(a.result.current[0]).toBe(32);
    a.rerender({ userId: 1 }); expect(a.result.current[0]).toBe(44); a.unmount();
    const b = renderHook(() => useTeleprompterFont(1)); expect(b.result.current[0]).toBe(44);
  });
  it("синхронизирует две панели одного ведущего и события другого окна", () => {
    const a = renderHook(() => useTeleprompterFont(1)), b = renderHook(() => useTeleprompterFont(1));
    act(() => a.result.current[1](40)); expect(b.result.current[0]).toBe(40);
    act(() => { localStorage.setItem(teleprompterFontKey(1)!, "48"); window.dispatchEvent(new StorageEvent("storage", { key: teleprompterFontKey(1) })); });
    expect(a.result.current[0]).toBe(48); expect(b.result.current[0]).toBe(48);
  });
  it("недоступный localStorage оставляет изменение в текущей панели работоспособным", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
    const f = renderHook(() => useTeleprompterFont(1)); act(() => f.result.current[1](40)); expect(f.result.current[0]).toBe(40);
  });
});
