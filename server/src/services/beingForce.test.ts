import { describe, expect, it } from "vitest";
import { parseForce, parseParticipation, serializeForce, serializeParticipation } from "./beingForce";

describe("двигатель силы", () => {
  it("держит только словарные ключи и непустые строки", () => {
    const stored = serializeForce({ want: " единорога ", fear: "", hacked: "x", can: 5 });
    expect(JSON.parse(stored)).toEqual({ want: "единорога" });
    expect(parseForce(stored)).toEqual({ want: "единорога" });
  });

  it("битая колонка — пустой двигатель, а не падение", () => {
    expect(parseForce("{не json")).toEqual({});
    expect(parseForce(null)).toEqual({});
    expect(parseForce("[1,2]")).toEqual({});
  });

  it("участие — свой словарь", () => {
    expect(parseParticipation(serializeParticipation({ goal: "нанять", want: "нет" }))).toEqual({ goal: "нанять" });
  });
});
