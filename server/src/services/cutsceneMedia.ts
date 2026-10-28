import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { loadEsm } from "load-esm";
import {
  collectCutsceneMediaUses, checkCutsceneReadiness, type CutsceneDocument, type CutsceneMediaAccess,
  type CutsceneMediaCheck, type CutsceneMediaKind, type CutsceneMediaRef,
} from "@soyman/shared";
import { db } from "../db/db";
import { assertVaultPath, ensureSubfolder, toFileUrl, VAULT_ROOT, vaultAbs } from "./filesystem";
import { assertPathInside } from "./pathSafety";
import { storeDedupedFile } from "./vaultDedup";
import { signPath } from "./signedUrl";
import { CutsceneRequestError } from "./cutsceneErrors";

interface MediaRow {
  id: string; cutscene_id: number; kind: CutsceneMediaKind; file_path: string; name: string;
  mime: string; duration_seconds: number | null; state: "pending" | "ready"; created_at: string;
}
export interface CutsceneMediaHold {
  readonly kind: "original" | "staging" | "snapshot" | "frame" | "music";
  readonly key: string;
}
export type CutsceneMediaSource =
  | { readonly kind: "gallery" | "resource"; readonly id: number }
  | { readonly kind: "vault"; readonly path: string };

const IMAGE_FORMATS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: ".jpg", mime: "image/jpeg" }, png: { ext: ".png", mime: "image/png" },
  gif: { ext: ".gif", mime: "image/gif" }, webp: { ext: ".webp", mime: "image/webp" }, avif: { ext: ".avif", mime: "image/avif" },
};
const AUDIO_FORMATS: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".flac": "audio/flac", ".aac": "audio/aac", ".opus": "audio/ogg", ".webm": "audio/webm",
};

