import { describe, it, expect } from "vitest";
import { averageDamageText, estimateCreatureDpr, extractArmorHp } from "./creatureDpr";

function sb(actions: unknown[], bonusActions: unknown[] = []) {
  return JSON.stringify({ name: "Тест", actions, bonusActions });
}

const atk = (name: string, damage: string, description = "") => ({
  name,
  category: "attack",
  damage,
  description,
});

describe("averageDamageText", () => {
  it("averages russian dice with bonus", () => {
    expect(averageDamageText("2к6+3 рубящий").avg).toBeCloseTo(10);
  });
  it("sums several damage parts", () => {
    expect(averageDamageText("5к6 огнём и 5к6 излучением").avg).toBeCloseTo(35);
  });
  it("handles english d and no bonus", () => {
    expect(averageDamageText("1d8").avg).toBeCloseTo(4.5);
  });
  it("takes max of conditional или-alternatives", () => {
    expect(averageDamageText("4 (2к4 + 2) Режущего урона или 9 (3к4 + 2), если налетела").avg).toBeCloseTo(9.5);
  });
  it("reports unparsed when no dice", () => {
    expect(averageDamageText("особый урон").parsed).toBe(false);
  });
});

describe("extractArmorHp", () => {
  it("reads structured armor and averaged hit dice", () => {
    const r = extractArmorHp(
      JSON.stringify({ armorClass: { value: 15, note: "" }, hitPoints: { diceCount: 6, dieSize: 10, bonus: 18 } })
    );
    // 6 × 5.5 + 18 = 51
    expect(r).toEqual({ ac: "15", hp: "51" });
  });
  it("reads legacy strings", () => {
    const r = extractArmorHp(JSON.stringify({ armorClass: "13", hitPoints: "45 (6к10+18)" }));
    expect(r).toEqual({ ac: "13", hp: "45" });
  });
  it("returns nulls for invalid json", () => {
    expect(extractArmorHp("garbage")).toEqual({ ac: null, hp: null });
  });
});

describe("estimateCreatureDpr", () => {
  it("returns null for invalid json", () => {
    expect(estimateCreatureDpr("not json")).toEqual({ dpr: null, approx: false });
  });
  it("returns null when no attacks", () => {
    expect(estimateCreatureDpr(sb([])).dpr).toBeNull();
  });
  it("takes best single attack", () => {
    const r = estimateCreatureDpr(sb([atk("Укус", "1к8+2"), atk("Когти", "2к6+3 колющий")]));
    expect(r).toEqual({ dpr: 10, approx: false });
  });
  it("resolves multiattack by attack name", () => {
    const r = estimateCreatureDpr(
      sb([
        { name: "Мультиатака", category: "attack", isMultiattack: true, description: "Совершает две атаки когтями." },
        atk("Когти", "1к6+3"),
        atk("Укус", "1к8+2"),
      ])
    );
    // 2 × floor(3.5+3) = 12
    expect(r).toEqual({ dpr: 12, approx: false });
  });
  it("resolves mixed multiattack counts", () => {
    const r = estimateCreatureDpr(
      sb([
        {
          name: "Мультиатака",
          category: "attack",
          isMultiattack: true,
          description: "Совершает три атаки: одну укусом и две когтями.",
        },
        atk("Когти", "1к6+3"),
        atk("Укус", "1к8+2"),
      ])
    );
    // floor(6.5) + 2×floor(6.5) = 18
    expect(r).toEqual({ dpr: 18, approx: false });
  });
  it("falls back to best attack when multiattack is vague", () => {
    const r = estimateCreatureDpr(
      sb([
        { name: "Мультиатака", category: "attack", isMultiattack: true, description: "Атакует врагов." },
        atk("Когти", "1к6+3"),
      ])
    );
    expect(r.dpr).toBe(6);
    expect(r.approx).toBe(true);
  });
  it("adds best bonus action", () => {
    const r = estimateCreatureDpr(sb([atk("Укус", "1к8+2")], [atk("Хвост", "1к6")]));
    // floor(6.5) + floor(3.5) = 9
    expect(r).toEqual({ dpr: 9, approx: false });
  });
});

