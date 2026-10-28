// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AudioAuthority } from "./audioOwnership";
const owner = { runId: "run-05", controllerId: "gm-05" };
describe("владение звуковыми каналами", () => {
  it("music блокирует только музыку, all — все четыре канала", () => {
    const gate = new AudioAuthority(); gate.claim(owner, "music");
    expect(gate.allows("background")).toBe(false);
    expect(gate.allows("ambient")).toBe(true); expect(gate.allows("weather")).toBe(true); expect(gate.allows("stinger")).toBe(true);
    gate.release(owner); gate.claim(owner, "all");
    for (const channel of ["background", "ambient", "weather", "stinger"] as const) expect(gate.allows(channel)).toBe(false);
  });
  it("разрешение владельца действует только на синхронное применение", () => {
    const gate = new AudioAuthority(); gate.claim(owner, "all");
    expect(gate.withOwner(owner, () => gate.allows("background"))).toBe(true);
    expect(gate.allows("background")).toBe(false);
    expect(() => gate.withOwner({ ...owner, controllerId: "other" }, () => {})).toThrow();
  });
  it("чужой запуск не освобождает и не перехватывает управление", () => {
    const gate = new AudioAuthority(); gate.claim(owner, "all");
    const other = { runId: "other", controllerId: "other" };
    expect(() => gate.claim(other, "music")).toThrow(); expect(() => gate.release(other)).toThrow();
    expect(gate.getSnapshot()?.owner).toEqual(owner);
  });
  it("изменение/передача владельца инвалидирует только затронутые каналы", () => {
    const gate = new AudioAuthority(), ambient = gate.epoch("ambient"), background = gate.epoch("background");
    gate.claim(owner, "music"); expect(gate.epoch("ambient")).toBe(ambient); expect(gate.epoch("background")).toBeGreaterThan(background);
    const next = { ...owner, controllerId: "next" }; gate.transfer(owner, next);
    expect(() => gate.release(owner)).toThrow(); gate.release(next); expect(gate.allows("background")).toBe(true);
  });
  it("принятый снимок другого окна закрывает общую точку применения", () => {
    const gate = new AudioAuthority(); gate.receive({ owner, scope: "all" });
    expect(gate.allows("weather")).toBe(false); gate.receive(null); expect(gate.allows("weather")).toBe(true);
  });
});
