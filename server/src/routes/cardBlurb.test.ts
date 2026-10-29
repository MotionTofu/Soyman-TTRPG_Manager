import { describe, expect, it } from "vitest";
import { cardBlurb } from "./canvas";

describe("первая фраза описания для карточки на доске", () => {
  it("снимает разметку и ссылки и берёт первую фразу первого абзаца", () => {
    expect(cardBlurb("**Хозяин** [«Зияющего портала»](soyman:location/abc). Молчит о прошлом.\r\n\r\nВторой абзац."))
      .toBe("Хозяин «Зияющего портала».");
  });

  it("упоминание показывает своей подписью", () => {
    expect(cardBlurb("Сестра [[being@2985cd75|Вотердип|Шани]], совладелица ресторана. Дальше."))
      .toBe("Сестра Шани, совладелица ресторана.");
  });

  it("длинную фразу обрезает до 120 знаков с многоточием", () => {
    const out = cardBlurb("а".repeat(300));
    expect(out).toHaveLength(120);
    expect(out.endsWith("…")).toBe(true);
  });

  it("без описания — пустая строка", () => {
    expect(cardBlurb(null)).toBe("");
    expect(cardBlurb("   ")).toBe("");
  });
});
