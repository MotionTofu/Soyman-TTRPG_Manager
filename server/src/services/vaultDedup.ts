import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, VAULT_ROOT, vaultAbs, vaultRel, assertVaultPath, isVaultPath } from "./filesystem";

// Writes `buffer` to `targetPath`, but if identical bytes were already
// uploaded somewhere else in the vault, hard-links `targetPath` to that
// existing file instead of writing a second physical copy. Same directory
// layout as before (every entity keeps its own conventional path — nothing
// else in the app needs to know this happened), zero extra disk usage for
// the duplicate, and later deleting either copy never breaks the other:
// the filesystem itself keeps the data alive as long as any link to it
// remains (see removeOrArchive below, which relies on exactly this).
export async function storeDeduped(buffer: Buffer, targetPath: string): Promise<void> {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  // БД хранит относительные пути; на диске работаем в абсолютном пространстве.
  const relTarget = vaultRel(targetPath);
  const absTarget = assertVaultPath(targetPath);
  const existing = db.prepare("SELECT path FROM vault_files WHERE hash = ?").get(hash) as
    | { path: string }
    | undefined;

  const existingAbs = existing?.path ? vaultAbs(existing.path) : null;
  const reusable = existing && existing.path !== relTarget && existingAbs && isVaultPath(existingAbs) && fs.existsSync(existingAbs);
  // Stage a different inode, then replace the directory entry atomically.
  // A failed write/rename keeps the original and never changes hard-link peers.
  const staged = assertVaultPath(path.join(path.dirname(absTarget), `.upload-${crypto.randomUUID()}.tmp`));
  try {
    let linked = false;
    if (reusable) {
      try { fs.linkSync(existingAbs, staged); linked = true; } catch { /* write a fresh inode below */ }
    }
    if (!linked) fs.writeFileSync(staged, buffer, { flag: "wx" });
    fs.renameSync(staged, absTarget);
    db.transaction(() => {
      db.prepare("DELETE FROM vault_files WHERE path = ?").run(relTarget);
      if (!reusable) {
        db.prepare(
          `INSERT INTO vault_files (hash, path, size) VALUES (?, ?, ?)
           ON CONFLICT(hash) DO UPDATE SET path = excluded.path, size = excluded.size`
        ).run(hash, relTarget, buffer.length);
      }
    })();
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
}

// Result of a delete attempt on a possibly-shared file. `needsChoice: true`
// means this is the *last* remaining link to that content — the caller
// should ask the user "удалить навсегда" vs "отправить в архив" and re-call
// with an explicit choice; anything else (file already gone, or other links
// still exist) is safe to just report done.
//
// `archivedFileId` возвращается, когда файл действительно уехал в `_Archive`:
// по нему потом находят, что нести обратно (отмена удаления в галерее).
export type RemoveResult = { needsChoice: true } | { done: true; archivedFileId?: number };

export function removeOrArchive(
  filePath: string,
  choice: "forever" | "archive" | undefined,
  ownerType: string,
  ownerId: number,
  displayName: string,
  // Файл, у которого остались другие жёсткие ссылки, по умолчанию просто
  // отвязывается: байты живы у соседа, спрашивать не о чем. Но вернуть такую
  // картинку потом нечем — второй путь к тем же байтам нигде не записан.
  // Вызывающий, который обещает отмену, просит унести файл в `_Archive`:
  // `rename` сохраняет inode, поэтому соседняя ссылка не страдает, а места
  // не прибавляется — это та же самая копия под другим именем.
  archiveShared = false
): RemoveResult {
  // Хард-перила как в deleteVaultFolder: путь обязан лежать внутри vault.
  // *_image_path пишут только наши upload-роуты, но битая/подменённая
  // БД не должна позволить двигать или удалять файл где угодно на диске
  // (находка 10.12). Отказ тихий: вызывающий роут продолжится, а сиротский
  // файл уйдёт в sweepOrphans — это безопаснее, чем трогать чужой путь.
  const abs = vaultAbs(filePath);
  if (!isVaultPath(abs)) {
    console.error(`removeOrArchive: refused to touch path outside vault: ${filePath}`);
    return { done: true };
  }
  if (!fs.existsSync(abs)) return { done: true };

  // fs.statSync(...).nlink is the hard-link count — 1 means this is the only
  // remaining reference to these bytes anywhere on disk.
  const isLastLink = fs.statSync(abs).nlink <= 1;
  if (isLastLink && !choice) return { needsChoice: true };

  if (choice === "archive" || (!isLastLink && archiveShared)) {
    return { done: true, archivedFileId: archiveFile(abs, ownerType, ownerId, displayName) };
  }
  fs.unlinkSync(abs);
  return { done: true };
}

export function archiveFile(filePath: string, ownerType: string, ownerId: number, displayName: string): number {
  filePath = assertVaultPath(filePath);
  const archiveDirAbs = vaultAbs(ensureSubfolder(VAULT_ROOT, "_Archive"));
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let target = path.join(archiveDirAbs, `${base}${ext}`);
  for (let n = 2; fs.existsSync(target); n++) {
    target = path.join(archiveDirAbs, `${base}-${n}${ext}`);
  }
  const size = fs.statSync(filePath).size;
  assertVaultPath(target);
  fs.renameSync(filePath, target);
  const info = db
    .prepare(
      `INSERT INTO archived_files (original_owner_type, original_owner_id, original_name, archive_path, size)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ownerType, ownerId, displayName, vaultRel(target), size);
  return Number(info.lastInsertRowid);
}
