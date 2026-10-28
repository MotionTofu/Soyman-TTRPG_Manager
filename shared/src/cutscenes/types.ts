import type { PresentationData, PresentationLayer, PresentationTransitionKind, ShowDisplay } from "../presentation";

/** Opaque IDs are assigned by storage/the editor, never by array position. */
export type CutsceneMediaKind = "image" | "audio";
export interface CutsceneMediaRef<K extends CutsceneMediaKind = CutsceneMediaKind> {
  readonly kind: K;
  readonly id: string;
}

/** Transient access is not part of a saved document or return snapshot. */
export interface CutsceneMediaAccess {
  readonly ref: CutsceneMediaRef;
  readonly url: string;
  readonly expiresAt: string | null;
}

export interface CutsceneVisualTransition {
  readonly kind: PresentationTransitionKind;
  /** Total duration, including BOTH halves of a transition through black. */
  readonly durationMs: number;
}

export interface CutsceneAudioTransition {
  readonly mode: "crossfade" | "sequential";
  readonly fadeOutMs: number;
  readonly fadeInMs: number;
}

export type CutsceneLoopTransition =
  | { readonly mode: "cut" }
  | { readonly mode: "crossfade"; readonly durationMs: number }
  | { readonly mode: "sequential"; readonly fadeOutMs: number; readonly fadeInMs: number };

export interface CutsceneImageLayer extends Readonly<Pick<PresentationLayer,
  "name" | "position" | "x_pct" | "y_pct" | "w_pct" | "h_pct">> {
  readonly id: string;
  readonly image: CutsceneMediaRef<"image">;
  readonly visible: boolean;
}

/** Geometry and caption settings retain the existing presentation meanings. */
export interface CutsceneComposition extends Readonly<Pick<PresentationData, "title" | "title_secs" | "fade_ms">> {
  readonly background: CutsceneMediaRef<"image"> | null;
  readonly layers: readonly CutsceneImageLayer[];
}

export interface CutsceneAudioCommand {
  readonly id: string;
  readonly audio: CutsceneMediaRef<"audio">;
  readonly startSeconds: number;
  readonly endSeconds: number | null;
  /** Linear gain, 0..1. */
  readonly volume: number;
  readonly transition: CutsceneAudioTransition;
  readonly loop: { readonly enabled: boolean; readonly transition: CutsceneLoopTransition };
  readonly endFadeOutMs: number;
}

export type CutsceneImageAction =
  | { readonly action: "keep" }
  | { readonly action: "clear"; readonly transition: CutsceneVisualTransition }
  | { readonly action: "replace"; readonly composition: CutsceneComposition; readonly transition: CutsceneVisualTransition };

export type CutsceneAudioAction =
  | { readonly action: "keep" }
  | { readonly action: "clear"; readonly fadeOutMs: number }
  | { readonly action: "replace"; readonly command: CutsceneAudioCommand };

export type CutsceneTextAction =
  | { readonly action: "keep" }
  | { readonly action: "clear" }
  | { readonly action: "replace"; readonly text: string };

export interface CutsceneStep {
  readonly id: string;
  readonly image: CutsceneImageAction;
  readonly audio: CutsceneAudioAction;
  readonly text: CutsceneTextAction;
  /** Belongs to this step; never inherited with its narration. */
  readonly notes: string;
}

export type CutsceneAudioScope = "music" | "all";
export type CutsceneImageFinish = "restore" | "keep" | "black";
export type CutsceneAudioFinish = "restore" | "keep" | "silence";

export interface CutsceneSettings {
  readonly audioScope: CutsceneAudioScope;
  readonly wordsPerMinute: number;
  readonly finish: {
    readonly image: CutsceneImageFinish;
    readonly audio: CutsceneAudioFinish;
    readonly imageTransition: CutsceneVisualTransition;
    readonly audioTransition: CutsceneAudioTransition;
  };
}

/** Internal document, not the deferred portable exchange format. */
export interface CutsceneDocument {
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly settings: CutsceneSettings;
  readonly steps: readonly CutsceneStep[];
}

