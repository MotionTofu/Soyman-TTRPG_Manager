import type { CutsceneRunRepository } from "../data/cutsceneRuns";
import type { CutsceneAudioController } from "../sound/cutsceneAudio";
import type { CutsceneAudioRunner } from "../sound/cutsceneAudioRunner";
import type { PlayerDisplayOpenResult, PlayerDisplayOwner } from "@shared/playerDisplay";
import type { CutsceneOriginal, CutsceneResolvedStep, CutsceneRunError, CutsceneRunPhase,
  CutsceneValidationIssue, CutsceneVisualTransition } from "@shared/cutscenes/types";
import type { CutsceneRunState } from "@shared/cutscenes/runApi";
import type { ScreenChoice } from "../components/presentation/screens";

export interface CutsceneOutput {
  open(screen: ScreenChoice | null): Promise<PlayerDisplayOpenResult>;
  close(opened: PlayerDisplayOpenResult): Promise<boolean>;
  /** Prepares pixels without publishing; rehearsal uses the same media check locally. */
  prepare(run: CutsceneRunState, step: CutsceneResolvedStep, signal: AbortSignal): Promise<() => void>;
  isCurrentFrame(playKey: string, owner: PlayerDisplayOwner): Promise<boolean>;
  subscribeErrors(listener: (windowId: string, message: string, playKey: string) => void): () => void;
}
export interface CutscenePlaybackPorts {
  repository: CutsceneRunRepository;
  audio: CutsceneAudioController;
  music: Pick<CutsceneAudioRunner, "prepare" | "clear" | "stop" | "capture" | "getSnapshot" | "subscribe">;
  output: CutsceneOutput;
  newId?: () => string;
}
export interface CutsceneNarration {
  readonly text: string | null;
  readonly sourceStepId: string | null;
  /** Changes only when a different text starts, not when its notes change. */
  readonly generation: number;
  readonly paused: boolean;
  readonly locallyPaused: boolean;
  readonly wordsPerMinute: number;
}
export interface CutscenePlaybackState {
  readonly phase: CutsceneRunPhase | "idle" | "starting" | "finishing" | "recoverable" | "lost";
  readonly original: CutsceneOriginal | null;
  readonly preview: CutsceneResolvedStep | null;
  readonly run: CutsceneRunState | null;
  readonly step: CutsceneResolvedStep | null;
  readonly busy: boolean;
  readonly error: CutsceneRunError | null;
  readonly issues: readonly CutsceneValidationIssue[];
  readonly narration: CutsceneNarration;
  readonly notes: string;
  readonly visualTransition: CutsceneVisualTransition | null;
}
