import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/db";
import { characterFolder, ensureSubfolder, toFileUrl, vaultAbs, vaultRel, writeReplacingOldFile } from "../services/filesystem";
import { broadcastCharacterUpdate } from "../services/realtime";

export const charactersRouter = Router();
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

function withAvatarUrl<T extends { avatar_image_path?: string | null; thumbnail_image_path?: string | null }>(
  row: T
) {
  return {
    ...row,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

function withChapterImageUrl<T extends { image_path?: string | null }>(row: T) {
  return {
    ...row,
    image_url: row.image_path ? toFileUrl(row.image_path) : null,
  };
}

// Characters migrated from the old (pre-folder) schema can have a NULL
// folder_path; create the folder on first use and persist it.
export function ensureCharacterFolder(characterId: number | string): string {
  const character = db
    .prepare(
      `SELECT c.folder_path, c.character_name, ca.folder_path as campaign_folder_path
       FROM characters c JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.id = ?`
    )
    .get(characterId) as
    | { folder_path: string | null; character_name: string; campaign_folder_path: string }
    | undefined;
  if (!character) throw new Error("character not found");
  if (character.folder_path) return character.folder_path;
  const folder = characterFolder(character.campaign_folder_path, character.character_name);
  db.prepare("UPDATE characters SET folder_path = ? WHERE id = ?").run(folder, characterId);
  return folder;
}

charactersRouter.get("/", (req, res) => {
  const { campaign_id, player_id, setting_id } = req.query as {
    campaign_id?: string;
    player_id?: string;
    setting_id?: string;
  };
  const clauses = ["c.archived_at IS NULL"];
  const params: Record<string, string> = {};
  if (campaign_id) {
    clauses.push("c.campaign_id = @campaign_id");
    params.campaign_id = campaign_id;
  }
  if (player_id) {
    clauses.push("c.player_id = @player_id");
    params.player_id = player_id;
  }
  if (setting_id) {
    clauses.push("ca.setting_id = @setting_id");
    params.setting_id = setting_id;
  }
  const rows = db
    .prepare(
      `SELECT c.*, p.name as player_name, ca.name as campaign_name, ca.setting_id as campaign_setting_id
       FROM characters c
       JOIN players p ON p.id = c.player_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.character_name`
    )
    .all(params) as { avatar_image_path: string | null }[];
  res.json(rows.map(withAvatarUrl));
});

charactersRouter.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT c.*, p.name as player_name, ca.name as campaign_name, ca.setting_id as campaign_setting_id
       FROM characters c
       JOIN players p ON p.id = c.player_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.id = ?`
    )
    .get(req.params.id) as { avatar_image_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const chapters = (
    db
      .prepare("SELECT * FROM character_chapters WHERE character_id = ? ORDER BY created_at")
      .all(req.params.id) as { image_path: string | null }[]
  ).map(withChapterImageUrl);
  const importantDates = db
    .prepare("SELECT * FROM important_dates WHERE owner_type = 'character' AND owner_id = ?")
    .all(req.params.id);
  res.json({ ...withAvatarUrl(row), chapters, important_dates: importantDates });
});

charactersRouter.post("/:id/important-dates", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title: string;
    recurrence: string;
    year?: number | null;
    month?: number | null;
    day: number;
  };
  if (!title || day == null) return res.status(400).json({ error: "title and day are required" });
  const info = db
    .prepare(
      `INSERT INTO important_dates (owner_type, owner_id, title, recurrence, year, month, day)
       VALUES ('character', ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, title, recurrence || "once", year ?? null, month ?? null, day);
  res.status(201).json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(info.lastInsertRowid));
});

charactersRouter.put("/important-dates/:dateId", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title?: string;
    recurrence?: string;
    year?: number | null;
    month?: number | null;
    day?: number;
  };
  db.prepare(
    `UPDATE important_dates SET
       title = COALESCE(?, title),
       recurrence = COALESCE(?, recurrence),
       year = ?,
       month = ?,
       day = COALESCE(?, day)
     WHERE id = ?`
  ).run(title ?? null, recurrence ?? null, year ?? null, month ?? null, day ?? null, req.params.dateId);
  res.json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(req.params.dateId));
});

charactersRouter.delete("/important-dates/:dateId", (req, res) => {
  db.prepare("DELETE FROM important_dates WHERE id = ?").run(req.params.dateId);
  res.json({ ok: true });
});

charactersRouter.post("/:id/chapters", (req, res) => {
  const { section, title, content } = req.body as {
    section: string;
    title?: string;
    content?: string;
  };
  if (!section) return res.status(400).json({ error: "section is required" });
  const info = db
    .prepare(
      "INSERT INTO character_chapters (character_id, section, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.id, section, title ?? "", content ?? "");
  broadcastCharacterUpdate(Number(req.params.id));
  res
    .status(201)
    .json(
      db.prepare("SELECT * FROM character_chapters WHERE id = ?").get(info.lastInsertRowid)
    );
});

charactersRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE character_chapters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.chapterId);
  const chapter = db.prepare("SELECT * FROM character_chapters WHERE id = ?").get(req.params.chapterId) as
    | { character_id: number }
    | undefined;
  if (chapter) broadcastCharacterUpdate(chapter.character_id);
  res.json(chapter);
});

