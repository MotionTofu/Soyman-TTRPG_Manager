import type { CutsceneAudioCommand, CutsceneRetainedMusicSnapshot, CutsceneTransportState, CutsceneAudioTransition } from "@shared/cutscenes/types";
import { audioAuthority, type AudioAuthority, type AudioOwner } from "./audioOwnership";
import type { CutsceneMusicPort } from "./cutsceneAudio";
import { abortAudioPreparation, prepareCutsceneAudioAsset, type CutsceneAudioAsset, type PrepareCutsceneAudioAsset } from "./cutsceneAudioMedia";
import { fragmentGain, fragmentTiming, unitGain, type FragmentTiming } from "./cutsceneAudioTiming";

export interface CutsceneMusicRequest { readonly cutsceneId: number; readonly runId: string; readonly command: CutsceneAudioCommand }
export interface PreparedCutsceneMusic {
  /** Starts the ready command; does not wait for its transition to finish. */
  commit(options?: { paused?: boolean }): Promise<void>;
  dispose(): void;
}
export interface CutsceneMusicState {
  readonly commandId: string | null;
  readonly state: CutsceneTransportState;
  readonly preparing: boolean;
  readonly error: string | null;
}
interface RestoredMusic { position: number; state: CutsceneTransportState; volume: number; transition?: CutsceneAudioTransition }
interface Ramp { from: number; start: number; duration: number }
interface Track {
  request: CutsceneMusicRequest; asset: CutsceneAudioAsset; timing: FragmentTiming; level: number;
  entryAt: number; fadeIn: number; primary: Voice; started: boolean; startPromise?: Promise<void>;
}
interface Voice {
  audio: HTMLAudioElement; track: Track; cycle: number; version: number; wanted: boolean;
  role: "primary" | "loop-tail" | "exit"; exit?: Ramp;
  cleanup(): void;
}
interface Suspension { start: number; duration: number; gains: Map<Voice, number>; resolve(): void; reject(error: Error): void }
const sameRequest = (a: CutsceneMusicRequest, b: CutsceneMusicRequest) =>
  a.cutsceneId === b.cutsceneId && a.runId === b.runId && a.command.id === b.command.id;

/** One logical music channel. Extra voices only exist for an in-progress transition or loop. */
export class CutsceneAudioRunner implements CutsceneMusicPort {
  private readonly prepareAsset: PrepareCutsceneAudioAsset;
  private readonly authority: AudioAuthority;
  private readonly now: () => number;
  private current: Track | null = null;
  private tracks = new Set<Track>();
  private voices = new Map<HTMLAudioElement, Voice>();
  private listeners = new Set<() => void>();
  private preparation: AbortController | null = null;
  private prepared: { dispose(): void } | null = null;
  private preparationVersion = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pauseAt: number | null = null;
  private pausedTime = 0;
  private origin: number;
  private suspension: Suspension | null = null;
  private error: string | null = null;
  private preparing = false;
  private updating = false;
  private snapshot: CutsceneMusicState = { commandId: null, state: "stopped", preparing: false, error: null };

  constructor(options: { prepareAsset?: PrepareCutsceneAudioAsset; authority?: AudioAuthority; now?: () => number } = {}) {
    this.prepareAsset = options.prepareAsset ?? prepareCutsceneAudioAsset;
    this.authority = options.authority ?? audioAuthority;
    this.now = options.now ?? (() => performance.now()); this.origin = this.now();
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): CutsceneMusicState => this.snapshot;
  /** Live gain edits in the workshop do not restart a fragment or change its identity. */
  setPreviewVolume(owner: AudioOwner, level: number): void {
    this.authority.assert(owner);
    if (this.current) this.current.level = unitGain(level);
    this.tick();
  }
  private clock(): number { return ((this.pauseAt ?? this.now()) - this.origin - this.pausedTime) / 1000; }
  private publish(): void {
    const primary = this.current?.primary;
    const state: CutsceneTransportState = !primary || (!this.voices.has(primary.audio) && this.current?.started) ? "stopped" : this.pauseAt !== null ? "paused" : "playing";
    this.snapshot = { commandId: this.current?.request.command.id ?? null, state, preparing: this.preparing, error: this.error };
    this.listeners.forEach(listener => listener());
  }
  private schedule(): void { if (this.timer === null && this.pauseAt === null && (this.voices.size || this.suspension)) this.timer = setInterval(() => this.tick(), 15); }
  private unschedule(): void { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }

