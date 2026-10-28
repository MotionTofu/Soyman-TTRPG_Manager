// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../cutscenes/useWorkshopPreview", () => ({ useWorkshopPreview: () => ({ controller: preview, state }) }));
const preview = { play: vi.fn(), stop: vi.fn(), repeatVisual: vi.fn(), external: vi.fn(), stopForeign: vi.fn() };
const state: Record<string, unknown> = { phase: "idle", mode: null, external: false, error: null, foreign: null, visualPlayback: { elapsedMs: 0, startedAt: null } };
import { WorkshopPreviewControls } from "./WorkshopPreviewControls";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("клавиши предпросмотра", () => {
  it("после щелчка по кнопке фокус остаётся в области, и стрелки листают шаги", () => {
    const onStep = vi.fn();
    render(<WorkshopPreviewControls position="Шаг 2 из 3" canStep={() => true} onStep={onStep} />);
    fireEvent.click(screen.getByRole("button", { name: /Воспроизвести всё/ }));
    const area = screen.getByRole("region", { name: "Предпросмотр катсцены" });
    expect(document.activeElement).toBe(area);
    fireEvent.keyDown(area, { code: "ArrowRight" });
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("стрелка на кнопке тоже листает шаги", () => {
    const onStep = vi.fn();
    render(<WorkshopPreviewControls position="Шаг 2 из 3" canStep={() => true} onStep={onStep} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Повторить переход и титр" }), { code: "ArrowLeft" });
    expect(onStep).toHaveBeenCalledWith(-1);
  });

  it("пробел в области запускает предпросмотр и не доходит до полосы плеера", () => {
    const player = vi.fn();
    window.addEventListener("keydown", player);
    try {
      render(<WorkshopPreviewControls position="Шаг 2 из 3" canStep={() => true} onStep={vi.fn()} />);
      fireEvent.keyDown(screen.getByRole("region", { name: "Предпросмотр катсцены" }), { code: "Space" });
      expect(preview.play).toHaveBeenCalledWith("general");
      fireEvent.keyDown(screen.getByRole("button", { name: "Повторить переход и титр" }), { code: "Space" });
      expect(preview.play).toHaveBeenCalledTimes(1);
      expect(player).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", player); }
  });
  it("«Стоп» есть только во время проигрывания, ‹ › учитывают края", () => {
    const view = render(<WorkshopPreviewControls position="Шаг 1 из 3" canStep={direction => direction > 0} onStep={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();
    expect(screen.getByRole("button", { name: "Предыдущий шаг" }).hasAttribute("disabled")).toBe(true);
    state.phase = "playing"; state.mode = "general";
    try { view.rerender(<WorkshopPreviewControls position="Шаг 1 из 3" canStep={() => true} onStep={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Стоп" })).toBeTruthy(); expect(screen.getByRole("status").textContent).toBe("Играет");
    } finally { state.phase = "idle"; state.mode = null; }
  });
});