function requireOriginal(id: number): void {
  if (!db.prepare("SELECT 1 FROM cutscenes WHERE id = ?").get(id)) throw new CutsceneRequestError(404, "Катсцена не найдена");
}
function mediaRow(ref: CutsceneMediaRef): MediaRow {
  const row = db.prepare("SELECT * FROM cutscene_media WHERE id = ? AND kind = ?").get(ref.id, ref.kind) as MediaRow | undefined;
  if (!row) throw new CutsceneRequestError(404, "Материал катсцены не найден");
  return row;
}
function ownedRow(id: number, mediaId: string): MediaRow {
  const row = db.prepare("SELECT * FROM cutscene_media WHERE id = ? AND cutscene_id = ?").get(mediaId, id) as MediaRow | undefined;
  if (!row) throw new CutsceneRequestError(404, "Материал катсцены не найден");
  return row;
}
function ownedPath(row: MediaRow): string {
  // The ledger must never be able to delete somebody else's gallery/resource file.
  const root = path.join(VAULT_ROOT, "Cutscenes", "media");
  const target = assertVaultPath(row.file_path);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Not a cutscene-owned path");
  }
  return target;
}
function info(row: MediaRow) {
  return { ref: { kind: row.kind, id: row.id } as CutsceneMediaRef, name: row.name,
    mime: row.mime, durationSeconds: row.duration_seconds, state: row.state, createdAt: row.created_at };
}
function uniqueRefs(refs: readonly CutsceneMediaRef[]): CutsceneMediaRef[] {
  return [...new Map(refs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
}
export function documentMediaRefs(document: CutsceneDocument): CutsceneMediaRef[] {
  return uniqueRefs(collectCutsceneMediaUses(document).map(use => use.ref));
}

/** Replaces the COMPLETE hold atomically. Used inside the run/document transaction by consumers. */
export function retainCutsceneMedia(hold: CutsceneMediaHold, refs: readonly CutsceneMediaRef[], ownerId?: number): void {
  if (!hold.key) throw new Error("A media hold needs a stable key");
  db.transaction(() => {
    const rows = uniqueRefs(refs).map(ref => {
      const row = mediaRow(ref);
      if (row.state !== "ready" || (ownerId !== undefined && row.cutscene_id !== ownerId)) {
        throw new CutsceneRequestError(400, "Материал ещё не готов или принадлежит другой катсцене");
      }
      return row;
    });
    db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind = ? AND holder_key = ?").run(hold.kind, hold.key);
    const insert = db.prepare("INSERT INTO cutscene_media_holds (holder_kind, holder_key, media_id) VALUES (?, ?, ?)");
    for (const row of rows) insert.run(hold.kind, hold.key, row.id);
  })();
}

/** Original and staging holds change in the SAME SQL transaction as the saved document. */
export function syncCutsceneOriginalMedia(id: number, document: CutsceneDocument): void {
  const refs = documentMediaRefs(document);
  retainCutsceneMedia({ kind: "original", key: String(id) }, refs, id);
  const releaseStaging = db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind = 'staging' AND holder_key = ? AND media_id = ?");
  for (const ref of refs) releaseStaging.run(String(id), ref.id);
}

/** Release is idempotent and does no filesystem IO; collect AFTER the surrounding transaction commits. */
export function releaseCutsceneMedia(hold: CutsceneMediaHold): void {
  db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind = ? AND holder_key = ?").run(hold.kind, hold.key);
}

/** Never expires snapshot/frame/music/staging holds. Failed unlinks stay in the ledger for retry. */
export function collectCutsceneMedia(ownerId?: number) {
  const removed: string[] = [], failed: string[] = [];
  db.transaction(() => {
    const rows = db.prepare(`SELECT m.* FROM cutscene_media m WHERE
      ${ownerId === undefined ? "" : "m.cutscene_id = ? AND"}
      NOT EXISTS (SELECT 1 FROM cutscene_media_holds h WHERE h.media_id = m.id)`)
      .all(...(ownerId === undefined ? [] : [ownerId])) as MediaRow[];
    for (const row of rows) {
      try {
        const target = ownedPath(row);
        try { fs.unlinkSync(target); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        db.prepare("DELETE FROM vault_files WHERE path = ?").run(row.file_path);
        db.prepare("DELETE FROM cutscene_media WHERE id = ?").run(row.id);
        removed.push(row.id);
      } catch { failed.push(row.id); }
    }
  }).immediate();
  return { removed, failed };
}

export function listCutsceneMedia(id: number) {
  requireOriginal(id);
  return (db.prepare("SELECT * FROM cutscene_media WHERE cutscene_id = ? ORDER BY created_at, id").all(id) as MediaRow[]).map(info);
}

export function discardCutsceneStagedMedia(id: number, mediaId: string) {
  const row = ownedRow(id, mediaId);
  db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind = 'staging' AND holder_key = ? AND media_id = ?").run(String(id), row.id);
  return collectCutsceneMedia(id);
}

/** Startup only, before accepting requests: recover interrupted copies, never expire successful staging. */
export function recoverCutsceneMediaUploads() {
  db.transaction(() => {
    // These private holds belong only to interrupted duplicate operations, never to a real run.
    db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind IN ('snapshot', 'staging') AND holder_key LIKE 'duplicate:%'").run();
    db.prepare(`DELETE FROM cutscene_media_holds WHERE holder_kind = 'staging' AND media_id IN
      (SELECT id FROM cutscene_media WHERE state = 'pending')`).run();
  })();
  const result = collectCutsceneMedia();
  const temporary: string[] = [], failed: string[] = [];
  for (const [folder, pattern] of [
    [".uploads", /^cutscene-[0-9a-f-]+\.(upload|frozen)$/],
    ["Cutscenes/media", /^\.upload-[0-9a-f-]+\.tmp$/],
  ] as const) {
    const directory = assertVaultPath(path.join(VAULT_ROOT, folder));
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (!pattern.test(name)) continue;
      try {
        const file = assertVaultPath(path.join(directory, name));
        if (!fs.lstatSync(file).isFile()) continue;
        fs.unlinkSync(file); temporary.push(name);
      } catch { failed.push(name); }
    }
  }
  return { ...result, temporary, failed: [...result.failed, ...failed] };
}

export async function inspectCutsceneFile(file: string, kind: CutsceneMediaKind, name: string) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || !stat.size) throw new CutsceneRequestError(400, "Нужен непустой файл");
  if (kind === "image") {
    const image = sharp(file);
    const metadata = await image.metadata();
    const format = IMAGE_FORMATS[metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format ?? ""];
    if (!format) throw new CutsceneRequestError(400, "Поддерживаются JPG/PNG/GIF/WebP/AVIF");
    await image.resize(1, 1).toBuffer();
    return { ...format, durationSeconds: null };
  }
  const ext = path.extname(name).toLowerCase(), mime = AUDIO_FORMATS[ext];
  if (!mime) throw new CutsceneRequestError(400, "Неподдерживаемый формат аудио");
  // Native ESM loading survives the CommonJS build and Electron's Node 20 runtime.
  const metadata = await (await loadEsm<typeof import("music-metadata")>("music-metadata"))
    .parseFile(file, { duration: true, skipCovers: true });
  const durationSeconds = metadata.format.duration;
  if (!metadata.format.codec || !(Number(metadata.format.numberOfChannels) > 0) ||
      !durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new CutsceneRequestError(400, "Не удалось определить длительность аудио");
  }
  return { ext, mime, durationSeconds };
}