charactersRouter.delete("/chapters/:chapterId", (req, res) => {
  const chapter = db.prepare("SELECT character_id FROM character_chapters WHERE id = ?").get(req.params.chapterId) as
    | { character_id: number }
    | undefined;
  db.prepare("DELETE FROM character_chapters WHERE id = ?").run(req.params.chapterId);
  if (chapter) broadcastCharacterUpdate(chapter.character_id);
  res.json({ ok: true });
});

charactersRouter.post("/chapters/:chapterId/image", upload.single("file"), async (req, res) => {
  const chapter = db
    .prepare(
      `SELECT cc.id, cc.character_id, cc.image_path FROM character_chapters cc
       WHERE cc.id = ?`
    )
    .get(req.params.chapterId) as
    | { id: number; character_id: number; image_path: string | null }
    | undefined;
  if (!chapter) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const characterFolderPath = ensureCharacterFolder(chapter.character_id);
  const folder = ensureSubfolder(characterFolderPath, "Inventory");
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `item-${chapter.id}${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, chapter.image_path, "thumbnail");

  db.prepare("UPDATE character_chapters SET image_path = ? WHERE id = ?").run(
    target,
    req.params.chapterId
  );
  res.json(withChapterImageUrl({ image_path: target }));
});

charactersRouter.post("/", (req, res) => {
  const { player_id, campaign_id, character_name } = req.body as {
    player_id: number;
    campaign_id: number;
    character_name: string;
  };
  if (!player_id || !campaign_id || !character_name)
    return res
      .status(400)
      .json({ error: "player_id, campaign_id and character_name are required" });

  const campaign = db
    .prepare("SELECT folder_path FROM campaigns WHERE id = ?")
    .get(campaign_id) as { folder_path: string } | undefined;
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  const folder = characterFolder(campaign.folder_path, character_name);

  const info = db
    .prepare(
      "INSERT INTO characters (player_id, campaign_id, character_name, folder_path) VALUES (?, ?, ?, ?)"
    )
    .run(player_id, campaign_id, character_name, folder);
  res
    .status(201)
    .json(db.prepare("SELECT * FROM characters WHERE id = ?").get(info.lastInsertRowid));
});

charactersRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT c.*, ca.folder_path as campaign_folder_path FROM characters c LEFT JOIN campaigns ca ON ca.id = c.campaign_id WHERE c.id = ?")
    .get(req.params.id) as
    | { folder_path: string; character_name: string; campaign_folder_path: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const {
    character_name,
    backstory,
    statblock,
    current_situation,
    personal_arc,
    future_thoughts,
    connections_notes,
    short_name,
  } = req.body as Record<string, string | undefined>;

  let folderPath = existing.folder_path ?? ensureCharacterFolder(req.params.id);
  if (character_name && character_name !== existing.character_name) {
    const absFolder = vaultAbs(folderPath);
    const parent = path.dirname(absFolder);
    const newPath = path.join(parent, character_name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim() || "untitled");
    if (fs.existsSync(absFolder) && absFolder !== newPath) {
      fs.renameSync(absFolder, newPath);
    }
    folderPath = vaultRel(newPath);
  }

  db.prepare(
    `UPDATE characters SET
       character_name = COALESCE(?, character_name),
       backstory = COALESCE(?, backstory),
       statblock = COALESCE(?, statblock),
       current_situation = COALESCE(?, current_situation),
       personal_arc = COALESCE(?, personal_arc),
       future_thoughts = COALESCE(?, future_thoughts),
       connections_notes = COALESCE(?, connections_notes),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       folder_path = ?
     WHERE id = ?`
  ).run(
    character_name ?? null,
    backstory ?? null,
    statblock ?? null,
    current_situation ?? null,
    personal_arc ?? null,
    future_thoughts ?? null,
    connections_notes ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    folderPath,
    req.params.id
  );
  broadcastCharacterUpdate(Number(req.params.id));
  res.json(db.prepare("SELECT * FROM characters WHERE id = ?").get(req.params.id));
});

charactersRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const character = db
    .prepare("SELECT id, avatar_image_path FROM characters WHERE id = ?")
    .get(req.params.id) as { id: number; avatar_image_path: string | null } | undefined;
  if (!character) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const folderPath = ensureCharacterFolder(character.id);
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folderPath, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, character.avatar_image_path, "avatar");

  db.prepare("UPDATE characters SET avatar_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withAvatarUrl({ avatar_image_path: target }));
});

// Wide thumbnail shown on the campaign roster card — cropped independently
// from the square avatar, since the roster card isn't square (mirrors
// setting_beings' avatar/thumbnail split for the Население list).
charactersRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const character = db
    .prepare("SELECT id, thumbnail_image_path FROM characters WHERE id = ?")
    .get(req.params.id) as { id: number; thumbnail_image_path: string | null } | undefined;
  if (!character) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const folderPath = ensureCharacterFolder(character.id);
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folderPath, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, character.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE characters SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withAvatarUrl({ thumbnail_image_path: target }));
});

charactersRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE characters SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

charactersRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE characters SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM characters WHERE id = ?").get(req.params.id));
});
