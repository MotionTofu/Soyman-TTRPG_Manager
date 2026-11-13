import { describe, expect, it } from "vitest";
import { actionLabel, consequenceActions, consequenceTextActions, limitFor } from "./consequence";

const labels = (effect: string) => consequenceActions(effect).map(actionLabel);

describe("consequenceActions", () => {
  it("статус — герою, «получить» — себе, «всем» — всем", () => {
    expect(labels("*схвачен-1*")).toEqual(["схвачен-1"]);
    expect(labels("получить *замаскирован-2*")).toEqual(["замаскирован-2 себе"]);
    expect(labels("*в-тумане-2* и *напуган-2* всем")).toEqual(["в-тумане-2 всем", "напуган-2 всем"]);
    expect(labels("*в-синяках-1* или *ранен-1*")).toEqual(["в-синяках-1", "ранен-1"]);
  });

  it("снять уровни со своего, вычеркнуть тег", () => {
    expect(labels("снять 2 уровня с *изгнан*, а изгоняющий получает *в-ужасе-3*")).toEqual(["−2 изгнан", "в-ужасе-3"]);
    expect(labels("снять уровень с *сторговался*")).toEqual(["−1 сторговался"]);
    expect(labels("снять два уровня с *убежать*")).toEqual(["−2 убежать"]);
    expect(labels("вычеркнуть тег или дать *загнан-в-угол-2*")).toEqual(["загнан-в-угол-2", "вычеркнуть тег"]);
  });

  it("именованное — строкой в лог, теги — без действий", () => {
    expect(labels("**Разоблачение**")).toEqual(["Обнаружение"]);
    expect(labels("добавить тег *указ*")).toEqual([]);
    expect(consequenceActions(null)).toEqual([]);
  });

  it("все скобки последствия, не только последняя", () => {
    const text = "Костёр слепит (**Заблокировано**), или привлекает гостей (**Новый вызов:** паук).";
    expect(consequenceTextActions(text).map(actionLabel)).toEqual(["Возможность закрыта", "Новый вызов"]);
    expect(consequenceTextActions("(Привал) Мешают спать (*устал-1*).").map(actionLabel)).toEqual(["устал-1"]);
  });

  it("старое и новое название перекрытия пути дают один тип", () => {
    for (const name of ["Заблокировано", "Возможность закрыта"]) {
      expect(consequenceActions(`**${name}**`)).toEqual([{ kind: "named", name: "Возможность закрыта", type: "blocked" }]);
    }
    expect(labels("**«Да, но…»**")).toEqual(["Да, но…"]);
  });
});

describe("limitFor", () => {
  const limits = [
    { name: "Ранить", status: "" },
    { name: "Изгнать", status: "" },
    { name: "Задобрить", status: "ублажён" },
  ];
  it("по корню и по засчитанному статусу", () => {
    expect(limitFor(limits, "ранен")).toBe(0);
    expect(limitFor(limits, "изгнан")).toBe(1);
    expect(limitFor(limits, "Ублажён")).toBe(2);
    expect(limitFor(limits, "в-синяках")).toBeNull();
  });
});
