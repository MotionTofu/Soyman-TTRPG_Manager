import { Router } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { db } from "../db/db";
import { ensureSubfolder, toFileUrl } from "../services/filesystem";
import { resizeImageBuffer } from "../services/imageResize";
import { storeDeduped, removeOrArchive } from "../services/vaultDedup";
import { ensureCharacterFolder } from "./characters";
import type { AuthedRequest } from "../services/auth";

export const galleryRouter = Router();
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "jpg", "png", "gif", "webp", "avif"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `rpg-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Поддерживаются только изображения JPG/PNG/GIF/WebP/AVIF"));
  },
});
async function getFileBuffer(file: Express.Multer.File): Promise<Buffer> {
  if ((file as unknown as { buffer?: Buffer }).buffer) return (file as unknown as { buffer: Buffer }).buffer;
  const p = (file as unknown as { path?: string }).path;
  if (p && fs.existsSync(p)) return await fs.promises.readFile(p);
  return Buffer.alloc(0);
}
function cleanupFile(file: Express.Multer.File | undefined) {
  const p = (file as unknown as { path?: string })?.path;
  if (p) try { fs.unlinkSync(p); } catch {}
}

const OWNER_TABLES: Record<string, string> = {
  character: "characters",
  being: "setting_beings",
  location: "setting_locations",
  community: "setting_communities",
  campaign_player_section: "campaign_player_sections",
  artifact: "artifacts",
};

function withUrl<T extends { image_path: string }>(row: T) {
  return { ...row, image_url: toFileUrl(row.image_path) };
}

// Characters can have a NULL folder_path until first touched (see
// ensureCharacterFolder); setting_beings always get one at creation time.
function resolveOwnerFolder(ownerType: string, ownerId: string | number): string {
  if (ownerType === "character") return ensureCharacterFolder(ownerId);
  const table = OWNER_TABLES[ownerType];
  if (!table) throw new Error("invalid owner_type");
  const row = db.prepare(`SELECT folder_path, archived_at FROM ${table} WHERE id = ?`).get(ownerId) as
    | { folder_path: string | null; archived_at: string | null }
    | undefined;
  if (!row || !row.folder_path) throw new Error("owner not found");
  if (row.archived_at) throw new Error("owner archived");
  return row.folder_path;
}

galleryRouter.get("/", (req, res) => {
  const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
  if (!owner_type || !owner_id) return res.status(400).json({ error: "owner_type and owner_id are required" });
  const rows = db
    .prepare("SELECT * FROM gallery_images WHERE owner_type = ? AND owner_id = ? ORDER BY position, id")
    .all(owner_type, owner_id) as { image_path: string }[];
  res.json(rows.map(withUrl));
});

galleryRouter.post("/", upload.single("file"), async (req: AuthedRequest, res) => {
  const { owner_type, owner_id, caption } = req.body as {
    owner_type?: string;
    owner_id?: string;
    caption?: string;
  };
  if (!owner_type || !owner_id) return res.status(400).json({ error: "owner_type and owner_id are required" });
  // Player tokens pass the /api role gate for this route before multer has
  // parsed the multipart form — the owner fields only exist here, so this is
  // where their ownership check has to live (см. services/playerAccess.ts).
  if (req.user?.role === "player") {
    const owned =
      owner_type === "character" &&
      db
        .prepare("SELECT id FROM characters WHERE id = ? AND player_id = ? AND archived_at IS NULL")
        .get(owner_id, req.user.playerId);
    if (!owned) return res.status(403).json({ error: "forbidden" });
  }
  if (!req.file) return res.status(400).json({ error: "file is required" });

  let folder: string;
  try {
    folder = ensureSubfolder(resolveOwnerFolder(owner_type, owner_id), "Gallery");
  } catch (e) {
    return res.status(404).json({ error: e instanceof Error ? e.message : "owner not found" });
  }
  const rawExt = (path.extname(req.file.originalname) || ".jpg").toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) return res.status(400).json({ error: "Недопустимое расширение файла" });
  const ext = rawExt;
  // C-P0-1: проверка магических байт, а не только mimetype клиента (асинхронно, не блокирует event loop)
  const buf = await getFileBuffer(req.file);
  if (!buf.length) return res.status(400).json({ error: "Пустой файл" });
  try {
    const meta = await sharp(buf).metadata();
    const fmt = (meta.format || "").toLowerCase();
    if (!ALLOWED_SHARP_FORMATS.has(fmt)) throw new Error("unsupported");
  } catch {
    cleanupFile(req.file);
    return res.status(400).json({ error: "Файл не является изображением JPG/PNG/GIF/WebP/AVIF" });
  }
  const target = path.join(folder, `img-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  const captionTrimmed = typeof caption === "string" ? caption.trim().slice(0, 500) : "";
  try { await storeDeduped(await resizeImageBuffer(buf, "gallery"), target); } finally { cleanupFile(req.file); }

  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM gallery_images WHERE owner_type = ? AND owner_id = ?")
    .get(owner_type, owner_id) as { m: number };
  const info = db
    .prepare(
      "INSERT INTO gallery_images (owner_type, owner_id, image_path, caption, position) VALUES (?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, target, captionTrimmed ?? "", maxPos.m + 1);
  res
    .status(201)
    .json(withUrl(db.prepare("SELECT * FROM gallery_images WHERE id = ?").get(info.lastInsertRowid) as { image_path: string }));
});

