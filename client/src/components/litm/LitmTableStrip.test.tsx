// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LitmTrip } from "./LitmTableStrip";

describe("стол игрока LitM: путешествие и привал (пульт v2, Q15)", () => {
  it("шаг путешествия, угроза виньетки и шаг привала", () => {
    const html = renderToStaticMarkup(
      <LitmTrip
        journey={{ name: "Тёмный лес", kind: "Местность", steps: 4, gap: "часы", passed: 1, now: { name: "Замёрзший ручей", threat: "*скользкий лёд*" } }}
        camp={{ step: 3, sojourn: false }}
      />
    );
    expect(html).toContain("Шаг 2 из 4 · между шагами — часы");
    expect(html).toContain("Замёрзший ручей");
    expect(html).toContain("скользкий лёд");
    expect(html).toContain("Первая стража");
    expect(html).toContain("Шаг 3 из 7");
  });

  it("после последнего шага — «Прибыли»", () => {
    expect(renderToStaticMarkup(<LitmTrip journey={{ name: "Тёмный лес", kind: "", steps: 2, gap: "", passed: 2, now: null }} camp={null} />)).toContain("Прибыли");
  });
});
