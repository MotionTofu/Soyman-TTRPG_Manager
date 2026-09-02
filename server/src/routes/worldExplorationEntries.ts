import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { worldExplorationEntryFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";

export const worldExplorationEntriesRouter = Router();
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

function withAvatarUrl<T extends { avatar_image_path?: string | null }>(row: T) {
  return { ...row, avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null };
}

// Старая общая картотека «Исследование Мира» живёт ТОЛЬКО в кампаниях, где
// владелец сам играет (`campaigns.role = 'player'`, вкладка PLAYER_TABS в
// CampaignDetailPage). В кампаниях, которые он водит, эти же строки — личные
// путевые заметки его игроков, и мастеру они не видны: разбор 2026-09-02,
// SideWorks/Профиль_Кампании_Игрок.md. Без этой проверки роут был бы ровно той
// дверью, которую там решили закрыть.
function isOwnPlayerCampaign(campaignId: number | string | undefined): boolean {
  if (campaignId == null) return false;
  const row = db.prepare("SELECT role FROM campaigns WHERE id = ?").get(campaignId) as
    | { role: string }
    | undefined;
  return row?.role === "player";
}

// То же самое, но по записи: PUT/DELETE/avatar приходят с одним лишь id.
function entryCampaignId(entryId: string): number | undefined {
  const row = db.prepare("SELECT campaign_id FROM world_exploration_entries WHERE id = ?").get(entryId) as
    | { campaign_id: number }
    | undefined;
  return row?.campaign_id;
}

worldExplorationEntriesRouter.get("/", (req, res) => {
  const { campaign_id, kind } = req.query as { campaign_id?: string; kind?: string };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  if (!isOwnPlayerCampaign(campaign_id)) return res.status(404).json({ error: "not found" });
  const clauses = ["e.campaign_id = @campaign_id", "e.archived_at IS NULL"];
  const params: Record<string, string> = { campaign_id };
  if (kind) {
    clauses.push("e.kind = @kind");
    params.kind = kind;
  }
  const rows = db
    .prepare(
      `SELECT e.*, p.name as player_name FROM world_exploration_entries e
       LEFT JOIN players p ON p.id = e.player_id
       WHERE ${clauses.join(" AND ")} ORDER BY e.name COLLATE NOCASE`
    )
    .all(params);
  res.json(rows.map((r) => withAvatarUrl(r as { avatar_image_path: string | null })));
});

worldExplorationEntriesRouter.post("/", (req, res) => {
  const { campaign_id, player_id, kind, name, description, extra_field } = req.body as {
    campaign_id: number;
    player_id: number;
    kind: string;
    name?: string;
    description?: string;
    extra_field?: string;
  };
  if (!campaign_id || !player_id || !kind) {
    return res.status(400).json({ error: "campaign_id, player_id and kind are required" });
  }
  if (!isOwnPlayerCampaign(campaign_id)) return res.status(404).json({ error: "not found" });
  const campaign = db.prepare("SELECT folder_path FROM campaigns WHERE id = ?").get(campaign_id) as
    | { folder_path: string }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  const folder = worldExplorationEntryFolder(campaign.folder_path, kind, name || "Без имени");
  const info = db
    .prepare(
      `INSERT INTO world_exploration_entries (campaign_id, player_id, kind, name, description, extra_field, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(campaign_id, player_id, kind, name ?? "", description ?? "", extra_field ?? "", folder);
  res
    .status(201)
    .json(withAvatarUrl(db.prepare("SELECT * FROM world_exploration_entries WHERE id = ?").get(info.lastInsertRowid) as { avatar_image_path: string | null }));
});

worldExplorationEntriesRouter.put("/:id", (req, res) => {
  if (!isOwnPlayerCampaign(entryCampaignId(req.params.id))) return res.status(404).json({ error: "not found" });
  const { name, description, extra_field } = req.body as {
    name?: string;
    description?: string;
    extra_field?: string;
  };
  db.prepare(
    `UPDATE world_exploration_entries SET
       name = COALESCE(?, name), description = COALESCE(?, description), extra_field = COALESCE(?, extra_field)
     WHERE id = ?`
  ).run(name ?? null, description ?? null, extra_field ?? null, req.params.id);
  res.json(
    withAvatarUrl(db.prepare("SELECT * FROM world_exploration_entries WHERE id = ?").get(req.params.id) as {
      avatar_image_path: string | null;
    })
  );
});

worldExplorationEntriesRouter.delete("/:id", (req, res) => {
  if (!isOwnPlayerCampaign(entryCampaignId(req.params.id))) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE world_exploration_entries SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

worldExplorationEntriesRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  if (!isOwnPlayerCampaign(entryCampaignId(req.params.id))) return res.status(404).json({ error: "not found" });
  const entry = db
    .prepare("SELECT folder_path, avatar_image_path FROM world_exploration_entries WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!entry) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(entry.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, entry.avatar_image_path, "avatar");

  db.prepare("UPDATE world_exploration_entries SET avatar_image_path = ? WHERE id = ?").run(target, req.params.id);
  res.json(withAvatarUrl({ avatar_image_path: target }));
});
