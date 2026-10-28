// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SoundCommand } from "./bus";

const mock = vi.hoisted(() => ({
  fadeMs: 0,
  command: null as ((command: SoundCommand) => void) | null,
  payload: { set: null, tracks: [], battle: null,
    ambient: [{ resource_id: 2, name: "Ambient", src: "/ambient.wav", missing: false }],
    weather: [{ resource_id: 3, name: "Weather", src: "/weather.wav", missing: false }],
    stingers: [{ resource_id: 4, name: "Stinger", src: "/stinger.wav", missing: false }] },
}));
vi.mock("../api/client", () => ({ getAuthToken: () => "test" }));
vi.mock("../data/hooks", () => ({ useResource: (path: string) => ({ data: path === "/app-settings" ? { fade_duration_ms: mock.fadeMs } : mock.payload }) }));
vi.mock("../data/imperative", () => ({ readResource: async (path: string) => path === "/sounds" ? [
  { resource_id: 1, src: "/fresh-background.wav", missing: false }, { resource_id: 2, src: "/fresh-ambient.wav", missing: false },
  { resource_id: 3, src: "/fresh-weather.wav", missing: false },
] : mock.payload }));
vi.mock("./bus", () => ({ onCommand: (command: (value: SoundCommand) => void) => { mock.command = command; return () => { mock.command = null; }; }, publishState: () => {} }));
import { AudioPlayerProvider, useAudioPlayer } from "../audioPlayer";
import { SoundEngineProvider, useSoundEngine } from "./engine";
import { audioAuthority } from "./audioOwnership";

