import type { CutscenePreviewStart, CutscenePreviewState, CutscenePreviewUpdate } from "@shared/cutscenes/previewApi";
import type { CutsceneRunOwner } from "@shared/cutscenes/runApi";
import { readOnce, afterWriteAnywhere } from "./imperative";
import { write } from "./hooks";

const root = "/cutscene-previews";
const changed = () => afterWriteAnywhere([{ path: `${root}/active` }, { path: "/presentation" }, { path: "/cutscene-runs/usage" }]);
export const cutscenePreviews = {
  active: () => readOnce<CutscenePreviewState | null>(`${root}/active`),
  start: (value: CutscenePreviewStart) => write.post<CutscenePreviewState>(`${root}/start`, value),
  async update(value: CutscenePreviewUpdate) { const result = await write.post<CutscenePreviewState>(`${root}/update`, value); if (value.publish) changed(); return result; },
  heartbeat: (owner: CutsceneRunOwner) => write.post<CutscenePreviewState>(`${root}/heartbeat`, { owner }),
  async stop(owner: CutsceneRunOwner) { const result = await write.post<CutscenePreviewState>(`${root}/stop`, { owner }); changed(); return result; },
  async acknowledge(owner: CutsceneRunOwner) { await write.post(`${root}/acknowledge`, { owner }); changed(); },
  claimReturn: (owner: CutsceneRunOwner, controllerId: string) => write.post<CutscenePreviewState>(`${root}/claim-return`, { owner, controllerId }),
};
