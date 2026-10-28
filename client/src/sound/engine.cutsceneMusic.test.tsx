// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createCutsceneAudioCommand } from "@shared/cutscenes/defaults";
const mock = vi.hoisted(() => ({ payload: { set: null, tracks: [], ambient: [], weather: [], stingers: [], battle: null } }));
vi.mock("../api/client", () => ({ getAuthToken: () => "stand-test" }));
vi.mock("../data/hooks", () => ({ useResource: () => ({ data: mock.payload }) }));
vi.mock("../data/imperative", () => ({ readResource: async () => mock.payload }));
vi.mock("./bus", () => ({ onCommand: () => () => {}, publishState: () => {} }));
vi.mock("./cutsceneAudioMedia", () => ({
  abortAudioPreparation: () => new DOMException("cancelled", "AbortError"),
  prepareCutsceneAudioAsset: async (_id: number, _ref: unknown, start: number) => {
    const voices = [document.createElement("audio"), document.createElement("audio")] as const;
    for (const audio of voices) { audio.dataset.cutsceneVoice = "test"; audio.dataset.audioChannel = "background"; audio.currentTime = start; document.body.append(audio); }
    return { duration: 20, voices, dispose: () => voices.forEach(audio => { audio.pause(); audio.remove(); }) };
  },
}));
import { AudioPlayerProvider, useAudioPlayer } from "../audioPlayer";
import { SoundEngineProvider, useSoundEngine } from "./engine";
import { audioAuthority } from "./audioOwnership";
const owner = { runId: "06-integration", controllerId: "06-host" };
const useAudio = () => ({ player: useAudioPlayer(), sound: useSoundEngine() });
const wrapper = ({ children }: { children: ReactNode }) => <AudioPlayerProvider><SoundEngineProvider>{children}</SoundEngineProvider></AudioPlayerProvider>;
beforeEach(() => {
  localStorage.clear(); if (audioAuthority.getSnapshot()) audioAuthority.release(audioAuthority.getSnapshot()!.owner);
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function(this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, false); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, true); });
});
afterEach(() => { if (audioAuthority.getSnapshot()) audioAuthority.release(audioAuthority.getSnapshot()!.owner); vi.restoreAllMocks(); });
async function start(value: ReturnType<typeof useAudio>) {
  const command = { ...createCutsceneAudioCommand("06-command", { kind: "audio", id: "06-file" }),
    transition: { mode: "crossfade" as const, fadeOutMs: 0, fadeInMs: 0 }, endFadeOutMs: 0 };
  value.sound.cutsceneAudio.capture(owner);
  await value.sound.cutsceneAudio.suspend(owner);
  const prepared = await value.sound.cutsceneMusic.prepare(owner, { cutsceneId: 6, runId: owner.runId, command });
  await prepared.commit();
}
describe("подключение фрагментов к снимку и обычному фону", () => {
  it("обычный запуск после keep заменяет оставленную музыку, при захвате запуск заблокирован", async () => {
    const { result, unmount } = renderHook(useAudio, { wrapper });
    await act(async () => start(result.current));
    act(() => result.current.player.playPlaylist([{ id: 1, name: "ordinary", src: "/ordinary.wav" }]));
    expect(result.current.sound.cutsceneMusic.capture()).not.toBeNull(); expect(result.current.player.isPlaying).toBe(false);
    act(() => result.current.sound.cutsceneAudio.release(owner));
    act(() => result.current.player.playPlaylist([{ id: 1, name: "ordinary", src: "/ordinary.wav" }]));
    expect(result.current.sound.cutsceneMusic.capture()).toBeNull(); expect(document.querySelectorAll("[data-cutscene-voice]")).toHaveLength(0);
    expect(result.current.player.isPlaying).toBe(true); unmount();
  });
  it("снимок следующей катсцены сохраняет оставленный фрагмент и возвращает его через адаптер", async () => {
    const { result, unmount } = renderHook(useAudio, { wrapper }); await act(async () => start(result.current));
    const audio = document.querySelector<HTMLAudioElement>("[data-cutscene-voice]")!; audio.currentTime = 7;
    act(() => result.current.sound.cutsceneAudio.release(owner));
    const next = { ...owner, runId: "next-06" };
    let saved!: ReturnType<typeof result.current.sound.cutsceneAudio.capture>;
    await act(async () => { saved = result.current.sound.cutsceneAudio.capture(next); await result.current.sound.cutsceneAudio.suspend(next); });
    expect(saved.background).toMatchObject({ kind: "cutscene", positionSeconds: 7 });
    await act(async () => { await result.current.sound.cutsceneAudio.restore(next, saved); result.current.sound.cutsceneAudio.release(next); });
    expect(result.current.sound.cutsceneMusic.capture()).toMatchObject({ runId: owner.runId, positionSeconds: 7, state: "playing" });
    expect(result.current.player.isPlaying).toBe(false); unmount();
  });
  it("размонтирование ведущего останавливает голоса и освобождает их временные источники", async () => {
    const { result, unmount } = renderHook(useAudio, { wrapper }); await act(async () => start(result.current));
    const voices = [...document.querySelectorAll<HTMLAudioElement>("[data-cutscene-voice]")]; unmount();
    expect(voices.every(audio => audio.paused && !audio.isConnected)).toBe(true);
    expect(audioAuthority.getSnapshot()?.owner).toEqual(owner);
  });
});