describe("legacy prose statblocks", () => {
  const legacy = (name: string, description: string) => ({ name, description });
  it("parses Попадание with several damage parts", () => {
    const r = estimateCreatureDpr(
      sb([legacy("Укус", "Бросок рукопашной атаки: +4 к попаданию, досягаемость 5 фт. Попадание: 4 (1к4 + 2) колющего урона и 3 (1к6) урона ядом.")])
    );
    // (2.5+2) + 3.5 = 8
    expect(r).toEqual({ dpr: 8, approx: false });
  });
  it("ignores range numbers, resolves instrumental-case multiattack", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Младший босс совершает три атаки Отравленным клинком или Магическим огнестрелом в любой комбинации."),
        legacy("Отравленный клинок", "Бросок рукопашной атаки: +7, досягаемость 5 футов. Попадание: 13 (2к8 + 4) Рубящего урона плюс 7 (2к6) урона Ядом."),
        legacy("Магический огнестрел", "Бросок дальнобойной атаки: +7, дистанция 30/90 футов. Попадание: 26 (4к10 + 4) урона Чистой силой."),
      ])
    );
    // 3 × max(20, 26) = 78, комбинация — приблизительно
    expect(r).toEqual({ dpr: 78, approx: true });
  });
  it("counts multiattack over a single named attack", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Здоровяк совершает три атаки Тумаком."),
        legacy("Тумак", "Бросок рукопашной атаки: +9, досягаемость 5 футов. Попадание: 12 (2к6 + 5) Дробящего урона."),
      ])
    );
    expect(r).toEqual({ dpr: 36, approx: false });
  });
  it("accepts category other from legacy migration", () => {
    const r = estimateCreatureDpr(
      sb([
        { name: "Лапы", category: "other", description: "Бросок атаки в ближнем бою: +4. Попадание: 4 (2к4 + 2) Режущего урона или 9 (3к4 + 2), если налетела." },
      ])
    );
    expect(r).toEqual({ dpr: 9, approx: false });
  });
  it("treats save rows as attacks", () => {
    const r = estimateCreatureDpr(
      sb([legacy("Огненное дыхание", "Спасбросок Ловкости: Сл 14. Провал: 21 (6к6) урона огнём.")])
    );
    expect(r).toEqual({ dpr: 21, approx: false });
  });
  it("takes max when swap is optional (может заменить)", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Совершает три атаки Вспышкой. Может заменить одну из этих атак на атаку Когтем."),
        legacy("Вспышка", "Бросок атаки: +9. Попадание: 31 (4к12 + 5) урона."),
        legacy("Коготь", "Бросок атаки: +9. Попадание: 10 (2к4 + 5) урона плюс 19 (3к12) урона."),
      ])
    );
    // max(2×31 + 29.5, 3×31) = 93, приблизительно
    expect(r).toEqual({ dpr: 93, approx: true });
  });
  it("returns null for multiattack with no attack rows (broken import)", () => {
    const r = estimateCreatureDpr(
      sb([{ name: "Мультиатака", description: "Совершает три атаки Вспышкой силы." }])
    );
    expect(r).toEqual({ dpr: null, approx: false });
  });
  it("adds и-использует action on top (succubus-like)", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Совершает одну атаку Касанием и использует Обворожение или Поцелуй."),
        legacy("Касание", "Бросок рукопашной атаки: +7. Попадание: 16 (2к10 + 5) урона."),
        legacy("Обворожение", "Сотворяет заклинание Подчинение личности."),
        legacy("Поцелуй", "Испытание Выносливости: СЛ 15. Провал: 13 (3к8) урона."),
      ])
    );
    // 16 + 13 = 29, приблизительно
    expect(r).toEqual({ dpr: 29, approx: true });
  });
  it("caps pairs at total count (optional swap is not extra)", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Совершает две атаки Пилумом или Бивнями в любой комбинации. Он может заменить одну из этих атак на атаку Клыками."),
        legacy("Пилум", "Бросок атаки: +5. Попадание: 13 (3к6 + 3) урона."),
        legacy("Бивни", "Бросок атаки: +5. Попадание: 10 (2к6 + 3) урона."),
        legacy("Клыки", "Бросок атаки: +5. Попадание: 12 (2к8 + 3) урона."),
      ])
    );
    // 2 × 13 = 26, приблизительно
    expect(r).toEqual({ dpr: 26, approx: true });
  });
  it("spreads recharge damage over 3 rounds", () => {
    const r = estimateCreatureDpr(
      sb(
        [legacy("Укус", "Бросок атаки: +4. Попадание: 6 (1к8 + 2) урона.")],
        [legacy("Кошмар (Перезарядка 6)", "Испытание Мудрости: СЛ 15. Провал: 18 (4к8) урона.")]
      )
    );
    // 6 + 18/3 = 12, приблизительно
    expect(r).toEqual({ dpr: 12, approx: true });
  });
  it("divides only the recharge tail, base hits every round", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy(
          "Удар",
          "Бросок атаки: +6. Попадание: 20 (5к6 + 3) урона Ядом. Голод (перезарядка 5-6). Провал: 28 (8к6) урона."
        ),
      ])
    );
    // floor(20 + 28/3) = 29, приблизительно
    expect(r).toEqual({ dpr: 29, approx: true });
  });
  it("multiplies only the base of a merged row, tail counts once", () => {    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Дракон совершает три атаки Раздиранием."),
        legacy(
          "Раздирание",
          "Бросок атаки: +15. Попадание: 17 (2к8 + 8) урона плюс 10 (3к6) урона. Ядовитое дыхание (перезарядка 5-6). Провал: 77 (22к6) урона."
        ),
      ])
    );
    // 3 × 27 + floor(77/3) = 106, приблизительно
    expect(r).toEqual({ dpr: 106, approx: true });
  });
  it("does not read Зомби использует as и использует", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Зомби использует Лучи дважды."),
        legacy("Лучи", "Бросок атаки: +5. Попадание: 10 (2к6 + 3) урона."),
      ])
    );
    expect(r).toEqual({ dpr: 20, approx: false });
  });
  it("averages random table instead of summing all options", () => {    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Зомби использует Лучи дважды."),
        legacy(
          "Лучи",
          "Зомби пускает луч, выбранный случайным образом (бросьте 1к4). 1. Луч паралича. Испытание Выносливости: СЛ 14. Провал: цель Парализована. 2. Луч ужаса. Испытание Мудрости: СЛ 14. Провал: 13 (3к8) урона. 3. Луч бессилия. Испытание Выносливости: СЛ 14. Провал: 10 (3к6) урона. 4. Луч дезинтеграции. Испытание Ловкости: СЛ 14. Провал: 27 (5к10) урона."
        ),
      ])
    );
    // floor((2.5 + 13.5 + 10.5 + 27.5) / 4) = 13 за луч, дважды → 26
    expect(r).toEqual({ dpr: 26, approx: true });
  });
  it("ignores digits in spell level refs, even with non-ascii hyphen", () => {
    const r = estimateCreatureDpr(
      sb([
        legacy("Мультиатака", "Совершает три атаки Когтями. Может заменить одну на Укол разума (5‑й круг)."),
        legacy("Когти", "Бросок атаки: +9. Попадание: 20 (3к8 + 7) урона."),
      ])
    );
    expect(r).toEqual({ dpr: 60, approx: false });
  });
});
