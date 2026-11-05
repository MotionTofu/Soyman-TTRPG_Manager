// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCutsceneAudioCommand, createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneAudioReturnSnapshot, CutsceneDocument, CutsceneAudioCommand } from "@shared/cutscenes/types";
import type { CutscenePreviewState } from "@shared/cutscenes/previewApi";
import { CutsceneAudioController } from "../sound/cutsceneAudio";
import { AudioAuthority } from "../sound/audioOwnership";
import type { CutsceneAudioRunner, CutsceneMusicRequest } from "../sound/cutsceneAudioRunner";
vi.mock("../data/cutscenePreviews", () => ({ cutscenePreviews: { start: vi.fn(), update: vi.fn(), stop: vi.fn(), acknowledge: vi.fn(), active: vi.fn(), heartbeat: vi.fn(), claimReturn: vi.fn() } }));
vi.mock("./display", () => ({ browserCutsceneOutput: { open: vi.fn(), close: vi.fn(), subscribeErrors: vi.fn(() => () => {}) }, subscribePreviewWindowClose: vi.fn(() => () => {}), prepareImages: vi.fn(async () => () => {}), preparePlayerWindow: vi.fn(async () => () => {}) }));
import { cutscenePreviews as repository } from "../data/cutscenePreviews";
import { browserCutsceneOutput, subscribePreviewWindowClose } from "./display";
import { WorkshopPreviewController } from "./workshopPreview";
let saved: CutscenePreviewState | null;
const snapshot = (): CutsceneAudioReturnSnapshot => ({ scope: "all", background: { kind: "queue", queue: [], index: null, positionSeconds: 0, state: "stopped", volume: .5, repeat: "off", shuffle: false, activePlaylistId: null }, ambient: { source: null, positionSeconds: 0, state: "stopped" }, weather: { source: null, positionSeconds: 0, state: "stopped" }, setId: null, duckingId: null, silence: false, volumes: { master: 1, background: 1, ambient: 1, weather: 1, stinger: 1 } });
const document = (): CutsceneDocument => ({ ...createCutsceneDocument("Пролог"), steps: [
  { ...createCutsceneStep("first"), audio: { action: "replace", command: { ...createCutsceneAudioCommand("music", { kind: "audio", id: "track" }), endSeconds: 12 } }, text: { action: "replace", text: "Ворота" } },
  createCutsceneStep("second"),
] });
function fixture() {
  const app = { capture: vi.fn(snapshot), suspend: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
  const music = { prepare: vi.fn(async (_owner: unknown, _request: CutsceneMusicRequest) => ({ commit: vi.fn(async () => {}), dispose: vi.fn() })),
    clear: vi.fn(), pause: vi.fn(), resume: vi.fn(async () => {}), stop: vi.fn(), suspend: vi.fn(async () => {}), restore: vi.fn(async () => {}), capture: vi.fn(() => null), setPreviewVolume: vi.fn(), getSnapshot: vi.fn(() => ({ state: "playing", error: null })) };
  const audio = new CutsceneAudioController(app, new AudioAuthority()); audio.registerMusic(music);
  const controller = new WorkshopPreviewController(audio, music as unknown as CutsceneAudioRunner), doc = document();
  controller.configure(1, doc, "first"); return { controller, doc, app, music, audio };
}
const withAudio = (doc: CutsceneDocument, patch: Partial<CutsceneAudioCommand>): CutsceneDocument => ({ ...doc, steps: doc.steps.map((step, i) => i === 0 && step.audio.action === "replace" ? { ...step, audio: { action: "replace", command: { ...step.audio.command, ...patch } } } : step) });
beforeEach(() => {
  vi.clearAllMocks(); saved = null;
  vi.mocked(repository.start).mockImplementation(async input => saved = { ...input, phase: "active", revision: 1, updatedAt: Date.now(), audio: null, presentation: null, window: null, external: false, visualPlayback: { elapsedMs: 0, startedAt: null } });
  vi.mocked(repository.update).mockImplementation(async input => {
    if (!saved || saved.revision !== input.revision) throw Error("stale");
    saved = { ...saved, ...input, revision: saved.revision + 1, external: input.window ? true : saved.external }; return saved;
  });
  vi.mocked(repository.stop).mockImplementation(async () => { if (!saved) throw Error("missing"); return saved = { ...saved, phase: "returning", external: false }; });
  vi.mocked(repository.acknowledge).mockImplementation(async () => { saved = null; });
  vi.mocked(repository.active).mockImplementation(async () => saved);
  vi.mocked(repository.heartbeat).mockImplementation(async () => saved!);
  vi.mocked(browserCutsceneOutput.open).mockResolvedValue({ ok: true, wasOpen: true, openedByCall: false, screenId: null, windowId: "existing" });
});
afterEach(() => vi.restoreAllMocks());
describe("проигрывание черновика мастерской", () => {
  it("запускается по HTTP в локальной сети без crypto.randomUUID", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const { controller } = fixture();
      expect(await controller.play("general")).toBe(true);
      expect(repository.start).toHaveBeenCalledWith(expect.objectContaining({
        owner: {
          runId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
          controllerId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        },
      }));
      await controller.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("запоздавшее обнаружение не принимает свой только что запущенный просмотр за чужой", async () => {
    const { controller } = fixture();
    let resolve!: (state: CutscenePreviewState | null) => void;
    vi.mocked(repository.active).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const disconnect = controller.connect();
    try { await controller.play("general"); resolve(saved); await Promise.resolve(); expect(controller.getSnapshot().foreign).toBeNull(); }
    finally { disconnect(); await controller.stop(); }
  });
  it("захватывает весь звук, держит его на паузе и возвращает один раз по стопу", async () => {
    const { controller, app, audio } = fixture();
    expect(await controller.play("general")).toBe(true); expect(app.capture).toHaveBeenCalledWith("all");
    controller.pause(); expect(app.restore).not.toHaveBeenCalled(); expect(audio.authority.getSnapshot()).toBeTruthy();
    await controller.stop(); await controller.stop(); expect(app.restore).toHaveBeenCalledTimes(1); expect(audio.authority.getSnapshot()).toBeNull();
  });
  it("статический внешний кадр не захватывает и не приостанавливает звук", async () => {
    const { controller, app, music } = fixture();
    expect(await controller.external(null)).toBe(true); await controller.stop();
    expect(app.capture).not.toHaveBeenCalled(); expect(music.pause).not.toHaveBeenCalled(); expect(app.restore).not.toHaveBeenCalled();
    expect(browserCutsceneOutput.close).not.toHaveBeenCalled();
  });
  it("закрытие подключённого окна завершает весь предпросмотр и возвращает пульт", async () => {
    const { controller, app } = fixture(), disconnect = controller.connect();
    try {
      await controller.play("general"); await controller.external(null);
      const callback = vi.mocked(subscribePreviewWindowClose).mock.calls.at(-1)![0]; callback("existing");
      await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("idle")); expect(app.restore).toHaveBeenCalledTimes(1);
    } finally { disconnect(); await controller.stop(); }
  });
  it("временный повтор использует выбранную склейку, сохраняется при стопе и сбрасывается при уходе", async () => {
    const { controller, doc, music } = fixture();
    const first = doc.steps[0].audio; if (first.action !== "replace") throw Error();
    const changed = withAudio(doc, { loop: { enabled: false, transition: { mode: "crossfade", durationMs: 400 } } });
    controller.configure(1, changed, "first"); controller.setAuditionLoop(true); await controller.play("audition");
    expect(music.prepare.mock.calls[0][1].command.loop).toEqual({ enabled: true, transition: { mode: "crossfade", durationMs: 400 } });
    expect(changed.steps[0].audio.action === "replace" && changed.steps[0].audio.command.loop.enabled).toBe(false); await controller.stop(); expect(controller.getSnapshot().auditionLoop).toBe(true);
    controller.leave(); expect(controller.getSnapshot().auditionLoop).toBe(false);
  });
  it("живые правки текста и громкости не перезапускают звук; текст ставится на отдельную паузу", async () => {
    const { controller, doc, music } = fixture(); await controller.play("general");
    const changed = withAudio({ ...doc, steps: doc.steps.map((step, i) => i === 0 ? { ...step, text: { action: "replace", text: "Новое чтение" } } : step) }, { volume: .25 });
    controller.configure(1, changed, "first"); await Promise.resolve();
    expect(music.prepare).toHaveBeenCalledTimes(1); expect(music.setPreviewVolume).toHaveBeenCalledWith(expect.anything(), .25);
    expect(controller.getSnapshot()).toMatchObject({ phase: "playing", textPaused: true }); await controller.stop();
  });
  it("наследованный текст не сбрасывается при выборе следующего шага", async () => {
    const { controller, doc } = fixture(); await controller.play("general"); const generation = controller.getSnapshot().textGeneration;
    controller.configure(1, doc, "second"); await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("playing"));
    expect(controller.getSnapshot().textGeneration).toBe(generation); await controller.stop();
  });
  it("отпускание ручки перезапускает уже игравшее прослушивание, числовая правка останавливает", async () => {
    const { controller, doc, music } = fixture(); await controller.play("audition");
    controller.beginBoundaryEdit(); expect(controller.getSnapshot().phase).toBe("paused"); controller.endBoundaryEdit(true);
    const changed = withAudio(doc, { startSeconds: 2 });
    controller.configure(1, changed, "first"); await vi.waitFor(() => expect(music.prepare).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("playing"));
    const numeric = withAudio(changed, { startSeconds: 3 });
    controller.configure(1, numeric, "first"); await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("idle"));
  });
  it("стоп во время ожидающего старта убирает служебное состояние без запуска звука", async () => {
    const { controller, music } = fixture(); const start = vi.mocked(repository.start).getMockImplementation()!;
    let resolve!: () => void; const gate = new Promise<void>(done => { resolve = done; });
    vi.mocked(repository.start).mockImplementation(async input => { await gate; return start(input); });
    const playing = controller.play("general"); await Promise.resolve(); const stopping = controller.stop(); resolve();
    await playing; await stopping; expect(saved).toBeNull(); expect(music.prepare).not.toHaveBeenCalled();
  });
});
