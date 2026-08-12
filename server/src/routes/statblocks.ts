import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { parseLongStoryShort } from "../services/lssImport";
import { broadcastCharacterUpdate } from "../services/realtime";
import { beingFolder, ensureSubfolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { ensureCharacterFolder } from "./characters";

export const statblocksRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function withAvatarUrl<T extends { avatar_image_path?: string | null }>(row: T) {
  return { ...row, avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null };
}

// A statblock's owner (character/being/compendium_entry) already has its own
// folder for characters/beings — compendium entries don't (a system's
// bestiary can have thousands of them, so no per-entry folder was ever
// created), so those share one "Статблоки" folder under the system, keyed
// by statblock id in the filename to avoid collisions.
function resolveStatblockOwnerFolder(ownerType: string, ownerId: number): string | null {
  if (ownerType === "character") {
    return ensureCharacterFolder(ownerId);
  }
  if (ownerType === "being") {
    const being = db
      .prepare(
        `SELECT b.name, b.folder_path, s.folder_path AS setting_folder_path
         FROM setting_beings b JOIN settings s ON s.id = b.setting_id WHERE b.id = ?`
      )
      .get(ownerId) as { name: string; folder_path: string | null; setting_folder_path: string } | undefined;
    if (!being) return null;
    return being.folder_path || beingFolder(being.setting_folder_path, being.name);
  }
  if (ownerType === "compendium_entry") {
    const entry = db
      .prepare(
        `SELECT sy.folder_path AS system_folder_path
         FROM compendium_entries ce JOIN systems sy ON sy.id = ce.system_id WHERE ce.id = ?`
      )
      .get(ownerId) as { system_folder_path: string } | undefined;
    if (!entry) return null;
    return ensureSubfolder(entry.system_folder_path, "Статблоки");
  }
  return null;
}

statblocksRouter.post("/import", (req, res) => {
  const { owner_type, owner_id, json } = req.body as {
    owner_type: string;
    owner_id: number;
    json: string;
  };
  if (!owner_type || !owner_id || !json)
    return res.status(400).json({ error: "owner_type, owner_id and json are required" });

  let parsed;
  try {
    parsed = parseLongStoryShort(json);
  } catch (err) {
    return res.status(400).json({ error: "Не удалось разобрать файл: " + String(err) });
  }

  const note = `Импортировано из Long Story Short${parsed.characterName ? ` (${parsed.characterName})` : ""}`;
  const info = db
    .prepare(
      "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, "full", "dnd_character", JSON.stringify(parsed.characterData), note);

  res.status(201).json({
    characterName: parsed.characterName,
    statblock: withAvatarUrl(db.prepare("SELECT * FROM statblocks WHERE id = ?").get(info.lastInsertRowid) as { avatar_image_path: string | null }),
  });
});

statblocksRouter.get("/", (req, res) => {
  const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
  if (!owner_type || !owner_id)
    return res.status(400).json({ error: "owner_type and owner_id are required" });
  const rows = db
    .prepare(
      "SELECT * FROM statblocks WHERE owner_type = ? AND owner_id = ? ORDER BY created_at"
    )
    .all(owner_type, owner_id) as { avatar_image_path: string | null }[];
  res.json(rows.map(withAvatarUrl));
});

statblocksRouter.post("/", (req, res) => {
  const { owner_type, owner_id, kind, format, content, note } = req.body as {
    owner_type: string;
    owner_id: number;
    kind?: string;
    format?: string;
    content?: string;
    note?: string;
  };
  if (!owner_type || !owner_id)
    return res.status(400).json({ error: "owner_type and owner_id are required" });
  const info = db
    .prepare(
      "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, kind ?? "full", format ?? "text", content ?? "", note ?? "");
  res
    .status(201)
    .json(withAvatarUrl(db.prepare("SELECT * FROM statblocks WHERE id = ?").get(info.lastInsertRowid) as { avatar_image_path: string | null }));
});

statblocksRouter.put("/:id", (req, res) => {
  const { kind, content, note, theme, density } = req.body as {
    kind?: string;
    content?: string;
    note?: string;
    theme?: string;
    density?: string;
  };
  db.prepare(
    `UPDATE statblocks SET
       kind = COALESCE(?, kind), content = COALESCE(?, content), note = COALESCE(?, note),
       theme = COALESCE(?, theme), density = COALESCE(?, density)
     WHERE id = ?`
  ).run(kind ?? null, content ?? null, note ?? null, theme ?? null, density ?? null, req.params.id);
  const updated = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(req.params.id) as
    | { owner_type: string; owner_id: number; avatar_image_path: string | null }
    | undefined;
  if (updated?.owner_type === "character") broadcastCharacterUpdate(updated.owner_id);
  res.json(updated ? withAvatarUrl(updated) : updated);
});

statblocksRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const statblock = db
    .prepare("SELECT id, owner_type, owner_id, avatar_image_path FROM statblocks WHERE id = ?")
    .get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number; avatar_image_path: string | null }
    | undefined;
  if (!statblock) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const folder = resolveStatblockOwnerFolder(statblock.owner_type, statblock.owner_id);
  if (!folder) return res.status(404).json({ error: "owner not found" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `statblock-${statblock.id}-avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, statblock.avatar_image_path, "avatar");

  db.prepare("UPDATE statblocks SET avatar_image_path = ? WHERE id = ?").run(target, statblock.id);
  if (statblock.owner_type === "character") broadcastCharacterUpdate(statblock.owner_id);
  res.json(withAvatarUrl({ avatar_image_path: target }));
});

statblocksRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM statblocks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
