import { randomUUID } from "../utils/uuid";
import type { CutsceneDocument, CutsceneAudioCommand, CutsceneResolvedStep } from "@shared/cutscenes/types";
import type { CutscenePreviewState, CutscenePreviewUpdate, CutsceneVisualPlayback } from "@shared/cutscenes/previewApi";
import { selectedPreviewDocument } from "@shared/cutscenes/previewApi";
import { parseCutsceneDocument } from "@shared/cutscenes/validate";
import { resolveCutsceneStep } from "@shared/cutscenes/resolve";
import { createCutsceneDocument, createCutsceneStep } from "@shared/cutscenes/defaults";
import type { CutsceneRunOwner } from "@shared/cutscenes/runApi";
import type { PlayerDisplayOpenResult } from "@shared/playerDisplay";
import { cutscenePreviews as repository } from "../data/cutscenePreviews";
import type { CutsceneAudioController } from "../sound/cutsceneAudio";
import type { CutsceneAudioRunner } from "../sound/cutsceneAudioRunner";
import type { ScreenChoice } from "../components/presentation/screens";
import { browserCutsceneOutput, prepareImages, preparePlayerWindow, subscribePreviewWindowClose } from "./display";
import { readCutscenePreview } from "./preview";

export interface WorkshopPreviewView {
  phase: "idle" | "preparing" | "playing" | "paused" | "returning";
  mode: "general" | "audition" | null;
  external: boolean;
  error: string | null;
  foreign: CutscenePreviewState | null;
  playKey: number;
  textGeneration: number;
  textPaused: boolean;
  auditionLoop: boolean;
  visualPlayback: CutsceneVisualPlayback;
}
type Draft = { id: number; document: CutsceneDocument; stepId: string; resolved: CutsceneResolvedStep; structure: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameOwner = (a: CutsceneRunOwner | undefined | null, b: CutsceneRunOwner | undefined | null) => !!a && !!b && a.runId === b.runId && a.controllerId === b.controllerId;
const audioShape = (command: CutsceneAudioCommand | null) => command ? JSON.stringify({ ...command, volume: 0 }) : "none";

/** Host-scoped temporary lifecycle. Unlike live playback, unmounting the editor ends it. */
export class WorkshopPreviewController {
  private state: WorkshopPreviewView = { phase: "idle", mode: null, external: false, error: null, foreign: null, playKey: 0, textGeneration: 0, textPaused: true, auditionLoop: false, visualPlayback: { elapsedMs: 0, startedAt: null } };
  private listeners = new Set<() => void>();
  private session: CutscenePreviewState | null = null;
  private latest: Draft | null = null;
  private operation = 0;
  private preparation: AbortController | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private finishing: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private removeErrors: (() => void) | null = null;
  private controllerId = randomUUID();
  private reloadOwner: string | null = null;
  private auditionLoop = false;
  private knownMusic = false;
  private audioRestored = false;
  private boundaryEdit: { resume: boolean } | null = null;
  private boundaryCommit: { resume: boolean } | null = null;
  private starting = false;
  private opening = false;
  private audio: CutsceneAudioController;
  private music: CutsceneAudioRunner;
  constructor(audio: CutsceneAudioController, music: CutsceneAudioRunner) {
    this.audio = audio; this.music = music;
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (navigation?.type === "reload") this.reloadOwner = sessionStorage.getItem("soyman.workshop-preview-controller");
      sessionStorage.setItem("soyman.workshop-preview-controller", this.controllerId);
    } catch { /* heartbeat recovery remains available */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<WorkshopPreviewView>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private serial<T>(apply: () => Promise<T>): Promise<T> { const next = this.writes.then(apply, apply); this.writes = next.catch(() => {}); return next; }
  private cancel() { this.preparation?.abort(); this.preparation = null; return ++this.operation; }
  private async update(patch: Omit<CutscenePreviewUpdate, "owner" | "revision">) {
    return this.serial(async () => {
      const current = this.session;
      if (!current) throw new Error("Предпросмотр уже остановлен");
      try { this.session = await repository.update({ ...patch, owner: current.owner, revision: current.revision }); }
      catch (error) {
        const actual = await repository.active().catch(() => null);
        if (actual && sameOwner(actual.owner, current.owner)) this.session = actual;
        throw error;
      }
      return this.session;
    });
  }
  connect(): () => void {
    if (this.timer) return () => {};
    const check = () => { void this.poll(); };
    this.timer = setInterval(check, 2000); check();
    const offline = () => { if (this.session) { if (this.session.audio) this.music.pause(); void this.stop(); } };
    window.addEventListener("offline", offline);
    const onClose = (windowId: string) => {
      if (this.session?.external && this.session.window?.windowId === windowId) void this.stop();
    };
    const removeErrors = browserCutsceneOutput.subscribeErrors(onClose), removeClose = subscribePreviewWindowClose(onClose);
    this.removeErrors = () => { removeErrors(); removeClose(); };
    return () => { if (this.timer) clearInterval(this.timer); this.timer = null; this.removeErrors?.(); window.removeEventListener("offline", offline); };
  }
  private async poll() {
    try {
      if (this.session) {
        const owner = this.session.owner;
        const actual = await repository.heartbeat(owner);
        if (!sameOwner(this.session?.owner, owner)) return;
        if (actual.phase === "returning" || this.state.phase === "returning") { this.session = actual; await this.stop(); }
        else if (this.state.mode === "audition" && this.state.phase === "playing" && this.knownMusic && this.music.getSnapshot().state === "stopped") await this.stop();
        else if (this.session?.audio && this.music.getSnapshot().error) { const reason = this.music.getSnapshot().error; await this.stop(); this.publish({ error: reason }); }
        return;
      }
      const active = await repository.active();
      // A local start may have finished while the discovery request was in flight.
      if (this.session) return;
      if (active && ((active.phase === "returning" && Date.now() - active.updatedAt > 30_000) || active.owner.controllerId === this.reloadOwner)) {
        const returning = active.phase === "returning" ? active : await repository.stop(active.owner);
        const claimed = await repository.claimReturn(returning.owner, this.controllerId);
        const lease = this.audio.authority.getSnapshot();
        if (lease && sameOwner(lease.owner, returning.owner)) this.audio.authority.transfer(returning.owner, claimed.owner);
        this.session = claimed; this.reloadOwner = null;
        await this.stop();
      } else if (this.state.foreign?.revision !== active?.revision || !sameOwner(this.state.foreign?.owner, active?.owner)) this.publish({ foreign: active });
    } catch (error) {
      if (this.session) { if (this.session.audio) this.music.pause(); this.publish({ phase: "returning", error: `Возврат ожидает соединения: ${message(error)}` }); }
    }
  }
  async stopForeign(): Promise<void> {
    try { const current = await repository.active(); if (current) await repository.stop(current.owner); await this.poll(); }
    catch (error) { this.publish({ error: message(error) }); }
  }
  configure(id: number, document: CutsceneDocument, stepId: string): void {
    const resolved = resolveCutsceneStep(document, stepId); if (!resolved) { void this.stop(); this.latest = null; return; }
    const previous = this.latest;
    this.latest = { id, document, stepId, resolved, structure: document.steps.map(step => step.id).join(":") };
    if (!this.session || !previous) { this.boundaryCommit = null; return; }
    if (!this.projection(this.state.mode ?? "general")) return;
    if (this.state.phase !== "returning" && this.state.error) this.publish({ error: null });
    if (previous.id !== id || previous.structure !== this.latest.structure) { void this.stop(); return; }
    if (!this.state.mode) {
      const projected = this.projection("general"); if (!projected) return;
      if (previous.stepId !== stepId) this.publish({ playKey: this.state.playKey + 1, visualPlayback: { elapsedMs: 0, startedAt: null } });
      void this.update({ document: projected, publish: this.session.external, playKey: String(this.state.playKey), visualPlayback: this.state.visualPlayback }).catch(error => this.failed(error));
      return;
    }
    if (previous.stepId === stepId && audioShape(previous.resolved.audio.command) !== audioShape(resolved.audio.command)) {
      if (this.boundaryCommit && this.state.mode === "audition") {
        const resume = this.boundaryCommit.resume; this.boundaryCommit = null;
        this.music.stop(); void this.transition("audition", !resume); return;
      }
      void this.stop(); return;
    }
    if (previous.resolved.text.text !== resolved.text.text || previous.resolved.text.sourceStepId !== resolved.text.sourceStepId) this.publish({ textPaused: previous.stepId === stepId, textGeneration: this.state.textGeneration + 1 });
    if (previous.stepId !== stepId) {
      void this.transition(this.state.mode ?? "general", this.state.phase === "paused"); return;
    }
    if (this.session.audio && resolved.audio.command && previous.resolved.audio.command?.volume !== resolved.audio.command.volume) this.music.setPreviewVolume(this.session.owner, resolved.audio.command.volume);
    if (JSON.stringify(previous.resolved) !== JSON.stringify(resolved)) {
      const projected = this.projection(this.state.mode ?? "general");
      if (!projected) return;
      void this.update({ document: projected, publish: this.session.external, playKey: String(this.state.playKey), animate: false }).catch(error => this.failed(error));
    }
  }
  private projection(mode: "general" | "audition"): CutsceneDocument | null {
    if (!this.latest) return null;
    let projected = selectedPreviewDocument(this.latest.document, this.latest.stepId);
    if (mode === "audition") {
      const step = projected.steps[0];
      projected = { ...createCutsceneDocument("Прослушивание"), steps: [{ ...createCutsceneStep(step.id), audio: step.audio }] };
    }
    const parsed = parseCutsceneDocument(projected);
    if (!parsed.ok) { this.publish({ error: "Правка не применена: исправьте параметры выбранного шага." }); return null; }
    return parsed.value;
  }
  private async ensure(mode: "general" | "audition") {
    const projected = this.projection(mode); if (!projected || !this.latest) throw new Error("Выбранный шаг не готов к предпросмотру");
    if (!this.session) {
      const owner = { runId: randomUUID(), controllerId: this.controllerId };
      this.starting = true;
      try {
        const id = this.latest.id;
        await this.serial(async () => {
          this.session = await repository.start({ owner, cutsceneId: id, document: projected });
          this.audioRestored = false;
          this.publish({ foreign: null });
        });
      } finally { this.starting = false; }
    }
    return projected;
  }
  private async captureAudio() {
    const current = this.session!;
    if (current.audio) return;
    const snapshot = this.audio.capture(current.owner, "all");
    try { await this.update({ audio: snapshot }); }
    catch (error) { this.audio.release(current.owner); throw error; }
    await this.audio.suspend(current.owner, 0);
  }
  async play(mode: "general" | "audition"): Promise<boolean> {
    if (this.state.phase === "preparing") return false;
    if (this.finishing) await this.finishing;
    if (this.state.mode && this.state.mode !== mode) { if (!await this.stop()) return false; }
    if (this.state.mode === mode && this.state.phase === "paused") {
      try { await this.audio.resume(this.session!.owner); this.publish({ phase: "playing", visualPlayback: { ...this.state.visualPlayback, startedAt: Date.now() } }); await this.update({ visualPlayback: this.state.visualPlayback, publish: this.state.external, playKey: String(this.state.playKey) }); return true; }
      catch (error) { this.failed(error); return false; }
    }
    if (this.state.mode === mode && this.state.phase === "playing") { this.pause(); return true; }
    return this.transition(mode);
  }
  private async transition(mode: "general" | "audition", paused = false): Promise<boolean> {
    const firstPlayback = this.state.mode !== mode;
    const resetVisual = firstPlayback || this.latest?.document.steps.find(step => step.id === this.latest?.stepId)?.image.action !== "keep";
    const token = this.cancel(), abort = new AbortController(); this.preparation = abort;
    this.publish({ phase: "preparing", error: null });
    try {
      const projected = await this.ensure(mode);
      if (token !== this.operation) return false;
      const current = this.session!, latest = this.latest!;
      const step = resolveCutsceneStep(projected, projected.steps[0].id)!;
      await this.captureAudio();
      if (token !== this.operation) return false;
      let command = step.audio.command;
      if (command && mode === "audition") command = { ...command, loop: { ...command.loop, enabled: this.auditionLoop }, transition: { ...command.transition, fadeOutMs: 0 } };
      const prepared = command ? await this.music.prepare(current.owner, { cutsceneId: latest.id, runId: current.owner.runId, command }, abort.signal) : null;
      if (token !== this.operation) { prepared?.dispose(); return false; }
      try {
        if (mode === "general") await this.prepareVisual(step, abort.signal);
        const playKey = this.state.playKey + (resetVisual ? 1 : 0);
        const visualPlayback = resetVisual ? { elapsedMs: 0, startedAt: paused ? null : Date.now() } : this.state.visualPlayback;
        await this.update({ document: projected, publish: mode === "general" && this.session!.external,
          playKey: String(playKey), animate: resetVisual, visualPlayback });
        if (token !== this.operation) return false;
        if (prepared) await prepared.commit({ paused }); else this.music.clear(current.owner, step.audio.fadeOutMs);
        this.knownMusic = !!command;
        this.publish({ phase: paused ? "paused" : "playing", mode, playKey, visualPlayback,
          textGeneration: this.state.textGeneration + (firstPlayback ? 1 : 0), textPaused: firstPlayback ? false : this.state.textPaused });
        return true;
      } finally { prepared?.dispose(); }
    } catch (error) { if (token === this.operation) this.failed(error); return false; }
  }
  private async prepareVisual(step: CutsceneResolvedStep, signal: AbortSignal) {
    if (!this.latest || !step.image.composition) return;
    const data = await readCutscenePreview(this.latest.id, step.image.composition, signal);
    const urls = [data.background_url, ...data.layers.map(layer => layer.image_url)].filter((url): url is string => !!url);
    const dispose = await prepareImages(urls, signal);
    try { if (this.session?.external && this.session.window?.windowId) await preparePlayerWindow(this.session.window.windowId, urls, signal); }
    finally { dispose(); }
  }
  pause(): void {
    if (!this.session || this.state.phase !== "playing") return;
    this.audio.pause(this.session.owner);
    const visual = this.state.visualPlayback;
    this.publish({ phase: "paused", visualPlayback: { elapsedMs: visual.elapsedMs + (visual.startedAt === null ? 0 : Date.now() - visual.startedAt), startedAt: null } });
    void this.update({ visualPlayback: this.state.visualPlayback, publish: this.state.external, playKey: String(this.state.playKey) }).catch(error => this.failed(error));
  }
  textPause(paused: boolean): void { this.publish({ textPaused: paused }); }
  setAuditionLoop(enabled: boolean): void { this.auditionLoop = enabled; this.publish({ auditionLoop: enabled }); if (this.state.mode === "audition") { this.music.stop(); void this.transition("audition", this.state.phase === "paused"); } }
  leave(): void { void this.stop(); this.auditionLoop = false; this.publish({ auditionLoop: false }); }
  async restartAudition(): Promise<void> { if (this.state.mode === "audition") { this.music.stop(); await this.transition("audition"); } }
  beginBoundaryEdit(): void { this.boundaryEdit = { resume: this.state.mode === "audition" && this.state.phase === "playing" }; if (this.boundaryEdit.resume) this.pause(); }
  endBoundaryEdit(changed: boolean): void {
    const editing = this.boundaryEdit; this.boundaryEdit = null;
    if (changed) this.boundaryCommit = editing;
    else if (editing?.resume) void this.play("audition");
  }
  cancelBoundaryEdit(): void { this.boundaryEdit = null; this.boundaryCommit = null; }
  position(): number | null { return this.session && this.state.mode ? this.music.capture()?.positionSeconds ?? null : null; }
  async repeatVisual(): Promise<void> {
    this.publish({ playKey: this.state.playKey + 1, visualPlayback: { elapsedMs: 0, startedAt: Date.now() } });
    if (this.session) await this.update({ publish: this.state.external, playKey: String(this.state.playKey), animate: true, visualPlayback: this.state.visualPlayback }).catch(error => this.failed(error));
  }
  async external(screen: ScreenChoice | null): Promise<boolean> {
    if (this.opening) return false;
    if (this.session?.external) return this.stop();
    this.opening = true;
    let token = this.operation;
    // Open under the initiating click, before awaiting an audition's audio return.
    const opening = browserCutsceneOutput.open(screen);
    let opened: PlayerDisplayOpenResult | null = null;
    try {
      if (this.state.mode === "audition") {
        if (!await this.stop()) { opened = await opening; if (opened.ok && opened.openedByCall) await browserCutsceneOutput.close(opened); return false; }
        token = this.operation;
      }
      opened = await opening; if (!opened.ok) throw new Error(opened.reason);
      if (token !== this.operation) throw new DOMException("Вывод отменён", "AbortError");
      const projected = await this.ensure("general");
      if (token !== this.operation) throw new DOMException("Вывод отменён", "AbortError");
      await this.update({ document: projected, window: { wasOpen: opened.wasOpen, openedByRun: opened.openedByCall, screenId: opened.screenId, windowId: opened.windowId } });
      await this.prepareVisual(resolveCutsceneStep(projected, projected.steps[0].id)!, new AbortController().signal);
      await this.update({ publish: true, playKey: String(this.state.playKey), animate: false, visualPlayback: this.state.visualPlayback });
      this.publish({ external: true, error: null }); return true;
    } catch (error) { if (opened?.ok && opened.openedByCall && !this.session?.external) await browserCutsceneOutput.close(opened).catch(() => false); if (token === this.operation) this.failed(error); return false; }
    finally { this.opening = false; }
  }
  private failed(error: unknown) { if (this.session?.audio) this.music.pause(); this.publish({ error: message(error) }); void this.stop().then(() => this.publish({ error: message(error) })); }
  stop(): Promise<boolean> {
    if (this.finishing) return this.finishing;
    this.cancel();
    if (!this.session && !this.starting) { this.publish({ phase: "idle", mode: null, external: false, visualPlayback: { elapsedMs: 0, startedAt: null } }); return Promise.resolve(true); }
    if (this.session?.audio && !this.audioRestored) this.music.pause(); this.publish({ phase: "returning" });
    this.finishing = this.serial(async () => {
      const current = this.session;
      if (!current) { this.publish({ phase: "idle", mode: null, external: false }); return true; }
      try {
        const stopped = await repository.stop(current.owner); this.session = stopped;
        if (stopped.audio && !this.audioRestored) {
          const lease = this.audio.authority.getSnapshot();
          if (!lease) this.audio.recover(stopped.owner, "all");
          else this.audio.authority.assert(stopped.owner);
          await this.audio.restore(stopped.owner, stopped.audio);
          this.audio.release(stopped.owner);
          this.audioRestored = true;
        }
        if (stopped.window?.openedByRun && !stopped.window.wasOpen && stopped.window.windowId) await browserCutsceneOutput.close({ ok: true,
          wasOpen: false, openedByCall: true, windowId: stopped.window.windowId, screenId: stopped.window.screenId });
        await repository.acknowledge(stopped.owner);
        this.session = null; this.knownMusic = false;
        this.publish({ phase: "idle", mode: null, external: false, error: null, visualPlayback: { elapsedMs: 0, startedAt: null } }); return true;
      } catch (error) { this.publish({ phase: "returning", error: `Не завершён возврат: ${message(error)}` }); return false; }
    }).finally(() => { this.finishing = null; });
    return this.finishing;
  }
}
const controllers = new WeakMap<CutsceneAudioController, WorkshopPreviewController>();
export function workshopPreview(audio: CutsceneAudioController, music: CutsceneAudioRunner): WorkshopPreviewController {
  let controller = controllers.get(audio);
  if (!controller) { controller = new WorkshopPreviewController(audio, music); controllers.set(audio, controller); }
  return controller;
}
