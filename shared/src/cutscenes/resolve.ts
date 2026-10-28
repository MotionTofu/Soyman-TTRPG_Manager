import { createCutsceneVisualTransition, CUTSCENE_DEFAULTS } from "./defaults";
import type { CutsceneDocument, CutsceneResolvedStep, CutsceneStep } from "./types";

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

/** GM-facing label: own name, then the step's own caption, then the first words of its own text, then its number. */
export function cutsceneStepLabel(step: CutsceneStep, index: number): string {
  const name = step.name?.trim();
  if (name) return name;
  const caption = step.image.action === "replace" ? step.image.composition.title.trim() : "";
  if (caption) return caption;
  const words = step.text.action === "replace" ? step.text.text.replace(/[*_#>`~[\]()]/g, " ").trim().split(/\s+/).filter(Boolean) : [];
  if (words.length) return words.length > 5 ? `${words.slice(0, 5).join(" ")}…` : words.join(" ");
  return `Шаг ${index + 1}`;
}

/** "3 · Берез" for a labelled step, plain "Шаг 3" when nothing names it. */
export function cutsceneStepTitle(step: CutsceneStep, index: number): string {
  const label = cutsceneStepLabel(step, index);
  return label === `Шаг ${index + 1}` ? label : `${index + 1} · ${label}`;
}

/** File name of a picked image as a starting step name: "04_Witch_hut.png" → "Witch hut". */
export function cutsceneStepNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/^\d+[\s_.-]+/, "").replace(/_+/g, " ").trim();
}
