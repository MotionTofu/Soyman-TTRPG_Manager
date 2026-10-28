// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AudioAuthority } from "./audioOwnership";
import { CutsceneAudioController, type ApplicationAudioPort, type CutsceneMusicPort } from "./cutsceneAudio";
import type { CutsceneAudioReturnSnapshot, CutsceneRetainedMusicSnapshot } from "@shared/cutscenes/types";
import { createCutsceneAudioCommand } from "@shared/cutscenes/defaults";

const owner = { runId: "05-test", controllerId: "05-test-window" };
const music: CutsceneAudioReturnSnapshot = { scope: "music", background: { kind: "queue", queue: [], index: null,
  positionSeconds: 0, state: "stopped", volume: 0.4, repeat: "track", shuffle: true, activePlaylistId: 42 } };
function setup(snapshot = music) {
  const port: ApplicationAudioPort = { capture: vi.fn(() => structuredClone(snapshot)), suspend: vi.fn(async () => {}),
    restore: vi.fn(async (_o, _s, _r, commit) => { commit(); }) };
  const gate = new AudioAuthority(), controller = new CutsceneAudioController(port, gate);
  return { port, gate, controller };
}
describe("интерфейс звука катсцены", () => {
  it("снимок независимо сериализуется и не подменяется повторным capture после паузы", () => {
    const { controller } = setup(); const saved = controller.capture(owner, "music");
    expect(JSON.parse(JSON.stringify(saved))).toEqual(music);
    expect(() => controller.capture(owner, "music")).toThrow(); controller.release(owner);
  });
  it("suspend не трогает чужой scope и освобождение вновь разрешает команды", async () => {
    const { controller, port, gate } = setup(); controller.capture(owner, "music");
    await controller.suspend(owner, 500); expect(port.suspend).toHaveBeenCalledWith(owner, "music", 500);
    controller.release(owner); expect(gate.allows("background")).toBe(true);
  });
  it("прежняя музыка катсцены восстанавливается своим адаптером, без второй очереди", async () => {
    const retained: CutsceneRetainedMusicSnapshot = { kind: "cutscene", cutsceneId: 17, runId: "previous",
      command: createCutsceneAudioCommand("previous-command", { kind: "audio", id: "previous-audio" }),
      positionSeconds: 12, state: "paused", volume: 0.5 };
    const adapter: CutsceneMusicPort = { capture: () => retained, pause: vi.fn(), resume: vi.fn(async () => {}),
      suspend: vi.fn(async () => {}), stop: vi.fn(), restore: vi.fn(async () => {}) };
    const { controller, port } = setup(); controller.registerMusic(adapter);
    const saved = controller.capture(owner, "music"); expect(saved.background).toEqual(retained);
    await controller.restore(owner, saved);
    expect(port.restore).toHaveBeenCalledTimes(1); expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(adapter.restore).toHaveBeenCalledWith(retained); controller.release(owner);
  });
  it("ошибка разрешения источника сохраняет владение и не останавливает текущую музыку", async () => {
    const snapshot = { ...music, background: { ...music.background, kind: "queue" as const, queue: [
      { source: { kind: "cutscene" as const, audio: { kind: "audio" as const, id: "missing" } }, name: "missing" }], index: 0 } } as CutsceneAudioReturnSnapshot;
    const { controller, port, gate } = setup(snapshot); const saved = controller.capture(owner, "music");
    await expect(controller.restore(owner, saved, async () => { throw Error("missing"); })).rejects.toThrow("missing");
    expect(port.restore).not.toHaveBeenCalled(); expect(gate.getSnapshot()?.owner).toEqual(owner); controller.release(owner);
  });
  it("после reload принимает сохранённого владельца, не переснимая пустой движок", () => {
    const { controller, gate, port } = setup(); gate.receive({ owner, scope: "all" }); controller.recover(owner, "all");
    expect(port.capture).not.toHaveBeenCalled(); controller.release(owner);
  });
  it("входной переход обычных слоёв не приостанавливает собственный runner второй раз", async () => {
    const { controller, port } = setup();
    const adapter: CutsceneMusicPort = { capture: () => null, pause: vi.fn(), resume: vi.fn(async () => {}),
      suspend: vi.fn(async () => {}), stop: vi.fn(), restore: vi.fn(async () => {}) };
    controller.registerMusic(adapter); controller.capture(owner, "music"); await controller.suspendApplication(owner, 1500);
    expect(port.suspend).toHaveBeenCalledWith(owner, "music", 1500); expect(adapter.suspend).not.toHaveBeenCalled(); controller.release(owner);
  });
});
