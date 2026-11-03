import { describe, expect, it } from "vitest";
import { canvasEntity, canvasMoveCount, canvasRouteAt, canvasRouteForEdge } from "./canvasRoutes";

describe("маршрут, брошенный на связь", () => {
  it("сохраняет вид и роль связи и оставляет улики и нити без разрыва", () => {
    expect(canvasRouteForEdge("cast", "being:7", "scene:2", "plot_characters"))
      .toEqual({ from_key: "being:7", to_key: "scene:2", kind: "cast", role: "plot_characters" });
    expect(canvasRouteForEdge("story", "adventure:1", "adventure:2")?.kind).toBe("arc-transition");
    expect(canvasRouteForEdge("story", "scene:1", "scene:2")?.kind).toBe("transition");
    expect(canvasRouteForEdge("clue", "scene:1", "scene:2")).toBeNull();
    expect(canvasRouteForEdge("thread", "pin:1", "pin:2")).toBeNull();
  });
  it("находит связь вдали от середины и не подключает слишком далёкий маршрут", () => {
    const route = canvasRouteForEdge("story", "scene:1", "scene:2");
    const edges = [{ source: "scene:1", target: "scene:2", data: { canvasRoute: route } }];
    const boxes = new Map([
      ["scene:1", { x: 100, y: 200, w: 220, h: 100 }],
      ["scene:2", { x: 1000, y: 200, w: 220, h: 100 }],
    ]);
    expect(canvasRouteAt({ x: 400, y: 260 }, edges, boxes, 50)).toEqual(route);
    expect(canvasRouteAt({ x: 400, y: 400 }, edges, boxes, 50)).toBeNull();
    expect(canvasRouteAt({ x: 400, y: 260 }, [{ ...edges[0], data: {} }], boxes, 50)).toBeNull();
  });
});
describe("меню сущности на холсте", () => {
  it("различает настоящие сущности и местные объекты доски", () => {
    expect(canvasEntity("being:7", "Мирт")).toEqual({ type: "being", id: 7, name: "Мирт" });
    expect(canvasEntity("chapter:2", "Глава")).toEqual({ type: "adventure", id: 2, name: "Глава" });
    expect(canvasEntity("pin:1", "Улика")).toBeNull();
    expect(canvasEntity("sticker:1", "Записка")).toBeNull();
    expect(canvasEntity("being:0", "Пусто")).toBeNull();
  });
});

it("считает переходы истории, а не их участки и рёбра состава", () => {
  expect(canvasMoveCount([
    { id: "transition:1::r0", kind: "transition" },
    { id: "transition:1::r1", kind: "transition" },
    { id: "transition:2", kind: "transition" },
    { id: "outcome:3::r0", kind: "outcome" },
    { id: "outcome:3::r1", kind: "outcome" },
    { id: "cast:4", kind: "cast" },
    { id: "thread:5", kind: "thread" },
  ])).toBe(3);
});
