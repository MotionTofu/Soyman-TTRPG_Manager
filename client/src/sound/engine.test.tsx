// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SoundCommand } from "./bus";

const mocks = vi.hoisted(() => ({
  handler: null as ((command: SoundCommand) => void) | null,
  gain: vi.fn(),
  playPlaylist: vi.fn(),
  player: { tracks: [] as { id: number; name: string; src: string }[], index: -1, currentTime: 0 },
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
  current: null, isPlaying: false, ...mocks.player,
  duration: 0, repeatMode: "off", shuffleMode: false,
  setBackgroundGain: mocks.gain, playPlaylist: mocks.playPlaylist,
}) }));
vi.mock("../data/hooks", () => ({ useResource: (path: string) => ({
  data: path === "/app-settings" ? { fade_duration_ms: 0 } : mocks.console,
}) }));
vi.mock("../data/imperative", () => ({ readResource: (path: string) => Promise.resolve(
  path.startsWith("/playlists/")
    ? { name: `Тема ${path.slice(11)}`, items: [{ resource_id: 90, name: "Бой", src: "/battle.mp3" }] }
    : mocks.console,
) }));
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
  mocks.playPlaylist.mockClear();
  mocks.player = { tracks: [], index: -1, currentTime: 0 };
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

describe("sound engine combat", () => {
  it("keeps the pre-fight music when the theme changes mid-fight", async () => {
    const before = [{ id: 1, name: "Таверна", src: "/tavern.mp3" }];
    mocks.player = { tracks: before, index: 0, currentTime: 42 };
    const { result, rerender, unmount } = renderHook(() => useSoundEngine(), { wrapper });
    await act(async () => result.current.enterCombat(18));
    // Теперь играет боевая тема — её и запомнил бы повторный вход без защиты.
    mocks.player = { tracks: [{ id: 90, name: "Бой", src: "/battle.mp3" }], index: 0, currentTime: 5 };
    rerender();
    await act(async () => result.current.enterCombat(19));
    expect(result.current.state.autoSwitch?.to).toBe("Тема 19");
    act(() => result.current.exitCombat());
    expect(mocks.playPlaylist).toHaveBeenLastCalledWith(before, 0, null, 42);
    unmount();
  });
});
