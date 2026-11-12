// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { giveBackpackTag } from "./litmSheetWrite";

describe("«Награды»: вещь — сюжетный тег в рюкзак (Q16)", () => {
  it("дописывает тег, повтор не дублирует", () => {
    expect(giveBackpackTag("удобный гамак")({ backpack: ["верёвка"] })).toEqual({ backpack: ["верёвка", "удобный гамак"] });
    expect(giveBackpackTag("верёвка")({ backpack: ["верёвка"] })).toBeNull();
  });
});
