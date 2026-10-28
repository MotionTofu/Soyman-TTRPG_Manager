import { Router } from "express";
import { requireAuth } from "../services/auth";
import { collectCutsceneMedia } from "../services/cutsceneMedia";
import { CutsceneRequestError } from "../services/cutsceneErrors";
import { claimPlayerDisplay, parseDisplayOwner, publishPlayerDisplay, publishSessionDisplay, readPlayerDisplay,
  readPlayerFrame, releasePlayerDisplay, reportPlayerViewport } from "../services/playerDisplay";

export const playerDisplayRouter = Router();
playerDisplayRouter.use(requireAuth("gm"));
playerDisplayRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const action = (run: (body: Record<string, unknown>) => unknown, cleanup = false) =>
  (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const result = run(req.body ?? {});
      if (cleanup) collectCutsceneMedia(); // only after the outer write committed
      res.json(result);
    } catch (error) {
      if (error instanceof CutsceneRequestError) res.status(error.status).json({ error: error.message });
      else next(error);
    }
  };
playerDisplayRouter.get("/state", action(() => readPlayerDisplay()));
playerDisplayRouter.get("/frame", action(() => readPlayerFrame()));
playerDisplayRouter.put("/state", action(body => publishPlayerDisplay(body.snapshot,
  body.owner == null ? null : parseDisplayOwner(body.owner), body.transition), true));
playerDisplayRouter.put("/viewport", action(body => reportPlayerViewport(body)));
playerDisplayRouter.put("/ownership", action(body => body.release === true ? releasePlayerDisplay(parseDisplayOwner(body.owner)) : claimPlayerDisplay(parseDisplayOwner(body.owner))));
playerDisplayRouter.delete("/ownership", action(body => releasePlayerDisplay(parseDisplayOwner(body.owner))));
playerDisplayRouter.post("/session/:id", (req, res, next) => {
  try { const state = publishSessionDisplay(Number(req.params.id), req.body?.ifEmpty === true); collectCutsceneMedia(); res.json(state); }
  catch (error) { if (error instanceof CutsceneRequestError) res.status(error.status).json({ error: error.message }); else next(error); }
});
