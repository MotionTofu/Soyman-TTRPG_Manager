import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, toFileUrl } from "../services/filesystem";
import { resizeImageBuffer } from "../services/imageResize";
import { storeDeduped, removeOrArchive } from "../services/vaultDedup";
import { ensureCharacterFolder } from "./characters";
import type { AuthedRequest } from "../services/auth";

export const galleryRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

const OWNER_TABLES: Record<string, string> = {
  character: "characters",
  being: "setting_beings",
  location: "setting_locations",
  community: "setting_communities",
  campaign_player_section: "campaign_player_sections",
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
  const row = db.prepare(`SELECT folder_path FROM ${table} WHERE id = ?`).get(ownerId) as
    | { folder_path: string | null }
    | undefined;
  if (!row || !row.folder_path) throw new Error("owner not found");
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
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `img-${Date.now()}${ext}`);
  await storeDeduped(await resizeImageBuffer(req.file.buffer, "gallery"), target);

  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM gallery_images WHERE owner_type = ? AND owner_id = ?")
    .get(owner_type, owner_id) as { m: number };
  const info = db
    .prepare(
      "INSERT INTO gallery_images (owner_type, owner_id, image_path, caption, position) VALUES (?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, target, caption ?? "", maxPos.m + 1);
  res
    .status(201)
    .json(withUrl(db.prepare("SELECT * FROM gallery_images WHERE id = ?").get(info.lastInsertRowid) as { image_path: string }));
});

galleryRouter.put("/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE gallery_images SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((id, i) => upd.run(i, id)));
  tx(order ?? []);
  res.json({ ok: true });
});

galleryRouter.put("/:id", (req, res) => {
  const { caption } = req.body as { caption?: string };
  db.prepare("UPDATE gallery_images SET caption = COALESCE(?, caption) WHERE id = ?").run(
    caption ?? null,
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
