// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioAuthority } from "./audioOwnership";
import { installAuxiliaryAudioGuard } from "./auxiliaryAudio";
const owner = { runId: "aux-05", controllerId: "aux-window" };
let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });
describe("прослушивание во время катсцены", () => {
  it("all прерывает прослушивание и блокирует отложенный play даже после освобождения", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const gate = new AudioAuthority(), audio = document.createElement("audio"); document.body.append(audio);
    dispose = installAuxiliaryAudioGuard(gate); await audio.play(); expect(play).toHaveBeenCalledTimes(1);
    gate.claim(owner, "all"); expect(pause).toHaveBeenCalled();
    await expect(audio.play()).rejects.toThrow("Прослушивание"); gate.release(owner);
    await expect(audio.play()).rejects.toThrow("Прослушивание"); expect(play).toHaveBeenCalledTimes(1);
  });
  it("music не затрагивает прослушивание, а управляемые каналы проверяются своими командами", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const gate = new AudioAuthority(), audition = document.createElement("audio"), managed = document.createElement("audio");
    managed.dataset.audioChannel = "background"; document.body.append(audition, managed);
    dispose = installAuxiliaryAudioGuard(gate); gate.claim(owner, "music"); await audition.play();
    gate.release(owner); gate.claim(owner, "all"); await managed.play(); expect(play).toHaveBeenCalledTimes(2);
  });
  it("позднее появившийся аудиоэлемент также не запускается после выхода сам собой", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const gate = new AudioAuthority(); dispose = installAuxiliaryAudioGuard(gate); gate.claim(owner, "all");
    const audio = document.createElement("audio"); document.body.append(audio); await Promise.resolve();
    gate.release(owner); await expect(audio.play()).rejects.toThrow("Прослушивание");
  });
  it("перехватывает play от native controls, который обходит JavaScript-метод", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const gate = new AudioAuthority(), audio = document.createElement("audio"); audio.controls = true; document.body.append(audio);
    dispose = installAuxiliaryAudioGuard(gate); gate.claim(owner, "all");
    const calls = pause.mock.calls.length; audio.dispatchEvent(new Event("play"));
    expect(pause.mock.calls.length).toBeGreaterThan(calls);
  });
});
