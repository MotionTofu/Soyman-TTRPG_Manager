// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapHotkeys } from "./useMapHotkeys";

// vitest без globals: авто-cleanup RTL не срабатывает, слушатели window
// текли бы между тестами — размонтируем явно.
afterEach(() => {
  cleanup();
});

function setup(overrides: Record<string, unknown> = {}) {
  const handlers = {
    canEdit: true,
    onSelectTool: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFit: vi.fn(),
    hasSelection: true,
    onDeleteSelected: vi.fn(),
    onCancel: vi.fn(),
    canFinishWall: true,
    onFinishWall: vi.fn(),
    isGenOpen: false,
    onGenerate: vi.fn(),
    onToggleGen: vi.fn(),
    onTogglePng: vi.fn(),
    ...overrides,
  };
  const utils = renderHook((props: typeof handlers) => useMapHotkeys(props), {
    initialProps: handlers,
  });
  return { ...utils, handlers };
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const ev = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.focus();
});

describe("useMapHotkeys (Этап Hotkeys)", () => {
  it("1. переключает основные инструменты без preventDefault", () => {
    const h = setup();
    const cases: Array<[string, string]> = [
      ["KeyV", "select"],
      ["KeyB", "brush"],
      ["KeyE", "eraser"],
      ["KeyI", "picker"],
      ["KeyG", "fill"],
      ["KeyR", "road"],
      ["KeyN", "river"],
      ["KeyW", "wall"],
      ["KeyU", "shape"],
      ["KeyM", "ruler"],
      ["KeyT", "label"],
      ["KeyD", "door"],
      ["KeyL", "trap"],
      ["KeyC", "chest"],
      ["KeyA", "altar"],
      ["KeyK", "marker"],
      ["KeyS", "start"],
      ["KeyF", "finish"],
    ];
    for (const [code, tool] of cases) {
      const ev = press({ code });
      expect(h.handlers.onSelectTool).toHaveBeenLastCalledWith(tool);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(h.handlers.onSelectTool).toHaveBeenCalledTimes(cases.length);
  });

  it("2. undo по Ctrl+Z и Cmd+Z", () => {
    const h = setup();
    const ev = press({ code: "KeyZ", ctrlKey: true });
    expect(h.handlers.onUndo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    press({ code: "KeyZ", metaKey: true });
    expect(h.handlers.onUndo).toHaveBeenCalledTimes(2);
  });

  it("3. redo по Ctrl+Shift+Z и Ctrl+Y", () => {
    const h = setup();
    press({ code: "KeyZ", ctrlKey: true, shiftKey: true });
    press({ code: "KeyY", ctrlKey: true });
    expect(h.handlers.onRedo).toHaveBeenCalledTimes(2);
  });

  it("4-5. zoom +/- и fit по 0", () => {
    const h = setup();
    let ev = press({ code: "Equal" });
    expect(h.handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    press({ code: "NumpadAdd" });
    expect(h.handlers.onZoomIn).toHaveBeenCalledTimes(2);
    ev = press({ code: "Minus" });
    expect(h.handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    press({ code: "NumpadSubtract" });
    expect(h.handlers.onZoomOut).toHaveBeenCalledTimes(2);
    ev = press({ code: "Digit0" });
    expect(h.handlers.onFit).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    press({ code: "Numpad0" });
    expect(h.handlers.onFit).toHaveBeenCalledTimes(2);
  });

  it("6. Delete только при выборе", () => {
    const h = setup({ hasSelection: true });
    const ev = press({ code: "Delete" });
    expect(h.handlers.onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    h.rerender({ ...h.handlers, hasSelection: false });
    press({ code: "Delete" });
    expect(h.handlers.onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it("7. Escape — cancel без preventDefault", () => {
    const h = setup();
    const ev = press({ code: "Escape" });
    expect(h.handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("8. Enter — финиш стен только при черновике", () => {
    const h = setup({ canFinishWall: true });
    const ev = press({ code: "Enter" });
    expect(h.handlers.onFinishWall).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    h.rerender({ ...h.handlers, canFinishWall: false });
    const ev2 = press({ code: "Enter" });
    expect(h.handlers.onFinishWall).toHaveBeenCalledTimes(1);
    expect(ev2.defaultPrevented).toBe(false);
  });

  it("9. молчит в input/textarea/contentEditable", () => {
    const h = setup();
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, area, editable);
    try {
      for (const el of [input, area, editable]) {
        el.focus();
        press({ code: "KeyB" });
        press({ code: "KeyZ", ctrlKey: true });
        press({ code: "Equal" });
      }
      expect(h.handlers.onSelectTool).not.toHaveBeenCalled();
      expect(h.handlers.onUndo).not.toHaveBeenCalled();
      expect(h.handlers.onZoomIn).not.toHaveBeenCalled();
    } finally {
      input.remove();
      area.remove();
      editable.remove();
    }
  });

  it("10. модификаторы не переключают инструменты, Ctrl+G не трогаем", () => {
    const h = setup();
    press({ code: "KeyB", ctrlKey: true });
    press({ code: "KeyB", metaKey: true });
    press({ code: "KeyB", altKey: true });
    press({ code: "KeyG", ctrlKey: true });
    expect(h.handlers.onSelectTool).not.toHaveBeenCalled();
    expect(h.handlers.onToggleGen).not.toHaveBeenCalled();
  });

  it("read-only: инструменты/undo/delete закрыты, zoom/fit/cancel живы", () => {
    const h = setup({ canEdit: false, hasSelection: true });
    press({ code: "KeyB" });
    press({ code: "KeyZ", ctrlKey: true });
    press({ code: "Delete" });
    expect(h.handlers.onSelectTool).not.toHaveBeenCalled();
    expect(h.handlers.onUndo).not.toHaveBeenCalled();
    expect(h.handlers.onDeleteSelected).not.toHaveBeenCalled();
    press({ code: "Equal" });
    press({ code: "Digit0" });
    press({ code: "Escape" });
    expect(h.handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(h.handlers.onFit).toHaveBeenCalledTimes(1);
    expect(h.handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter генерирует только при открытой панели", () => {
    const h = setup({ isGenOpen: true });
    const ev = press({ code: "Enter", ctrlKey: true });
    expect(h.handlers.onGenerate).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    h.rerender({ ...h.handlers, isGenOpen: false });
    press({ code: "Enter", ctrlKey: true });
    expect(h.handlers.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("Alt+G / Alt+P переключают панели", () => {
    const h = setup();
    press({ code: "KeyG", altKey: true });
    press({ code: "KeyP", altKey: true });
    expect(h.handlers.onToggleGen).toHaveBeenCalledTimes(1);
    expect(h.handlers.onTogglePng).toHaveBeenCalledTimes(1);
  });
});
