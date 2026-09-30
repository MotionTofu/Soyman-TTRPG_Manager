// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("./api/client", () => ({ getAuthToken: () => "token" }));
vi.mock("./data/hooks", () => ({ useResource: () => ({ data: { fade_duration_ms: 200 } }) }));

import { AudioPlayerProvider, useAudioPlayer } from "./audioPlayer";

const wrapper = ({ children }: { children: ReactNode }) =>
  <AudioPlayerProvider>{children}</AudioPlayerProvider>;

const tracks = [
  { id: 1, name: "First", src: "/first.mp3" },
  { id: 2, name: "Second", src: "/second.mp3" },
];

let paused = new WeakMap<HTMLMediaElement, boolean>();
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  paused = new WeakMap();
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    return Promise.resolve();
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("audio playback", () => {
  it("does not pause the first track when the spare element finishes unlocking", async () => {
    const { result, unmount } = renderHook(() => useAudioPlayer(), { wrapper });
    const [active, spare] = document.querySelectorAll("audio");

    act(() => result.current.playPlaylist(tracks));
    await act(async () => { await Promise.resolve(); });

    expect(play).toHaveBeenCalledTimes(2);
    expect(active.paused).toBe(false);
    expect(spare.paused).toBe(true);
    expect(pause.mock.instances).not.toContain(active);
    expect(result.current.isPlaying).toBe(true);
    unmount();
  });

  it("keeps both crossfade levels in sync with volume changes", async () => {
    const { result, unmount } = renderHook(() => useAudioPlayer(), { wrapper });
    const [outgoing, incoming] = document.querySelectorAll("audio");

    act(() => result.current.playPlaylist(tracks));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.next());
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.setBackgroundGain(0.4));

    expect(outgoing.volume).toBeCloseTo(0.2);
    expect(incoming.volume).toBeCloseTo(0.2);
    act(() => vi.advanceTimersByTime(100));
    expect(outgoing.paused).toBe(true);
    expect(incoming.volume).toBeCloseTo(0.4);
    unmount();
  });

  it("shows a paused state if the browser rejects playback", async () => {
    play.mockImplementation(function (this: HTMLMediaElement) {
      if (this.getAttribute("src") === tracks[0].src) return Promise.reject(new Error("blocked"));
      paused.set(this, false);
      return Promise.resolve();
    });
    const { result, unmount } = renderHook(() => useAudioPlayer(), { wrapper });

    act(() => result.current.playPlaylist(tracks));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isPlaying).toBe(false);
    unmount();
  });

  it("keeps the previous track when a crossfade cannot start", async () => {
    play.mockImplementation(function (this: HTMLMediaElement) {
      if (this.getAttribute("src") === tracks[1].src) return Promise.reject(new Error("blocked"));
      paused.set(this, false);
      return Promise.resolve();
    });
    const { result, unmount } = renderHook(() => useAudioPlayer(), { wrapper });
    const [outgoing, incoming] = document.querySelectorAll("audio");

    act(() => result.current.playPlaylist(tracks));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.next());
    await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.current?.id).toBe(1);
    expect(result.current.isPlaying).toBe(true);
    expect(outgoing.paused).toBe(false);
    expect(incoming.paused).toBe(true);
    unmount();
  });
});
