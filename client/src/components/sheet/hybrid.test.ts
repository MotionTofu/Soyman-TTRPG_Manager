// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { hybridUnits } from "./hybrid";

const units = (src: string) => hybridUnits(Text.of(src.split("\n"))).map(u => u.text);

describe("hybridUnits", () => {
  it("строка — кусок, пустые строки пропускаются", () => {
    expect(units("# Глава\n\nАбзац\n- пункт")).toEqual(["# Глава", "Абзац", "- пункт"]);
  });

  it("таблица, блок кода и {quote} раскрываются целиком", () => {
    expect(units("| a | b |\n|---|---|\n| 1 | 2 |\nпосле")).toEqual(["| a | b |\n|---|---|\n| 1 | 2 |", "после"]);
    expect(units("```\nx\n\ny\n```\nпосле")).toEqual(["```\nx\n\ny\n```", "после"]);
    expect(units("{quote}раз\nдва{/quote}\nпосле")).toEqual(["{quote}раз\nдва{/quote}", "после"]);
  });

  it("незакрытый блок доходит до конца текста", () => {
    expect(units("```\nx\ny")).toEqual(["```\nx\ny"]);
  });
});
