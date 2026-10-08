import { expect, it } from "vitest";
import { chosenWater, defaultMapEffects } from "./effects";

it("вода шейдером выключена, пока не выбрана; из двух видов рисуется пиксельная", () => {
  const effects = defaultMapEffects();
  expect(chosenWater(effects)).toBeNull();
  effects.water.on = true;
  expect(chosenWater(effects)).toMatchObject({ mode: 0, speed: 1 });
  effects.waterPixel.on = true; effects.waterPixel.values.size = 12;
  expect(chosenWater(effects)).toEqual({ mode: 1, speed: 1, size: 12 });
});
