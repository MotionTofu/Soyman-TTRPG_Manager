import { describe, expect, it } from "vitest";
import { createDeterministicIdFactory, createUuidIdFactory } from "./idFactory";

describe("idFactory", () => {
  it("deterministic: предсказуемая последовательность", () => {
    const f = createDeterministicIdFactory("t");
    expect([f(), f(), f()]).toEqual(["t-1", "t-2", "t-3"]);
  });

  it("uuid: формат UUID", () => {
    const f = createUuidIdFactory();
    expect(f()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
