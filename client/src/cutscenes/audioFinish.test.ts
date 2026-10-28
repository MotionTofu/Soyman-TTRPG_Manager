// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CutsceneAudioController, type ApplicationAudioPort, type CutsceneMusicPort } from "../sound/cutsceneAudio";
import { AudioAuthority } from "../sound/audioOwnership";
import type { CutsceneAudioReturnSnapshot } from "@shared/cutscenes/types";

const owner = { runId: "finish-08", controllerId: "host-08" };
const snapshot: CutsceneAudioReturnSnapshot = { scope: "music", background: { kind: "queue", queue: [], index: null,
  state: "stopped", positionSeconds: 0, volume: .4, repeat: "track", shuffle: true, activePlaylistId: null } };
function setup() {
  let finish!: () => void;
  const fading = new Promise<void>(resolve => { finish = resolve; });
  const music: CutsceneMusicPort = { capture: () => null, suspend: vi.fn(() => fading), pause: vi.fn(),
    resume: vi.fn(async () => {}), stop: vi.fn(), restore: vi.fn(async () => {}) };
  const app: ApplicationAudioPort = { capture: () => snapshot, suspend: vi.fn(async () => {}),
    restore: vi.fn(async (_owner, _saved, _resolve, commit) => { commit(); }) };
  const audio = new CutsceneAudioController(app, new AudioAuthority()); audio.registerMusic(music); audio.capture(owner, "music");
  return { audio, music, app, finish };
}
describe("плавность обычного завершения", () => {
  it("crossfade начинает возврат одновременно с уходом собственного трека", async () => {
    const f = setup(), transition = { mode: "crossfade" as const, fadeOutMs: 1000, fadeInMs: 700 };
    const returning = f.audio.restore(owner, snapshot, undefined, transition);
    await vi.waitFor(() => expect(f.app.restore).toHaveBeenCalled());
    expect(f.music.suspend).toHaveBeenCalledWith(1000); expect(f.music.stop).not.toHaveBeenCalled();
    expect(vi.mocked(f.app.restore).mock.calls[0][4]).toBe(700);
    f.finish(); await returning; expect(f.music.stop).toHaveBeenCalledTimes(1); f.audio.release(owner);
  });
  it("sequential ждёт ухода собственного трека перед возвратом прежних слоёв", async () => {
    const f = setup(); const returning = f.audio.restore(owner, snapshot, undefined, { mode: "sequential", fadeOutMs: 1200, fadeInMs: 800 });
    await vi.waitFor(() => expect(f.music.suspend).toHaveBeenCalledWith(1200));
    expect(f.app.restore).not.toHaveBeenCalled(); f.finish(); await returning;
    expect(vi.mocked(f.app.restore).mock.calls[0][4]).toBe(800); f.audio.release(owner);
  });
  it("прерывание без transition сохраняет прежнюю мгновенную операцию", async () => {
    const f = setup(); await f.audio.restore(owner, snapshot);
    expect(f.music.suspend).not.toHaveBeenCalled(); expect(f.music.stop).toHaveBeenCalledTimes(1); f.audio.release(owner);
  });
});
