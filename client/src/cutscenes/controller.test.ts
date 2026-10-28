// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCutsceneAudioCommand, createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneAudioReturnSnapshot, CutsceneDocument, CutsceneRetainedMusicSnapshot } from "@shared/cutscenes/types";
import type { CutsceneMusicState, CutsceneRunState } from "@shared/cutscenes/runApi";
import type { CutsceneRunRepository } from "../data/cutsceneRuns";
import { AudioAuthority } from "../sound/audioOwnership";
import { CutsceneAudioController, type ApplicationAudioPort, type CutsceneMusicPort } from "../sound/cutsceneAudio";
import type { CutsceneAudioRunner, CutsceneMusicRequest, CutsceneMusicState as RunnerState } from "../sound/cutsceneAudioRunner";
import type { CutsceneOutput } from "./ports";
import { CutscenePlaybackController } from "./controller";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function document(): CutsceneDocument {
  const base = createCutsceneDocument("Test cutscene");
  const command = (id: string) => ({ ...createCutsceneAudioCommand(id, { kind: "audio" as const, id: `audio-${id}` }),
    transition: { mode: "crossfade" as const, fadeInMs: 0, fadeOutMs: 0 } });
  return { ...base, settings: { ...base.settings, finish: { ...base.settings.finish,
    imageTransition: { kind: "cut", durationMs: 0 }, audioTransition: { mode: "crossfade", fadeInMs: 0, fadeOutMs: 0 } } },
  steps: [
    { ...createCutsceneStep("first"), audio: { action: "replace", command: command("a") }, text: { action: "replace", text: "First text" }, notes: "First notes" },
    { ...createCutsceneStep("second"), notes: "Only the notes change" },
    { ...createCutsceneStep("third"), audio: { action: "replace", command: command("b") }, text: { action: "replace", text: "Third text" } },
  ] };
}
function fixture(doc = document(), wasOpen = false) {
  const gate = new AudioAuthority(), listeners = new Set<() => void>();
  let saved: CutsceneRunState | null = null, current: CutsceneRetainedMusicSnapshot | null = null;
  let runnerState: RunnerState = { state: "stopped", commandId: null, preparing: false, error: null };
  const emit = () => listeners.forEach(listener => listener());
  const music: Pick<CutsceneAudioRunner, "prepare" | "clear" | "stop" | "capture" | "getSnapshot" | "subscribe"> & CutsceneMusicPort = {
    prepare: vi.fn(async (_owner: unknown, request: CutsceneMusicRequest, _signal?: AbortSignal) => ({
      commit: vi.fn(async () => {
        if (current?.command.id !== request.command.id) current = { kind: "cutscene", cutsceneId: request.cutsceneId,
          runId: request.runId, command: request.command, positionSeconds: request.command.startSeconds, state: "playing", volume: request.command.volume };
        runnerState = { ...runnerState, state: current!.state, commandId: request.command.id }; emit();
      }), dispose: vi.fn(),
    })),
    capture: vi.fn(() => current ? structuredClone(current) : null),
    suspend: vi.fn(async () => music.pause()),
    pause: vi.fn(() => { if (current) current = { ...current, state: "paused" }; runnerState = { ...runnerState, state: current ? "paused" : "stopped" }; emit(); }),
    resume: vi.fn(async () => { if (current) current = { ...current, state: "playing" }; runnerState = { ...runnerState, state: current ? "playing" : "stopped" }; emit(); }),
    clear: vi.fn(() => music.stop()),
    stop: vi.fn(() => { current = null; runnerState = { ...runnerState, state: "stopped", commandId: null, error: null }; emit(); }),
    restore: vi.fn(async (value: CutsceneRetainedMusicSnapshot) => { current = structuredClone(value); runnerState = { ...runnerState, state: value.state, commandId: value.command.id }; emit(); }),
    getSnapshot: () => runnerState,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } satisfies Pick<CutsceneAudioRunner, "prepare" | "clear" | "stop" | "capture" | "getSnapshot" | "subscribe"> & CutsceneMusicPort;
  const snapshot: CutsceneAudioReturnSnapshot = { scope: "all", background: { kind: "queue", queue: [], index: null,
    positionSeconds: 0, state: "stopped", volume: .6, repeat: "track", shuffle: true, activePlaylistId: null },
    ambient: { source: null, positionSeconds: 0, state: "stopped" }, weather: { source: null, positionSeconds: 0, state: "stopped" },
    setId: null, duckingId: null, silence: false, volumes: { master: .8, background: .6, ambient: .4, weather: .3, stinger: .5 } };
  const application: ApplicationAudioPort = { capture: vi.fn(() => structuredClone(snapshot)), suspend: vi.fn(async () => {}),
    restore: vi.fn(async (_owner, _snapshot, _resolve, commit) => { commit(); }) };
  const audio = new CutsceneAudioController(application, gate); audio.registerMusic(music);
  let musicState: CutsceneMusicState = { runId: null, audio: null, revision: 0 };
  const repository: CutsceneRunRepository = {
    original: vi.fn(async () => ({ id: 17, savedVersion: "saved-1", document: structuredClone(doc), createdAt: "now", updatedAt: "now", archivedAt: null })),
    check: vi.fn(async () => ({ checks: [], readiness: { ready: true as const, document: doc } })),
    active: vi.fn(async () => saved?.endedAt ? null : saved),
    music: vi.fn(async () => musicState),
    read: vi.fn(async () => structuredClone(saved!)),
    start: vi.fn(async input => {
      saved = { snapshot: { runId: "server-run", mode: input.mode, context: input.context,
        version: { cutsceneId: input.cutsceneId, savedVersion: "saved-1", document: structuredClone(doc) },
        returnState: { ...input.returnState, presentation: null },
        ownership: { runId: "server-run", controllerId: input.controllerId, audioScope: input.returnState.audio.scope, display: input.mode === "live" } },
        checkpoint: { runId: "server-run", stepId: null, pendingStepId: null, phase: "ready", textPaused: false, error: null },
        revision: 1, createdAt: "now", updatedAt: "now", endedAt: null }; return structuredClone(saved);
    }),
    update: vi.fn(async (_id, input) => {
      saved = { ...saved!, checkpoint: input.checkpoint, revision: saved!.revision + 1 }; return structuredClone(saved);
    }),
    recover: vi.fn(async (_id, input) => {
      saved = { ...saved!, revision: saved!.revision + 1,
        snapshot: { ...saved!.snapshot, ownership: { ...saved!.snapshot.ownership, controllerId: input.controllerId } },
        checkpoint: { ...saved!.checkpoint, phase: "paused", pendingStepId: null, error: null } }; return structuredClone(saved);
    }),
    finish: vi.fn(async (_id, input) => {
      const restoring = input.kind === "interrupt" || saved!.snapshot.mode === "rehearsal";
      const imageResult = restoring ? "restore" : saved!.snapshot.version.document.settings.finish.image;
      const audioResult = restoring ? "restore" : saved!.snapshot.version.document.settings.finish.audio;
      saved = { ...saved!, revision: saved!.revision + 1, endedAt: "ended",
        checkpoint: { ...saved!.checkpoint, phase: input.kind === "interrupt" ? "interrupted" : "completed", pendingStepId: null, error: null } };
      musicState = { runId: audioResult === "keep" ? saved.snapshot.runId : null, revision: musicState.revision + 1,
        audio: audioResult === "keep" && input.music ? { scope: "music", background: input.music } : null };
      return { run: structuredClone(saved), display: null, music: musicState, imageResult, audioResult,
        closeWindow: saved.snapshot.mode === "live" && imageResult === "restore" && saved.snapshot.returnState.presentation === null && !wasOpen };
    }),
    releaseMusic: vi.fn(async () => { musicState = { runId: null, audio: null, revision: musicState.revision + 1 }; return musicState; }),
  };
  const output: CutsceneOutput = { open: vi.fn(async () => ({ ok: true as const, wasOpen, openedByCall: !wasOpen, windowId: "window-08", screenId: null })),
    close: vi.fn(async () => true), prepare: vi.fn(async () => vi.fn()), subscribeErrors: () => () => {} };
  let id = 0;
  const controller = new CutscenePlaybackController({ repository, audio, music, output, newId: () => `controller-${++id}` });
  cleanups.push(controller.connect());
  const start = async () => { await controller.select(17); return controller.start(); };
  return { controller, repository, audio, application, music, output, gate, start,
    failMusic: () => { runnerState = { ...runnerState, error: "device lost", state: "paused" }; emit(); },
    setPosition: (seconds: number) => { if (current) current = { ...current, positionSeconds: seconds }; },
  };
}

