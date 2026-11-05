// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerDisplayFrame } from "@shared/playerDisplay";
import { PlayerDisplaySurface } from "./PlayerDisplaySurface";

const frame = (key: string, kind: "cut" | "fade" | "black" = "cut", durationMs = 0): PlayerDisplayFrame => ({
  revision: 1, playKey: key, display: { rotation: 0, fit: "contain", zoom: 1, pan_x: 0, pan_y: 0, screen_w: null, screen_h: null },
  transition: { kind, durationMs }, content: { kind: "black" },
});
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
let animations: { duration: number; animation: { onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> } }[];
beforeEach(() => {
  vi.useFakeTimers(); animations = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn((_keys, options) => {
    const animation = { onfinish: null, cancel: vi.fn() };
    animations.push({ duration: (options as KeyframeAnimationOptions).duration as number, animation });
    return animation as unknown as Animation;
  }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate; });
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
describe("переходы общего окна", () => {
  it("через чёрное занимает T: две фазы по T/2, без звуковых элементов", async () => {
    const view = render(<PlayerDisplaySurface frame={frame("old")} />); await flush();
    view.rerender(<PlayerDisplaySurface frame={frame("new", "black", 1000)} />); await flush();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(animations.map(a => a.duration)).toEqual([500]);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(animations.map(a => a.duration)).toEqual([500, 500]);
    expect(view.container.querySelectorAll("audio")).toHaveLength(0);
    act(() => animations[1].animation.onfinish?.());
    expect(view.container.querySelectorAll(".player-display-layer")).toHaveLength(1);
  });
  it("повторный опрос того же кадра не переигрывает переход", async () => {
    const view = render(<PlayerDisplaySurface frame={frame("current", "fade", 600)} />); await flush();
    await act(async () => { vi.advanceTimersByTime(1); });
    view.rerender(<PlayerDisplaySurface frame={{ ...frame("current", "fade", 600), revision: 2 }} />); await flush();
    expect(animations).toHaveLength(1);
  });
  it("новый шаг прерывает анимацию и отменяет старую отложенную смену кадра", async () => {
    const view = render(<PlayerDisplaySurface frame={frame("old")} />); await flush();
    view.rerender(<PlayerDisplaySurface frame={frame("middle", "black", 1000)} />); await flush();
    await act(async () => { vi.advanceTimersByTime(100); });
    view.rerender(<PlayerDisplaySurface frame={frame("last")} />); await flush();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(animations[0].animation.cancel).toHaveBeenCalled();
    expect(view.container.querySelector(".player-display-surface")?.getAttribute("data-play-key")).toBe("last");
    expect(view.container.querySelectorAll(".player-display-layer")).toHaveLength(1);
  });
});

it("сообщает идентичность неудавшегося кадра, поздняя ошибка уже сменённого кадра игнорируется", async () => {
  const images: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null; onerror: (() => void) | null = null; src = "";
    constructor() { images.push(this); }
  });
  const failed = { ...frame("failed"), content: { kind: "composition" as const, data: { background_url: "/files/missing.png", layers: [] }, visibleLayerIds: [] } } as unknown as PlayerDisplayFrame;
  const error = vi.fn(), view = render(<PlayerDisplaySurface frame={failed} onError={error} />);
  await act(async () => { images[0].onerror?.(); });
  expect(error).toHaveBeenCalledWith("Изображение не загружено", failed);
  error.mockClear();
  view.rerender(<PlayerDisplaySurface frame={{ ...failed, playKey: "older" }} onError={error} />); await flush();
  view.rerender(<PlayerDisplaySurface frame={frame("current")} onError={error} />); await flush();
  await act(async () => { images[1].onerror?.(); }); expect(error).not.toHaveBeenCalled();
});
