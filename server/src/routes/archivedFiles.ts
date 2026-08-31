import path from "path";
import { Router } from "express";
import fs from "fs";
import { db } from "../db/db";
import { ensureSubfolder, openInFileExplorer, VAULT_ROOT, vaultAbs } from "../services/filesystem";

// Files moved here by vaultDedup.ts's removeOrArchive() when a user chose
// "отправить в архив" over "удалить навсегда" for the last remaining link to
// some content — reviewable/purgeable from the Archive page's "Файлы" tab.
export const archivedFilesRouter = Router();

archivedFilesRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM archived_files ORDER BY archived_at DESC").all();
  res.json(rows);
});

archivedFilesRouter.get("/open-folder", (_req, res) => {
  const folder = ensureSubfolder(VAULT_ROOT, "_Archive");
  openInFileExplorer(folder, false);
  res.json({ ok: true });
});

archivedFilesRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT archive_path FROM archived_files WHERE id = ?").get(req.params.id) as
    | { archive_path: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  // Хард-перила как в filesystem.deleteVaultFolder / vaultDedup.removeOrArchive:
  // путь обязан лежать строго внутри VAULT_ROOT, иначе битая БД могла бы
  // удалить файл вне хранилища. Отказ — тихий, строку БД всё равно чистим.
  const abs = vaultAbs(row.archive_path);
  const resolved = path.resolve(abs);
  const root = path.resolve(VAULT_ROOT);
  const insideVault = resolved === root || resolved.startsWith(root + path.sep);
  if (insideVault) {
    try {
      fs.unlinkSync(abs);
    } catch {
      // already gone — proceed with removing the DB row regardless
    }
  } else {
    console.error(`archivedFiles DELETE refused: path outside vault: ${row.archive_path}`);
  }
  db.prepare("DELETE FROM archived_files WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
