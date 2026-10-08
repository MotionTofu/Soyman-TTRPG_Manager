import { describe, expect, it } from "vitest";
import { cutRoad, roadCrossings, type CrossingChoice } from "./crossings";
import type { MapRenderModel, RenderPath } from "./renderModel";

const line = (kind: RenderPath["kind"], style: string, width: number, points: [number, number][], crossings?: CrossingChoice[]): RenderPath =>
  ({ kind, style, width, cells: new Set(), nodes: points.map(([x, y]) => ({ position: { x, y } })), ...(crossings ? { crossings } : {}) });
const model = (...paths: RenderPath[]) => ({ layers: [{ id: "p", name: "p", visible: true, locked: false, opacity: 1, kind: "path", paths }] }) as unknown as MapRenderModel;
// Дорога идёт слева направо по y = 5; мелкая река шириной 2 пересекает её у x = 6, глубокая шириной 4 — у x = 14.
const shallow = line("river", "soyman-village:shallow", 2, [[6, 0], [6, 10]]), deep = line("river", "soyman-village:deep-2", 4, [[14, 0], [14, 10]]);

describe("переправы", () => {
  it("через мелкую воду — брод, через глубокую — мост; настил выходит на берег на полклетки", () => {
    const road = line("road", "soyman-village:road-dirt", 2, [[0, 5], [20, 5]]);
    const found = roadCrossings(model(shallow, deep, road), road);
    expect(found.map(c => [c.kind, c.chosen, Math.round(c.x)])).toEqual([["ford", false, 6], ["bridge-wood", false, 14]]);
    expect(found[0].from).toBeCloseTo(4.5, 1); expect(found[0].to).toBeCloseTo(7.5, 1);
    expect(found[1].from).toBeCloseTo(11.5, 1); expect(found[1].to).toBeCloseTo(16.5, 1);
  });

  it("мощёная дорога строит каменный мост; линия тушью и суша переправ не дают", () => {
    const cobbles = line("road", "soyman-village:road-cobbles", 3, [[0, 5], [20, 5]]), dry = line("road", "soyman-village:road-dirt", 2, [[0, 20], [20, 20]]);
    const ink = { ...cobbles, style: undefined };
    const all = model(deep, cobbles, dry, ink);
    expect(roadCrossings(all, cobbles).map(c => c.kind)).toEqual(["bridge-stone"]);
    expect(roadCrossings(all, dry)).toEqual([]);
    expect(roadCrossings(all, ink)).toEqual([]);
  });

  it("выбор Мастера привязан к месту и переезжает вместе с переправой, а чужой переправы не касается", () => {
    const road = line("road", "soyman-village:road-dirt", 2, [[0, 5], [20, 5]], [{ x: 6.8, y: 5.4, kind: "none" }]);
    expect(roadCrossings(model(shallow, deep, road), road).map(c => [c.kind, c.chosen])).toEqual([["none", true], ["bridge-wood", false]]);
  });

  it("настил вырезает дорогу, «без переправы» — нет", () => {
    const road = line("road", "soyman-village:road-dirt", 2, [[0, 5], [20, 5]], [{ x: 6, y: 5, kind: "none" }]);
    const samples = [{ x: 0, y: 5, width: 2 }, { x: 10, y: 5, width: 2 }, { x: 20, y: 5, width: 2 }];
    const cut = cutRoad(samples, roadCrossings(model(shallow, deep, road), road));
    expect(cut.decks.map(d => d.kind)).toEqual(["bridge-wood"]);
    expect(cut.road.map(piece => [piece[0].x, piece.at(-1)!.x].map(x => Math.round(x * 10) / 10))).toEqual([[0, 11.5], [16.5, 20]]);
    expect(cut.road[0].map(p => p.x)).toContain(10);
  });
});
