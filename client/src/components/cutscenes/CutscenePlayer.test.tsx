// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutscenePlaybackController } from "../../cutscenes/controller";
import type { CutscenePlaybackState } from "../../cutscenes/ports";
import { CutscenePlayerView } from "./CutscenePlayer";
vi.mock("./CutsceneTeleprompter", () => ({ CutsceneTeleprompter: () => <div>Текст и отдельные заметки</div> }));
vi.mock("./CutscenePreview", () => ({ CutscenePreview: () => <div>Превью</div> }));
beforeEach(() => vi.spyOn(document, "hasFocus").mockReturnValue(true));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture() {
  const document = { ...createCutsceneDocument("Показ 10"), steps: [createCutsceneStep("one"), createCutsceneStep("two")] };
  const controller = { next: vi.fn(async () => true), previous: vi.fn(async () => true), goTo: vi.fn(async () => true),
    pause: vi.fn(async () => true), resume: vi.fn(async () => true), setTextPaused: vi.fn(async () => true),
    complete: vi.fn(async () => true), interrupt: vi.fn(async () => true), retry: vi.fn(async () => true) };
  const state = { phase: "playing", busy: false, run: { endedAt: null, snapshot: { runId: "run-10", mode: "live", version: { document } } },
    step: { stepId: "one", stepIndex: 0 }, narration: { text: "Текст", locallyPaused: false }, notes: "", error: null } as unknown as CutscenePlaybackState;
  return { controller, state, props: { controller: controller as unknown as CutscenePlaybackController, state } };
}
const press = (code: string, key?: string) => { fireEvent.keyDown(window, { code, key }); fireEvent.keyUp(window, { code, key }); };
describe("полноэкранный пульт ведущего", () => {
  it("показывает имя, текущий шаг, текст/заметки, превью и команды", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} />);
    expect(screen.getByRole("dialog", { name: "Показ катсцены" })).toBeTruthy(); expect(screen.getByText("Шаг 1 из 2")).toBeTruthy();
    expect(screen.getByText("Превью")).toBeTruthy(); expect(screen.getByText("Текст и отдельные заметки")).toBeTruthy();
  });
  it("Space переходит один раз, Enter остаётся доступным кнопкам", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} />); press("Space", " "); expect(f.controller.next).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Завершить" })); expect(f.controller.complete).toHaveBeenCalledTimes(1);
  });
  it("на общей паузе Space/Left и прямой выбор заблокированы", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} state={{ ...f.state, phase: "paused", step: { ...f.state.step!, stepIndex: 1 } }} />);
    press("Space"); press("ArrowLeft"); expect(f.controller.next).not.toHaveBeenCalled(); expect(f.controller.previous).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  });
  it("последний шаг удерживается до отдельной команды завершения", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} state={{ ...f.state, step: { ...f.state.step!, stepIndex: 1, stepId: "two" } }} />);
    press("Space"); expect(f.controller.next).not.toHaveBeenCalled(); expect(f.controller.complete).not.toHaveBeenCalled();
    press("ArrowLeft"); expect(f.controller.previous).toHaveBeenCalledTimes(1);
  });
  it("во время подготовки навигация заблокирована, P может поставить общую паузу", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} state={{ ...f.state, phase: "preparing", busy: true }} />);
    press("Space"); press("KeyP", "з"); expect(f.controller.next).not.toHaveBeenCalled(); expect(f.controller.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Прервать и вернуться" }).hasAttribute("disabled")).toBe(false);
  });
  it("P и T вызывают независимые команды по физическому коду", () => {
    const f = fixture(), view = render(<CutscenePlayerView {...f.props} />);
    press("KeyT", "е"); expect(f.controller.setTextPaused).toHaveBeenCalledWith(true); expect(f.controller.pause).not.toHaveBeenCalled();
    press("KeyP", "з"); expect(f.controller.pause).toHaveBeenCalledTimes(1);
    view.rerender(<CutscenePlayerView {...f.props} state={{ ...f.state, phase: "paused", narration: { ...f.state.narration, locallyPaused: true } }} />);
    press("KeyP"); expect(f.controller.resume).toHaveBeenCalledTimes(1); expect(f.controller.setTextPaused).toHaveBeenCalledTimes(1);
  });
  it("Esc ставит общую паузу и открывает меню с тремя отдельными действиями", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} />); press("Escape");
    expect(f.controller.pause).toHaveBeenCalledTimes(1); const menu = screen.getByRole("dialog", { name: "Меню паузы" });
    expect(menu.textContent).toContain("Продолжить"); expect(menu.textContent).toContain("Завершить"); expect(menu.textContent).toContain("Прервать и вернуться");
  });
  it("выбор шага и прерывание используют тот же координатор", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } }); expect(f.controller.goTo).toHaveBeenCalledWith("two");
    fireEvent.click(screen.getByRole("button", { name: "Прервать и вернуться" })); expect(f.controller.interrupt).toHaveBeenCalledTimes(1);
  });
  it("blur не вызывает общую или локальную паузу", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} />); fireEvent(window, new Event("blur"));
    expect(f.controller.pause).not.toHaveBeenCalled(); expect(f.controller.setTextPaused).not.toHaveBeenCalled();
  });
  it("размонтирование освобождает клавиатуру и возвращает фокус инициатору", () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const f = fixture(), view = render(<CutscenePlayerView {...f.props} />); view.unmount();
    expect(document.activeElement).toBe(trigger); press("Space"); expect(f.controller.next).not.toHaveBeenCalled(); trigger.remove();
  });
  it("ошибка завершения оставляет отдельную команду повтора", () => {
    const f = fixture(); render(<CutscenePlayerView {...f.props} state={{ ...f.state, phase: "error", error: { code: "audio", stepId: "one", media: null, message: "Не удалось вернуть звук" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" })); expect(f.controller.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Не удалось вернуть звук");
  });
});
