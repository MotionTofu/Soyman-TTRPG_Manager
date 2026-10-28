import type { CutsceneAudioReturnSnapshot, CutsceneAudioScope, CutsceneBackgroundSnapshot,
  CutsceneRetainedMusicSnapshot, CutsceneAudioTransition } from "@shared/cutscenes/types";
import { audioAuthority, AudioAuthority, type AudioOwner } from "./audioOwnership";
import { freshAudioSources, type AudioSourceResolver } from "./audioSources";

export interface ApplicationAudioPort {
  capture(scope: CutsceneAudioScope): CutsceneAudioReturnSnapshot;
  suspend(owner: AudioOwner, scope: CutsceneAudioScope, fadeOutMs: number): Promise<void>;
  restore(owner: AudioOwner, snapshot: CutsceneAudioReturnSnapshot, resolve: AudioSourceResolver, beforeCommit: () => void, fadeInMs?: number): Promise<void>;
}
/** Implemented by 06; all sources remain in the GM host, never in the players' window. */
export interface CutsceneMusicPort {
  capture(): CutsceneRetainedMusicSnapshot | null;
  suspend(fadeOutMs: number): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  stop(): void;
  restore(snapshot: CutsceneRetainedMusicSnapshot, transition?: CutsceneAudioTransition): Promise<void>;
}

/** Ownership + serializable return state; fragment playback itself belongs to ticket 06. */
export class CutsceneAudioController {
  private music: CutsceneMusicPort | null = null;
  private operation = 0;
  private application: ApplicationAudioPort;
  readonly authority: AudioAuthority;
  constructor(application: ApplicationAudioPort, authority: AudioAuthority = audioAuthority) {
    this.application = application; this.authority = authority;
  }
  registerMusic(port: CutsceneMusicPort): () => void {
    if (this.music && this.music !== port) throw new Error("Музыкальный канал катсцены уже подключён");
    this.music = port;
    return () => { if (this.music === port) this.music = null; };
  }
  capture(owner: AudioOwner, scope: CutsceneAudioScope = "all"): CutsceneAudioReturnSnapshot {
    // Take the actual transport positions before claiming invalidates pending normal commands.
    if (this.authority.getSnapshot()) throw new Error("Снимок захваченного звука уже существует; используйте восстановление запуска");
    const snapshot = this.application.capture(scope);
    const retained = this.music?.capture();
    this.authority.claim(owner, scope);
    this.operation++;
    return structuredClone(retained ? { ...snapshot, background: retained } : snapshot);
  }
  /** Recovery uses 07's saved return snapshot instead of capturing an empty reloaded engine. */
  recover(owner: AudioOwner, scope: CutsceneAudioScope): void {
    this.authority.claim(owner, scope); this.operation++;
  }
  async suspend(owner: AudioOwner, fadeOutMs = 0): Promise<void> {
    this.authority.assert(owner);
    const scope = this.authority.getSnapshot()!.scope;
    await Promise.all([this.application.suspend(owner, scope, Math.max(0, fadeOutMs)), this.music?.suspend(Math.max(0, fadeOutMs))]);
    this.authority.assert(owner);
  }
  /** Entry crossfade: the runner transitions retained music itself; only ordinary layers fade here. */
  async suspendApplication(owner: AudioOwner, fadeOutMs = 0): Promise<void> {
    this.authority.assert(owner);
    await this.application.suspend(owner, this.authority.getSnapshot()!.scope, Math.max(0, fadeOutMs));
    this.authority.assert(owner);
  }
  pause(owner: AudioOwner): void { this.authority.assert(owner); this.music?.pause(); }
  async resume(owner: AudioOwner): Promise<void> { this.authority.assert(owner); await this.music?.resume(); this.authority.assert(owner); }
  async restore(owner: AudioOwner, snapshot: CutsceneAudioReturnSnapshot, external?: AudioSourceResolver, transition?: CutsceneAudioTransition): Promise<void> {
    this.authority.assert(owner);
    if (snapshot.scope !== this.authority.getSnapshot()!.scope) throw new Error("Снимок не соответствует захваченным каналам");
    const operation = ++this.operation;
    const resolve = freshAudioSources(external);
    // Resolve every application source before stopping any retained music or mutating the engine.
    const background = snapshot.background;
    const sources = [
      ...(background.kind === "queue" ? background.queue.map(item => item.source) : []),
      ...(snapshot.scope === "all" ? [snapshot.ambient.source, snapshot.weather.source].filter(s => s !== null) : []),
    ];
    await Promise.all(sources.map(source => resolve(source!)));
    this.authority.assert(owner);
    if (operation !== this.operation) throw new Error("Восстановление звука отменено");
    if (background.kind === "cutscene" && !this.music) throw new Error("Музыкальный проигрыватель катсцены не подключён");
    let outgoing: Promise<void> = Promise.resolve();
    let retainedRestore: Promise<void> | null = null;
    if (transition?.mode === "sequential" && background.kind === "queue") {
      await this.music?.suspend(transition.fadeOutMs); this.music?.stop();
    }
    await this.application.restore(owner, snapshot, resolve, () => {
      if (!transition) this.music?.stop();
      else if (background.kind === "cutscene") {
        retainedRestore = this.music!.restore(background, transition); void retainedRestore.catch(() => {});
      } else if (background.kind === "queue" && transition.mode === "crossfade") {
        outgoing = (this.music?.suspend(transition.fadeOutMs) ?? Promise.resolve()).then(() => { this.authority.assert(owner); this.music?.stop(); });
        void outgoing.catch(() => {});
      }
    }, transition?.fadeInMs);
    await outgoing;
    this.authority.assert(owner);
    if (operation !== this.operation) throw new Error("Восстановление звука отменено");
    if (retainedRestore) await retainedRestore;
    else if (background.kind === "cutscene") await this.music!.restore(background);
  }
  release(owner: AudioOwner): void { this.authority.assert(owner); this.operation++; this.authority.release(owner); }
  async transfer(owner: AudioOwner, next: AudioOwner): Promise<void> {
    this.authority.assert(owner); this.operation++;
    await this.suspend(owner, 0);
    this.authority.transfer(owner, next);
  }
  captureMusic(): CutsceneBackgroundSnapshot | null { return this.music?.capture() ?? null; }
}