  async prepare(owner: AudioOwner, request: CutsceneMusicRequest, signal?: AbortSignal): Promise<PreparedCutsceneMusic> {
    this.authority.assert(owner);
    return this.prepareRequest(request, owner, signal);
  }
  private async prepareRequest(request: CutsceneMusicRequest, owner: AudioOwner | null, external?: AbortSignal,
    restore?: RestoredMusic): Promise<PreparedCutsceneMusic> {
    this.cancelPreparation();
    const version = ++this.preparationVersion, controller = new AbortController(); this.preparation = controller;
    const abort = () => { controller.abort(); if (this.preparation === controller) this.prepared?.dispose(); };
    external?.addEventListener("abort", abort, { once: true });
    const detach = () => external?.removeEventListener("abort", abort);
    if (external?.aborted) controller.abort();
    this.preparing = true; this.error = null; this.publish();
    let asset: CutsceneAudioAsset | null = null;
    try {
      const requestCopy = structuredClone(request);
      const keep = !restore && this.current !== null && sameRequest(this.current.request, requestCopy);
      if (!keep) asset = await this.prepareAsset(requestCopy.cutsceneId, requestCopy.command.audio, requestCopy.command.startSeconds, controller.signal);
      if (controller.signal.aborted || version !== this.preparationVersion) throw abortAudioPreparation();
      const timing = asset ? fragmentTiming(requestCopy.command, asset.duration) : null;
      let consumed = false;
      const dispose = () => {
        detach(); if (consumed) return;
        consumed = true; asset?.dispose(); controller.abort();
        if (this.prepared === result) this.prepared = null;
        if (this.preparation === controller) this.preparation = null;
      };
      const result: PreparedCutsceneMusic = {
        dispose,
        commit: async (options) => {
          if (consumed || controller.signal.aborted || version !== this.preparationVersion) throw abortAudioPreparation();
          try {
            if (owner) this.authority.assert(owner);
            else if (this.authority.getSnapshot()) throw new Error("Музыкальный канал уже захвачен другим запуском");
          } catch (error) { dispose(); throw error; }
          consumed = true; detach(); this.prepared = null; this.preparation = null;
          if (keep) return;
          await this.begin(requestCopy, asset!, timing!, restore, options?.paused ?? false);
        },
      };
      this.prepared = result; return result;
    } catch (error) { detach(); asset?.dispose(); throw error; }
    finally {
      if (version === this.preparationVersion) { this.preparing = false; this.publish(); }
    }
  }
  private cancelPreparation(): void {
    this.preparationVersion++; this.preparation?.abort(); this.preparation = null;
    this.prepared?.dispose(); this.prepared = null; this.preparing = false;
  }