galleryRouter.put("/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  if (!Array.isArray(order) || order.length === 0 || order.length > 500) return res.status(400).json({ error: "order must be non-empty array ≤500" });
  if (order.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) return res.status(400).json({ error: "order contains invalid id" });
  if (new Set(order).size !== order.length) return res.status(400).json({ error: "order contains duplicates" });
  const placeholders = order.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, owner_type, owner_id FROM gallery_images WHERE id IN (${placeholders})`).all(...order) as { id: number; owner_type: string; owner_id: number }[];
  if (rows.length !== order.length) return res.status(400).json({ error: "some ids not found" });
  const first = rows[0];
  if (rows.some((r) => r.owner_type !== first.owner_type || r.owner_id !== first.owner_id)) return res.status(400).json({ error: "all ids must belong to same owner" });
  const upd = db.prepare("UPDATE gallery_images SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((id, i) => upd.run(i, id)));
  tx(order);
  res.json({ ok: true });
});

galleryRouter.put("/:id", (req, res) => {
  const { caption } = req.body as { caption?: string };
  if (typeof caption === "string" && caption.length > 500) return res.status(400).json({ error: "caption too long (max 500)" });
  const trimmed = typeof caption === "string" ? caption.trim().slice(0, 500) : caption ?? null;
  db.prepare("UPDATE gallery_images SET caption = COALESCE(?, caption) WHERE id = ?").run(
    trimmed ?? null,
    req.params.id
  );
  const row = db.prepare("SELECT * FROM gallery_images WHERE id = ?").get(req.params.id) as
    | { image_path: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withUrl(row));
});

// `mode` ("forever" | "archive") is only required when this turns out to be
// the *last* remaining link to that image's bytes elsewhere in the vault
// (see removeOrArchive) — the client re-calls with it after the user picks
// in the "удалить навсегда / отправить в архив" dialog triggered by a 409.
galleryRouter.delete("/:id", (req, res) => {
  const { mode } = req.query as { mode?: "forever" | "archive" };
  const row = db.prepare("SELECT image_path, caption FROM gallery_images WHERE id = ?").get(req.params.id) as
    | { image_path: string; caption: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  const result = removeOrArchive(
    row.image_path,
    mode,
    "gallery_image",
    Number(req.params.id),
    row.caption || path.basename(row.image_path)
  );
  if ("needsChoice" in result) return res.status(409).json({ needsChoice: true });

  db.prepare("DELETE FROM gallery_images WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
