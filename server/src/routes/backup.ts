import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { VAULT_ROOT } from "../services/filesystem";

export const backupRouter = Router();

// archiver ships as an ESM-only package. A static `import` (and even a
// TS-transpiled dynamic `import()`, which tsc rewrites to a plain require()
// under module=CommonJS) fails to load it on Node builds without
// require(esm) support — notably the Node version bundled with Electron.
// Going through `new Function` hides the import() call from tsc's rewriter
// so the emitted JS keeps a real dynamic import, which always uses the ESM
// loader regardless of Node version.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<typeof import("archiver")>;
const loadArchiver = () => nativeImport("archiver");

const BACKUP_DIR =
  process.env.BACKUP_DIR || path.join(path.dirname(VAULT_ROOT), "RPG-Backups");

backupRouter.post("/", async (_req, res) => {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(":", "-");
    const zipPath = path.join(BACKUP_DIR, `rpg-backup-${stamp}.zip`);

    // Consistent DB snapshot even while the app is running (WAL mode)
    const dbSnapshotPath = path.join(BACKUP_DIR, `app-snapshot-${stamp}.db`);
    await db.backup(dbSnapshotPath);

    const output = fs.createWriteStream(zipPath);
    const { ZipArchive } = await loadArchiver();
    const archive = new ZipArchive({ zlib: { level: 6 } });

    const done = new Promise<void>((resolve, reject) => {
      output.on("close", () => resolve());
      archive.on("error", (err: Error) => reject(err));
    });

    archive.pipe(output);
    archive.file(dbSnapshotPath, { name: "app.db" });
    if (fs.existsSync(VAULT_ROOT)) {
      archive.directory(VAULT_ROOT, "RPG-Vault");
    }
    await archive.finalize();
    await done;

    fs.unlinkSync(dbSnapshotPath);

    const size = fs.statSync(zipPath).size;
    res.json({ path: zipPath, size });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
