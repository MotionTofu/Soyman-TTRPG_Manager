import { createCutsceneVisualTransition, CUTSCENE_DEFAULTS } from "./defaults";
import type { CutsceneDocument, CutsceneResolvedStep } from "./types";

/** Pure fold of a validated document; IDs survive reordering and inherited commands. */
export function resolveCutsceneStep(document: CutsceneDocument, stepId: string): CutsceneResolvedStep | null {
  const stepIndex = document.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) return null;
  let image: CutsceneResolvedStep["image"] = {
    sourceStepId: null, composition: null, transition: createCutsceneVisualTransition(),
  };
  let audio: CutsceneResolvedStep["audio"] = {
    sourceStepId: null, command: null, fadeOutMs: CUTSCENE_DEFAULTS.audioFadeOutMs,
  };
  let text: CutsceneResolvedStep["text"] = { sourceStepId: null, text: null };
  for (let index = 0; index <= stepIndex; index++) {
    const step = document.steps[index];
    if (step.image.action !== "keep") {
      image = { sourceStepId: step.id,
        composition: step.image.action === "replace" ? step.image.composition : null,
        transition: step.image.transition };
    }
    if (step.audio.action === "replace") {
      audio = { sourceStepId: step.id, command: step.audio.command, fadeOutMs: step.audio.command.transition.fadeOutMs };
    } else if (step.audio.action === "clear") {
      audio = { sourceStepId: step.id, command: null, fadeOutMs: step.audio.fadeOutMs };
    }
    if (step.text.action !== "keep") {
      text = { sourceStepId: step.id, text: step.text.action === "replace" ? step.text.text : null };
    }
  }
  return { stepId, stepIndex, image, audio, text, notes: document.steps[stepIndex].notes };
}
