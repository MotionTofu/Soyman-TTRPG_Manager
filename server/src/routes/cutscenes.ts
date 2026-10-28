import { readCutsceneThumbnail } from "../services/cutsceneThumbnail";
import { Router, type RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { requireAuth } from "../services/auth";
import {
  CutsceneRequestError, createCutscene, cutsceneDraft, cutsceneId, listCutscenes,
  readCutscene, readCutsceneBindings, removeCutsceneBinding, replaceCutsceneBindings, saveCutscene,
  type CutsceneContext,
} from "../services/cutscenes";
import { accessCutsceneMedia, checkCutsceneMedia, collectCutsceneMedia, cutsceneMediaSource,
  discardCutsceneStagedMedia, importCutsceneMedia, listCutsceneMedia } from "../services/cutsceneMedia";
import { duplicateCutscene } from "../services/cutsceneDuplicate";
import { assertVaultPath, ensureSubfolder, VAULT_ROOT, vaultAbs } from "../services/filesystem";
import { assertPathInside } from "../services/pathSafety";
import { db } from "../db/db";
import { readCutsceneUsage } from "../services/cutsceneUsage";

/** Root /api router. Auth is scoped to these routes, never to unrelated /api paths. */
export const cutscenesRouter = Router();
const gm = requireAuth("gm");
const route = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  const fail = (error: unknown) => {
    if (error instanceof CutsceneRequestError) {
      res.status(error.status).json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) });
    } else next(error);
  };
  try { Promise.resolve(handler(req, res, next)).catch(fail); }
  catch (error) { fail(error); }
};

function mediaKind(raw: unknown): "image" | "audio" {
  if (raw !== "image" && raw !== "audio") throw new CutsceneRequestError(400, "Нужен вид image/audio");
  return raw;
}
function cleanupUpload(file: Express.Multer.File | undefined, root: string): void {
  if (!file) return;
  try { fs.unlinkSync(assertPathInside(root, file.path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Cutscene upload cleanup failed", error); }
}
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, done) {
      try { done(null, vaultAbs(ensureSubfolder(VAULT_ROOT, ".uploads"))); }
      catch (error) { done(error as Error, ""); }
    },
    filename(_req, _file, done) { done(null, `cutscene-${randomUUID()}.upload`); },
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 4 },
}).single("file");
const uploadFile: RequestHandler = (req, res, next) => {
  const database = db.prepare("SELECT 1").database, root = VAULT_ROOT;
  try { mediaKind(req.params.kind); cutsceneId(req.params.id); readCutscene(cutsceneId(req.params.id)); }
  catch (error) {
    const failure = error as CutsceneRequestError;
    res.status(failure.status ?? 400).json({ error: failure.message }); return;
  }
  upload(req, res, error => {
    if (error) {
      cleanupUpload(req.file, root);
      res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: "Не удалось загрузить файл (не более 200 МБ)" }); return;
    }
    if (!database.open || root !== VAULT_ROOT || db.prepare("SELECT 1").database !== database) {
      cleanupUpload(req.file, root);
      res.status(409).json({ error: "Хранилище изменилось во время загрузки" }); return;
    }
    next();
  });
};

cutscenesRouter.get("/cutscenes", gm, route((req, res) => {
  res.json(listCutscenes(req.query));
}));
cutscenesRouter.post("/cutscenes", gm, route((req, res) => {
  res.status(201).json(createCutscene(cutsceneDraft(req.body?.document)));
}));
cutscenesRouter.get("/cutscenes/:id", gm, route((req, res) => {
  res.json(readCutscene(cutsceneId(req.params.id)));
}));
cutscenesRouter.put("/cutscenes/:id", gm, route((req, res) => {
  const id = cutsceneId(req.params.id);
  const result = saveCutscene(id, cutsceneDraft(req.body?.document));
  collectCutsceneMedia(id);
  res.json(result);
}));

cutscenesRouter.get("/cutscenes/:id/usage", gm, route((req, res) => {
  res.json(readCutsceneUsage(cutsceneId(req.params.id)));
}));
cutscenesRouter.delete("/cutscenes/:id", gm, route((req, res) => {
  const id = cutsceneId(req.params.id); readCutscene(id);
  db.prepare("UPDATE cutscenes SET archived_at = COALESCE(archived_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
  res.json(readCutscene(id));
}));
cutscenesRouter.put("/cutscenes/:id/restore", gm, route((req, res) => {
  const id = cutsceneId(req.params.id); readCutscene(id);
  db.prepare("UPDATE cutscenes SET archived_at = NULL WHERE id = ?").run(id);
  res.json(readCutscene(id));
}));

cutscenesRouter.get("/cutscenes/:id/thumbnail", gm, route((req, res) => {
  res.json(readCutsceneThumbnail(cutsceneId(req.params.id)));
}));

cutscenesRouter.get("/cutscenes/:id/media", gm, route((req, res) => {
  res.json(listCutsceneMedia(cutsceneId(req.params.id)));
}));
cutscenesRouter.post("/cutscenes/:id/media/import", gm, route(async (req, res) => {
  const kind = mediaKind(req.body?.kind);
  const source = cutsceneMediaSource(kind, req.body?.source);
  res.status(201).json(await importCutsceneMedia(cutsceneId(req.params.id), kind, source.file, source.name));
}));
cutscenesRouter.post("/cutscenes/:id/media/:kind/upload", gm, uploadFile, route(async (req, res) => {
  if (!req.file) throw new CutsceneRequestError(400, "Нужен файл");
  const root = VAULT_ROOT;
  try {
    const result = await importCutsceneMedia(cutsceneId(req.params.id), mediaKind(req.params.kind), req.file.path, req.file.originalname);
    res.status(201).json(result);
  } finally { cleanupUpload(req.file, root); }
}));
cutscenesRouter.get("/cutscenes/:id/media/:mediaId/access", gm, route((req, res) => {
  res.json(accessCutsceneMedia(cutsceneId(req.params.id), req.params.mediaId));
}));
cutscenesRouter.delete("/cutscenes/:id/media/:mediaId", gm, route((req, res) => {
  res.json(discardCutsceneStagedMedia(cutsceneId(req.params.id), req.params.mediaId));
}));
cutscenesRouter.post("/cutscenes/:id/readiness", gm, route(async (req, res) => {
  res.json(await checkCutsceneMedia(readCutscene(cutsceneId(req.params.id)).document));
}));
cutscenesRouter.post("/cutscenes/:id/duplicate", gm, route(async (req, res) => {
  res.status(201).json(await duplicateCutscene(cutsceneId(req.params.id)));
}));

for (const context of ["campaign", "session"] as const satisfies readonly CutsceneContext[]) {
  const base = `/${context}s/:contextId/cutscenes`;
  cutscenesRouter.get(base, gm, route((req, res) => {
    res.json(readCutsceneBindings(context, cutsceneId(req.params.contextId)));
  }));
  cutscenesRouter.put(base, gm, route((req, res) => {
    res.json(replaceCutsceneBindings(context, cutsceneId(req.params.contextId), req.body?.cutsceneIds));
  }));
  cutscenesRouter.delete(`${base}/:cutsceneId`, gm, route((req, res) => {
    removeCutsceneBinding(context, cutsceneId(req.params.contextId), cutsceneId(req.params.cutsceneId));
    res.status(204).end();
  }));
}
