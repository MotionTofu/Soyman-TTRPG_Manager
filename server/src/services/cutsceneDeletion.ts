import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db/db";
import { VAULT_ROOT, assertVaultPath, ensureSubfolder } from "./filesystem";
import { assertPathInside } from "./pathSafety";
import { CutsceneRequestError } from "./cutsceneErrors";
import { readCutscene } from "./cutscenes";
import { readCutsceneUsage } from "./cutsceneUsage";

interface PurgeJournal { id: number; token: string; files: { original: string; staged: string }[] }
const journalName = (token: string) => `.purge-${token}.json`;
const directory = () => assertVaultPath(ensureSubfolder(VAULT_ROOT, "Cutscenes/media"));
function fileIn(root: string, name: string): string {
  if (!name || path.basename(name) !== name) throw Error("Invalid purge filename");
  return assertPathInside(root, path.join(root, name));
}
function completeJournal(root: string, journal: PurgeJournal): void {
  const restore = !!db.prepare("SELECT 1 FROM cutscenes WHERE id = ?").get(journal.id);
  for (const entry of journal.files) {
    const original = fileIn(root, entry.original), staged = fileIn(root, entry.staged);
    if (!fs.existsSync(staged)) continue;
    if (restore) {
      if (fs.existsSync(original)) throw Error("Cannot overwrite an existing file during purge recovery");
      fs.renameSync(staged, original);
    } else fs.unlinkSync(staged);
  }
  fs.unlinkSync(fileIn(root, journalName(journal.token)));
}
/** Before media GC: restore a rolled-back deletion, or finish cleanup after a committed one. */
export function recoverCutscenePurges(): void {
  const root = directory();
  for (const name of fs.readdirSync(root)) {
    const match = /^\.purge-([0-9a-f-]{36})\.json$/.exec(name);
    if (!match) continue;
    try {
      const journal = JSON.parse(fs.readFileSync(fileIn(root, name), "utf8")) as PurgeJournal;
      if (!Number.isSafeInteger(journal.id) || journal.id <= 0 || journal.token !== match[1] || !Array.isArray(journal.files) ||
        journal.files.some((entry, i) => entry.staged !== `.purge-${journal.token}-${i}.file`)) throw Error("Invalid purge journal");
      completeJournal(root, journal);
    } catch (error) { console.error("Cutscene purge recovery pending", name, error); }
  }
}

/** SQL and file removal share a recoverable boundary; a failed SQL DELETE never loses original bytes. */
export function deleteArchivedCutscene(id: number): void {
  let journal: PurgeJournal | null = null;
  const root = directory();
  try {
    db.transaction(() => {
      if (!readCutscene(id).archivedAt) throw new CutsceneRequestError(400, "Можно удалить навсегда только из архива");
      const usage = readCutsceneUsage(id);
      if (usage.places.length) throw new CutsceneRequestError(409, `Катсцена используется: ${usage.places.map(place => place.label).join("; ")}`, usage);
      const rows = db.prepare("SELECT file_path FROM cutscene_media WHERE cutscene_id = ? ORDER BY id").all(id) as { file_path: string }[];
      const token = randomUUID();
      const files = rows.map((row, i) => {
        const target = assertPathInside(root, assertVaultPath(row.file_path));
        if (path.dirname(target) !== root) throw Error("Invalid cutscene-owned media path");
        if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw Error("Media is not a regular file");
        return { original: path.basename(target), staged: `.purge-${token}-${i}.file` };
      });
      journal = { id, token, files };
      // Journal is durable before any rename. Existing paths are never overwritten.
      fs.writeFileSync(fileIn(root, journalName(token)), JSON.stringify(journal), { flag: "wx" });
      for (const entry of files) {
        const original = fileIn(root, entry.original), staged = fileIn(root, entry.staged);
        if (fs.existsSync(original)) fs.renameSync(original, staged);
      }
      db.prepare("DELETE FROM cutscene_media_holds WHERE media_id IN (SELECT id FROM cutscene_media WHERE cutscene_id = ?)").run(id);
      for (const row of rows) db.prepare("DELETE FROM vault_files WHERE path = ?").run(row.file_path);
      db.prepare("DELETE FROM cutscene_media WHERE cutscene_id = ?").run(id);
      db.prepare("DELETE FROM cutscenes WHERE id = ?").run(id);
    }).immediate();
  } catch (error) {
    if (journal) {
      try { completeJournal(root, journal); }
      catch (recoveryError) { console.error("Cutscene purge rollback recovery pending", recoveryError); }
    }
    if (error instanceof CutsceneRequestError) throw error;
    console.error("Cutscene purge failed", error);
    throw new CutsceneRequestError(500, "Не удалось удалить катсцену — попробуйте ещё раз");
  }
  if (journal) {
    try { completeJournal(root, journal); }
    catch (error) { console.error("Cutscene purge cleanup pending; will retry on startup", error); }
  }
}
