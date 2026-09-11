import { describe, it, expect } from "vitest";
import { collectBackgroundUrls, swapBackgroundUrls } from "./cardSnapshot";

/**
 * Подмена фоновых URL на dataURL перед снимком (кости d20 — это
 * background-image, и без подмены в постер уезжали голые числа).
 * Чистые строковые функции — тестируются без DOM.
 */
describe("collectBackgroundUrls", () => {
  it("вытаскивает ссылочные URL, data пропускает", () => {
    expect(collectBackgroundUrls('url("http://x/textures/dice-d20.png")')).toEqual([
      "http://x/textures/dice-d20.png",
    ]);
    expect(collectBackgroundUrls("url(/textures/dice-d20.png)")).toEqual(["/textures/dice-d20.png"]);
    expect(collectBackgroundUrls("url('a.png'), url(\"b.png\")")).toEqual(["a.png", "b.png"]);
    expect(collectBackgroundUrls('url("data:image/png;base64,AAA")')).toEqual([]);
    expect(collectBackgroundUrls("none")).toEqual([]);
    expect(collectBackgroundUrls("")).toEqual([]);
  });

  it("дубли схлопывает", () => {
    expect(collectBackgroundUrls('url("a.png"), url("a.png")')).toEqual(["a.png"]);
  });
});

describe("swapBackgroundUrls", () => {
  it("меняет только подтянутое, остальное не трогает", () => {
    const computed = 'url("http://x/dice.png"), linear-gradient(red, blue)';
    const next = swapBackgroundUrls(computed, new Map([["http://x/dice.png", "data:image/png;base64,AAA"]]));
    expect(next).toBe('url("data:image/png;base64,AAA"), linear-gradient(red, blue)');
  });

  it("без подтянутого возвращает как было", () => {
    const computed = 'url("http://x/dice.png")';
    expect(swapBackgroundUrls(computed, new Map())).toBe(computed);
  });
});
