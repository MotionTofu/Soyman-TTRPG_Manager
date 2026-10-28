// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CutsceneKeyboardRouter, installCutsceneKeyboard } from "./keyboard";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); });
function setup() {
  let focused = true;
  const router = new CutsceneKeyboardRouter(window, () => focused), invoke = vi.fn();
  cleanups.push(() => router.dispose());
  const release = router.claim(invoke);
  return { router, invoke, release, focus(value: boolean) { focused = value; } };
}
function key(type: "keydown" | "keyup", code: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event;
}
describe("владение клавиатурой катсцены", () => {
  it("одна установка маршрутизатора на окно", () => { expect(installCutsceneKeyboard()).toBe(installCutsceneKeyboard()); });
  it("одно удержание даёт одну команду даже без корректного repeat", () => {
    const f = setup(); key("keydown", "Space"); key("keydown", "Space", { repeat: true }); key("keydown", "Space");
    expect(f.invoke).toHaveBeenCalledTimes(1); key("keyup", "Space"); key("keydown", "Space"); expect(f.invoke).toHaveBeenCalledTimes(2);
  });
  it.each([["KeyP", "p", "pause"], ["KeyP", "з", "pause"], ["KeyT", "t", "text"], ["KeyT", "е", "text"]])("физический %s / %s → %s", (code, value, command) => {
    const f = setup(); key("keydown", code, { key: value }); expect(f.invoke).toHaveBeenCalledWith(command);
  });
  it("стрелка влево и Esc получают свои команды", () => {
    const f = setup(); key("keydown", "ArrowLeft"); key("keydown", "Escape"); expect(f.invoke.mock.calls).toEqual([["previous"], ["menu"]]);
  });
  it("пробел потребляется на обоих краях и не всплывает от сфокусированной кнопки", () => {
    const f = setup(), button = document.createElement("button"), down = vi.fn(), up = vi.fn(); document.body.append(button);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    cleanups.push(() => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); });
    expect(key("keydown", "Space", { key: " " }, button).defaultPrevented).toBe(true);
    expect(key("keyup", "Space", { key: " " }, button).defaultPrevented).toBe(true);
    expect(down).not.toHaveBeenCalled(); expect(up).not.toHaveBeenCalled(); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it("ранний capture останавливает и соседний capture на том же window", () => {
    setup(); const other = vi.fn(); window.addEventListener("keydown", other, true);
    cleanups.push(() => window.removeEventListener("keydown", other, true)); key("keydown", "Space"); expect(other).not.toHaveBeenCalled();
  });
  it("пробел принадлежит режиму и в полях ввода", () => {
    const f = setup(), input = document.createElement("input"); document.body.append(input);
    expect(key("keydown", "Space", {}, input).defaultPrevented).toBe(true); expect(f.invoke).toHaveBeenCalledWith("next");
  });
  it("модификатор и IME не выполняют команду и не передают пробел другому плееру", () => {
    const f = setup(); expect(key("keydown", "Space", { ctrlKey: true }).defaultPrevented).toBe(true); key("keyup", "Space");
    key("keydown", "Space", { isComposing: true }); expect(f.invoke).not.toHaveBeenCalled();
  });
  it("после выхода обычные клавиши снова доходят до приложения", () => {
    const f = setup(); key("keydown", "Space"); key("keyup", "Space"); f.release();
    expect(key("keydown", "Space").defaultPrevented).toBe(false); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it("отпускание удержанного при выходе пробела не активирует нижнюю кнопку", () => {
    const f = setup(); key("keydown", "Space"); f.release();
    expect(key("keydown", "Space", { repeat: true }).defaultPrevented).toBe(true);
    expect(key("keyup", "Space").defaultPrevented).toBe(true); expect(key("keydown", "Space").defaultPrevented).toBe(false);
  });
  it("потеря фокуса не вызывает команд и не захватывает чужой ввод", () => {
    const f = setup(); f.focus(false); window.dispatchEvent(new Event("blur"));
    expect(key("keydown", "Space").defaultPrevented).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
    f.focus(true); key("keydown", "Space"); expect(f.invoke).toHaveBeenCalledWith("next");
  });
  it("освобождение старого владельца не снимает нового, повторный mount не копит обработчики", () => {
    const f = setup(), other = vi.fn(), release = f.router.claim(other); f.release();
    key("keydown", "Space"); key("keyup", "Space"); expect(other).toHaveBeenCalledTimes(1); expect(f.invoke).not.toHaveBeenCalled(); release();
    const again = f.router.claim(f.invoke); key("keydown", "Space"); key("keyup", "Space"); expect(f.invoke).toHaveBeenCalledTimes(1); again();
  });
  it("остальные клавиши сохраняют обычное поведение", () => {
    const f = setup(); for (const code of ["Enter", "Tab", "PageDown", "KeyA"]) expect(key("keydown", code).defaultPrevented).toBe(false);
    expect(f.invoke).not.toHaveBeenCalled();
  });
});