export interface CutsceneOriginal {
  readonly id: number;
  /** Opaque identifier of the last successful save. */
  readonly savedVersion: string;
  readonly document: CutsceneDocument;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface CutsceneVersionSnapshot {
  readonly cutsceneId: number;
  readonly savedVersion: string;
  readonly document: CutsceneDocument;
}

export interface CutsceneResolvedStep {
  readonly stepId: string;
  readonly stepIndex: number;
  readonly image: {
    readonly sourceStepId: string | null;
    readonly composition: CutsceneComposition | null;
    readonly transition: CutsceneVisualTransition;
  };
  readonly audio: {
    readonly sourceStepId: string | null;
    readonly command: CutsceneAudioCommand | null;
    readonly fadeOutMs: number;
  };
  readonly text: { readonly sourceStepId: string | null; readonly text: string | null };
  readonly notes: string;
}

/** No read-aloud text, notes, layer labels, audio or return state. */
export interface CutscenePlayerFrame {
  readonly stepId: string;
  readonly sourceStepId: string | null;
  readonly transition: CutsceneVisualTransition;
  readonly composition: (Readonly<Pick<CutsceneComposition, "background" | "title" | "title_secs" | "fade_ms">> & {
    readonly layers: readonly Readonly<Omit<CutsceneImageLayer, "name">>[];
  }) | null;
}

export type CutsceneLaunchContext =
  | { readonly kind: "library" }
  | { readonly kind: "campaign"; readonly campaignId: number }
  | { readonly kind: "session"; readonly sessionId: number; readonly campaignId: number | null };

export type CutscenePresentationSource =
  | { readonly kind: "black" }
  | { readonly kind: "scene"; readonly sceneId: number }
  | { readonly kind: "cover"; readonly campaignId: number }
  | { readonly kind: "map"; readonly mapId: number }
  | { readonly kind: "cutscene"; readonly cutsceneId: number; readonly frame: CutscenePlayerFrame };

export interface CutscenePresentationSnapshot {
  readonly source: CutscenePresentationSource;
  readonly context: CutsceneLaunchContext | null;
  readonly display: Readonly<ShowDisplay>;
  readonly visibleLayerIds: readonly number[];
  readonly playKey: string;
}

/** Existing application audio and retained music of a preceding cutscene. */
export type CutsceneAudioSource =
  | { readonly kind: "resource"; readonly resourceId: number }
  | { readonly kind: "cutscene"; readonly audio: CutsceneMediaRef<"audio"> };

export type CutsceneTransportState = "playing" | "paused" | "stopped";
export interface CutsceneBackgroundQueueSnapshot {
  readonly kind: "queue";
  readonly queue: readonly { readonly source: CutsceneAudioSource; readonly name: string }[];
  readonly index: number | null;
  readonly positionSeconds: number;
  readonly state: CutsceneTransportState;
  readonly volume: number;
  readonly repeat: "off" | "track" | "playlist";
  readonly shuffle: boolean;
  readonly activePlaylistId: number | null;
}

/** A previous cutscene may have left its fragment and loop running after exit. */
export interface CutsceneRetainedMusicSnapshot {
  readonly kind: "cutscene";
  readonly cutsceneId: number;
  readonly runId: string;
  readonly command: CutsceneAudioCommand;
  readonly positionSeconds: number;
  readonly state: CutsceneTransportState;
  readonly volume: number;
}

export type CutsceneBackgroundSnapshot = CutsceneBackgroundQueueSnapshot | CutsceneRetainedMusicSnapshot;

export interface CutsceneLoopChannelSnapshot {
  readonly source: CutsceneAudioSource | null;
  readonly positionSeconds: number;
  readonly state: CutsceneTransportState;
}

/** Runtime automation also survives recovery; it contains stable queue sources, never signed URLs. */
export interface CutsceneAudioAutomationSnapshot {
  readonly combat: { readonly from: string; readonly to: string; readonly previous: CutsceneBackgroundQueueSnapshot } | null;
  readonly sceneSet?: { readonly scene: string; readonly to: string; readonly previousSetId: number | null } | null;
}

/** Stingers are deliberately absent: interrupted one-shots are not resumed. */
export type CutsceneAudioReturnSnapshot =
  | { readonly scope: "music"; readonly background: CutsceneBackgroundSnapshot; readonly automation?: CutsceneAudioAutomationSnapshot }
  | {
    readonly scope: "all";
    readonly background: CutsceneBackgroundSnapshot;
    readonly ambient: CutsceneLoopChannelSnapshot;
    readonly weather: CutsceneLoopChannelSnapshot;
    readonly setId: number | null;
    readonly duckingId: number | null;
    readonly silence: boolean;
    readonly volumes: Readonly<Record<"master" | "background" | "ambient" | "weather" | "stinger", number>>;
    readonly automation?: CutsceneAudioAutomationSnapshot;
  };

export interface CutsceneReturnSnapshot {
  /** null means there was no prior presentation, not a black presentation. */
  readonly presentation: CutscenePresentationSnapshot | null;
  readonly audio: CutsceneAudioReturnSnapshot;
  readonly window: { readonly wasOpen: boolean; readonly openedByRun: boolean; readonly screenId: string | null;
    /** Identity of the script-opened window; older snapshots may omit it. */
    readonly windowId?: string | null };
}

export type CutsceneOwnedAudioChannel = "background" | "ambient" | "weather" | "stinger";
export interface CutsceneOwnership {
  readonly runId: string;
  readonly controllerId: string;
  readonly display: boolean;
  readonly audioScope: CutsceneAudioScope;
}

export interface CutsceneRunSnapshot {
  readonly runId: string;
  readonly mode: "live" | "rehearsal";
  readonly context: CutsceneLaunchContext;
  readonly version: CutsceneVersionSnapshot;
  readonly returnState: CutsceneReturnSnapshot;
  readonly ownership: CutsceneOwnership;
}

export type CutsceneRunPhase = "ready" | "preparing" | "playing" | "paused" | "error" | "completed" | "interrupted";
export interface CutsceneRunError {
  readonly code: "media" | "display" | "audio" | "storage" | "preparation";
  readonly message: string;
  readonly stepId: string | null;
  readonly media: CutsceneMediaRef | null;
}

/** Recovery saves the committed step, not a continuous music/scroll history. */
export interface CutsceneRunCheckpoint {
  readonly runId: string;
  readonly stepId: string | null;
  readonly pendingStepId: string | null;
  readonly phase: CutsceneRunPhase;
  readonly textPaused: boolean;
  readonly error: CutsceneRunError | null;
}

export interface CutsceneValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly stepId: string | null;
}

export type CutsceneParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly CutsceneValidationIssue[] };

export interface CutsceneMediaUse {
  readonly ref: CutsceneMediaRef;
  readonly stepId: string;
  readonly path: string;
}

/** Produced by media preparation; shared itself performs no file/network IO. */
export interface CutsceneMediaCheck {
  readonly ref: CutsceneMediaRef;
  readonly status: "ready" | "missing" | "unreadable" | "pending";
  readonly durationSeconds: number | null;
}

export type CutsceneReadiness =
  | { readonly ready: true; readonly document: CutsceneDocument }
  | { readonly ready: false; readonly issues: readonly CutsceneValidationIssue[] };
