import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { playerFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";

export const playersRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function withThumbUrl<T extends { thumbnail_image_path?: string | null; avatar_image_path?: string | null }>(
  row: T
) {
  return {
    ...row,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
  };
}

// next_planned_date mirrors campaigns.ts's own computed field — same
// "soonest upcoming planned session" idea, just rolled up across every
// active campaign a player is rostered in (via campaign_roster, not
// characters — a player can be on a roster before their character exists).
playersRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT MIN(s.date) FROM sessions s
                 JOIN campaign_roster cr ON cr.campaign_id = s.campaign_id
                 WHERE cr.player_id = p.id AND cr.status = 'active'
                   AND s.status = 'planned' AND s.archived_at IS NULL
                   AND s.date >= date('now')) as next_planned_date
       FROM players p
       WHERE p.archived_at IS NULL
       ORDER BY (next_planned_date IS NULL), next_planned_date, p.name`
    )
    .all() as { thumbnail_image_path: string | null }[];
  res.json(rows.map(withThumbUrl));
});

// The user's own "self" player record, used to attach their PC in campaigns
// where they are a player rather than the GM. Found-or-created on demand.
playersRouter.get("/self", (_req, res) => {
  const existing = db.prepare("SELECT * FROM players WHERE name = ?").get("Я");
  if (existing) return res.json(existing);
  const folder = playerFolder("Я");
  const info = db
    .prepare("INSERT INTO players (name, notes, folder_path) VALUES (?, ?, ?)")
    .run("Я", "", folder);
  res.json(db.prepare("SELECT * FROM players WHERE id = ?").get(info.lastInsertRowid));
});

playersRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | { thumbnail_image_path: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const characters = db
    .prepare(
      `SELECT c.*, ca.name as campaign_name FROM characters c
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.player_id = ? AND c.archived_at IS NULL`
    )
    .all(req.params.id) as { avatar_image_path: string | null }[];
  res.json({
    ...withThumbUrl(row),
    characters: characters.map((c) => ({
      ...c,
      avatar_image_url: c.avatar_image_path ? toFileUrl(c.avatar_image_path) : null,
    })),
  });
});

playersRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const player = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM players WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!player) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(player.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, player.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE players SET thumbnail_image_path = ? WHERE id = ?").run(target, req.params.id);
  res.json(withThumbUrl({ thumbnail_image_path: target }));
});

playersRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const player = db
    .prepare("SELECT folder_path, avatar_image_path FROM players WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!player) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(player.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, player.avatar_image_path, "avatar");

  db.prepare("UPDATE players SET avatar_image_path = ? WHERE id = ?").run(target, req.params.id);
  res.json(withThumbUrl({ avatar_image_path: target }));
});

playersRouter.post("/", (req, res) => {
  const { name, notes } = req.body as { name: string; notes?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = playerFolder(name);
  const info = db
    .prepare("INSERT INTO players (name, notes, folder_path) VALUES (?, ?, ?)")
    .run(name, notes || "", folder);
  res
    .status(201)
    .json(db.prepare("SELECT * FROM players WHERE id = ?").get(info.lastInsertRowid));
});

playersRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM players WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { name, notes } = req.body as { name?: string; notes?: string };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    "UPDATE players SET name = COALESCE(?, name), notes = COALESCE(?, notes), folder_path = ? WHERE id = ?"
  ).run(name ?? null, notes ?? null, folderPath, req.params.id);
  res.json(db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id));
});

playersRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE players SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

playersRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE players SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id));
});

// GM reminders shown to this one player only, on their player-app Главная.
// See gm_reminders in schema.sql — lifecycle is entirely GM-controlled.
playersRouter.get("/:id/reminders", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM gm_reminders WHERE target_type = 'player' AND target_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json(rows);
});

playersRouter.post("/:id/reminders", (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: "message is required" });
  const info = db
    .prepare("INSERT INTO gm_reminders (target_type, target_id, message) VALUES ('player', ?, ?)")
    .run(req.params.id, message);
  res.status(201).json(db.prepare("SELECT * FROM gm_reminders WHERE id = ?").get(info.lastInsertRowid));
});

playersRouter.delete("/:id/reminders/:reminderId", (req, res) => {
  db.prepare("DELETE FROM gm_reminders WHERE id = ? AND target_type = 'player' AND target_id = ?").run(
    req.params.reminderId,
    req.params.id
  );
  res.json({ ok: true });
});
