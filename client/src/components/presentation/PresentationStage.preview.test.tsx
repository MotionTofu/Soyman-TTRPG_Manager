// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationStage } from "./PresentationStage";
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("время титра предпросмотра", () => {
  it("подключает текущую позицию и удерживает титр при паузе без перезапуска", () => {
    vi.useFakeTimers(); vi.setSystemTime(10_000);
    const props = { backgroundUrl: null, layers: [], visibleIds: [], fadeMs: 0, transition: "cut", transitionMs: 0, title: "Ворота", titleSecs: 3, playKey: "same" };
    const view = render(<PresentationStage {...props} playback={{ elapsedMs: 2000, startedAt: null }} />);
    act(() => vi.advanceTimersByTime(10_000)); expect(screen.getByText("Ворота")).toBeTruthy();
    view.rerender(<PresentationStage {...props} playback={{ elapsedMs: 2000, startedAt: Date.now() }} />);
    act(() => vi.advanceTimersByTime(999)); expect(screen.getByText("Ворота")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2)); expect(screen.queryByText("Ворота")).toBeNull();
  });
});
