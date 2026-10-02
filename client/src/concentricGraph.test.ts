import { describe, expect, it } from "vitest";
import { concentricLayout } from "./concentricGraph";
import type { GraphNode } from "./graphTypes";

const node = (id: number, type = "being", title = `Существо ${id}`): GraphNode => ({ key: `${type}:${id}`, type, id, title });

describe("кольца графа миров", () => {
  it("держит виды на отдельных соседних кольцах и сортирует по русскому алфавиту с учётом чисел", () => {
    const nodes = [node(1, "location", "Место"), node(10), node(2), node(3, "being", "Альфа"), node(4, "character", "Герой")];
    const layout = concentricLayout(nodes);
    expect(layout.rings.map(r => r.type)).toEqual(["character", "being", "location"]);
    expect(layout.rings[1].keys).toEqual(["being:3", "being:2", "being:10"]);
    for (const ring of layout.rings) {
      for (const key of ring.keys) {
        const p = layout.positions.get(key)!;
        expect(Math.hypot(p.x - layout.centerX, p.y - layout.centerY)).toBeCloseTo(ring.radius);
      }
    }
  });

  it("не зависит от порядка ответа сервера, в том числе при одинаковых названиях и неизвестном виде", () => {
    const nodes = [node(2, "being", "Дубликат"), node(1, "being", "Дубликат"), node(4, "other", "Новое"), node(3, "location")];
    const first = concentricLayout(nodes), second = concentricLayout([...nodes].reverse());
    expect(second).toEqual(first);
    expect(nodes[0].id).toBe(2);
  });

  it("делит многочисленный вид на соседние кольца, оставляет карточки внутри холста и не допускает наложений", () => {
    const nodes = Array.from({ length: 350 }, (_, i) => node(i, i < 300 ? "being" : "location", i % 9 ? `Название ${i}` : `Длинное название сущности для проверки ${i}`));
    const scales = new Map(nodes.map((n, i) => [n.key, i % 13 === 0 ? 3 : 1]));
    const layout = concentricLayout(nodes, scales);
    expect(layout.positions.size).toBe(nodes.length);
    const types = layout.rings.map(r => r.type);
    const firstLocation = types.indexOf("location");
    expect(firstLocation).toBeGreaterThan(1);
    expect(types.slice(0, firstLocation).every(t => t === "being")).toBe(true);
    expect(types.slice(firstLocation).every(t => t === "location")).toBe(true);
    // Проверяем прямоугольники карточек; длинный текст рендерер
    // сокращает до их ширины, сохраняя полное имя в подсказке.
    const boxes = nodes.map(n => {
      const s = scales.get(n.key)!;
      const p = layout.positions.get(n.key)!;
      const chipW = Math.max(48, (Math.min(n.title.length * 6.6, 180) + 10 * s + 16) * s);
      const left = p.x - chipW / 2, right = p.x + chipW / 2;
      const top = p.y - 11 * s, bottom = p.y + 11 * s;
      expect(left).toBeGreaterThan(0); expect(right).toBeLessThan(layout.width);
      expect(top).toBeGreaterThan(0); expect(bottom).toBeLessThan(layout.height);
      return { left, right, top, bottom };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
  });

  it("учитывает счётчик свёрнутой группы и сохраняет порядок при скрытии других видов", () => {
    const nodes = [node(1, "being"), node(2, "location"), node(3, "artifact")];
    const normal = concentricLayout(nodes), folded = concentricLayout(nodes, new Map(), new Map([["being:1", 12345]]));
    expect(folded.rings[0].radius).toBeGreaterThan(normal.rings[0].radius);
    expect(concentricLayout(nodes.slice(1)).rings.map(r => r.type)).toEqual(["location", "artifact"]);
  });

  it("обрабатывает пустой срез и единственную сущность без бесконечных координат", () => {
    const empty = concentricLayout([]);
    expect(empty.positions.size).toBe(0); expect(empty.rings).toEqual([]);
    const single = concentricLayout([node(1)]);
    expect([...single.positions.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(single.rings).toHaveLength(1);
  });
});
