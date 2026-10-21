import { expect, it } from "vitest";
import { rulerLabel } from "./useRuler";

it("линейка меряет в клетках и в том, что в клетке", () => {
  expect(rulerLabel("square", "1,5 м", 20, 20, { x: 0.5, y: 0.5 }, { x: 3.5, y: 4.5 })).toBe("5 кл. · 7,5 м");
  expect(rulerLabel("square", "2 км", 20, 20, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe("10 кл. · 20 км");
  expect(rulerLabel("square", "у старого моста", 20, 20, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe("1,4 кл.");
});
