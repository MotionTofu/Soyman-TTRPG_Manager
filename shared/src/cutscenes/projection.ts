import type { CutsceneMediaRef, CutscenePlayerFrame, CutsceneResolvedStep } from "./types";

function imageRef(ref: CutsceneMediaRef<"image">): CutsceneMediaRef<"image"> {
  return { kind: "image", id: ref.id };
}

/** Explicit allow-list at every level; never spread a GM object into the player payload. */
export function projectCutscenePlayerFrame(state: CutsceneResolvedStep): CutscenePlayerFrame {
  const composition = state.image.composition;
  return {
    stepId: state.stepId,
    sourceStepId: state.image.sourceStepId,
    transition: { kind: state.image.transition.kind, durationMs: state.image.transition.durationMs },
    composition: composition === null ? null : {
      background: composition.background === null ? null : imageRef(composition.background),
      title: composition.title, title_secs: composition.title_secs, fade_ms: composition.fade_ms,
      layers: composition.layers.map((layer) => ({
        id: layer.id, image: imageRef(layer.image), position: layer.position, visible: layer.visible,
        x_pct: layer.x_pct, y_pct: layer.y_pct, w_pct: layer.w_pct, h_pct: layer.h_pct,
      })),
    },
  };
}
