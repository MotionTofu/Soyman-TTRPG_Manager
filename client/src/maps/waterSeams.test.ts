import { expect, it } from "vitest";
import { liquidSeams } from "./water";

it("стык жидкостей: расстояние расходится по своей жидкости от полушага, суша стыка не даёт", () => {
  const strip = liquidSeams(Uint8Array.from([0, 0, 0, 2, 2, 2]), [1, 1, 1, 1, 1, 1], 6, 1);
  expect([...strip.gap]).toEqual([2.5, 1.5, 0.5, 0.5, 1.5, 2.5]);
  expect([...strip.other]).toEqual([2, 2, 2, 0, 0, 0]);
  // Вода и лава через полоску суши: у суши номер лавы (заходит на берег), но это не стык.
  const shore = liquidSeams(Uint8Array.from([0, 2, 2, 2]), [1, 0, 1, 1], 4, 1);
  expect(shore.gap[0]).toBe(1e6);
  expect(shore.gap[2]).toBe(1e6);
});
