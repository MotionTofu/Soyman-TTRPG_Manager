import { describe, expect, it } from "vitest";
import { parseEntryFields, parsePassport, serializeEntryFields, serializePassport } from "./settingWorld";

describe("паспорт сеттинга", () => {
  it("берёт только свои ключи, режет пустое и держит не больше пяти признаков", () => {
    const raw = serializePassport({
      promise: "  Город долгов  ",
      tone: "",
      hacker: "x",
      signature: ["a", " ", "b", "c", "d", "e", "f", 7],
    });
    expect(JSON.parse(raw)).toEqual({ promise: "Город долгов", signature: ["a", "b", "c", "d", "e"] });
  });

  it("битая колонка — пустой паспорт, а не исключение", () => {
    expect(parsePassport("{oops")).toEqual({});
    expect(parsePassport(null)).toEqual({});
  });
});

describe("поля записи «Мира»", () => {
  it("строгость — только из пяти значений, «обещано» — только флажок", () => {
    expect(JSON.parse(serializeEntryFields("world_truth", { formula: "Магия по лицензии", strictness: "очень" }))).toEqual({
      formula: "Магия по лицензии",
    });
    expect(JSON.parse(serializeEntryFields("activity", { supports: "Улики", promised: "yes" }))).toEqual({ supports: "Улики" });
    expect(JSON.parse(serializeEntryFields("activity", { promised: "1" }))).toEqual({ promised: "1" });
  });

  it("поля чужого вида и у задумок отбрасываются", () => {
    expect(JSON.parse(serializeEntryFields("norm", { formula: "x", declared: "y" }))).toEqual({ declared: "y" });
    expect(JSON.parse(serializeEntryFields("notes", { declared: "y" }))).toEqual({});
    expect(parseEntryFields("norm", '{"declared":"y","formula":"x"}')).toEqual({ declared: "y" });
  });
});
