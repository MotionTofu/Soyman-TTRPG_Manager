// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createTeleprompterCursor, TeleprompterScroller, teleprompterWordCount } from "./teleprompter";

function setup(options: { height?: number; viewportHeight?: number; words?: number; cursor?: ReturnType<typeof createTeleprompterCursor> } = {}) {
  const viewport = document.createElement("div"), content = document.createElement("div"); viewport.append(content);
  let height = options.height ?? 1000, viewportHeight = options.viewportHeight ?? 200, now = 0, id = 0;
  content.textContent = Array(options.words ?? 100).fill("слово").join(" ");
  Object.defineProperty(content, "scrollHeight", { get: () => height });
  Object.defineProperty(viewport, "scrollHeight", { get: () => height });
  Object.defineProperty(viewport, "clientHeight", { get: () => viewportHeight });
  const frames = new Map<number, (time: number) => void>(), manual = vi.fn(), changed = vi.fn();
  const cursor = options.cursor ?? createTeleprompterCursor();
  const scroller = new TeleprompterScroller(viewport, content, cursor, { manual, changed, clock: {
    now: () => now, request: callback => { frames.set(++id, callback); return id; }, cancel: key => { frames.delete(key); },
  } });
  return { viewport, content, cursor, manual, changed, scroller, frames,
    tick(ms: number) { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); },
    resize(h: number, v = viewportHeight) { height = h; viewportHeight = v; scroller.refresh(); },
  };
}

describe("чтение и прокрутка телесуфлёра", () => {
  it("считает отображаемые слова без отдельно стоящей пунктуации", () => {
    expect(teleprompterWordCount("Мирт — сказал: «ну-ка, ещё 2 слова!»")).toBe(6);
    expect(teleprompterWordCount(" \n … — ")).toBe(0);
  });
  it("переводит темп в движение по геометрии отрисованного текста", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000);
    expect(f.viewport.scrollTop).toBe(20); f.scroller.dispose();
  });
  it("прежняя идентичность не сбрасывает позицию при новых заметках/рендере", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000); f.scroller.update("a", false, 120);
    expect(f.viewport.scrollTop).toBe(20); f.scroller.dispose();
  });
  it("новый и возвращённый текст начинают с нуля, истории прошлых текстов нет", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000);
    f.scroller.update("b", false, 120); expect(f.viewport.scrollTop).toBe(0); f.tick(1000);
    f.scroller.update("a", false, 120); expect(f.viewport.scrollTop).toBe(0); f.scroller.dispose();
  });
  it("общая пауза останавливает время, продолжение не догоняет паузу", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000); f.scroller.update("a", true, 120);
    f.tick(10000); expect(f.viewport.scrollTop).toBe(20);
    f.scroller.update("a", false, 120); f.tick(1000); expect(f.viewport.scrollTop).toBe(40); f.scroller.dispose();
  });
  it("изменение темпа не сбрасывает чтение", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000);
    f.scroller.update("a", false, 60); f.tick(1000); expect(f.viewport.scrollTop).toBe(30); f.scroller.dispose();
  });
  it("программный scroll не вызывает локальную паузу", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000); f.scroller.scrolled();
    expect(f.manual).not.toHaveBeenCalled(); f.tick(1000); expect(f.viewport.scrollTop).toBe(40); f.scroller.dispose();
  });
  it("колесо немедленно останавливает автоматическую прокрутку", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000); f.scroller.pauseForManualScroll();
    f.tick(1000); expect(f.viewport.scrollTop).toBe(20); expect(f.manual).toHaveBeenCalledTimes(1); f.scroller.dispose();
  });
  it("перетаскивание полосы прокрутки сохраняет выбранное место и ставит локальную паузу", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.viewport.scrollTop = 350; f.scroller.scrolled();
    f.tick(1000); expect(f.cursor.top).toBe(350); expect(f.manual).toHaveBeenCalledTimes(1);
    f.scroller.update("a", false, 120); f.tick(1000); expect(f.viewport.scrollTop).toBe(370); f.scroller.dispose();
  });
  it("страничные клавиши приостанавливают текст, навигационные клавиши катсцены не перехватываются", () => {
    const f = setup(); f.scroller.update("a", false, 120);
    f.scroller.keydown(new KeyboardEvent("keydown", { key: "PageDown" })); expect(f.manual).toHaveBeenCalledTimes(1);
    const space = new KeyboardEvent("keydown", { key: " ", cancelable: true }); f.scroller.keydown(space);
    expect(space.defaultPrevented).toBe(false); expect(f.manual).toHaveBeenCalledTimes(1); f.scroller.dispose();
  });
  it("шрифт и ширина сохраняют относительное место чтения", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(5000); expect(f.viewport.scrollTop).toBe(100);
    f.resize(2000); expect(f.viewport.scrollTop).toBe(200); f.scroller.dispose();
  });
  it("перемонтирование того же текста восстанавливает единственный текущий курсор", () => {
    const a = setup(); a.scroller.update("a", false, 120); a.tick(1000); a.scroller.dispose();
    const b = setup({ cursor: a.cursor }); b.scroller.update("a", true, 120); expect(b.viewport.scrollTop).toBe(20); b.scroller.dispose();
  });
  it("короткий текст не создаёт анимацию и не ставит ложную паузу колесом", () => {
    const f = setup({ height: 150 }); f.scroller.update("a", false, 120); f.scroller.pauseForManualScroll();
    expect(f.frames.size).toBe(0); expect(f.viewport.scrollTop).toBe(0); expect(f.manual).not.toHaveBeenCalled(); f.scroller.dispose();
  });
  it("конец длинного текста останавливает только прокрутку", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(60000);
    expect(f.viewport.scrollTop).toBe(800); expect(f.frames.size).toBe(0);
    expect(f.changed).toHaveBeenLastCalledWith({ overflowing: true, atEnd: true }); expect(f.manual).not.toHaveBeenCalled(); f.scroller.dispose();
  });
  it("перерыв в кадрах скрытой вкладки учитывает прошедшее время без автопаузы", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(10000);
    expect(f.viewport.scrollTop).toBe(200); expect(f.manual).not.toHaveBeenCalled(); f.scroller.dispose();
  });
  it("размонтирование отменяет анимацию", () => {
    const f = setup(); f.scroller.update("a", false, 120); f.tick(1000); f.scroller.dispose(); f.tick(1000);
    expect(f.frames.size).toBe(0); expect(f.viewport.scrollTop).toBe(20);
  });
});
