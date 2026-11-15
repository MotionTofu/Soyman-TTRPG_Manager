import { describe, expect, it } from "vitest";
import type { CompendiumEntry } from "../../types";
import { norm } from "./litmBookText";
import { isCard, isTerm, resolveCoreRuleRef, ruleEntry, rulesOf, searchRules, snippet } from "./litmRules";

const entry = (id: number, kind: string, name: string, parent: number | null, position: number, data: Record<string, unknown> = {}, description = "") =>
  ({ id, kind, name, name_original: name, parent_id: parent, position, data, description }) as unknown as CompendiumEntry;

const sec = (head: string, text: string) => ({ head, headEn: "", page: "A1", text, textEn: "" });

const groups = rulesOf([
  entry(2, "mechanic_group", "Статусы", null, 1),
  entry(1, "mechanic_group", "Вызовы", null, 0),
  entry(20, "mechanic_item", "Бой", 2, 0),
  entry(21, "mechanic_item", "ранен", 20, 0),
  entry(22, "mechanic_item", "Статусы", 2, 1, { page: "A166", steps: ["Прибавьте уровень"], related: [{ name: "Пределы", page: "A169" }], sections: [sec("Статусы", "Статус — *ранен-3*")] }),
  entry(10, "mechanic_item", "Агрессор", 1, 0, { sections: [sec("Что это", "x"), sec("Угрозы", "целится"), sec("Последствия", "ранит")] }),
  entry(11, "mechanic_consequence_item", "Заблокировано", 1, 1, { related: [{ name: "Последствия" }], sections: [sec("Что это", "путь закрыт")] }),
  entry(12, "mechanic_item", "Увядание", 1, 2, { sections: [sec("Увядание", "(с. 75) Дорожка на теме")] }),
]);

describe("Справочник LitM", () => {
  it("keeps book order, splits articles from the status catalogue", () => {
    expect(groups.map((g) => g.entry.name)).toEqual(["Вызовы", "Статусы"]);
    expect(groups[1].articles.map((a) => a.entry.id)).toEqual([22]);
    expect(groups[1].catalog.map((c) => [c.entry.name, c.items.map((s) => s.name)])).toEqual([["Бой", ["ранен"]]]);
    expect(groups[1].articles[0].related).toEqual([{ name: "Пределы", page: "A169" }]);
  });

  it("tells cards and glossary terms from rule articles", () => {
    const [role, cons, term] = groups[0].articles;
    expect([isCard(role), isCard(cons), isCard(term)]).toEqual([true, true, false]);
    expect([isTerm(role), isTerm(term), isTerm(groups[1].articles[0])]).toEqual([false, true, false]);
  });

  it("searches names first, then the full translation", () => {
    const all = groups.flatMap((g) => g.articles);
    expect(searchRules(all, "агрес").map((h) => h.article.entry.id)).toEqual([10]);
    expect(searchRules(all, "дорожка")[0]).toMatchObject({ phrase: "(с. 75) Дорожка на теме", rank: 2 });
    expect(snippet("• Статус *ранен-3* мешает", norm("ранен"))).toBe("Статус ранен-3 мешает");
  });

  it("ведёт к точному подразделу тома I и оставляет неизвестную отсылку текстом", () => {
    const rule = {
      ...entry(42, "mechanic_item", "Как ещё работают статусы", 1, 1, {
        page: "A170",
        sections: [
          { ...sec("Противоположные статусы", "x"), headEn: "Polar Statuses" },
          { ...sec("Побуждающие статусы", "y"), headEn: "Compelling Statuses" },
        ],
      }),
      name_original: "Advanced Use Of Statuses",
    };
    const duplicate = { ...rule, id: 12, data: { page: "B170" } };
    const entries = [duplicate, rule];
    expect(resolveCoreRuleRef(entries, "Полярные статусы", "A170")).toEqual({ entry: rule, anchor: "rule-polar-statuses" });
    expect(resolveCoreRuleRef(entries, "Побуждающие статусы", "A170")).toEqual({ entry: rule, anchor: "rule-compelling-statuses" });
    expect(resolveCoreRuleRef(entries, "Полярные статусы", "A169")).toBeNull();
    expect(resolveCoreRuleRef([duplicate], "Полярные статусы", "A170")).toBeNull();
    const camp = { ...entry(9, "mechanic_item", "Привал и передышка", 1, 2, { page: "A179–A181" }), name_original: "Camping & Sojourns" };
    expect(resolveCoreRuleRef([camp], "Привалы и передышки", "A179")).toEqual({ entry: camp, anchor: undefined });
  });

  it("ищет переименованное Последствие по старой метке и различает правило и словарь по странице", () => {
    const rule = entry(17379, "mechanic_item", "Последствия", 1, 1, { page: "A160–A161" });
    const glossary = entry(17405, "mechanic_item", "Последствия", 1, 2, { page: "A231" });
    expect(ruleEntry([rule, glossary], "Последствия", "A160")).toBe(rule);
    expect(ruleEntry([rule, glossary], "Последствия", "A231")).toBe(glossary);
    const renamed = { ...entry(15017, "mechanic_consequence_item", "Возможность закрыта", 1, 3), aliases: ["Заблокировано"] };
    const [group] = rulesOf([groups[0].entry, renamed]);
    expect(searchRules(group.articles, "заблокировано").map(({ article }) => article.entry.id)).toEqual([15017]);
  });
});
