// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SoundCommand } from "./bus";

const mocks = vi.hoisted(() => ({
  handler: null as ((command: SoundCommand) => void) | null,
  gain: vi.fn(),
  console: {
    set: null,
    tracks: [],
    battle: null,
    ambient: [{
      resource_id: 1, name: "Rainforest", role: "ambient", icon: null,
      icon_url: null, pinned: false, src: "/ambient.mp3", missing: false,
    }],
    weather: [],
    stingers: [],
  },
}));

vi.mock("../audioPlayer", () => ({ useAudioPlayer: () => ({
  current: null, tracks: [], index: -1, isPlaying: false,
  currentTime: 0, duration: 0, repeatMode: "off", shuffleMode: false,
  setBackgroundGain: mocks.gain,
}) }));
vi.mock("../data/hooks", () => ({ useResource: (path: string) => ({
  data: path === "/app-settings" ? { fade_duration_ms: 0 } : mocks.console,
}) }));
vi.mock("../data/imperative", () => ({ readResource: () => Promise.resolve(mocks.console) }));
vi.mock("./bus", () => ({
  onCommand: (handler: (command: SoundCommand) => void) => {
    mocks.handler = handler;
    return () => { mocks.handler = null; };
  },
  publishState: () => {},
}));

import { SoundEngineProvider, useSoundEngine } from "./engine";

const wrapper = ({ children }: { children: ReactNode }) =>
  <SoundEngineProvider>{children}</SoundEngineProvider>;

let paused = new WeakMap<HTMLMediaElement, boolean>();

beforeEach(() => {
  localStorage.clear();
  paused = new WeakMap();
  mocks.gain.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("sound engine volume", () => {
  it("does not wake a stopped ambient channel when master volume changes", () => {
    const { result, unmount } = renderHook(() => useSoundEngine(), { wrapper });
    act(() => result.current.playAmbient(1));
    const ambient = [...document.querySelectorAll("audio")].find((el) => el.getAttribute("src") === "/ambient.mp3");
    expect(ambient).toBeDefined();

    act(() => mocks.handler?.({ kind: "stop", channel: "ambient" }));
    expect(ambient?.paused).toBe(true);
    const backgroundUpdates = mocks.gain.mock.calls.length;
    act(() => result.current.setVolume("ambient", 0.7));
    expect(mocks.gain).toHaveBeenCalledTimes(backgroundUpdates);
    act(() => result.current.setVolume("master", 0.3));

    expect(ambient?.paused).toBe(true);
    expect(ambient?.volume).toBe(0);
    unmount();
  });
});
