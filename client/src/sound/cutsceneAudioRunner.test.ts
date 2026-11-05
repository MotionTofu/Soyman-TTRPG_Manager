// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createCutsceneAudioCommand } from "@shared/cutscenes/defaults";
import type { CutsceneAudioCommand } from "@shared/cutscenes/types";
import { AudioAuthority } from "./audioOwnership";
import { CutsceneAudioRunner, type CutsceneMusicRequest } from "./cutsceneAudioRunner";
import type { CutsceneAudioAsset, PrepareCutsceneAudioAsset } from "./cutsceneAudioMedia";

const owner = { runId: "06-run", controllerId: "06-window" };
let gate: AudioAuthority, runner: CutsceneAudioRunner, assets: CutsceneAudioAsset[], paused: WeakMap<HTMLMediaElement, boolean>;
let prepare: Mock<PrepareCutsceneAudioAsset>;
function command(id: string, patch: Partial<CutsceneAudioCommand> = {}): CutsceneAudioCommand {
  return { ...createCutsceneAudioCommand(id, { kind: "audio", id: "same-file" }), startSeconds: 2, endSeconds: 10,
    transition: { mode: "crossfade", fadeOutMs: 0, fadeInMs: 0 }, endFadeOutMs: 0, ...patch };
}
const request = (value: CutsceneAudioCommand): CutsceneMusicRequest => ({ cutsceneId: 6, runId: owner.runId, command: value });
function asset(start: number): CutsceneAudioAsset {
  const voices = [document.createElement("audio"), document.createElement("audio")] as const;
  for (const audio of voices) {
    Object.defineProperty(audio, "duration", { value: 12 });
    Object.defineProperty(audio, "readyState", { value: 4 });
    audio.currentTime = start; audio.volume = 0; document.body.append(audio);
  }
  const value = { duration: 12, voices, dispose: vi.fn(() => voices.forEach(audio => { audio.pause(); audio.remove(); })) };
  assets.push(value); return value;
}
async function start(value: CutsceneAudioCommand) { const prepared = await runner.prepare(owner, request(value)); await prepared.commit(); }
async function advance(seconds: number) {
  for (let elapsed = 0; elapsed < Math.round(seconds * 100); elapsed++) {
    for (const value of assets) for (const audio of value.voices) if (!audio.paused && audio.isConnected) {
      audio.currentTime += 0.01;
      if (audio.currentTime >= audio.duration) {
        if (audio.loop) audio.currentTime %= audio.duration;
        else { paused.set(audio, true); audio.dispatchEvent(new Event("ended")); }
      }
    }
    await vi.advanceTimersByTimeAsync(10);
  }
}
const playing = () => assets.flatMap(value => [...value.voices]).filter(audio => audio.isConnected && !audio.paused);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); assets = []; paused = new WeakMap();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function(this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, false); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) { paused.set(this, true); });
  gate = new AudioAuthority(); gate.claim(owner, "all");
  prepare = vi.fn(async (_id, _ref, position) => asset(position));
  runner = new CutsceneAudioRunner({ authority: gate, prepareAsset: prepare, now: () => Date.now() });
});
afterEach(() => { runner.stop(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

describe("фрагменты и переходы одного музыкального канала", () => {
  it("готовит новый файл без остановки прежнего и без начала нового звука", async () => {
    await start(command("first")); await advance(0.5); const first = playing()[0];
    const prepared = await runner.prepare(owner, request(command("second")));
    expect(first.paused).toBe(false); expect(assets[1].voices.every(audio => audio.paused)).toBe(true);
    await prepared.commit(); expect(first.paused).toBe(true); expect(runner.capture()?.command.id).toBe("second");
  });
  it("та же унаследованная команда сохраняет позицию, другая команда того же файла начинает сначала", async () => {
    const first = command("first"); await start(first); await advance(1);
    const position = runner.capture()!.positionSeconds; await start(first);
    expect(prepare).toHaveBeenCalledTimes(1); expect(runner.capture()!.positionSeconds).toBe(position);
    await start(command("second")); expect(runner.capture()!.positionSeconds).toBe(2);
  });
  it("перекрёстная смена одновременно гасит старый и поднимает новый с разными временами", async () => {
    await start(command("first", { volume: 0.8 })); const first = playing()[0];
    await start(command("second", { volume: 0.4, transition: { mode: "crossfade", fadeOutMs: 2000, fadeInMs: 1000 } }));
    const second = assets[1].voices[0]; await advance(0.5);
    expect(first.volume).toBeCloseTo(0.6, 1); expect(second.volume).toBeCloseTo(0.2, 1);
    await advance(1.6); expect(first.paused).toBe(true); expect(second.volume).toBe(0.4); expect(playing()).toHaveLength(1);
  });
  it("последовательная смена ждёт затухания старого, затем начинает фрагмент нового", async () => {
    await start(command("first")); const first = playing()[0];
    await start(command("second", { transition: { mode: "sequential", fadeOutMs: 1000, fadeInMs: 1000 } }));
    const second = assets[1].voices[0]; await advance(0.5);
    expect(first.volume).toBeCloseTo(0.5, 1); expect(second.paused).toBe(true); expect(second.currentTime).toBe(2);
    await advance(1); expect(first.paused).toBe(true); expect(second.paused).toBe(false); expect(second.volume).toBeCloseTo(0.5, 1);
  });
  it("прерывает текущую смесь от реальных громкостей и убирает все прежние голоса", async () => {
    await start(command("first", { volume: 0.8 }));
    await start(command("second", { volume: 0.4, transition: { mode: "crossfade", fadeOutMs: 2000, fadeInMs: 1000 } }));
    await advance(0.5); const old = playing().map(audio => ({ audio, gain: audio.volume }));
    await start(command("third", { transition: { mode: "crossfade", fadeOutMs: 1000, fadeInMs: 0 } }));
    await advance(0.5); for (const item of old) expect(item.audio.volume).toBeCloseTo(item.gain / 2, 1);
    await advance(0.6); expect(old.every(item => item.audio.paused)).toBe(true); expect(playing()).toHaveLength(1);
    expect(runner.capture()?.command.id).toBe("third");
  });
  it("пауза замораживает обе позиции и время склейки, resume продолжает оставшуюся часть", async () => {
    await start(command("first")); await start(command("second", { transition: { mode: "crossfade", fadeOutMs: 2000, fadeInMs: 2000 } }));
    await advance(0.5); runner.pause(); const frozen = assets.flatMap(value => [...value.voices]).map(audio => [audio.currentTime, audio.volume]);
    await advance(3); expect(assets.flatMap(value => [...value.voices]).map(audio => [audio.currentTime, audio.volume])).toEqual(frozen);
    await runner.resume(); await advance(0.5); expect(assets[1].voices[0].volume).toBeCloseTo(0.5, 1);
    await advance(1.1); expect(playing()).toHaveLength(1);
  });
  it("естественное затухание заканчивает фрагмент, сохраняет команду остановленной и не запускает следующий шаг", async () => {
    const value = command("last", { startSeconds: 8, endFadeOutMs: 1000 }); await start(value); await advance(1.5);
    expect(playing()[0].volume).toBeCloseTo(0.5, 1); await advance(0.6);
    expect(playing()).toHaveLength(0); expect(runner.capture()).toMatchObject({ state: "stopped", command: { id: "last" } });
    await start(value); expect(playing()).toHaveLength(0); expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("обычный повтор возвращается к началу фрагмента без fade, в том числе дольше срока URL", async () => {
    await start(command("loop", { endSeconds: 3, loop: { enabled: true, transition: { mode: "cut" } } }));
    await advance(65); expect(playing()).toHaveLength(1); expect(prepare).toHaveBeenCalledTimes(1);
    expect(runner.capture()!.positionSeconds).toBeGreaterThanOrEqual(2); expect(runner.capture()!.positionSeconds).toBeLessThan(3.03);
    expect(playing()[0].volume).toBe(1);
  });
  it("обычный повтор всего файла использует нативный loop без сетевого запроса на границе", async () => {
    await start(command("whole", { startSeconds: 0, endSeconds: null, loop: { enabled: true, transition: { mode: "cut" } } }));
    expect(playing()[0].loop).toBe(true); await advance(24.5);
    expect(playing()).toHaveLength(1); expect(playing()[0].currentTime).toBeCloseTo(0.5, 1); expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("склейка повтора перекрывает конец и начало двумя голосами одного файла", async () => {
    await start(command("loop", { endSeconds: 6, loop: { enabled: true, transition: { mode: "crossfade", durationMs: 1000 } } }));
    await advance(3.5); expect(playing()).toHaveLength(2);
    expect(playing().reduce((sum, audio) => sum + audio.volume, 0)).toBeCloseTo(1, 1);
    expect(runner.capture()!.positionSeconds).toBeCloseTo(2.5, 1);
    await advance(1); expect(playing()).toHaveLength(1); await advance(12); expect(playing().length).toBeLessThanOrEqual(2);
  });
  it("короткий фрагмент с длинной склейкой остаётся ограничен двумя голосами и своими границами", async () => {
    await start(command("short", { endSeconds: 2.2, loop: { enabled: true, transition: { mode: "crossfade", durationMs: 1000 } } }));
    await advance(2); expect(playing().length).toBeLessThanOrEqual(2); expect(playing().length).toBeGreaterThan(0);
    expect(runner.capture()!.positionSeconds).toBeGreaterThanOrEqual(2); expect(runner.capture()!.positionSeconds).toBeLessThanOrEqual(2.2);
    expect(assets).toHaveLength(1);
  });
  it("последовательный повтор затухает перед концом и нарастает после возврата к началу", async () => {
    await start(command("loop", { endSeconds: 4, loop: { enabled: true, transition: { mode: "sequential", fadeOutMs: 800, fadeInMs: 400 } } }));
    await advance(1.6); expect(playing()[0].volume).toBeCloseTo(0.5, 1);
    await advance(0.6); expect(playing()).toHaveLength(1);
    // The boundary and fade are polled every 15 ms; assert the middle of the ramp with that tolerance.
    expect(playing()[0].volume).toBeGreaterThan(0.35); expect(playing()[0].volume).toBeLessThan(0.65);
  });
  it.each(["crossfade", "sequential"] as const)("нулевые времена %s не создают задержек или оставшихся голосов", async mode => {
    await start(command("first")); await start(command("second", { transition: { mode, fadeOutMs: 0, fadeInMs: 0 } }));
    expect(playing()).toHaveLength(1); expect(playing()[0].currentTime).toBe(2); expect(playing()[0].volume).toBe(1);
    runner.clear(owner, 0); expect(playing()).toHaveLength(0); expect(runner.capture()).toBeNull();
  });
  it("новая команда отменяет ещё не начавшийся последовательный трек", async () => {
    await start(command("first")); await start(command("waiting", { transition: { mode: "sequential", fadeOutMs: 2000, fadeInMs: 0 } }));
    const waiting = assets[1]; await start(command("third")); await advance(3);
    expect(waiting.dispose).toHaveBeenCalledTimes(1); expect(playing()).toHaveLength(1); expect(runner.capture()?.command.id).toBe("third");
  });
  it("последовательная смена у конца фрагмента не добавляет тишину после его границы", async () => {
    await start(command("ending", { startSeconds: 8 })); await advance(1.5);
    await start(command("new", { transition: { mode: "sequential", fadeOutMs: 2000, fadeInMs: 0 } }));
    await advance(0.6); expect(assets[1].voices[0].paused).toBe(false); expect(assets[1].voices[0].currentTime).toBeLessThan(2.2);
    expect(assets[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("возврат паузы не вызывает даже короткого play и получает новый подготовленный источник", async () => {
    await start(command("previous")); await advance(1); runner.pause(); const saved = runner.capture()!; runner.stop();
    const before = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await runner.restore(saved); expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(before);
    expect(runner.capture()).toMatchObject({ positionSeconds: saved.positionSeconds, state: "paused" });
    expect(prepare).toHaveBeenCalledTimes(2); await runner.resume(); expect(playing()).toHaveLength(1);
  });
  it("подготовленный шаг восстановления начинает нарастание только после явного продолжения", async () => {
    const prepared = await runner.prepare(owner, request(command("recovery", { transition: { mode: "crossfade", fadeOutMs: 0, fadeInMs: 1000 } })));
    await prepared.commit({ paused: true }); await advance(3);
    expect(playing()).toHaveLength(0); expect(runner.capture()).toMatchObject({ positionSeconds: 2, state: "paused" });
    await runner.resume(); await advance(0.5); expect(playing()[0].volume).toBeCloseTo(0.5, 1);
  });
  it("поздний результат отменённой подготовки освобождается и не меняет текущую команду", async () => {
    let resolve!: (value: CutsceneAudioAsset) => void; prepare.mockImplementationOnce(() => new Promise<CutsceneAudioAsset>(done => { resolve = done; }));
    const pending = runner.prepare(owner, request(command("stale"))).catch(error => error);
    await start(command("current")); const stale = asset(2); resolve(stale);
    expect((await pending).name).toBe("AbortError"); expect(stale.dispose).toHaveBeenCalledTimes(1); expect(runner.capture()?.command.id).toBe("current");
  });
  it("готовая команда теряет право запуска после передачи владельца", async () => {
    const prepared = await runner.prepare(owner, request(command("stale"))); gate.transfer(owner, { ...owner, controllerId: "other" });
    await expect(prepared.commit()).rejects.toThrow("другому запуску"); prepared.dispose(); expect(playing()).toHaveLength(0);
  });
  it("поздний play старого оборота не останавливает повторно использованный audio-элемент", async () => {
    let resolve!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function(this: HTMLMediaElement) {
      paused.set(this, false); return new Promise<void>(done => { resolve = done; });
    });
    const pending = start(command("loop", { startSeconds: 0, endSeconds: 4, loop: { enabled: true, transition: { mode: "crossfade", durationMs: 1000 } } }));
    await vi.advanceTimersByTimeAsync(0); await advance(7.5); const reused = assets[0].voices[0];
    expect(reused.paused).toBe(false); resolve(); await pending; expect(reused.paused).toBe(false);
  });
  it("ошибка play ставит канал на паузу, а stop удаляет голоса и таймеры", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("autoplay"));
    await expect(start(command("error"))).rejects.toThrow("autoplay");
    expect(runner.getSnapshot()).toMatchObject({ state: "paused", error: "autoplay" }); runner.stop();
    expect(vi.getTimerCount()).toBe(0); expect(document.querySelectorAll("audio")).toHaveLength(0);
  });
  it("ошибка первого play после восстановления на паузе отклоняет resume и оставляет ошибку канала", async () => {
    const prepared = await runner.prepare(owner, request(command("paused"))); await prepared.commit({ paused: true });
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("resume blocked"));
    await expect(runner.resume()).rejects.toThrow("resume blocked");
    expect(runner.getSnapshot()).toMatchObject({ state: "paused", error: "resume blocked" });
  });
});

describe("обновление доступа к длинному потоку", () => {
  it("обновляет истёкший источник с текущей позиции и продолжает воспроизведение", async () => {
    await start(command("stream")); await advance(1);
    const audio = assets[0].voices[0], position = audio.currentTime;
    const refresh = vi.fn(async (voice: HTMLAudioElement, at: number) => { voice.currentTime = at; return true; });
    assets[0].refresh = refresh;
    audio.dispatchEvent(new Event("error")); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledWith(audio, position, expect.any(AbortSignal));
    expect(audio.paused).toBe(false); expect(audio.currentTime).toBe(position); expect(runner.getSnapshot().error).toBeNull();
  });
  it("пауза во время обновления не запускает голос после получения ссылки", async () => {
    await start(command("stream")); const audio = assets[0].voices[0];
    let resolve!: (value: boolean) => void;
    assets[0].refresh = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    audio.dispatchEvent(new Event("error")); runner.pause(); resolve(true); await vi.advanceTimersByTimeAsync(0);
    expect(audio.paused).toBe(true); expect(runner.capture()?.state).toBe("paused");
  });
  it("stop отменяет обновление и не даёт позднему ответу оживить старый голос", async () => {
    await start(command("stream")); const audio = assets[0].voices[0];
    let resolve!: (value: boolean) => void, signal!: AbortSignal;
    assets[0].refresh = vi.fn((_voice, _at, pending) => { signal = pending; return new Promise<boolean>(done => { resolve = done; }); });
    audio.dispatchEvent(new Event("error")); runner.stop(); expect(signal.aborted).toBe(true);
    resolve(true); await vi.advanceTimersByTimeAsync(0); expect(playing()).toHaveLength(0); expect(runner.capture()).toBeNull();
  });
  it("ошибка свежего источника остаётся ошибкой, а не бесконечным переподключением", async () => {
    await start(command("stream")); const audio = assets[0].voices[0];
    assets[0].refresh = vi.fn(async () => false); audio.dispatchEvent(new Event("error")); await vi.advanceTimersByTimeAsync(0);
    expect(runner.getSnapshot()).toMatchObject({ state: "paused", error: "Ошибка воспроизведения аудио катсцены" });
    expect(assets[0].refresh).toHaveBeenCalledTimes(1);
  });
});
