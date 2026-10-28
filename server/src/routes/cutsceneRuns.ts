import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../services/auth";
import { collectCutsceneMedia } from "../services/cutsceneMedia";
import { CutsceneRequestError } from "../services/cutsceneErrors";
import { cutsceneId } from "../services/cutscenes";
import { finishCutsceneRun, readActiveCutsceneRun, readCutsceneMusic, readCutsceneRun, readCutsceneRuntimeUsage,
  recoverCutsceneRun, releaseCutsceneMusic, startCutsceneRun, updateCutsceneRun } from "../services/cutsceneRuns";

export const cutsceneRunsRouter = Router();
cutsceneRunsRouter.use(requireAuth("gm"));
cutsceneRunsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const action = (run: (req: Request) => unknown, cleanup = false, status = 200) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = run(req);
    if (cleanup) collectCutsceneMedia(); // All outer SQL transactions have committed.
    res.status(status).json(result);
  } catch (error) {
    if (error instanceof CutsceneRequestError) res.status(error.status).json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) });
    else next(error);
  }
};
cutsceneRunsRouter.get("/active", action(() => readActiveCutsceneRun()));
cutsceneRunsRouter.get("/music", action(() => readCutsceneMusic()));
cutsceneRunsRouter.post("/music/release", action(req => releaseCutsceneMusic(req.body), true));
cutsceneRunsRouter.get("/usage/:cutsceneId", action(req => readCutsceneRuntimeUsage(cutsceneId(req.params.cutsceneId))));
cutsceneRunsRouter.post("/", action(req => startCutsceneRun(req.body), false, 201));
cutsceneRunsRouter.get("/:runId", action(req => readCutsceneRun(req.params.runId)));
cutsceneRunsRouter.put("/:runId/checkpoint", action(req => updateCutsceneRun(req.params.runId, req.body)));
cutsceneRunsRouter.post("/:runId/recover", action(req => recoverCutsceneRun(req.params.runId, req.body)));
cutsceneRunsRouter.post("/:runId/finish", action(req => finishCutsceneRun(req.params.runId, req.body), true));
