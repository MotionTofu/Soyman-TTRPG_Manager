import type { CutsceneDocument, CutsceneReturnSnapshot, CutsceneAudioReturnSnapshot } from "./types";
import type { CutsceneRunOwner } from "./runApi";
import { createCutsceneDocument } from "./defaults";
import { resolveCutsceneStep } from "./resolve";

/** Only the selected step and its resolved sources are needed to validate a preview. */
export function selectedPreviewDocument(document: CutsceneDocument, stepId: string): CutsceneDocument {
  const step = resolveCutsceneStep(document, stepId);
  if (!step) throw new Error("Шаг предпросмотра не найден");
  return { ...createCutsceneDocument(document.name.trim() || "Предпросмотр"), settings: document.settings, steps: [{
    id: step.stepId, notes: step.notes,
    image: step.image.composition ? { action: "replace", composition: step.image.composition, transition: step.image.transition }
      : { action: "clear", transition: step.image.transition },
    audio: step.audio.command ? { action: "replace", command: step.audio.command } : { action: "clear", fadeOutMs: step.audio.fadeOutMs },
    text: step.text.text ? { action: "replace", text: step.text.text } : { action: "clear" },
  }] };
}
export interface CutscenePreviewState {
  readonly owner: CutsceneRunOwner;
  readonly cutsceneId: number;
  /** Resolved, validated working projection; never a saved run snapshot. */
  readonly document: CutsceneDocument;
  readonly phase: "active" | "returning";
  readonly revision: number;
  readonly updatedAt: number;
  readonly external: boolean;
  readonly audio: CutsceneAudioReturnSnapshot | null;
  readonly presentation: CutsceneReturnSnapshot["presentation"];
  readonly window: CutsceneReturnSnapshot["window"] | null;
  readonly visualPlayback: CutsceneVisualPlayback;
}
/** Time in the visual entrance only; there is no automatic step duration. */
export interface CutsceneVisualPlayback { readonly elapsedMs: number; readonly startedAt: number | null }
export interface CutscenePreviewStart {
  readonly owner: CutsceneRunOwner;
  readonly cutsceneId: number;
  readonly document: CutsceneDocument;
}
export interface CutscenePreviewUpdate {
  readonly owner: CutsceneRunOwner;
  readonly revision: number;
  readonly document?: CutsceneDocument;
  readonly audio?: CutsceneAudioReturnSnapshot;
  readonly window?: CutsceneReturnSnapshot["window"];
  readonly publish?: boolean;
  readonly playKey?: string;
  readonly animate?: boolean;
  readonly visualPlayback?: CutsceneVisualPlayback;
}
