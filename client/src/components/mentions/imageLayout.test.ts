import { describe, expect, it } from "vitest";
import { formatImageAlt, parseImageLayout } from "./imageLayout";

describe("imageLayout", () => {
  it("разбирает сторону и ширину из подписи", () => {
    expect(parseImageLayout("Ирма у огня|справа|40")).toEqual({ alt: "Ирма у огня", side: "right", width: 40 });
    expect(parseImageLayout("Карта|по центру")).toEqual({ alt: "Карта", side: "center", width: null });
    expect(parseImageLayout("Схема|60%")).toEqual({ alt: "Схема", side: null, width: 60 });
  });

  it("обычную подпись с «|» не трогает", () => {
    expect(parseImageLayout("A | B")).toEqual({ alt: "A | B", side: null, width: null });
    expect(parseImageLayout("Портрет|250")).toEqual({ alt: "Портрет|250", side: null, width: null });
  });

  it("собирает подпись обратно", () => {
    expect(formatImageAlt({ alt: "Ирма", side: "left", width: 25 })).toBe("Ирма|слева|25");
    expect(formatImageAlt({ alt: "Ирма", side: null, width: null })).toBe("Ирма");
  });
});
