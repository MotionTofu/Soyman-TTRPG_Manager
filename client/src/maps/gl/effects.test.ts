import { expect, it } from "vitest";
import { chosenWater, defaultMapEffects } from "./effects";

it("вода шейдером выключена, пока не выбрана; из нескольких видов рисуется нижний в списке", () => {
  const effects = defaultMapEffects();
  expect(chosenWater(effects)).toBeNull();
  effects.water.on = true;
  expect(chosenWater(effects)).toMatchObject({ mode: 0, speed: 1 });
  effects.waterPond.on = true; effects.waterPond.values.size = 12;
  expect(chosenWater(effects)).toEqual({ mode: 1, speed: 1, size: 12 });
  effects.waterSoft.on = true;
  expect(chosenWater(effects)).toMatchObject({ mode: 3 });
});
