import { describe, expect, it } from "vitest";
import { createCutsceneAudioCommand } from "@shared/cutscenes/defaults";
import { fragmentGain, fragmentTiming } from "./cutsceneAudioTiming";
const command = () => createCutsceneAudioCommand("06", { kind: "audio", id: "sound" });
describe("границы и огибающие музыкального фрагмента", () => {
  it("без границ использует весь файл и утверждённые начальные времена", () => {
    const value = command(), timing = fragmentTiming(value, 120);
    expect(timing).toMatchObject({ start: 0, end: 120, length: 120, fadeIn: 2, endFade: 1, loopCrossfade: 1 });
    expect(value.transition).toEqual({ mode: "crossfade", fadeOutMs: 2000, fadeInMs: 2000 });
    expect(value.loop.enabled).toBe(false);
  });
  it.each([{ startSeconds: 10, endSeconds: 10 }, { startSeconds: 12 }, { endSeconds: 13 }, { startSeconds: -1 }])("отклоняет фрагмент вне файла: %j", patch => {
    expect(() => fragmentTiming({ ...command(), ...patch }, 12)).toThrow("границы");
  });
  it("естественное затухание действует только у неповторяющегося фрагмента", () => {
    const value = { ...command(), endSeconds: 6 }, timing = fragmentTiming(value, 12);
    expect(fragmentGain(timing, value, 5.5, false)).toBe(0.5);
    const loop = { ...value, loop: { enabled: true, transition: { mode: "cut" as const } } };
    expect(fragmentGain(fragmentTiming(loop, 12), loop, 5.5, false)).toBe(1);
  });
  it("сокращает склейку до половины короткого фрагмента и остальные затухания до его длины", () => {
    const value = { ...command(), startSeconds: 2, endSeconds: 2.2 }, timing = fragmentTiming(value, 12);
    expect(timing.fadeIn).toBeCloseTo(0.2); expect(timing.endFade).toBeCloseTo(0.2); expect(timing.loopCrossfade).toBeCloseTo(0.1);
    expect(value.transition.fadeInMs).toBe(2000); expect(value.loop.transition).toEqual({ mode: "crossfade", durationMs: 1000 });
    const sequential = { ...value, loop: { enabled: true, transition: { mode: "sequential" as const, fadeOutMs: 1000, fadeInMs: 2000 } } };
    expect(fragmentTiming(sequential, 12)).toMatchObject({ loopOut: timing.length, loopIn: timing.length });
  });
});
