import { describe, it, expect } from "vitest";
import { TYPE_LABELS, TYPE_COLORS, TYPE_SHAPES, TYPE_ROUTES, EDGE_KINDS, EDGE_KIND_STYLE } from "./graphTypes";

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

  it("ключей вообще тринадцать — проверка умеет падать", () => {
    expect(Object.keys(TYPE_LABELS).length).toBe(13);
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
