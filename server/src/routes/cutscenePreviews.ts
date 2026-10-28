import { Router } from "express";
import { requireAuth } from "../services/auth";
import { CutsceneRequestError } from "../services/cutsceneErrors";
import { readCutscenePreview, startCutscenePreview, updateCutscenePreview, heartbeatCutscenePreview, stopCutscenePreview, acknowledgeCutscenePreview, claimCutscenePreviewReturn } from "../services/cutscenePreviews";

export const cutscenePreviewsRouter = Router();
cutscenePreviewsRouter.use(requireAuth("gm"));
cutscenePreviewsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const handlers = { start: startCutscenePreview, update: updateCutscenePreview, heartbeat: heartbeatCutscenePreview,
  stop: stopCutscenePreview, acknowledge: acknowledgeCutscenePreview, "claim-return": claimCutscenePreviewReturn };
cutscenePreviewsRouter.get("/active", (_req, res, next) => { try { res.json(readCutscenePreview()); } catch (error) { next(error); } });
for (const [action, handler] of Object.entries(handlers)) cutscenePreviewsRouter.post(`/${action}`, (req, res, next) => {
  try { res.status(action === "start" ? 201 : 200).json(handler(req.body)); }
  catch (error) { if (error instanceof CutsceneRequestError) res.status(error.status).json({ error: error.message }); else next(error); }
});