it("архивная версия проходит общую готовность, контекст проверяет сервер при начале", async () => {
  const { controller, repository } = fixture();
  vi.mocked(repository.original).mockResolvedValue({ id: 17, savedVersion: "archived", document: document(), createdAt: "now", updatedAt: "now", archivedAt: "now" });
  expect(await controller.select(17)).toBe(true); expect(controller.getSnapshot().issues).toEqual([]);
});

describe("cutscene playback lifecycle", () => {
  it("готовность не захватывает звук и не открывает/не меняет экран", async () => {
    const f = fixture(); await f.controller.select(17);
    expect(f.gate.getSnapshot()).toBeNull(); expect(f.output.open).not.toHaveBeenCalled();
    expect(f.repository.start).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().narration.paused).toBe(true);
  });
  it("отказ popup оставляет готовность без запуска музыки", async () => {
    const f = fixture(); vi.mocked(f.output.open).mockResolvedValue({ ok: false, reason: "blocked" });
    expect(await f.start()).toBe(false); expect(f.controller.getSnapshot().phase).toBe("ready");
    expect(f.music.prepare).not.toHaveBeenCalled(); expect(f.repository.start).not.toHaveBeenCalled();
  });
  it("не запускает пустой/невалидный материал", async () => {
    const f = fixture(); vi.mocked(f.repository.check).mockResolvedValue({ checks: [], readiness: { ready: false,
      issues: [{ code: "readiness.empty", path: "steps", message: "empty", stepId: null }] } });
    expect(await f.start()).toBe(false); expect(f.output.open).not.toHaveBeenCalled(); expect(f.gate.getSnapshot()).toBeNull();
  });
  it("первый шаг использует зафиксированную сервером версию и связанного владельца", async () => {
    const f = fixture(); expect(await f.start()).toBe(true);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: "playing", step: { stepId: "first" }, notes: "First notes" });
    expect(f.gate.getSnapshot()?.owner.runId).toBe("server-run");
    expect(f.controller.getSnapshot().run?.snapshot.returnState.window.windowId).toBe("window-08");
  });
  it("удерживает прежний шаг до готовности обоих каналов и не копит нажатия", async () => {
    const f = fixture(); await f.start(); const pending = deferred<() => void>();
    vi.mocked(f.output.prepare).mockReturnValueOnce(pending.promise);
    const moving = f.controller.next(); await Promise.resolve();
    expect(await f.controller.next()).toBe(false); expect(f.controller.getSnapshot().step?.stepId).toBe("first");
    pending.resolve(() => {}); expect(await moving).toBe(true); expect(f.controller.getSnapshot().step?.stepId).toBe("second");
  });
  it("поздняя загрузка после паузы не запускает пропущенный кадр/трек", async () => {
    const f = fixture(); await f.start(); const pending = deferred<() => void>(), entered = deferred<void>();
    vi.mocked(f.output.prepare).mockImplementationOnce(() => { entered.resolve(); return pending.promise; }); const moving = f.controller.goTo("third");
    await entered.promise; await f.controller.pause(); pending.resolve(() => {}); await moving;
    expect(f.controller.getSnapshot()).toMatchObject({ phase: "paused", step: { stepId: "first" } });
    expect(f.music.capture()?.command.id).toBe("a");
  });
  it("на общей паузе переходы запрещены, локальная пауза текста сохраняется", async () => {
    const f = fixture(); await f.start(); await f.controller.setTextPaused(true); await f.controller.pause();
    expect(await f.controller.next()).toBe(false); expect(await f.controller.goTo("third")).toBe(false);
    await f.controller.resume(); expect(f.controller.getSnapshot().narration).toMatchObject({ locallyPaused: true, paused: true });
    expect(f.music.getSnapshot().state).toBe("playing");
  });
  it("наследование сохраняет текст/паузу/позицию музыки, заметки принадлежат выбранному шагу", async () => {
    const f = fixture(); await f.start(); f.setPosition(9); await f.controller.setTextPaused(true);
    const generation = f.controller.getSnapshot().narration.generation; await f.controller.next();
    expect(f.music.capture()?.positionSeconds).toBe(9);
    expect(f.controller.getSnapshot()).toMatchObject({ notes: "Only the notes change",
      narration: { generation, locallyPaused: true, sourceStepId: "first" } });
  });
  it("прямой переход и возврат к другому тексту начинают его заново", async () => {
    const f = fixture(); await f.start(); const generation = f.controller.getSnapshot().narration.generation;
    await f.controller.goTo("third"); await f.controller.setTextPaused(true); await f.controller.goTo("second");
    expect(f.controller.getSnapshot().narration).toMatchObject({ text: "First text", generation: generation + 2, locallyPaused: false });
    expect(f.music.capture()?.command.id).toBe("a"); expect(f.music.capture()?.positionSeconds).toBe(0);
  });
  it("последний шаг и остановившийся трек не завершают катсцену", async () => {
    const f = fixture(); await f.start(); await f.controller.goTo("third"); f.music.stop();
    expect(await f.controller.next()).toBe(false); expect(f.repository.finish).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().phase).toBe("playing");
  });
  it("ошибка подготовки удерживает успешный шаг; повтор продолжает ту же музыку", async () => {
    const f = fixture(); await f.start(); f.setPosition(7);
    vi.mocked(f.output.prepare).mockRejectedValueOnce(Error("missing image")); expect(await f.controller.next()).toBe(false);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: "error", step: { stepId: "first" }, narration: { paused: true } });
    expect(await f.controller.retry()).toBe(true); expect(f.music.capture()?.positionSeconds).toBe(7);
    expect(f.music.getSnapshot().state).toBe("playing");
  });
  it("неожиданная ошибка runner ставит общий показ на паузу", async () => {
    const f = fixture(); await f.start(); f.failMusic();
    await vi.waitFor(() => expect(f.controller.getSnapshot().phase).toBe("error"));
    expect(f.controller.getSnapshot().step?.stepId).toBe("first"); expect(f.controller.getSnapshot().narration.paused).toBe(true);
  });
  it("обнаружение после reload не забирает управление; recovery сохраняет шаг на паузе без нового capture", async () => {
    const f = fixture(); await f.start(); await f.controller.next();
    const next = new CutscenePlaybackController({ repository: f.repository, audio: f.audio, music: f.music, output: f.output, newId: () => "reload-host" });
    cleanups.push(next.connect()); expect(await next.discover()).toBe(true); expect(next.getSnapshot().phase).toBe("recoverable");
    const captures = vi.mocked(f.application.capture).mock.calls.length;
    expect(await next.recover()).toBe(true); expect(next.getSnapshot()).toMatchObject({ phase: "paused", step: { stepId: "second" } });
    expect(f.controller.getSnapshot().phase).toBe("lost"); expect(f.music.getSnapshot().state).toBe("stopped");
    expect(vi.mocked(f.application.capture).mock.calls.length).toBe(captures);
    await next.resume(); expect(f.music.capture()?.positionSeconds).toBe(0); expect(next.getSnapshot().phase).toBe("playing");
  });
  it.each(["restore", "keep", "black"] as const)("все результаты звука для изображения %s", async image => {
    for (const sound of ["restore", "keep", "silence"] as const) {
      const base = document(), doc = { ...base, settings: { ...base.settings, finish: { ...base.settings.finish, image, audio: sound } } };
      const f = fixture(doc); await f.start(); expect(await f.controller.complete()).toBe(true);
      expect(f.controller.getSnapshot().phase).toBe("completed"); expect(f.gate.getSnapshot()).toBeNull();
      expect(vi.mocked(f.output.close).mock.calls.length).toBe(image === "restore" ? 1 : 0);
      expect(vi.mocked(f.application.restore).mock.calls.length).toBe(sound === "restore" ? 1 : 0);
      expect(f.music.capture()?.state === "playing").toBe(sound === "keep");
    }
  });
  it("прерывание всегда возвращает звук мгновенно и сохраняет старое окно", async () => {
    const base = document(), f = fixture({ ...base, settings: { ...base.settings, finish: { ...base.settings.finish, image: "black", audio: "silence" } } }, true);
    await f.start(); await f.controller.interrupt(); expect(f.application.restore).toHaveBeenCalled();
    expect(f.output.close).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().phase).toBe("interrupted");
  });
  it("репетиция проходит ту же последовательность без окна и всегда возвращает звук", async () => {
    const f = fixture(); await f.controller.select(17); await f.controller.start({ mode: "rehearsal" });
    await f.controller.goTo("third"); await f.controller.complete();
    expect(f.output.open).not.toHaveBeenCalled(); expect(f.output.close).not.toHaveBeenCalled(); expect(f.application.restore).toHaveBeenCalled();
  });
  it("ошибку возврата после серверного завершения можно повторить без второго finish", async () => {
    const f = fixture(); await f.start(); vi.mocked(f.application.restore).mockRejectedValueOnce(Error("restore unavailable"));
    expect(await f.controller.complete()).toBe(false); expect(f.gate.getSnapshot()).not.toBeNull();
    expect(await f.controller.retry()).toBe(true); expect(f.repository.finish).toHaveBeenCalledTimes(1); expect(f.gate.getSnapshot()).toBeNull();
  });
  it("смена локального владельца отменяет старую загрузку и останавливает только старый host", async () => {
    const f = fixture(); await f.start(); const pending = deferred<() => void>(), entered = deferred<void>();
    vi.mocked(f.output.prepare).mockImplementationOnce(() => { entered.resolve(); return pending.promise; });
    const moving = f.controller.next(); await entered.promise; f.gate.transfer(f.gate.getSnapshot()!.owner, { runId: "server-run", controllerId: "other" });
    pending.resolve(() => {}); await moving; expect(f.controller.getSnapshot().phase).toBe("lost");
    expect(f.music.getSnapshot().state).toBe("stopped"); expect(f.repository.finish).not.toHaveBeenCalled();
  });
  it("пауза во время подтверждения кадра синхронизирует UI с уже сохранённым шагом", async () => {
    const f = fixture(); await f.start(); const committed = deferred<void>(), ack = deferred<void>();
    const update = vi.mocked(f.repository.update).getMockImplementation()!;
    vi.mocked(f.repository.update).mockImplementation(async (id, input) => {
      const result = await update(id, input);
      if (input.checkpoint.phase === "playing" && input.checkpoint.stepId === "second") { committed.resolve(); await ack.promise; }
      return result;
    });
    const moving = f.controller.next(); await committed.promise;
    const pausing = f.controller.pause(); ack.resolve(); await Promise.all([moving, pausing]);
    expect(f.controller.getSnapshot()).toMatchObject({ phase: "paused", step: { stepId: "second" }, notes: "Only the notes change" });
  });
  it("потерянный ответ finish повторяет ту же операцию и освобождает владение после результата", async () => {
    const f = fixture(); await f.start(); const finish = vi.mocked(f.repository.finish).getMockImplementation()!;
    let result: Awaited<ReturnType<typeof finish>>;
    vi.mocked(f.repository.finish).mockImplementationOnce(async (id, input) => { result = await finish(id, input); throw new TypeError("lost response"); })
      .mockImplementationOnce(async () => result);
    expect(await f.controller.complete()).toBe(false); expect(f.gate.getSnapshot()).not.toBeNull();
    expect(await f.controller.retry()).toBe(true); expect(f.gate.getSnapshot()).toBeNull();
    const calls = vi.mocked(f.repository.finish).mock.calls; expect(calls[1]).toEqual(calls[0]);
  });
  it.each([undefined, 500])("завершение без серверного commit повторяется с актуальной ревизией: status=%s", async status => {
    const f = fixture(); await f.start();
    const unavailable = Object.assign(new Error("unavailable before commit"), { status });
    vi.mocked(f.repository.finish).mockRejectedValueOnce(unavailable);
    expect(await f.controller.complete()).toBe(false);
    expect(await f.controller.retry()).toBe(true);
    expect(f.controller.getSnapshot().phase).toBe("completed"); expect(f.gate.getSnapshot()).toBeNull();
    const calls = vi.mocked(f.repository.finish).mock.calls;
    expect(calls[1][1].kind).toBe("complete"); expect(calls[1][1].revision).toBeGreaterThan(calls[0][1].revision);
  });

  it("ручная прокрутка во время подготовки паузит только унаследованный текст", async () => {
    const f = fixture(); await f.start(); const pending = deferred<() => void>(), entered = deferred<void>();
    vi.mocked(f.output.prepare).mockImplementationOnce(() => { entered.resolve(); return pending.promise; });
    const moving = f.controller.next(); await entered.promise;
    expect(await f.controller.setTextPaused(true)).toBe(true); expect(f.music.getSnapshot().state).toBe("playing");
    pending.resolve(() => {}); await moving;
    expect(f.controller.getSnapshot()).toMatchObject({ step: { stepId: "second" }, narration: { locallyPaused: true, paused: true } });
  });
  it("поздняя пауза прежнего текста не приостанавливает новый текст уже подтверждаемого шага", async () => {
    const f = fixture(); await f.start(); const committed = deferred<void>(), ack = deferred<void>();
    const update = vi.mocked(f.repository.update).getMockImplementation()!;
    vi.mocked(f.repository.update).mockImplementation(async (id, input) => {
      const result = await update(id, input);
      if (input.checkpoint.phase === "playing" && input.checkpoint.stepId === "third") { committed.resolve(); await ack.promise; }
      return result;
    });
    const moving = f.controller.goTo("third"); await committed.promise;
    const pausing = f.controller.setTextPaused(true); ack.resolve(); await Promise.all([moving, pausing]);
    expect(f.controller.getSnapshot()).toMatchObject({ step: { stepId: "third" }, narration: { locallyPaused: false, paused: false } });
    expect((await f.repository.read("server-run")).checkpoint.textPaused).toBe(false);
  });

  it("закрытие готовности ничего не захватывает и убирает выбранный оригинал", async () => {
    const f=fixture(); await f.controller.select(17); expect(f.controller.dismiss()).toBe(true);
    expect(f.controller.getSnapshot()).toMatchObject({phase:"idle",original:null}); expect(f.output.close).not.toHaveBeenCalled();
  });
  it("не закрывает готовность во время запуска и не сбрасывает активный прогон", async () => {
    const f=fixture(); await f.start(); expect(f.controller.dismiss()).toBe(false); expect(f.controller.getSnapshot().phase).toBe("playing");
  });
  it("не оставляет старый оригинал после ошибки выбора другого", async () => {
    const f=fixture(); await f.controller.select(17); vi.mocked(f.repository.original).mockRejectedValueOnce(Error("offline"));
    await f.controller.select(18); expect(f.controller.getSnapshot().original).toBeNull(); expect(await f.controller.start()).toBe(false);
  });
  it("позднее обнаружение запуска не вытесняет новую готовность", async () => {
    const f=fixture(),pending=deferred<CutsceneRunState|null>(); vi.mocked(f.repository.active).mockReturnValueOnce(pending.promise);
    const discovery=f.controller.discover(); await f.controller.select(17); pending.resolve(null); await discovery;
    expect(f.controller.getSnapshot()).toMatchObject({phase:"ready",original:{id:17}});
  });
  it("репетиция восстанавливает весь звук и его исходную паузу, даже при настройке только музыки", async () => {
    const doc=document(),f=fixture({...doc,settings:{...doc.settings,audioScope:"music"}});
    const capture=vi.mocked(f.application.capture).getMockImplementation()!;
    vi.mocked(f.application.capture).mockImplementation(scope=>{const snapshot=capture(scope);return {...snapshot,background:{...snapshot.background,state:"paused"}};});
    await f.controller.select(17); await f.controller.start({mode:"rehearsal"}); expect(f.application.capture).toHaveBeenCalledWith("all");
    await f.controller.pause(); expect(await f.controller.next()).toBe(false); await f.controller.resume(); await f.controller.next();
    await f.controller.complete(); expect(f.application.restore).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({scope:"all",background:expect.objectContaining({state:"paused"})}),expect.anything(),expect.anything(),0);
    expect(f.output.open).not.toHaveBeenCalled(); expect(f.output.close).not.toHaveBeenCalled();
  });
  it("восстановление репетиции готовит сохранённый кадр без открытия окна и старта музыки", async () => {
    const f=fixture(); await f.controller.select(17); await f.controller.start({mode:"rehearsal"}); await f.controller.next();
    const next=new CutscenePlaybackController({repository:f.repository,audio:f.audio,music:f.music,output:f.output,newId:()=>"rehearsal-reload"});
    cleanups.push(next.connect()); await next.discover(); vi.mocked(f.output.prepare).mockClear(); await next.recover();
    expect(f.output.prepare).toHaveBeenCalledTimes(1); expect(next.getSnapshot()).toMatchObject({phase:"paused",step:{stepId:"second"}});
    expect(f.music.capture()).toBeNull(); expect(f.output.open).not.toHaveBeenCalled(); await next.interrupt();
  });
  it("исчезновение активного запуска снимает предложение восстановления в другом окне", async () => {
    const f=fixture(); await f.start();
    const observer=new CutscenePlaybackController({repository:f.repository,audio:f.audio,music:f.music,output:f.output});
    await observer.discover();expect(observer.getSnapshot().phase).toBe("recoverable");await f.controller.complete();
    await observer.discover();expect(observer.getSnapshot()).toMatchObject({phase:"idle",run:null});
  });
});
