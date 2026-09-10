import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { playerFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";
import { unpaidSessionsForPlayer } from "../services/finance";
import { normalizeDndCharacter } from "@soyman/shared";

export const playersRouter = Router();
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

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
      `SELECT c.*, ca.name as campaign_name, ca.system_id as campaign_system_id,
              sys.name as campaign_system_name
       FROM characters c
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       LEFT JOIN systems sys ON sys.id = ca.system_id
       WHERE c.player_id = ? AND c.archived_at IS NULL`
    )
    .all(req.params.id) as {
    id: number;
    avatar_image_path: string | null;
    thumbnail_image_path: string | null;
    system_id: number | null;
    campaign_system_id: number | null;
    campaign_system_name: string | null;
  }[];
  const systemsById = new Map<number, string>(
    (db.prepare("SELECT id, name FROM systems").all() as { id: number; name: string }[]).map(
      (s) => [s.id, s.name]
    )
  );
  res.json({
    ...withThumbUrl(row),
    characters: characters.map((c) => ({
      ...c,
      avatar_image_url: c.avatar_image_path ? toFileUrl(c.avatar_image_path) : null,
      thumbnail_image_url: c.thumbnail_image_path ? toFileUrl(c.thumbnail_image_path) : null,
      ...summarizeCharacterSheet(c.id, c.system_id, c.campaign_system_id, systemsById),
    })),
  });
});

// Чарник персонажа для профиля игрока: какой лист показать по «Чарник →» и
// что написать в строке «система + системная инфа». Первичный лист —
// dnd_character > litm_character > zip_character > остальное, full раньше
// short. Система: systemId из содержимого листа, иначе system_id персонажа
// (для внекампанейских), иначе система кампании. Всё аддитивно: новых
// запросов клиент не делает, старых полей не убираем.
function summarizeCharacterSheet(
  characterId: number,
  characterSystemId: number | null,
  campaignSystemId: number | null,
  systemsById: Map<number, string>
): {
  sheet_statblock_id: number | null;
  statblock_format: string | null;
  system_name: string | null;
  system_info: string | null;
} {
  const empty = {
    sheet_statblock_id: null,
    statblock_format: null,
    system_name: null as string | null,
    system_info: null as string | null,
  };
  let statblocks: { id: number; format: string; kind: string; content: string }[];
  try {
    statblocks = db
      .prepare(
        `SELECT id, format, kind, content FROM statblocks
         WHERE owner_type = 'character' AND owner_id = ? AND archived_at IS NULL`
      )
      .all(characterId) as { id: number; format: string; kind: string; content: string }[];
  } catch {
    return empty;
  }
  if (statblocks.length === 0) {
    const fallback = characterSystemId != null ? systemsById.get(characterSystemId) ?? null : null;
    return { ...empty, system_name: fallback };
  }
  const formatRank = (f: string) =>
    f === "dnd_character" ? 0 : f === "litm_character" ? 1 : f === "zip_character" ? 2 : 3;
  const sorted = [...statblocks].sort(
    (a, b) =>
      formatRank(a.format) - formatRank(b.format) ||
      (a.kind === "full" ? 0 : 1) - (b.kind === "full" ? 0 : 1) ||
      a.id - b.id
  );
  const primary = sorted[0];
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(primary.content || "{}") as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const systemIdFromContent =
    parsed && typeof parsed.systemId === "number" ? (parsed.systemId as number) : null;
  const systemId = systemIdFromContent ?? characterSystemId ?? campaignSystemId ?? null;
  const system_name = systemId != null ? (systemsById.get(systemId) ?? null) : null;

  let system_info: string | null = null;
  if (parsed) {
    if (primary.format === "dnd_character") {
      // Разбор листа — общей нормализацией: свой был четвёртым по счёту и
      // отличался от соседнего в `player.ts` мелочами вроде обрезки пробелов.
      const d = normalizeDndCharacter(parsed);
      const race = (d.raceName ?? "").trim();
      const classSummary = d.classes
        .filter((c) => (c.className ?? "").trim())
        .map((c) => {
          const cls = (c.className ?? "").trim();
          const sub = (c.subclassName ?? "").trim();
          const lvl = Number.isFinite(c.level) && c.level ? ` ${c.level}` : "";
          return `${[cls, sub].filter(Boolean).join(" — ")}${lvl}`;
        })
        .join(" / ");
      system_info = [race, classSummary].filter(Boolean).join(" · ") || null;
    } else if (primary.format === "litm_character") {
      const themes = Array.isArray(parsed.themes)
        ? (parsed.themes as { name?: unknown; themeType?: unknown }[])
        : [];
      const names = themes
        .map((t) => (typeof t.name === "string" ? t.name.trim() : ""))
        .filter(Boolean)
        .slice(0, 4);
      system_info = names.length > 0 ? names.join(" · ") : null;
    } else if (primary.format === "zip_character") {
      const typeName =
        typeof parsed.characterTypeName === "string" ? parsed.characterTypeName.trim() : "";
      const level = typeof parsed.level === "string" ? parsed.level.trim() : "";
      const spec = typeof parsed.specialization === "string" ? parsed.specialization.trim() : "";
      system_info =
        [typeName, level ? `Ур. ${level}` : "", spec].filter(Boolean).join(" · ") || null;
    }
  }
  return {
    sheet_statblock_id: primary.id,
    statblock_format: primary.format,
    system_name,
    system_info,
  };
}

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
// Неоплаченное этим игроком — то же вычисление, что видит он сам в своём
// кабинете (routes/player.ts), только запрошенное Мастером. Долг нигде не
// хранится: «ожидалось − оплачено − прощено». Действия над ним живут в
// карточке конкретной сессии — сумма зависит от ставки и состава того вечера,
// и гасить «вообще» значило бы дать приложению выбрать сессию за Мастера.
playersRouter.get("/:id/unpaid", (req, res) => {
  const playerId = Number(req.params.id);
  if (!Number.isFinite(playerId)) return res.status(400).json({ error: "bad id" });
  res.json(unpaidSessionsForPlayer(playerId));
});

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
