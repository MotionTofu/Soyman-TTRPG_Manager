// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDurations } from "./duration";

const probes: ProbeAudio[] = [];
class ProbeAudio extends EventTarget {
  preload = "";
  src = "";
  duration = 0;
  constructor() { super(); probes.push(this); }
  removeAttribute() { this.src = ""; }
  load() {}
}
async function loaded(audio: ProbeAudio, seconds: number) {
  await act(async () => {
    audio.duration = seconds;
    audio.dispatchEvent(new Event("loadedmetadata"));
  });
}
beforeEach(() => { probes.length = 0; vi.stubGlobal("Audio", ProbeAudio); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("метаданные длительности", () => {
  it("один общий запрос обновляет оба списка, не проигрывая звук", async () => {
    const first = renderHook(() => useDurations([{ id: 101, src: "/shared-duration.wav" }]));
    const second = renderHook(() => useDurations([{ id: 101, src: "/shared-duration.wav" }]));
    expect(probes).toHaveLength(1);
    await loaded(probes[0], 42);
    expect(first.result.current.get(101)).toBe(42);
    expect(second.result.current.get(101)).toBe(42);
    expect(probes[0].preload).toBe("metadata");
  });

  it("перечитывает метаданные при смене URL у прежнего id", async () => {
    const hook = renderHook(({ src }) => useDurations([{ id: 102, src }]), { initialProps: { src: "/old-duration.wav" } });
    await loaded(probes[0], 120);
    hook.rerender({ src: "/new-duration.wav" });
    expect(hook.result.current.has(102)).toBe(false);
    await loaded(probes[1], 5);
    expect(hook.result.current.get(102)).toBe(5);
  });

  it("читает не больше двух файлов одновременно и сохраняет нулевую длительность", async () => {
    const hook = renderHook(() => useDurations([
      { id: 103, src: "/queue-one.wav" }, { id: 104, src: "/queue-two.wav" }, { id: 105, src: "/queue-three.wav" },
    ]));
    expect(probes).toHaveLength(2);
    await loaded(probes[0], 0);
    expect(probes).toHaveLength(3);
    await loaded(probes[1], 30);
    await loaded(probes[2], 60);
    expect([...hook.result.current.values()]).toEqual([0, 30, 60]);
  });
});