/** Only local app sources; arbitrary external paths never come from the request. */
export function cutsceneMediaSource(kind: CutsceneMediaKind, raw: unknown): { file: string; name: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CutsceneRequestError(400, "Нужен источник материала");
  const source = raw as Record<string, unknown>;
  const localPath = (file: string) => {
    try { return assertVaultPath(file); }
    catch { throw new CutsceneRequestError(400, "Источник вне текущего хранилища"); }
  };
  if (source.kind === "vault" && typeof source.path === "string") {
    const file = localPath(source.path);
    return { file, name: path.basename(file) };
  }
  if (!Number.isSafeInteger(source.id) || Number(source.id) <= 0) throw new CutsceneRequestError(400, "Некорректный источник материала");
  if (source.kind === "gallery" && kind === "image") {
    const row = db.prepare("SELECT image_path FROM gallery_images WHERE id = ?").get(source.id) as { image_path: string } | undefined;
    if (!row) throw new CutsceneRequestError(404, "Картинка галереи не найдена");
    const file = localPath(row.image_path);
    return { file, name: path.basename(file) };
  }
  if (source.kind === "resource") {
    const row = db.prepare("SELECT name, category, file_path FROM resources WHERE id = ?").get(source.id) as
      { name: string; category: string; file_path: string | null } | undefined;
    if (!row?.file_path || row.category !== kind) throw new CutsceneRequestError(404, "Локальный материал не найден");
    // Local external files already registered in Resources are legitimate sources by ID.
    const file = vaultAbs(row.file_path), ext = path.extname(file);
    // The name carries the extension for the audio check; Resources often already have it.
    return { file, name: row.name.toLowerCase().endsWith(ext.toLowerCase()) ? row.name : `${row.name}${ext}` };
  }
  throw new CutsceneRequestError(400, "Неподдерживаемый источник материала");
}

