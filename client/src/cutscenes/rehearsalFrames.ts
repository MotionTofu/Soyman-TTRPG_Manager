import type { CutsceneResolvedStep } from "@shared/cutscenes/types";
import type { CutsceneRunState } from "@shared/cutscenes/runApi";
import type { PlayerDisplayFrame } from "@shared/playerDisplay";
import type { PresentationData } from "@shared/presentation";

let runId: string | null = null;
const prepared = new Map<string | null, PresentationData>();
const listeners = new Set<() => void>();
let revision = 0;
export const subscribeRehearsalFrames = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const rehearsalFramesRevision = () => revision;

/** Local pixels prepared by the existing output port, before a checkpoint can commit the step. */
export function rememberRehearsalFrame(run: CutsceneRunState, step: CutsceneResolvedStep, data: PresentationData): void {
  if (runId !== run.snapshot.runId) { prepared.clear(); runId = run.snapshot.runId; }
  prepared.set(step.image.sourceStepId, data);
  revision++; listeners.forEach(listener => listener());
}
export function readRehearsalFrame(run: CutsceneRunState, step: CutsceneResolvedStep): PlayerDisplayFrame | null {
  const data = runId === run.snapshot.runId ? prepared.get(step.image.sourceStepId) : undefined;
  if (step.image.composition && !data) return null;
  return {
    revision: run.revision, playKey: `${run.snapshot.runId}:${step.image.sourceStepId ?? "black"}`,
    display: run.snapshot.returnState.presentation?.display ?? { rotation: 0, fit: "contain", zoom: 1, pan_x: 0, pan_y: 0, screen_w: null, screen_h: null },
    transition: step.image.transition,
    content: data && step.image.composition ? { kind: "composition", data, visibleLayerIds: [] } : { kind: "black" },
  };
}
