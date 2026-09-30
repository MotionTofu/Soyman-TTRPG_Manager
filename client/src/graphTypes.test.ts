import { describe, it, expect } from "vitest";
import { TYPE_LABELS, TYPE_COLORS, TYPE_SHAPES, TYPE_ROUTES, EDGE_KINDS, EDGE_KIND_STYLE, foldAdventures, adventureOwners, layeredLayout, clampToBand, type GraphNode, type GraphEdge } from "./graphTypes";

/**
 * Первый тест клиента. Раньше `vitest` в `client/` был установлен, но не имел
 * ни одного файла — то есть `npm test` здесь падал с кодом 1, а не проверял
 * что-либо.
 *
 * Проверяется ровно та болезнь, ради которой затевался реестр видов на
 * сервере, только на клиентской стороне: **четыре параллельные карты, набранные
 * по одним и тем же тринадцати ключам.** Подпись, цвет, форма и маршрут узла
 * лежат в четырёх отдельных объектах, и ничто не мешает добавить вид в один и
 * забыть про три остальных. Тогда узел на графе выйдет без подписи, серым, без
 * формы или без перехода по щелчку — а увидит это Мастер, открывший граф во
 * время игры.
 */
describe("карты видов узлов графа набраны по одним ключам", () => {
  const maps = {
    TYPE_LABELS,
    TYPE_COLORS,
    TYPE_SHAPES,
    TYPE_ROUTES,
  };

  it("ключей вообще четырнадцать — проверка умеет падать", () => {
    expect(Object.keys(TYPE_LABELS).length).toBe(14);
  });

  it("все четыре карты знают один и тот же набор видов", () => {
    const reference = Object.keys(TYPE_LABELS).sort();
    for (const [name, map] of Object.entries(maps)) {
      expect(Object.keys(map).sort(), `${name} разошлась с TYPE_LABELS`).toEqual(reference);
    }
  });

  it("ни одно значение не пустое", () => {
    for (const [name, map] of Object.entries(maps)) {
      for (const [key, value] of Object.entries(map)) {
        expect(String(value).trim(), `${name}.${key} пустое`).not.toBe("");
      }
    }
  });

  it("маршрут вида начинается со слэша", () => {
    // Маршрут подставляется в переход по щелчку по узлу; относительный путь
    // уехал бы от текущего адреса, а не в раздел.
    for (const [key, route] of Object.entries(TYPE_ROUTES)) {
      expect(route.startsWith("/"), `${key}: ${route}`).toBe(true);
    }
  });

  it("цвета не повторяются", () => {
    // Палитра выбрана различимой при дальтонизме (комментарий в graphTypes.ts).
    // Два вида одного цвета обесценивают эту работу молча.
    const colors = Object.values(TYPE_COLORS).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("виды связей графа", () => {
  it("ключ вида связи уникален", () => {
    const keys = EDGE_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("стиль есть у каждого вида связи", () => {
    for (const k of EDGE_KINDS) {
      expect(EDGE_KIND_STYLE[k.key], `нет стиля для ${k.key}`).toBeDefined();
    }
  });

  it("упоминания выключены по умолчанию", () => {
    // Их больше всех, и включёнными они хоронят под собой отношения — так
    // записано в самом файле. Тест держит это решение.
    expect(EDGE_KINDS.find((k) => k.key === "mention")?.defaultOn).toBe(false);
  });
});

describe("сворачивание сцен и глав в приключение", () => {
  const node = (key: string): GraphNode => ({ key, type: key.split(":")[0], id: Number(key.split(":")[1]), title: key });
  const edge = (from: string, to: string, section: string): GraphEdge => ({ from, to, section, tone: null, kind: "scene" });
  const nodes = ["adventure:1", "adventure:2", "scene:10", "session:5", "being:7"].map(node);
  const edges = [
    edge("adventure:2", "adventure:1", "глава приключения"),
    edge("scene:10", "adventure:2", "сцена приключения"),
    edge("session:5", "scene:10", "набрано"),
    edge("session:5", "scene:10", "сыграно"),
    edge("scene:10", "being:7", "scene_obstacles"),
  ];

  it("«Показать в графе»: сцена раскрывает главу и приключение над ней", () => {
    const chain = adventureOwners(edges, "scene:10");
    expect(chain).toEqual(["adventure:2", "adventure:1"]);
    expect(foldAdventures(nodes, edges, new Set(chain)).nodes.map((n) => n.key)).toContain("scene:10");
  });

  it("всё свёрнуто в верхнее приключение, набрано уступает сыгранному", () => {
    const g = foldAdventures(nodes, edges, new Set());
    expect(g.nodes.map((n) => n.key).sort()).toEqual(["adventure:1", "being:7", "session:5"]);
    expect(g.folded.get("adventure:1")).toBe(2);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.section}`).sort()).toEqual([
      "adventure:1>being:7:scene_obstacles",
      "session:5>adventure:1:сыграно",
    ]);
  });

  it("раскрытое приключение показывает главу, сцена свёрнута в главу", () => {
    const g = foldAdventures(nodes, edges, new Set(["adventure:1"]));
    expect(g.nodes.map((n) => n.key)).toContain("adventure:2");
    expect(g.folded.get("adventure:2")).toBe(1);
  });
});

describe("ярусная раскладка графа приключений", () => {
  const n = (key: string, extra: Partial<GraphNode> = {}): GraphNode => ({ key, type: key.split(":")[0], id: Number(key.split(":")[1]), title: key, ...extra });
  const e = (from: string, to: string, section: string): GraphEdge => ({ from, to, section, tone: null, kind: "scene" });
  const nodes = [
    n("session:2", { date: "2026-02-01", campaign_id: 1 }),
    n("session:1", { date: "2026-01-01", campaign_id: 1 }),
    n("adventure:1", { position: 0 }),
    n("adventure:2", { position: 1 }),
    n("adventure:3", { position: 2 }),
    n("being:1"),
  ];
  const edges = [e("session:2", "adventure:1", "сыграно"), e("session:1", "adventure:3", "сыграно"), e("adventure:1", "being:1", "scene_npcs")];
  const L = layeredLayout(nodes, edges, new Map());
  const p = (k: string) => L.positions.get(k)!;

  it("сессии по дате слева направо, над сюжетом; мир под сюжетом", () => {
    expect(p("session:1").x).toBeLessThan(p("session:2").x);
    expect(p("session:1").y).toBeLessThan(p("adventure:1").y);
    expect(p("adventure:1").y).toBeLessThan(p("being:1").y);
  });

  it("приключения по первой сыгравшей сессии, несыгранные в конце", () => {
    expect(p("adventure:3").x).toBeLessThan(p("adventure:1").x);
    expect(p("adventure:1").x).toBeLessThan(p("adventure:2").x);
  });

  it("узел ходит только в своей полосе, лента сессий не двигается", () => {
    const [, story, world] = L.bands;
    expect(clampToBand(L.bands, "session", 60, 500)).toBe(60);
    expect(clampToBand(L.bands, "being", 0, -1000)).toBeGreaterThan(world.top);
    expect(clampToBand(L.bands, "adventure", 0, 1e6)).toBeLessThan(story.bottom);
  });

  it("открывается на последней проведённой сессии", () => {
    expect(L.anchorX).toBe(p("session:2").x);
  });
});
