import { describe, expect, it } from "vitest";
import { blendSeam } from "./seamless";

describe("подмес шва образца", () => {
  it("правый и нижний край растворяются в начале: повтор продолжает рисунок без скачка", () => {
    // Градиент 8×8: яркость растёт по x и по y. Без подмеса на стыке повтора скачок с 140 до 0.
    const side = 8, data = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) data.set([x * 10 + y * 10, 0, 0, 255], (y * side + x) * 4);
    const out = blendSeam(data, side, 2);
    expect(out.side).toBe(6);
    const red = (x: number, y: number) => out.data[(y * 6 + x) * 4];
    // Строка без подмеса по y: начало берёт значение «за краем» (60) и за две точки возвращается к своему.
    expect([0, 1, 2, 3, 4, 5].map((x) => red(x, 3))).toEqual([90, 70, 50, 60, 70, 80]);
    // Стык повтора: последняя точка 80, первая следующего повтора 90 — тот же шаг, что внутри.
    expect(red(0, 3) - red(5, 3)).toBe(10);
    expect(red(3, 0) - red(3, 5)).toBe(10);
    expect(out.data[3]).toBe(255);
  });
  it("нулевой и чрезмерный подмес оставляют образец как есть", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    expect(blendSeam(data, 4, 0)).toEqual({ data, side: 4 });
    expect(blendSeam(data, 4, 2)).toEqual({ data, side: 4 });
  });
});