  private createVoice(track: Track, audio: HTMLAudioElement, cycle: number): Voice {
    audio.loop = track.request.command.loop.enabled && track.request.command.loop.transition.mode === "cut" &&
      track.timing.start === 0 && track.timing.end === track.asset.duration;
    const onEnded = () => this.tick();
    const onError = () => this.fail(new Error("Ошибка воспроизведения аудио катсцены"));
    const voice: Voice = { track, audio, cycle, role: "primary", version: 0, wanted: false,
      cleanup: () => { audio.removeEventListener("ended", onEnded); audio.removeEventListener("error", onError); } };
    audio.addEventListener("ended", onEnded); audio.addEventListener("error", onError);
    this.voices.set(audio, voice); return voice;
  }
  private async play(voice: Voice): Promise<void> {
    const version = ++voice.version; voice.wanted = true;
    try {
      await voice.audio.play();
      const current = this.voices.get(voice.audio);
      // A resolved promise from an earlier loop must not pause this element's newer voice.
      if (current && current !== voice) return;
      if (!current || !voice.wanted || this.pauseAt !== null) voice.audio.pause();
    } catch (error) {
      if (version !== voice.version || this.voices.get(voice.audio) !== voice || this.pauseAt !== null) return;
      this.fail(error); throw error;
    }
  }
  private remove(voice: Voice): void {
    if (this.voices.get(voice.audio) !== voice) return;
    voice.version++; voice.wanted = false; voice.audio.pause(); voice.audio.volume = 0; voice.cleanup(); this.voices.delete(voice.audio);
    if (voice.role === "loop-tail") voice.audio.currentTime = voice.track.timing.start;
  }
  private collect(): void {
    for (const track of this.tracks) if (track !== this.current && ![...this.voices.values()].some(voice => voice.track === track)) {
      track.asset.dispose(); this.tracks.delete(track);
    }
    if (!this.voices.size && !this.suspension) this.unschedule();
  }
  private exit(duration: number): number {
    const time = this.clock();
    let longest = 0;
    for (const voice of this.voices.values()) {
      voice.audio.loop = false;
      // An outgoing voice cannot continue past its fragment boundary.
      const remaining = Math.max(0, voice.track.timing.end - voice.audio.currentTime);
      const effective = Math.min(duration, remaining);
      voice.role = "exit"; voice.exit = { from: voice.audio.volume, start: time, duration: effective };
      if (effective === 0 || (voice.audio.paused && voice.audio.volume === 0)) this.remove(voice);
      else longest = Math.max(longest, effective);
    }
    return longest;
  }
  private async begin(request: CutsceneMusicRequest, asset: CutsceneAudioAsset, timing: FragmentTiming,
    restore?: RestoredMusic, pausedStart = false): Promise<void> {
    this.cancelSuspension();
    const outgoing = [...this.voices.values()].some(voice => !voice.audio.paused);
    const transition = restore?.transition ?? request.command.transition;
    const out = !outgoing || (restore && (restore.state !== "playing" || !restore.transition)) ? 0 : transition.fadeOutMs / 1000;
    const actualOut = this.exit(out);
    this.thaw();
    const track = { request, asset, timing, level: restore?.volume ?? request.command.volume,
      entryAt: this.clock() + (outgoing && transition.mode === "sequential" ? actualOut : 0),
      fadeIn: restore ? Math.min(timing.length, (restore.transition?.fadeInMs ?? 0) / 1000) : timing.fadeIn, started: false } as Track;
    track.primary = this.createVoice(track, asset.voices[0], 0);
    this.current = track; this.tracks.add(track); this.collect(); this.error = null;
    if (restore) {
      track.primary.audio.currentTime = Math.max(timing.start, Math.min(timing.end, restore.position));
      if (restore.state === "stopped") { track.started = true; this.remove(track.primary); this.publish(); return; }
      if (restore.state === "paused") { this.freeze(); this.publish(); return; }
    }
    if (pausedStart) { this.freeze(); this.publish(); return; }
    this.tick(); this.publish(); this.schedule();
    await track.startPromise;
  }
  /** Clear is a command too: a later command can interrupt its fade immediately. */
  clear(owner: AudioOwner, fadeOutMs: number): void {
    this.authority.assert(owner);
    if (!Number.isFinite(fadeOutMs) || fadeOutMs < 0) throw new Error("Некорректное время затухания");
    this.cancelPreparation(); this.cancelSuspension(); this.exit(this.pauseAt !== null ? 0 : fadeOutMs / 1000); this.current = null;
    this.collect(); this.tick(); this.publish(); this.schedule();
  }

