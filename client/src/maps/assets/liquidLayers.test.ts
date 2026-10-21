import { expect, it } from "vitest";
import { liquidLayers, liquidRecipe } from "./village";

it("рисунок жидкости слоями: свои слои важнее, прежний одиночный рисунок переводится как выглядел (Q8)", () => {
  expect(liquidLayers({ pattern: "cracks" })).toEqual({ cracks: 1, ripple: 0.4 });
  expect(liquidLayers({ pattern: "smooth" })).toEqual({ ripple: 0.2 });
  expect(liquidLayers({})).toEqual({ ripple: 1 });
  expect(liquidLayers({ pattern: "mist", layers: {} })).toEqual({});
  // Готовые жидкости — по таблице Q7: у лавы корка вместо бликов.
  expect(liquidLayers(liquidRecipe("lava"))).toEqual({ crust: 1, bubbles: 0.2 });
});