const owner = { runId: "engine-test-05", controllerId: "engine-test-window-05" };
const wrapper = ({ children }: { children: ReactNode }) => <AudioPlayerProvider><SoundEngineProvider>{children}</SoundEngineProvider></AudioPlayerProvider>;
const useCombinedAudio = () => ({ player: useAudioPlayer(), sound: useSoundEngine() });
const audio = (channel: string) => [...document.querySelectorAll<HTMLAudioElement>(`audio[data-audio-channel='${channel}']`)].find(el => el.hasAttribute("src") && !el.src.startsWith("data:"))!;
beforeEach(() => {
  mock.fadeMs = 0;
  localStorage.clear();
  if (audioAuthority.getSnapshot()) audioAuthority.release(audioAuthority.getSnapshot()!.owner);
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function(this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, false); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, true); });
});
afterEach(() => { if (audioAuthority.getSnapshot()) audioAuthority.release(audioAuthority.getSnapshot()!.owner); vi.useRealTimers(); vi.restoreAllMocks(); });
function start(value: ReturnType<typeof useCombinedAudio>) {
  value.player.playPlaylist([{ id: 1, name: "Background", src: "/background.wav" }], 0, 99);
  value.player.setRepeatMode("playlist"); value.player.setShuffleMode(true); value.player.setVolume(0.4);
  value.sound.playAmbient(2); value.sound.playWeather(3); value.sound.fireStinger(4);
}
describe("реальные провайдеры: захват и возврат", () => {
  it("возвращает паузу, позиции, очередь, режимы и громкости; стингер не возобновляется", async () => {
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper });
    await act(async () => start(result.current));
    act(() => { result.current.player.toggle(); result.current.sound.setVolume("ambient", 0.23); });
    audio("background").currentTime = 17; audio("ambient").currentTime = 23; audio("weather").currentTime = 31;
    let saved: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    act(() => { saved = result.current.sound.cutsceneAudio.capture(owner); });
    expect(JSON.stringify(saved!)).not.toContain(".wav"); expect(saved!.background).toMatchObject({ state: "paused", positionSeconds: 17, volume: 0.4, repeat: "playlist", shuffle: true, activePlaylistId: 99 });
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    expect(audio("ambient").paused).toBe(true);
    await act(async () => result.current.sound.cutsceneAudio.restore(owner, saved!));
    act(() => result.current.sound.cutsceneAudio.release(owner));
    for (const el of document.querySelectorAll("audio")) el.dispatchEvent(new Event("loadedmetadata"));
    expect(audio("background").paused).toBe(true); expect(audio("background").currentTime).toBe(17);
    expect(audio("ambient").paused).toBe(false); expect(audio("ambient").currentTime).toBe(23); expect(audio("weather").currentTime).toBe(31);
    expect(result.current.sound.state.volumes.ambient).toBe(0.23); expect(result.current.sound.state.duckingId).toBeNull();
    expect(result.current.sound.state.stingerPlaying).toBe(false);
    expect(document.querySelector("audio[data-audio-channel='stinger']")?.getAttribute("src")).toBeNull();
    unmount();
  });
  it("music оставляет атмосферу/погоду/стингер управляемыми и блокирует прямые методы плеера", async () => {
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper }); await act(async () => start(result.current));
    let saved: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    act(() => { saved = result.current.sound.cutsceneAudio.capture(owner, "music"); });
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    expect(audio("background").paused).toBe(true); expect(audio("ambient").paused).toBe(false); expect(audio("weather").paused).toBe(false); expect(audio("stinger").paused).toBe(false);
    act(() => {
      result.current.player.playPlaylist([{ id: 100, name: "Blocked", src: "/blocked.wav" }]);
      result.current.player.toggle(); result.current.player.setVolume(0.99); result.current.player.setShuffleMode(false);
      mock.command?.({ kind: "volume", channel: "ambient", value: 0.17 });
    });
    expect(result.current.player.current?.id).toBe(1); expect(result.current.player.volume).toBe(0.4); expect(result.current.player.shuffleMode).toBe(true);
    expect(result.current.sound.state.volumes.ambient).toBe(0.17);
    await act(async () => result.current.sound.cutsceneAudio.restore(owner, saved!)); act(() => result.current.sound.cutsceneAudio.release(owner));
    expect(result.current.sound.state.volumes.ambient).toBe(0.17); expect(audio("background").paused).toBe(false); unmount();
  });
  it("BroadcastChannel-команды полного захвата не применяются и не копятся для выполнения после release", async () => {
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper }); await act(async () => start(result.current));
    act(() => result.current.sound.cutsceneAudio.capture(owner));
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    const volumes = { ...result.current.sound.state.volumes };
    act(() => {
      mock.command?.({ kind: "stinger", resourceId: 4 }); mock.command?.({ kind: "ambient", resourceId: 2 });
      mock.command?.({ kind: "volume", channel: "master", value: 0.99 }); mock.command?.({ kind: "set", setId: 999 });
    });
    expect(result.current.sound.state.volumes).toEqual(volumes); expect(result.current.sound.state.setId).toBeNull();
    expect(result.current.sound.state.ambientId).toBe(2); expect(result.current.sound.state.stingerPlaying).toBe(false);
    act(() => result.current.sound.cutsceneAudio.release(owner)); await act(async () => { await Promise.resolve(); });
    expect(result.current.sound.state.stingerPlaying).toBe(false);
    act(() => mock.command?.({ kind: "stinger", resourceId: 4 })); expect(result.current.sound.state.stingerPlaying).toBe(true); unmount();
  });
  it("остановленная очередь сохраняется заряженной и не запускается при возврате", async () => {
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper }); await act(async () => start(result.current));
    act(() => result.current.player.halt());
    let saved: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    act(() => { saved = result.current.sound.cutsceneAudio.capture(owner, "music"); });
    expect(saved!.background).toMatchObject({ index: null, state: "stopped", positionSeconds: 0 });
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    await act(async () => result.current.sound.cutsceneAudio.restore(owner, saved!));
    act(() => result.current.sound.cutsceneAudio.release(owner));
    expect(result.current.player.tracks.map(t => t.id)).toEqual([1]); expect(result.current.player.index).toBe(-1);
    expect(result.current.player.isPlaying).toBe(false); unmount();
  });
  it("остановленный эмбиент остаётся выбранным, сохраняет позицию и не запускается", async () => {
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper }); await act(async () => start(result.current));
    audio("ambient").currentTime = 29;
    act(() => mock.command?.({ kind: "stop", channel: "ambient" }));
    let saved: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    act(() => { saved = result.current.sound.cutsceneAudio.capture(owner); });
    expect(saved!.scope === "all" && saved!.ambient.state).toBe("stopped");
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    await act(async () => result.current.sound.cutsceneAudio.restore(owner, saved!));
    act(() => result.current.sound.cutsceneAudio.release(owner));
    for (const el of document.querySelectorAll("audio")) el.dispatchEvent(new Event("loadedmetadata"));
    expect(result.current.sound.state.ambientId).toBe(2); expect(result.current.sound.state.stopped.ambient).toBe(true);
    expect(audio("ambient").paused).toBe(true); expect(audio("ambient").currentTime).toBe(29); unmount();
  });
  it("возврат музыки не отменяет затухание выключенного незахваченного эмбиента", async () => {
    vi.useFakeTimers(); mock.fadeMs = 1000;
    const { result, unmount } = renderHook(useCombinedAudio, { wrapper }); await act(async () => start(result.current));
    act(() => vi.advanceTimersByTime(1000));
    let saved: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    act(() => { saved = result.current.sound.cutsceneAudio.capture(owner, "music"); });
    await act(async () => result.current.sound.cutsceneAudio.suspend(owner));
    act(() => result.current.sound.playAmbient(2));
    act(() => vi.advanceTimersByTime(400));
    await act(async () => result.current.sound.cutsceneAudio.restore(owner, saved!));
    act(() => result.current.sound.cutsceneAudio.release(owner));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.sound.state.ambientId).toBeNull(); expect(audio("ambient").paused).toBe(true); unmount();
  });
});