  private tick(): void {
    if (this.updating || this.pauseAt !== null) return;
    this.updating = true;
    try {
      const time = this.clock();
      for (const voice of [...this.voices.values()]) {
        const { audio, track } = voice, position = audio.currentTime;
        if (voice.role === "exit") {
          const ramp = voice.exit!, t = ramp.duration === 0 ? 1 : unitGain((time - ramp.start) / ramp.duration);
          audio.volume = ramp.from * (1 - t);
          if (t >= 1 || position >= track.timing.end || audio.ended) this.remove(voice);
          continue;
        }
        if (!track.started) {
          if (time < track.entryAt) continue;
          track.started = true;
          this.volume(voice, time); track.startPromise = this.play(voice); void track.startPromise.catch(() => {});
        }
        if (position >= track.timing.end || audio.ended) {
          if (voice.role === "primary" && track.request.command.loop.enabled) this.repeat(voice);
          else { audio.currentTime = track.timing.end; this.remove(voice); this.publish(); }
          continue;
        }
        this.volume(voice, time);
        const overlap = track.timing.loopCrossfade;
        if (voice.role === "primary" && track.request.command.loop.enabled && overlap > 0 &&
          track.request.command.loop.transition.mode === "crossfade" && position >= track.timing.end - overlap) this.overlap(voice);
      }
      if (this.suspension) {
        const fade = this.suspension, t = fade.duration === 0 ? 1 : unitGain((time - fade.start) / fade.duration);
        for (const voice of this.voices.values()) voice.audio.volume = (fade.gains.get(voice) ?? 0) * (1 - t);
        if (t >= 1) { this.suspension = null; this.pause(); fade.resolve(); }
      }
      this.collect();
    } finally { this.updating = false; }
  }
  private volume(voice: Voice, time: number): void {
    const track = voice.track;
    const entry = track.fadeIn === 0 ? 1 : unitGain((time - track.entryAt) / track.fadeIn);
    voice.audio.volume = unitGain(track.level * entry * fragmentGain(track.timing, track.request.command, voice.audio.currentTime, voice.cycle > 0));
  }
  private repeat(voice: Voice): void {
    voice.audio.currentTime = voice.track.timing.start; voice.cycle++;
    this.volume(voice, this.clock()); void this.play(voice).catch(() => {});
  }
  private overlap(voice: Voice): void {
    const track = voice.track;
    const spare = track.asset.voices.find(audio => audio !== voice.audio)!;
    const older = this.voices.get(spare);
    if (older) this.remove(older);
    voice.role = "loop-tail";
    spare.currentTime = track.timing.start;
    const next = this.createVoice(track, spare, voice.cycle + 1); track.primary = next;
    this.volume(next, this.clock()); void this.play(next).catch(() => {});
  }
  private freeze(): void {
    if (this.pauseAt !== null) return;
    this.pauseAt = this.now(); this.unschedule();
    for (const voice of this.voices.values()) { voice.version++; voice.wanted = false; voice.audio.pause(); }
  }
  private thaw(): void {
    if (this.pauseAt !== null) { this.pausedTime += this.now() - this.pauseAt; this.pauseAt = null; }
  }
  pause(): void { const fade = this.suspension; this.suspension = null; this.freeze(); fade?.resolve(); this.publish(); }
  async resume(): Promise<void> {
    if (this.pauseAt === null) return;
    const existing = [...this.voices.values()].filter(voice => voice.track.started);
    const pending = this.current && !this.current.started ? this.current : null;
    this.thaw(); this.error = null;
    this.tick(); this.schedule(); this.publish();
    const jobs = existing.filter(voice => this.voices.get(voice.audio) === voice && !voice.wanted).map(voice => this.play(voice));
    if (pending?.startPromise) jobs.push(pending.startPromise);
    await Promise.all(jobs);
  }
  async suspend(fadeOutMs: number): Promise<void> {
    if (!Number.isFinite(fadeOutMs) || fadeOutMs < 0) throw new Error("Некорректное время затухания");
    this.cancelSuspension();
    if (fadeOutMs <= 0 || this.pauseAt !== null || !this.voices.size) { this.pause(); return; }
    return new Promise((resolve, reject) => {
      this.suspension = { start: this.clock(), duration: Math.min(fadeOutMs / 1000, this.current?.timing.length ?? Infinity),
        gains: new Map([...this.voices.values()].map(voice => [voice, voice.audio.volume])), resolve, reject };
      this.schedule();
    });
  }
  private cancelSuspension(): void { const previous = this.suspension; this.suspension = null; previous?.reject(abortAudioPreparation()); }
  private fail(error: unknown): void { this.error = error instanceof Error ? error.message : String(error); this.cancelSuspension(); this.freeze(); this.publish(); }

  capture(): CutsceneRetainedMusicSnapshot | null {
    const track = this.current;
    return track ? { kind: "cutscene", cutsceneId: track.request.cutsceneId, runId: track.request.runId,
      command: structuredClone(track.request.command), positionSeconds: Math.max(track.timing.start, Math.min(track.timing.end, track.primary.audio.currentTime)),
      state: this.getSnapshot().state, volume: track.level } : null;
  }
  async restore(saved: CutsceneRetainedMusicSnapshot, transition?: CutsceneAudioTransition): Promise<void> {
    if (!Number.isFinite(saved.positionSeconds) || !Number.isFinite(saved.volume) || saved.volume < 0 || saved.volume > 1) {
      throw new Error("Некорректный снимок музыкального фрагмента");
    }
    const owner = this.authority.getSnapshot()?.owner ?? null;
    const request = { cutsceneId: saved.cutsceneId, runId: saved.runId, command: saved.command };
    const prepared = await this.prepareRequest(request, owner, undefined,
      { position: saved.positionSeconds, state: saved.state, volume: saved.volume, transition });
    await prepared.commit();
  }
  stop(): void {
    this.cancelPreparation(); this.cancelSuspension(); this.unschedule();
    for (const voice of [...this.voices.values()]) this.remove(voice);
    this.current = null; for (const track of this.tracks) track.asset.dispose(); this.tracks.clear();
    this.pauseAt = null; this.pausedTime = 0; this.origin = this.now(); this.error = null; this.publish();
  }
}