export async function importCutsceneMedia(id: number, kind: CutsceneMediaKind, source: string, name: string, stagingKey = String(id)) {
  const database = db.prepare("SELECT 1").database;
  const root = VAULT_ROOT;
  const sameStorage = () => {
    if (!database.open || root !== VAULT_ROOT || db.prepare("SELECT 1").database !== database) {
      throw new CutsceneRequestError(409, "Хранилище изменилось во время загрузки");
    }
  };
  requireOriginal(id);
  const frozen = assertVaultPath(path.join(ensureSubfolder(VAULT_ROOT, ".uploads"), `cutscene-${randomUUID()}.frozen`));
  try {
    // Freeze before probing: source replacement during parsing cannot change the accepted bytes.
    try { await fs.promises.copyFile(source, frozen); }
    catch { throw new CutsceneRequestError(400, "Исходный файл недоступен"); }
    sameStorage();
    let metadata: Awaited<ReturnType<typeof inspectCutsceneFile>>;
    try { metadata = await inspectCutsceneFile(frozen, kind, name); }
    catch (error) {
      if (error instanceof CutsceneRequestError) throw error;
      throw new CutsceneRequestError(400, "Файл недоступен или не читается");
    }
    sameStorage();
    requireOriginal(id);
    const mediaId = randomUUID();
    const relative = path.join(ensureSubfolder(VAULT_ROOT, "Cutscenes/media"), `${mediaId}${metadata.ext}`);
    const target = assertVaultPath(relative);
    db.transaction(() => {
      db.prepare(`INSERT INTO cutscene_media (id, cutscene_id, kind, file_path, name, mime, duration_seconds, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .run(mediaId, id, kind, relative, path.basename(name), metadata.mime, metadata.durationSeconds, new Date().toISOString());
      db.prepare("INSERT INTO cutscene_media_holds VALUES ('staging', ?, ?)").run(stagingKey, mediaId);
    })();
    try {
      await storeDedupedFile(frozen, target, sameStorage);
      sameStorage();
      db.prepare("UPDATE cutscene_media SET state = 'ready' WHERE id = ?").run(mediaId);
      return info(ownedRow(id, mediaId));
    } catch (error) {
      // Only this reserved path/row; never touch the source, another storage, or somebody else's hold.
      let removed = true;
      try { fs.unlinkSync(assertPathInside(root, target)); }
      catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          removed = false; console.error("Cutscene upload cleanup failed", cleanupError);
        }
      }
      if (database.open) database.transaction(() => {
        database.prepare("DELETE FROM cutscene_media_holds WHERE media_id = ?").run(mediaId);
        // Keep an unheld pending row if Windows locked the file, so GC can retry later.
        if (removed) {
          database.prepare("DELETE FROM cutscene_media WHERE id = ?").run(mediaId);
          database.prepare("DELETE FROM vault_files WHERE path = ?").run(relative);
        }
      })();
      throw error;
    }
  } finally {
    try { fs.unlinkSync(assertPathInside(root, frozen)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Cutscene staging cleanup failed", error); }
  }
}

/** Internal copy for duplication; the caller retains the source snapshot across awaits. */
export function copyCutsceneMedia(id: number, ref: CutsceneMediaRef, stagingKey: string) {
  const row = mediaRow(ref);
  return importCutsceneMedia(id, row.kind, ownedPath(row), row.name, stagingKey);
}

export function accessCutsceneMedia(id: number, mediaId: string): CutsceneMediaAccess {
  const row = ownedRow(id, mediaId);
  if (row.state !== "ready") throw new CutsceneRequestError(409, "Материал ещё готовится");
  const target = ownedPath(row);
  try { if (!fs.statSync(target).isFile()) throw new Error(); fs.accessSync(target, fs.constants.R_OK); }
  catch { throw new CutsceneRequestError(404, "Файл материала недоступен"); }
  const url = signPath(toFileUrl(row.file_path));
  const expires = new URL(url, "http://local").searchParams.get("exp")!;
  return { ref: { kind: row.kind, id: row.id }, url, expiresAt: new Date(Number(expires) * 1000).toISOString() };
}

export async function checkCutsceneMedia(document: CutsceneDocument) {
  const database = db.prepare("SELECT 1").database, root = VAULT_ROOT;
  const checks: CutsceneMediaCheck[] = [];
  for (const ref of documentMediaRefs(document)) {
    let row: MediaRow;
    try { row = mediaRow(ref); }
    catch { checks.push({ ref, status: "missing", durationSeconds: null }); continue; }
    if (row.state !== "ready") { checks.push({ ref, status: "pending", durationSeconds: null }); continue; }
    try {
      const metadata = await inspectCutsceneFile(ownedPath(row), row.kind, row.file_path);
      checks.push({ ref, status: "ready", durationSeconds: metadata.durationSeconds });
    } catch (error) {
      checks.push({ ref, status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable", durationSeconds: null });
    }
    if (!database.open || root !== VAULT_ROOT || db.prepare("SELECT 1").database !== database) {
      throw new CutsceneRequestError(409, "Хранилище изменилось во время проверки");
    }
  }
  return { checks, readiness: checkCutsceneReadiness(document, checks) };
}
