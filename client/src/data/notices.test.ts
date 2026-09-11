import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_NOTICES,
  dismissNotice,
  getSaveNotices,
  resetNoticesForTests,
  retryNotice,
  showSaveError,
} from "./notices";

beforeEach(() => resetNoticesForTests());

const messages = () => getSaveNotices().map((n) => n.message);

describe("плашки ошибок сохранения", () => {
  it("одинаковая ошибка не множится, а поднимается наверх со свежим повтором", () => {
    const first = () => "первый";
    const second = () => "второй";
    const a = showSaveError("Сервер не отвечает", first);
    showSaveError("Другая ошибка");
    const b = showSaveError("Сервер не отвечает", second);
    expect(b).toBe(a);
    expect(messages()).toEqual(["Другая ошибка", "Сервер не отвечает"]);
    expect(getSaveNotices()[1].retry).toBe(second);
  });

  it("пустой текст не даёт пустую плашку", () => {
    showSaveError("   ");
    expect(messages()).toEqual(["Неизвестная ошибка"]);
  });

  it("разом видно не больше предела, старые уступают место", () => {
    for (let i = 0; i < MAX_NOTICES + 2; i++) showSaveError(`ошибка ${i}`);
    expect(messages()).toEqual(["ошибка 2", "ошибка 3", "ошибка 4"].slice(-MAX_NOTICES));
    expect(getSaveNotices()).toHaveLength(MAX_NOTICES);
  });

  it("закрытие убирает ровно одну плашку", () => {
    const a = showSaveError("а");
    showSaveError("б");
    dismissNotice(a);
    expect(messages()).toEqual(["б"]);
    dismissNotice(12345);
    expect(messages()).toEqual(["б"]);
  });

  it("«Повторить»: неудача оставляет плашку с новым текстом, успех убирает", async () => {
    let attempts = 0;
    const id = showSaveError("не сохранилось", async () => {
      attempts++;
      if (attempts === 1) throw new Error("опять не вышло");
    });

    await retryNotice(id);
    expect(attempts).toBe(1);
    expect(getSaveNotices()).toEqual([expect.objectContaining({ id, message: "опять не вышло", retrying: false })]);

    await retryNotice(id);
    expect(attempts).toBe(2);
    expect(getSaveNotices()).toEqual([]);
  });

  it("пока идёт повтор, второй щелчок ничего не делает", async () => {
    let release: () => void = () => {};
    let calls = 0;
    const id = showSaveError("медленно", () => {
      calls++;
      return new Promise<void>((r) => (release = r));
    });
    const running = retryNotice(id);
    expect(getSaveNotices()[0].retrying).toBe(true);
    await retryNotice(id);
    expect(calls).toBe(1);
    release();
    await running;
    expect(getSaveNotices()).toEqual([]);
  });

  it("без повтора «Повторить» ничего не делает", async () => {
    const id = showSaveError("без повтора");
    await retryNotice(id);
    expect(messages()).toEqual(["без повтора"]);
  });
});
