import { describe, expect, it } from "vitest";
import { recognizeCreatureAction, recognizeRepeat, recognizeSave } from "./inflicts";

const KNOWN = [
  { id: 1, name: "Парализованный" },
  { id: 2, name: "Схваченный" },
  { id: 3, name: "Опутанный" },
  { id: 4, name: "Оглохший" },
  { id: 5, name: "Окаменевший" },
  { id: 6, name: "Ослеплённый" },
];
const names = (r: ReturnType<typeof recognizeCreatureAction>) =>
  r && !("review" in r) ? r.conditions.value.map((c) => c.name) : r;

describe("повтор спасброска в заклинаниях", () => {
  it("конец хода, начало хода, урон — и оба сразу", () => {
    expect(recognizeRepeat("В конце каждого своего хода цель повторяет спасбросок, при успехе заклинание прекращается.")).toMatchObject({ value: ["turn_end"] });
    expect(recognizeRepeat("В начале каждого своего хода до окончания действия заклинания цель получает 1к6 урона огнём и затем совершает спасбросок Телосложения.")).toMatchObject({ value: ["turn_start"], ability: "con" });
    expect(recognizeRepeat("Когда цель получает урон, то повторяет спасбросок, заканчивая эффект заклинания на себе при успехе.")).toMatchObject({ value: ["on_damage"] });
    expect(recognizeRepeat("В конце каждого своего хода и каждый раз, когда оно получает урон, цель совершает новый спасбросок Мудрости.")).toMatchObject({ value: ["turn_end", "on_damage"], ability: "wis" });
  });

  it("первый спасбросок — не повтор; странный повтор — на разбор", () => {
    expect(recognizeRepeat("Существо должно успешно совершить спасбросок Мудрости в начале своего хода.")).toBeNull();
    expect(recognizeRepeat("После того как существо переместится таким образом, оно повторяет спасбросок.")).toMatchObject({ review: expect.any(String) });
  });
});

describe("что накладывает действие чудовища", () => {
  it("когти упыря: паралич на минуту с повтором и СЛ из текста", () => {
    const text =
      "Если цель – существо и не является эльфом или нежитью, она должна преуспеть в спасброске Телосложения Сл 10, иначе станет парализованной на 1 минуту. Цель может повторить спасбросок в конце каждого своего хода, оканчивая эффект на себе при успехе.";
    expect(recognizeCreatureAction({ name: "Когти", description: text }, KNOWN)).toMatchObject({
      conditions: { value: [{ name: "Парализованный" }] },
      duration: { value: { rounds: 10 } },
      repeat: { value: ["turn_end"] },
    });
    expect(recognizeSave(text)?.value).toEqual({ ability: "con", dc: 10 });
  });

  it("слова «Монстрономикона» и чужой ход", () => {
    const r = recognizeCreatureAction({ name: "Какофония", description: "Провал: цель Оглушена до начала следующего хода стаи." }, KNOWN);
    expect(r).toMatchObject({ conditions: { value: [{ name: "Оглохший" }] }, duration: { value: { rounds: 1 } } });
    const m = recognizeCreatureAction({ name: "Пепельное дыхание", description: "Провал: цель Ослеплена до конца следующего хода мефита." }, KNOWN);
    expect(m).toMatchObject({ duration: { value: { until: "caster_turn_end" } } });
    expect(recognizeSave("Испытание Выносливости: СЛ 15, одно существо.")?.value).toEqual({ ability: "con", dc: 15 });
  });

  it("состояние как признак цели, мультиатака и снятое — не наложение", () => {
    expect(recognizeCreatureAction({ name: "Кулак", description: "Испытание Ловкости: СЛ 17, одно Захваченное глабрезу существо." }, KNOWN)).toBeNull();
    expect(recognizeCreatureAction({ name: "Мультиатака", description: "Грелл совершает одну атаку Парализующими щупальцами." }, KNOWN)).toBeNull();
    expect(
      names(recognizeCreatureAction({ name: "Укус", description: "Второй провал: цель перестаёт быть Обездвиженной и становится Окаменевшей." }, KNOWN))
    ).toEqual(["Окаменевший"]);
  });
});
