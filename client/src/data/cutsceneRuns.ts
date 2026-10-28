import type { CutsceneMediaCheck, CutsceneOriginal, CutsceneReadiness } from "@shared/cutscenes/types";
import type { CutsceneMusicState, CutsceneRunFinish, CutsceneRunFinishResult, CutsceneRunRecovery,
  CutsceneRunStart, CutsceneRunState, CutsceneRunUpdate } from "@shared/cutscenes/runApi";
import { afterWriteAnywhere, readOnce } from "./imperative";
import { write } from "./hooks";
import { showSaveError } from "./notices";

const ROOT = "/cutscene-runs";
export interface CutsceneRunRepository {
  original(id: number): Promise<CutsceneOriginal>;
  check(id: number): Promise<{ checks: readonly CutsceneMediaCheck[]; readiness: CutsceneReadiness }>;
  active(): Promise<CutsceneRunState | null>;
  music(): Promise<CutsceneMusicState>;
  read(runId: string): Promise<CutsceneRunState>;
  start(input: CutsceneRunStart): Promise<CutsceneRunState>;
  update(runId: string, input: CutsceneRunUpdate): Promise<CutsceneRunState>;
  recover(runId: string, input: CutsceneRunRecovery): Promise<CutsceneRunState>;
  finish(runId: string, input: CutsceneRunFinish): Promise<CutsceneRunFinishResult>;
  releaseMusic(runId: string, revision: number): Promise<CutsceneMusicState>;
}
function changed(run: CutsceneRunState, display = false, music = false): void {
  afterWriteAnywhere([{ path: `${ROOT}/active` }, { path: `${ROOT}/${run.snapshot.runId}` },
    { path: `${ROOT}/usage` }, ...(display ? [{ path: "/presentation" }] : []),
    ...(music ? [{ path: `${ROOT}/music` }] : [])]);
}
export const cutsceneRuns: CutsceneRunRepository = {
  original: id => readOnce(`/cutscenes/${id}`),
  // POST reads existing files; write suppresses the transport's global cache reset.
  check: id => write.post(`/cutscenes/${id}/readiness`),
  active: () => readOnce(`${ROOT}/active`),
  music: () => readOnce(`${ROOT}/music`),
  read: id => readOnce(`${ROOT}/${encodeURIComponent(id)}`),
  async start(input) { const run = await write.post<CutsceneRunState>(ROOT, input); changed(run); return run; },
  async update(id, input) {
    const run = await write.put<CutsceneRunState>(`${ROOT}/${encodeURIComponent(id)}/checkpoint`, input);
    changed(run, run.snapshot.mode === "live" && input.checkpoint.phase === "playing"); return run;
  },
  async recover(id, input) {
    const run = await write.post<CutsceneRunState>(`${ROOT}/${encodeURIComponent(id)}/recover`, input);
    changed(run); return run;
  },
  async finish(id, input) {
    const result = await write.post<CutsceneRunFinishResult>(`${ROOT}/${encodeURIComponent(id)}/finish`, input);
    changed(result.run, result.run.snapshot.mode === "live", true); return result;
  },
  async releaseMusic(runId, revision) {
    try {
      const result = await write.post<CutsceneMusicState>(`${ROOT}/music/release`, { runId, revision });
      afterWriteAnywhere([{ path: `${ROOT}/music` }, { path: `${ROOT}/usage` }]); return result;
    } catch (error) {
      showSaveError(error instanceof Error ? error.message : String(error), () => cutsceneRuns.releaseMusic(runId, revision));
      throw error;
    }
  },
};
