import { randomUUID } from "../utils/uuid";
import { CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import type { CutsceneLaunchContext, CutsceneResolvedStep, CutsceneRunCheckpoint,
  CutsceneRunError } from "@shared/cutscenes/types";
import type { CutsceneMusicState, CutsceneRunFinish, CutsceneRunFinishResult, CutsceneRunOwner, CutsceneRunStart, CutsceneRunState } from "@shared/cutscenes/runApi";
import type { PlayerDisplayOpenResult } from "@shared/playerDisplay";
import type { ScreenChoice } from "../components/presentation/screens";
import type { PreparedCutsceneMusic } from "../sound/cutsceneAudioRunner";
import { onOrdinaryBackgroundIntent } from "../sound/backgroundHandoff";
import type { CutscenePlaybackPorts, CutscenePlaybackState } from "./ports";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameOwner = (a: CutsceneRunOwner | null | undefined, b: CutsceneRunOwner | null | undefined) =>
  !!a && !!b && a.runId === b.runId && a.controllerId === b.controllerId;
const initial = (): CutscenePlaybackState => ({ phase: "idle", original: null, preview: null, run: null, step: null, busy: false,
  error: null, issues: [], notes: "", visualTransition: null,
  narration: { text: null, sourceStepId: null, generation: 0, paused: true, locallyPaused: false, wordsPerMinute: CUTSCENE_DEFAULTS.wordsPerMinute } });

/** Single lifecycle for real output and rehearsal. UI never folds steps or operates the music runner itself. */
export class CutscenePlaybackController {
  private readonly ports: CutscenePlaybackPorts;
  private readonly newId: () => string;
  private state = initial();
  private listeners = new Set<() => void>();
  private run: CutsceneRunState | null = null;
  private owner: CutsceneRunOwner | null = null;
  private sequence = 0;
  private preparation: AbortController | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private restartOnResume = false;
  private applicationSuspended = false;
  private globallyPaused = true;
  private pendingFinishRequest: { runId: string; input: CutsceneRunFinish } | null = null;
  private failedFinishKind: "complete" | "interrupt" | null = null;
  private pendingStart: { input: CutsceneRunStart; provisional: CutsceneRunOwner; opened: PlayerDisplayOpenResult | null } | null = null;
  private pendingFinish: CutsceneRunFinishResult | null = null;
  private retained: CutsceneMusicState | null = null;
  private releasing: Promise<unknown> | null = null;
  private retainedKnown = false;
  private detach: (() => void) | null = null;

  constructor(ports: CutscenePlaybackPorts) { this.ports = ports; this.newId = ports.newId ?? (() => randomUUID()); }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): CutscenePlaybackState => this.state;
  private publish(patch: Partial<CutscenePlaybackState>): void {
    this.state = { ...this.state, ...patch };
    const paused = this.globallyPaused;
    this.state = { ...this.state, narration: { ...this.state.narration, paused: paused || this.state.narration.locallyPaused } };
    this.listeners.forEach(listener => listener());
  }
  /** Host lifetime, not the lifetime of the full-screen controls. Cleanup preserves the server run and lease. */
  connect(): () => void {
    if (this.detach) return () => {};
    const { audio, music, output } = this.ports;
    const removals = [
      audio.authority.subscribe(() => {
        if (!this.owner || this.run?.endedAt || this.state.phase === "finishing" || sameOwner(audio.authority.getSnapshot()?.owner, this.owner)) return;
        this.cancel(); this.owner = null; this.globallyPaused = true; music.stop();
        this.publish({ phase: "lost", busy: false, error: this.error("storage", "Управление передано другому окну", this.state.step?.stepId ?? null) });
      }),
      music.subscribe(() => {
        const current = music.getSnapshot();
        if (current.error && this.owner && (this.state.phase === "playing" || this.state.phase === "preparing")) {
          void this.fail(this.error("audio", current.error, this.run?.checkpoint.pendingStepId ?? this.state.step?.stepId ?? null));
        }
        if ((!this.run || this.run.endedAt) && !this.state.busy && current.state === "stopped") void this.releaseRetained();
      }),
      output.subscribeErrors((windowId, reason) => {
        if (this.owner && this.run?.snapshot.mode === "live" && this.run.snapshot.returnState.window.windowId === windowId &&
          (this.state.phase === "playing" || this.state.phase === "preparing")) {
          void this.fail(this.error("display", reason, this.run.checkpoint.pendingStepId ?? this.state.step?.stepId ?? null));
        }
      }),
      onOrdinaryBackgroundIntent(() => { if (!this.run || this.run.endedAt) void this.releaseRetained(true); }),
    ];
    const detach = () => { removals.forEach(remove => remove()); this.cancel(); this.detach = null; };
    this.detach = detach; return detach;
  }
  private cancel(): number { this.preparation?.abort(); this.preparation = null; return ++this.sequence; }
  private serial<T>(apply: () => Promise<T>): Promise<T> {
    const next = this.writes.then(apply, apply); this.writes = next.catch(() => {}); return next;
  }
  private error(code: CutsceneRunError["code"], reason: unknown, stepId: string | null): CutsceneRunError {
    return { code, message: message(reason), stepId, media: null };
  }
  private assertOwner(): CutsceneRunState {
    if (!this.run || this.run.endedAt || !this.owner || !sameOwner(this.run.snapshot.ownership, this.owner)) throw new Error("Нет управления активной катсценой");
    this.ports.audio.authority.assert(this.owner); return this.run;
  }
  private async save(patch: Partial<CutsceneRunCheckpoint> | ((run: CutsceneRunState) => Partial<CutsceneRunCheckpoint> | null)): Promise<CutsceneRunState> {
    return this.serial(async () => {
      const run = this.assertOwner(), owner = this.owner!;
      const changes = typeof patch === "function" ? patch(run) : patch;
      if (!changes) return run;
      const checkpoint = { ...run.checkpoint, ...changes };
      try { this.run = await this.ports.repository.update(run.snapshot.runId, { owner, revision: run.revision, checkpoint }); }
      catch (error) {
        // A response may be lost after SQLite committed. Never replay an older revision blindly.
        const actual = await this.ports.repository.read(run.snapshot.runId).catch(() => null);
        if (actual && sameOwner(actual.snapshot.ownership, owner) && !actual.endedAt &&
          JSON.stringify(actual.checkpoint) === JSON.stringify(checkpoint)) this.run = actual;
        else {
          if (actual && (!sameOwner(actual.snapshot.ownership, owner) || actual.endedAt)) this.lose();
          throw error;
        }
      }
      return this.run!;
    });
  }
  private lose(): void {
    this.cancel(); this.owner = null; this.globallyPaused = true; this.ports.music.stop();
    this.publish({ phase: "lost", busy: false, error: this.error("storage", "Этот запуск уже изменён другим окном", this.state.step?.stepId ?? null) });
  }

  /** Closing readiness releases no runtime resources: none have been captured yet. */
  dismiss(): boolean {
    if (this.owner || this.pendingStart || this.state.busy || this.state.phase === "recoverable") return false;
    this.cancel(); this.globallyPaused = true; this.publish(initial()); return true;
  }

  async select(cutsceneId: number): Promise<boolean> {
    if (this.owner || this.pendingStart || this.state.busy) return false;
    const token = this.cancel(); this.publish({ phase: "ready", original: null, preview: null, run: null, step: null, busy: true, error: null, issues: [] });
    try {
      const original = await this.ports.repository.original(cutsceneId), checked = await this.ports.repository.check(cutsceneId);
      if (token !== this.sequence) return false;
      this.run = null; this.pendingFinish = null; this.pendingFinishRequest = null; this.failedFinishKind = null; this.globallyPaused = true;
      this.publish({ phase: "ready", original, run: null, step: null, busy: false, notes: "",
        preview: original.document.steps[0] ? resolveCutsceneStep(original.document, original.document.steps[0].id) : null,
        issues: checked.readiness.ready ? [] : checked.readiness.issues,
        narration: { ...initial().narration, generation: this.state.narration.generation + 1, wordsPerMinute: original.document.settings.wordsPerMinute } });
      return checked.readiness.ready;
    } catch (error) {
      if (token === this.sequence) this.publish({ phase: "ready", busy: false, error: this.error("storage", error, null) });
      return false;
    }
  }
  /** Opening starts before the first await, preserving the browser's trusted button gesture. */
  async start(options: { mode?: "live" | "rehearsal"; context?: CutsceneLaunchContext; screen?: ScreenChoice | null } = {}): Promise<boolean> {
    if (!this.state.original || this.state.busy || this.owner || this.pendingStart || this.state.issues.length) return false;
    const id = this.state.original.id, mode = options.mode ?? "live", token = this.cancel();
    const opening = mode === "live" ? this.ports.output.open(options.screen ?? null) : Promise.resolve(null);
    this.publish({ phase: "starting", busy: true, error: null });
    let opened: PlayerDisplayOpenResult | null = null;
    try {
      opened = await opening;
      if (opened && !opened.ok) throw this.error("display", opened.reason, null);
      const [original, checked, active] = await Promise.all([this.ports.repository.original(id), this.ports.repository.check(id), this.ports.repository.active()]);
      if (token !== this.sequence) return false;
      if (active) throw this.error("storage", "Другой показ или репетиция уже запущены", null);
      if (!checked.readiness.ready) {
        this.publish({ issues: checked.readiness.issues }); throw this.error("media", "Катсцена не готова к запуску", null);
      }
      const provisional = { runId: this.newId(), controllerId: this.newId() };
      const audio = this.ports.audio.capture(provisional, mode === "rehearsal" ? "all" : original.document.settings.audioScope);
      const window = opened?.ok ? { wasOpen: opened.wasOpen, openedByRun: opened.openedByCall, screenId: opened.screenId, windowId: opened.windowId }
        : { wasOpen: false, openedByRun: false, screenId: null, windowId: null };
      this.pendingStart = { provisional, opened, input: { cutsceneId: id, controllerId: provisional.controllerId, mode,
        context: options.context ?? { kind: "library" }, returnState: { audio, window } } };
      return await this.submitStart();
    } catch (error) {
      if (!this.pendingStart && opened?.ok && opened.openedByCall) await this.ports.output.close(opened).catch(() => false);
      if (token === this.sequence) this.publish({ phase: this.pendingStart ? "error" : "ready", busy: false,
        error: this.asError(error, "storage", null) });
      return false;
    }
  }
  private asError(error: unknown, code: CutsceneRunError["code"], stepId: string | null): CutsceneRunError {
    return error && typeof error === "object" && "code" in error && "stepId" in error ? error as CutsceneRunError : this.error(code, error, stepId);
  }
  private async submitStart(): Promise<boolean> {
    const pending = this.pendingStart!;
    let run: CutsceneRunState;
    try { run = await this.ports.repository.start(pending.input); }
    catch (error) {
      const active = await this.ports.repository.active();
      if (active?.snapshot.ownership.controllerId === pending.input.controllerId) run = active;
      else if (active || (error as { status?: number }).status) {
        this.ports.audio.release(pending.provisional); this.pendingStart = null;
        if (pending.opened?.ok && pending.opened.openedByCall) await this.ports.output.close(pending.opened).catch(() => false);
        throw error;
      } else throw error; // Unknown outcome: retain the provisional gate until an explicit retry resolves it.
    }
    this.run = run; this.owner = { runId: run.snapshot.runId, controllerId: run.snapshot.ownership.controllerId };
    this.ports.audio.authority.transfer(pending.provisional, this.owner);
    this.pendingStart = null; this.pendingFinish = null; this.pendingFinishRequest = null; this.failedFinishKind = null;
    this.applicationSuspended = false; this.restartOnResume = false;
    this.publish({ run, phase: "ready", busy: false, original: { ...this.state.original!, document: run.snapshot.version.document },
      preview: resolveCutsceneStep(run.snapshot.version.document, run.snapshot.version.document.steps[0].id),
      narration: { ...this.state.narration, wordsPerMinute: run.snapshot.version.document.settings.wordsPerMinute } });
    return this.navigate(run.snapshot.version.document.steps[0].id, true);
  }

  next = (): Promise<boolean> => this.adjacent(1);
  previous = (): Promise<boolean> => this.adjacent(-1);
  private adjacent(delta: number): Promise<boolean> {
    const steps = this.run?.snapshot.version.document.steps, index = this.state.step?.stepIndex ?? -1;
    const next = steps?.[index + delta]; return next ? this.goTo(next.id) : Promise.resolve(false);
  }
  goTo = (stepId: string): Promise<boolean> => this.navigate(stepId);
  private async navigate(stepId: string, entry = false, retry = false): Promise<boolean> {
    if (!this.owner || this.state.busy || (!entry && !retry && this.state.phase !== "playing")) return false;
    const run = this.assertOwner(), target = resolveCutsceneStep(run.snapshot.version.document, stepId);
    if (!target || (!entry && !retry && this.state.step?.stepId === stepId)) return false;
    const token = this.cancel(), controller = new AbortController(); this.preparation = controller;
    const valid = () => token === this.sequence && !controller.signal.aborted && !!this.owner;
    let visual: (() => void) | null = null, music: PreparedCutsceneMusic | null = null;
    const textChanged = target.text.sourceStepId !== this.state.narration.sourceStepId;
    this.publish({ phase: "preparing", busy: true, error: null });
    let stage: CutsceneRunError["code"] = "storage";
    try {
      await this.save({ phase: "preparing", pendingStepId: stepId, error: null });
      if (!valid()) return false;
      stage = "preparation";
      await Promise.all([
        this.ports.output.prepare(this.run!, target, controller.signal).then(dispose => { visual = dispose; if (!valid()) dispose(); }),
        target.audio.command ? this.ports.music.prepare(this.owner!, { cutsceneId: run.snapshot.version.cutsceneId,
          runId: run.snapshot.runId, command: target.audio.command }, controller.signal).then(prepared => {
          music = prepared; if (!valid()) prepared.dispose();
        }) : Promise.resolve(),
      ]);
      if (!valid()) return false;
      stage = "audio";
      if (!this.applicationSuspended) {
        const fading = this.ports.audio.suspendApplication(this.owner!, target.audio.fadeOutMs);
        if (target.audio.command?.transition.mode === "sequential" && run.snapshot.returnState.audio.background.kind !== "cutscene") await fading;
        else void fading.catch(error => { if (valid()) void this.fail(this.error("audio", error, stepId)); });
        this.applicationSuspended = true;
      }
      if (!valid()) return false;
      if (music) {
        await (music as PreparedCutsceneMusic).commit();
        if (retry) await this.ports.audio.resume(this.owner!);
      } else this.ports.music.clear(this.owner!, target.audio.fadeOutMs);
      if (!valid()) return false;
      stage = "storage";
      const saved = await this.save({ phase: "playing", stepId, pendingStepId: null, error: null,
        textPaused: textChanged ? false : this.state.narration.locallyPaused });
      if (!valid()) return false;
      this.commitText(target, saved, textChanged); return true;
    } catch (error) {
      if (valid()) await this.fail(this.error(stage, error, stepId));
      return false;
    } finally {
      (visual as (() => void) | null)?.(); (music as PreparedCutsceneMusic | null)?.dispose();
      if (token === this.sequence) { this.preparation = null; this.publish({ busy: false }); }
    }
  }
  private commitText(step: CutsceneResolvedStep, run: CutsceneRunState, reset: boolean): void {
    this.globallyPaused = false;
    this.publish({ phase: "playing", run, step, notes: step.notes, visualTransition: step.image.transition,
      narration: { ...this.state.narration, text: step.text.text, sourceStepId: step.text.sourceStepId,
        locallyPaused: reset ? false : this.state.narration.locallyPaused, generation: this.state.narration.generation + (reset ? 1 : 0) } });
  }
  private synchronizeConfirmed(run: CutsceneRunState): void {
    if (run.checkpoint.stepId === this.state.step?.stepId) return;
    const step = run.checkpoint.stepId ? resolveCutsceneStep(run.snapshot.version.document, run.checkpoint.stepId) : null;
    const changed = step?.text.sourceStepId !== this.state.narration.sourceStepId;
    this.publish({ step, notes: step?.notes ?? "", visualTransition: step?.image.transition ?? null,
      narration: { ...this.state.narration, text: step?.text.text ?? null, sourceStepId: step?.text.sourceStepId ?? null,
        generation: this.state.narration.generation + (changed ? 1 : 0),
        locallyPaused: changed ? run.checkpoint.textPaused : this.state.narration.locallyPaused } });
  }
  private async fail(error: CutsceneRunError): Promise<void> {
    const token = this.cancel();
    if (!this.owner || this.state.phase === "lost") return;
    // Publish before pause(): the runner synchronously notifies subscribers again when it freezes.
    this.globallyPaused = true;
    this.publish({ phase: "error", busy: true, error });
    try {
      this.ports.audio.pause(this.owner); await this.ports.audio.suspendApplication(this.owner, 0);
      this.applicationSuspended = true;
    } catch { /* already fenced */ }
    if (token !== this.sequence || !this.owner) return;
    if (this.run && !this.run.endedAt) {
      try {
        const saved = await this.save({ phase: "error", pendingStepId: error.stepId, error });
        if (token === this.sequence && this.owner) { this.synchronizeConfirmed(saved); this.publish({ run: saved }); }
      } catch (storage) {
        if (token === this.sequence && this.getSnapshot().phase !== "lost") this.publish({ error: this.error("storage", `${error.message}. ${message(storage)}`, error.stepId) });
      }
    }
    if (token === this.sequence && this.owner) this.publish({ busy: false, run: this.run });
  }

  async pause(): Promise<boolean> {
    if (!this.owner || !["playing", "preparing"].includes(this.state.phase)) return false;
    const token = this.cancel(); this.ports.audio.pause(this.owner); this.globallyPaused = true;
    this.publish({ phase: "paused", busy: true });
    try {
      await this.ports.audio.suspendApplication(this.owner!, 0); this.applicationSuspended = true;
      const saved = await this.save({ phase: "paused", pendingStepId: null, error: null });
      if (token === this.sequence) { this.synchronizeConfirmed(saved); this.publish({ run: saved, busy: false }); } return true;
    } catch (error) { await this.fail(this.error("storage", error, this.state.step?.stepId ?? null)); return false; }
  }
  async resume(): Promise<boolean> {
    if (!this.owner || this.state.busy || this.state.phase !== "paused") return false;
    this.publish({ busy: true });
    try {
      if (this.restartOnResume || !this.state.step) {
        this.restartOnResume = false;
        const run = await this.save({ phase: this.state.step ? "playing" : "ready" });
        this.publish({ phase: run.checkpoint.phase, run, busy: false });
        return this.navigate(this.state.step?.stepId ?? run.snapshot.version.document.steps[0].id, true, true);
      }
      await this.ports.audio.resume(this.owner);
      const saved = await this.save({ phase: "playing", pendingStepId: null, error: null });
      this.globallyPaused = false; this.publish({ phase: "playing", run: saved, busy: false }); return true;
    } catch (error) { await this.fail(this.error("audio", error, this.state.step?.stepId ?? null)); return false; }
  }
  async setTextPaused(paused: boolean): Promise<boolean> {
    const run = this.run;
    if (!this.owner || !run || run.endedAt || !["playing", "paused", "preparing", "error"].includes(this.state.phase)) return false;
    if (paused === this.state.narration.locallyPaused) return true;
    const runId = run.snapshot.runId, sourceStepId = this.state.narration.sourceStepId;
    this.publish({ narration: { ...this.state.narration, locallyPaused: paused } });
    try {
      const saved = await this.save(current => {
        const selected = current.checkpoint.stepId ? resolveCutsceneStep(current.snapshot.version.document, current.checkpoint.stepId) : null;
        return current.snapshot.runId === runId && (selected?.text.sourceStepId ?? null) === sourceStepId ? { textPaused: paused } : null;
      });
      this.publish({ run: saved }); return true;
    }
    catch (error) { await this.fail(this.error("storage", error, this.state.step?.stepId ?? null)); return false; }
  }
  setWordsPerMinute(value: number): void {
    if (Number.isFinite(value) && value > 0) this.publish({ narration: { ...this.state.narration, wordsPerMinute: value } });
  }

  /** Reading is harmless: UI offers recovery; it does not steal the running host's authority. */
  async discover(): Promise<boolean> {
    if (this.owner || this.state.busy || this.pendingStart) return false;
    const token = this.sequence;
    let active: CutsceneRunState | null;
    try { [active, this.retained] = await Promise.all([this.ports.repository.active(), this.ports.repository.music()]); }
    catch (error) { this.publish({ error: this.error("storage", error, null) }); return false; }
    if (token !== this.sequence || this.owner || this.state.busy) return false;
    this.retainedKnown = true;
    if (!active) {
      const lease = this.ports.audio.authority.getSnapshot();
      if (lease) {
        const previous = await this.ports.repository.read(lease.owner.runId).catch(() => null);
        if (previous?.endedAt && sameOwner(previous.snapshot.ownership, lease.owner)) this.ports.audio.authority.release(lease.owner);
      }
      if (this.state.phase === "recoverable" || this.state.phase === "lost") {
        this.run = null; this.globallyPaused = true; this.publish(initial());
      }
      return false;
    }
    this.run = active;
    this.publish({ phase: "recoverable", run: active, step: active.checkpoint.stepId ? resolveCutsceneStep(active.snapshot.version.document, active.checkpoint.stepId) : null });
    return true;
  }
  async recover(): Promise<boolean> {
    if (this.owner || this.state.busy || !this.run || this.run.endedAt) return false;
    const old = this.run; this.publish({ busy: true, error: null });
    try {
      const run = await this.ports.repository.recover(old.snapshot.runId, { controllerId: this.newId(), revision: old.revision });
      const owner = { runId: run.snapshot.runId, controllerId: run.snapshot.ownership.controllerId };
      const lease = this.ports.audio.authority.getSnapshot();
      if (lease && lease.scope === run.snapshot.ownership.audioScope) this.ports.audio.authority.transfer(lease.owner, owner);
      else {
        if (lease) this.ports.audio.authority.release(lease.owner);
        this.ports.audio.recover(owner, run.snapshot.ownership.audioScope);
      }
      this.run = run; this.owner = owner; this.ports.music.stop();
      await this.ports.audio.suspendApplication(owner, 0);
      this.applicationSuspended = true; this.restartOnResume = true; this.globallyPaused = true;
      const step = run.checkpoint.stepId ? resolveCutsceneStep(run.snapshot.version.document, run.checkpoint.stepId) : null;
      if (run.snapshot.mode === "rehearsal" && step) {
        const dispose = await this.ports.output.prepare(run, step, new AbortController().signal); dispose();
      }
      this.publish({ run, phase: "paused", busy: false, step, notes: step?.notes ?? "",
        narration: { text: step?.text.text ?? null, sourceStepId: step?.text.sourceStepId ?? null,
          generation: this.state.narration.generation + 1, paused: true, locallyPaused: run.checkpoint.textPaused,
          wordsPerMinute: run.snapshot.version.document.settings.wordsPerMinute } }); return true;
    } catch (error) {
      if (this.owner) await this.fail(this.error("storage", error, old.checkpoint.stepId));
      else this.publish({ phase: "recoverable", busy: false, error: this.error("storage", error, old.checkpoint.stepId) });
      return false;
    }
  }

  complete = (): Promise<boolean> => this.finish("complete");
  interrupt = (): Promise<boolean> => this.finish("interrupt");
  private async finish(kind: "complete" | "interrupt"): Promise<boolean> {
    if (!this.owner || this.pendingFinish || this.state.phase === "finishing" || (kind === "complete" && !this.state.step)) return false;
    this.failedFinishKind = kind;
    this.cancel(); this.globallyPaused = true; this.publish({ phase: "finishing", busy: true, error: null });
    try {
      const result = await this.serial(async () => {
        const run = this.assertOwner(), music = this.ports.music.capture();
        const input: CutsceneRunFinish = { kind, owner: this.owner!, revision: run.revision, music };
        this.pendingFinishRequest = { runId: run.snapshot.runId, input };
        try { return await this.ports.repository.finish(run.snapshot.runId, input); }
        catch (error) {
          const actual = await this.ports.repository.read(run.snapshot.runId).catch(() => null);
          // The server replays this exact completed request, including its original result.
          if (actual?.endedAt) this.run = actual;
          if ((error as { status?: number }).status && !actual?.endedAt) this.pendingFinishRequest = null;
          throw error;
        }
      });
      this.pendingFinish = result; this.run = result.run;
      return await this.applyFinish(result);
    } catch (error) { await this.fail(this.error("storage", error, this.state.step?.stepId ?? null)); return false; }
  }
  private async applyFinish(result: CutsceneRunFinishResult): Promise<boolean> {
    const owner = this.owner!, run = result.run, settings = run.snapshot.version.document.settings;
    this.synchronizeConfirmed(run);
    const instant = run.checkpoint.phase === "interrupted" || run.snapshot.mode === "rehearsal";
    const transition = instant ? { mode: "crossfade" as const, fadeInMs: 0, fadeOutMs: 0 } : settings.finish.audioTransition;
    try {
      if (result.audioResult === "restore") await this.ports.audio.restore(owner, run.snapshot.returnState.audio, undefined, transition);
      else if (result.audioResult === "silence") { await this.ports.audio.suspend(owner, transition.fadeOutMs); this.ports.music.stop(); }
      if (result.closeWindow) {
        if (!instant && settings.finish.imageTransition.durationMs > 0) await new Promise(resolve => setTimeout(resolve, settings.finish.imageTransition.durationMs));
        const saved = run.snapshot.returnState.window;
        if (saved.windowId) await this.ports.output.close({ ok: true, openedByCall: saved.openedByRun, wasOpen: saved.wasOpen,
          windowId: saved.windowId, screenId: saved.screenId });
      }
      this.ports.audio.release(owner); this.owner = null; this.pendingFinish = null; this.pendingFinishRequest = null;
      this.failedFinishKind = null; this.retained = result.music; this.retainedKnown = true;
      this.publish({ phase: run.checkpoint.phase, run, busy: false, error: null }); return true;
    } catch (error) { await this.fail(this.error("audio", error, this.state.step?.stepId ?? null)); return false; }
  }
  async retry(): Promise<boolean> {
    if (this.state.busy || this.state.phase !== "error") return false;
    if (this.pendingStart) { this.publish({ busy: true, error: null });
      try { return await this.submitStart(); } catch (error) { this.publish({ phase: "error", busy: false, error: this.error("storage", error, null) }); return false; } }
    if (this.pendingFinish) { this.publish({ phase: "finishing", busy: true, error: null }); return this.applyFinish(this.pendingFinish); }
    if (this.pendingFinishRequest) {
      this.publish({ busy: true, error: null });
      try {
        const saved = this.pendingFinishRequest;
        const actual = await this.ports.repository.read(saved.runId);
        if (!sameOwner(actual.snapshot.ownership, this.owner)) { this.lose(); return false; }
        this.run = actual;
        if (!actual.endedAt) {
          this.pendingFinishRequest = null;
          return this.finish(this.failedFinishKind ?? saved.input.kind);
        }
        this.publish({ phase: "finishing" });
        const result = await this.ports.repository.finish(saved.runId, saved.input);
        this.pendingFinish = result; this.run = result.run; return this.applyFinish(result);
      } catch (error) { await this.fail(this.error("storage", error, this.state.step?.stepId ?? null)); return false; }
    }
    if (this.failedFinishKind && this.owner && this.run && !this.run.endedAt) return this.finish(this.failedFinishKind);
    if (!this.owner || this.run?.endedAt) return false;
    const playing = this.ports.music.capture();
    if (this.ports.music.getSnapshot().error || playing?.command.id !== this.state.step?.audio.command?.id) this.ports.music.stop();
    this.restartOnResume = false;
    const target = this.state.error?.stepId ?? this.state.step?.stepId ?? this.run!.snapshot.version.document.steps[0].id;
    return this.navigate(target, false, true);
  }
  private async releaseRetained(readIfUnknown = false): Promise<void> {
    if (!this.retainedKnown && readIfUnknown) {
      try { this.retained = await this.ports.repository.music(); this.retainedKnown = true; } catch { return; }
    }
    const retained = this.retained;
    if (!retained?.runId || !retained.audio || this.releasing) return;
    this.releasing = this.ports.repository.releaseMusic(retained.runId, retained.revision)
      .then(next => { if (this.retained === retained) this.retained = next; })
      .catch(() => { /* Keep the hold on a failed release; a later explicit ordinary command retries. */ })
      .finally(() => { this.releasing = null; });
    await this.releasing;
  }
}
