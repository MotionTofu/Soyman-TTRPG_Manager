import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, VAULT_ROOT } from "./filesystem";

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
  const existing = db.prepare("SELECT path FROM vault_files WHERE hash = ?").get(hash) as
    | { path: string }
    | undefined;

  if (existing && existing.path !== targetPath && fs.existsSync(existing.path)) {
    try {
      fs.linkSync(existing.path, targetPath);
      return;
    } catch {
      // Cross-volume, or a filesystem that doesn't support hard links —
      // fall through to a plain write below.
    }
  }

  fs.writeFileSync(targetPath, buffer);
  if (!existing || !fs.existsSync(existing.path)) {
    db.prepare(
      `INSERT INTO vault_files (hash, path, size) VALUES (?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET path = excluded.path, size = excluded.size`
    ).run(hash, targetPath, buffer.length);
  }
}

// Result of a delete attempt on a possibly-shared file. `needsChoice: true`
// means this is the *last* remaining link to that content — the caller
// should ask the user "удалить навсегда" vs "отправить в архив" and re-call
// with an explicit choice; anything else (file already gone, or other links
// still exist) is safe to just report done.
export type RemoveResult = { needsChoice: true } | { done: true };

export function removeOrArchive(
  filePath: string,
  choice: "forever" | "archive" | undefined,
  ownerType: string,
  ownerId: number,
  displayName: string
): RemoveResult {
  if (!fs.existsSync(filePath)) return { done: true };

  // fs.statSync(...).nlink is the hard-link count — 1 means this is the only
  // remaining reference to these bytes anywhere on disk.
  const isLastLink = fs.statSync(filePath).nlink <= 1;
  if (isLastLink && !choice) return { needsChoice: true };

  if (isLastLink && choice === "archive") {
    archiveFile(filePath, ownerType, ownerId, displayName);
  } else {
    fs.unlinkSync(filePath);
  }
  return { done: true };
}

function archiveFile(filePath: string, ownerType: string, ownerId: number, displayName: string): void {
  const archiveDir = ensureSubfolder(VAULT_ROOT, "_Archive");
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let target = path.join(archiveDir, `${base}${ext}`);
  for (let n = 2; fs.existsSync(target); n++) {
    target = path.join(archiveDir, `${base}-${n}${ext}`);
  }
  const size = fs.statSync(filePath).size;
  fs.renameSync(filePath, target);
  db.prepare(
    `INSERT INTO archived_files (original_owner_type, original_owner_id, original_name, archive_path, size)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ownerType, ownerId, displayName, target, size);
}
