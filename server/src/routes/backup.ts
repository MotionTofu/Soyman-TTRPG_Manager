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

function isValidBackupPath(p: string): boolean {
  if (!p || typeof p !== "string" || p.includes("\0") || p.length > 1024) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  if (!path.isAbsolute(p)) return false;
  if (p.startsWith("\\\\")) return false;
  return true;
}

backupRouter.get("/info", (_req, res) => {
  res.json({ defaultDir: BACKUP_DIR });
});

backupRouter.post("/", async (req, res) => {
  try {
    // Optional custom destination: { dir } (folder) or { filePath / path } (exact zip file)
    const body = (req.body ?? {}) as { dir?: string; filePath?: string; path?: string };
    const rawDir = typeof body.dir === "string" ? body.dir.trim() : "";
    const rawFile = typeof body.filePath === "string" ? body.filePath.trim() : typeof body.path === "string" ? body.path.trim() : "";

    let targetDir = BACKUP_DIR;
    let targetFile: string | null = null;

    if (rawFile) {
      if (!isValidBackupPath(rawFile)) {
        return res.status(400).json({ error: "Недопустимый путь файла" });
      }
      if (path.extname(rawFile).toLowerCase() !== ".zip") {
        return res.status(400).json({ error: "Путь должен указывать на .zip файл" });
      }
      targetFile = rawFile;
      targetDir = path.dirname(rawFile);
    } else if (rawDir) {
      if (!isValidBackupPath(rawDir)) {
        return res.status(400).json({ error: "Недопустимый путь папки" });
      }
      targetDir = rawDir;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(":", "-");
    const zipPath = targetFile ?? path.join(targetDir, `rpg-backup-${stamp}.zip`);

    // Consistent DB snapshot even while the app is running (WAL mode)
    const dbSnapshotPath = path.join(targetDir, `app-snapshot-${stamp}.db`);
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
