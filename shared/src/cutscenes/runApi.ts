import type { PlayerDisplayState } from "../playerDisplay";
import type { CutsceneAudioFinish, CutsceneAudioReturnSnapshot, CutsceneImageFinish, CutsceneLaunchContext,
  CutsceneOwnership, CutsceneRetainedMusicSnapshot, CutsceneReturnSnapshot, CutsceneRunCheckpoint, CutsceneRunSnapshot } from "./types";

export type CutsceneRunOwner = Pick<CutsceneOwnership, "runId" | "controllerId">;
export interface CutsceneRunState {
  readonly snapshot: CutsceneRunSnapshot;
  readonly checkpoint: CutsceneRunCheckpoint;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
}
export interface CutsceneRunStart {
  readonly cutsceneId: number;
  readonly controllerId: string;
  readonly mode: "live" | "rehearsal";
  readonly context: CutsceneLaunchContext;
  /** The server captures the actual presentation in the same transaction as the version. */
  readonly returnState: Pick<CutsceneReturnSnapshot, "audio" | "window">;
}
export interface CutsceneRunUpdate {
  readonly owner: CutsceneRunOwner;
  readonly revision: number;
  readonly checkpoint: CutsceneRunCheckpoint;
}
export interface CutsceneRunRecovery { readonly controllerId: string; readonly revision: number }
export interface CutsceneRunFinish {
  readonly owner: CutsceneRunOwner;
  readonly revision: number;
  readonly kind: "complete" | "interrupt";
  /** Required for keep: null acknowledges silence/a naturally stopped fragment. */
  readonly music?: CutsceneRetainedMusicSnapshot | null;
}
export interface CutsceneMusicState {
  readonly runId: string | null;
  readonly revision: number;
  readonly audio: CutsceneAudioReturnSnapshot | null;
}
export interface CutsceneRunFinishResult {
  readonly run: CutsceneRunState;
  readonly display: PlayerDisplayState | null;
  readonly music: CutsceneMusicState;
  readonly imageResult: CutsceneImageFinish;
  readonly audioResult: CutsceneAudioFinish;
  readonly closeWindow: boolean;
}
export interface CutsceneRuntimeUsage {
  readonly cutsceneId: number;
  readonly runs: readonly { readonly runId: string; readonly mode: "live" | "rehearsal" }[];
  readonly frame: boolean;
  readonly music: boolean;
}
