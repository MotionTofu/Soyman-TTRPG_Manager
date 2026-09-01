import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { db } from "../db/db";
import { campaignNow, defaultStatus, timePatch } from "../services/eventTime";
import { campaignFolder, toFileUrl, VAULT_ROOT, vaultAbs, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";
import { campaignEarnings } from "../services/finance";
import { requireAuth } from "../services/auth";
import { broadcastToCampaign } from "../services/realtime";

export const campaignsRouter = Router();
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `rpg-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Недопустимый тип файла — разрешены только JPG/PNG/GIF/WebP/AVIF"));
  },
});
function getFileBuffer(file: Express.Multer.File): Buffer {
  if ((file as unknown as { buffer?: Buffer }).buffer) return (file as unknown as { buffer: Buffer }).buffer;
  const p = (file as unknown as { path?: string }).path;
  if (p && fs.existsSync(p)) return fs.readFileSync(p);
  return Buffer.alloc(0);
}
function cleanupFile(file: Express.Multer.File | undefined) {
  const p = (file as unknown as { path?: string })?.path;
  if (p) try { fs.unlinkSync(p); } catch {}
}

function withBgUrl<T extends { background_image_path?: string | null; thumbnail_image_path?: string | null }>(
  row: T
) {
  return {
    ...row,
    background_image_url: row.background_image_path ? toFileUrl(row.background_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

campaignsRouter.get("/", (req, res) => {
  const { setting_id, system_id } = req.query as { setting_id?: string; system_id?: string };
  const clauses = ["c.archived_at IS NULL"];
  const params: Record<string, string> = {};
  if (setting_id) {
    clauses.push("c.setting_id = @setting_id");
    params.setting_id = setting_id;
  }
  if (system_id) {
    clauses.push("c.system_id = @system_id");
    params.system_id = system_id;
  }
  const rows = db
    .prepare(
      `SELECT c.*, s.name as system_name, st.name as setting_name,
              (SELECT COUNT(*) FROM campaign_roster cr
                 JOIN players p ON p.id = cr.player_id
                 WHERE cr.campaign_id = c.id AND cr.status = 'active' AND p.archived_at IS NULL) as player_count,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = c.id AND s2.status = 'held' AND s2.archived_at IS NULL) as held_sessions_count,
              (SELECT MIN(s3.date) FROM sessions s3
                 WHERE s3.campaign_id = c.id AND s3.status = 'planned' AND s3.archived_at IS NULL
                   AND s3.date >= date('now')) as next_planned_date
       FROM campaigns c
       LEFT JOIN systems s ON s.id = c.system_id
       LEFT JOIN settings st ON st.id = c.setting_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY (next_planned_date IS NULL), next_planned_date, c.created_at DESC`
    )
    .all(params) as { background_image_path: string | null }[];
  res.json(rows.map(withBgUrl));
});

campaignsRouter.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT c.*, s.name as system_name, st.name as setting_name
       FROM campaigns c
       LEFT JOIN systems s ON s.id = c.system_id
       LEFT JOIN settings st ON st.id = c.setting_id
       WHERE c.id = ?`
    )
    .get(req.params.id) as { background_image_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const roster = db
    .prepare(
      `SELECT p.*, cr.status as roster_status FROM campaign_roster cr
       JOIN players p ON p.id = cr.player_id
       WHERE cr.campaign_id = ? AND p.archived_at IS NULL
       ORDER BY p.name`
    )
    .all(req.params.id) as { thumbnail_image_path: string | null }[];
  const finance = campaignEarnings(Number(req.params.id));
  res.json({ ...withBgUrl(row), roster: roster.map(withBgUrl), finance });
});

campaignsRouter.post("/:id/background", upload.single("file"), async (req, res) => {
  const campaign = db
    .prepare("SELECT folder_path, background_image_path FROM campaigns WHERE id = ?")
    .get(req.params.id) as { folder_path: string; background_image_path: string | null } | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const rawExt = path.extname(req.file.originalname).toLowerCase() || ".jpg";
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) { cleanupFile(req.file); return res.status(400).json({ error: "Недопустимое расширение файла" }); }
  const ext = rawExt;
  const target = path.join(campaign.folder_path, `background${ext}`);
  try {
    await writeReplacingOldFile(target, getFileBuffer(req.file), campaign.background_image_path, "background");
  } finally { cleanupFile(req.file); }

  db.prepare("UPDATE campaigns SET background_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withBgUrl({ background_image_path: target }));
});

campaignsRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const campaign = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM campaigns WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const rawExt = path.extname(req.file.originalname).toLowerCase() || ".jpg";
  if (!ALLOWED_IMAGE_EXTS.has(rawExt)) { cleanupFile(req.file); return res.status(400).json({ error: "Недопустимое расширение файла" }); }
  const ext = rawExt;
  const target = path.join(campaign.folder_path, `thumbnail${ext}`);
  try {
    await writeReplacingOldFile(target, getFileBuffer(req.file), campaign.thumbnail_image_path, "thumbnail");
  } finally { cleanupFile(req.file); }

  db.prepare("UPDATE campaigns SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withBgUrl({ thumbnail_image_path: target }));
});

campaignsRouter.delete("/:id/background", (req, res) => {
  const campaign = db.prepare("SELECT background_image_path FROM campaigns WHERE id = ?").get(req.params.id) as
    | { background_image_path: string | null }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  if (campaign.background_image_path) {
    try {
      const abs = path.resolve(vaultAbs(campaign.background_image_path));
      const root = path.resolve(VAULT_ROOT);
      if (abs !== root && abs.startsWith(root + path.sep) && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {}
    db.prepare("UPDATE campaigns SET background_image_path = NULL WHERE id = ?").run(req.params.id);
  }
  res.json({ ok: true });
});

campaignsRouter.delete("/:id/thumbnail", (req, res) => {
  const campaign = db.prepare("SELECT thumbnail_image_path FROM campaigns WHERE id = ?").get(req.params.id) as
    | { thumbnail_image_path: string | null }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "not found" });
  if (campaign.thumbnail_image_path) {
    try {
      const abs = path.resolve(vaultAbs(campaign.thumbnail_image_path));
      const root = path.resolve(VAULT_ROOT);
      if (abs !== root && abs.startsWith(root + path.sep) && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {}
    db.prepare("UPDATE campaigns SET thumbnail_image_path = NULL WHERE id = ?").run(req.params.id);
  }
  res.json({ ok: true });
});

campaignsRouter.post("/", (req, res) => {
  const { name, role, system_id, setting_id, type, payment_type, payment_frequency, rate_split, session_rate, currency } =
    req.body as {
      name: string;
      role?: string;
      system_id?: number;
      setting_id?: number;
      type?: string;
      payment_type?: string;
      payment_frequency?: string;
      rate_split?: string;
      session_rate?: number;
      currency?: string;
    };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = campaignFolder(name);
  const info = db
    .prepare(
      `INSERT INTO campaigns (name, role, system_id, setting_id, type, payment_type, payment_frequency, rate_split, session_rate, currency, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      role === "player" ? "player" : "gm",
      system_id ?? null,
      setting_id ?? null,
      type === "oneshot" ? "oneshot" : "campaign",
      payment_type ?? "free",
      payment_frequency ?? "per_session",
      rate_split ?? "per_person",
      session_rate ?? 0,
      currency ?? "RUB",
      folder
    );
  res
    .status(201)
    .json(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(info.lastInsertRowid));
});

campaignsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM campaigns WHERE id = ?")
    .get(req.params.id) as
    | { folder_path: string; name: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const {
    name,
    role,
    system_id,
    setting_id,
    status,
    type,
    payment_type,
    payment_frequency,
    rate_split,
    session_rate,
    currency,
    group_theme_litm,
  } = req.body as {
    name?: string;
    role?: string;
    system_id?: number | null;
    setting_id?: number | null;
    status?: string;
    type?: string;
    payment_type?: string;
    payment_frequency?: string;
    rate_split?: string;
    session_rate?: number;
    currency?: string;
    group_theme_litm?: string | null;
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  // C-P0-5: COALESCE(NULL, col)=col — нельзя отвязать system_id/setting_id. Собираем SET только по ключам, присутствующим в body (явный null = отвязать).
  const body = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  function setIfPresent(key: string, col: string) {
    if (key in body) { sets.push(`${col} = ?`); vals.push(body[key] as unknown); }
  }
  // name/role/type/status/payment_* — тоже через presence, чтобы не затирать, но и дать шанс очистить группу тем
  setIfPresent("name", "name");
  setIfPresent("role", "role");
  setIfPresent("system_id", "system_id");
  setIfPresent("setting_id", "setting_id");
  setIfPresent("status", "status");
  setIfPresent("type", "type");
  setIfPresent("payment_type", "payment_type");
  setIfPresent("payment_frequency", "payment_frequency");
  setIfPresent("rate_split", "rate_split");
  setIfPresent("session_rate", "session_rate");
  setIfPresent("currency", "currency");
  setIfPresent("group_theme_litm", "group_theme_litm");
  sets.push("folder_path = ?");
  vals.push(folderPath);
  if (sets.length > 1 || vals.length > 1) {
    db.prepare(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = ?`).run(...vals, req.params.id);
  } else {
    db.prepare(`UPDATE campaigns SET folder_path = ? WHERE id = ?`).run(folderPath, req.params.id);
  }
  res.json(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id));
});

campaignsRouter.put("/:id/pinned-calendar", (req, res) => {
  const { year, month } = req.body as { year: number | null; month: number | null };
  db.prepare("UPDATE campaigns SET pinned_calendar_year = ?, pinned_calendar_month = ? WHERE id = ?").run(
    year ?? null,
    month ?? null,
    req.params.id
  );
  res.json({ pinned_calendar_year: year ?? null, pinned_calendar_month: month ?? null });
});

// Sets the campaign's shared LitM group theme and overwrites the `fellowshipTheme`
// field on every litm_character statblock belonging to this campaign's characters
// (Fellowship Theme is meant to be shared across the party, so this is what
// "group theme" / "team theme" refers to in the UI).
campaignsRouter.post("/:id/group-theme/apply", (req, res) => {
  const { theme } = req.body as { theme?: unknown };
  if (!theme) return res.status(400).json({ error: "theme is required" });
  const themeJson = JSON.stringify(theme);

  db.prepare("UPDATE campaigns SET group_theme_litm = ? WHERE id = ?").run(themeJson, req.params.id);

  const rows = db
    .prepare(
      `SELECT s.id, s.content FROM statblocks s
       JOIN characters c ON c.id = s.owner_id
       WHERE s.owner_type = 'character' AND s.format = 'litm_character' AND c.campaign_id = ?`
    )
    .all(req.params.id) as { id: number; content: string }[];

  const update = db.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.content || "{}");
    } catch {
      data = {};
    }
    data.fellowshipTheme = theme;
    update.run(JSON.stringify(data), row.id);
  }

  res.json({ ok: true, updatedCharacters: rows.length });
});

campaignsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE campaigns SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

campaignsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE campaigns SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id));
});

// GM reminders broadcast to every player in this campaign, on their
// player-app Главная. See gm_reminders in schema.sql.
campaignsRouter.get("/:id/reminders", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM gm_reminders WHERE target_type = 'campaign' AND target_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json(rows);
});

campaignsRouter.post("/:id/reminders", (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: "message is required" });
  const info = db
    .prepare("INSERT INTO gm_reminders (target_type, target_id, message) VALUES ('campaign', ?, ?)")
    .run(req.params.id, message);
  res.status(201).json(db.prepare("SELECT * FROM gm_reminders WHERE id = ?").get(info.lastInsertRowid));
});

campaignsRouter.delete("/:id/reminders/:reminderId", (req, res) => {
  db.prepare("DELETE FROM gm_reminders WHERE id = ? AND target_type = 'campaign' AND target_id = ?").run(
    req.params.reminderId,
    req.params.id
  );
  res.json({ ok: true });
});

// Pushes an image to every connected player device in this campaign in
// real time (mobile GM's "показать изображение" button) — a no-op when
// nobody's listening (local desktop GM app, or no player has the mobile app
// open). requireAuth("gm") only bites when AUTH_ENABLED — see services/auth.
campaignsRouter.post("/:id/show-image", requireAuth("gm"), (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) return res.status(400).json({ error: "url is required" });
  broadcastToCampaign(Number(req.params.id), "show-image", { url });
  res.json({ ok: true });
});

// Roster management
campaignsRouter.post("/:id/roster/:playerId", (req, res) => {
  db.prepare(
    "INSERT OR IGNORE INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)"
  ).run(req.params.id, req.params.playerId);
  res.json({ ok: true });
});

campaignsRouter.delete("/:id/roster/:playerId", (req, res) => {
  db.prepare(
    "DELETE FROM campaign_roster WHERE campaign_id = ? AND player_id = ?"
  ).run(req.params.id, req.params.playerId);
  res.json({ ok: true });
});

campaignsRouter.put("/:id/roster/:playerId", (req, res) => {
  const { status } = req.body as { status: string };
  if (!status) return res.status(400).json({ error: "status is required" });
  db.prepare(
    "UPDATE campaign_roster SET status = ? WHERE campaign_id = ? AND player_id = ?"
  ).run(status, req.params.id, req.params.playerId);
  res.json({ ok: true });
});

campaignsRouter.get("/:id/finance", (req, res) => {
  res.json(campaignEarnings(Number(req.params.id)));
});

campaignsRouter.get("/:id/sessions", (req, res) => {
  const campaign = db
    .prepare("SELECT payment_type FROM campaigns WHERE id = ?")
    .get(req.params.id) as { payment_type: string } | undefined;
  const rows = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = s.campaign_id AND s2.archived_at IS NULL
                   AND s2.date <= s.date) as session_number
       FROM sessions s
       WHERE s.campaign_id = ? AND s.archived_at IS NULL
       ORDER BY s.date`
    )
    .all(req.params.id) as Record<string, unknown>[];
  const withPaymentType = rows.map((r) => ({
    ...r,
    effective_payment_type: (r.payment_override as string) || campaign?.payment_type || "free",
  }));
  res.json(withPaymentType);
});

// In-world calendar events for a campaign, created from its custom
// calendar tab (right-click on a day) or the "События" list.
campaignsRouter.get("/:id/calendar-events", (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM campaign_calendar_events WHERE campaign_id = ?
       ORDER BY important DESC, inworld_year, inworld_month, inworld_day`
    )
    .all(req.params.id);
  res.json(rows);
});

campaignsRouter.post("/:id/calendar-events", (req, res) => {
  const { title, description, inworld_year, inworld_month, inworld_day, important } =
    req.body as {
      title: string;
      description?: string;
      inworld_year: number;
      inworld_month: number;
      inworld_day: number;
      important?: boolean;
    };
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle || inworld_year == null || inworld_month == null || inworld_day == null) {
    return res
      .status(400)
      .json({ error: "title, inworld_year, inworld_month, inworld_day are required" });
  }
  if (trimmedTitle.length > 200 || (description && description.length > 5000)) {
    return res.status(400).json({ error: "title or description too long" });
  }
  const y = Number(inworld_year); const m = Number(inworld_month); const d = Number(inworld_day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 36 || d < 1 || d > 60) {
    return res.status(400).json({ error: "invalid inworld date" });
  }
  // «Сейчас» кампании — закреплённая дата, а без неё последняя проведённая
  // сессия: у расписания будущее и есть основной случай, и ставить всему
  // «случилось» значило бы врать почти каждой записи.
  const status = defaultStatus(y, m, campaignNow(Number(req.params.id)));
  const info = db
    .prepare(
      `INSERT INTO campaign_calendar_events
         (campaign_id, title, description, inworld_year, inworld_month, inworld_day, important, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      trimmedTitle,
      description ?? "",
      y,
      m,
      d,
      important ? 1 : 0,
      status
    );
  res
    .status(201)
    .json(db.prepare("SELECT * FROM campaign_calendar_events WHERE id = ?").get(info.lastInsertRowid));
});

campaignsRouter.put("/calendar-events/:eventId", (req, res) => {
  const { title, description, inworld_year, inworld_month, inworld_day, important } =
    req.body as {
      title?: string;
      description?: string;
      inworld_year?: number;
      inworld_month?: number;
      inworld_day?: number;
      important?: boolean;
    };
  const existing = db.prepare("SELECT campaign_id FROM campaign_calendar_events WHERE id = ?").get(req.params.eventId) as { campaign_id: number } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  if (title !== undefined && typeof title === "string" && title.trim().length === 0) {
    return res.status(400).json({ error: "title cannot be empty" });
  }
  if (title !== undefined && typeof title === "string" && title.trim().length > 200) {
    return res.status(400).json({ error: "title too long" });
  }
  if (description !== undefined && typeof description === "string" && description.length > 5000) {
    return res.status(400).json({ error: "description too long" });
  }
  for (const [k, v] of [["inworld_month", inworld_month], ["inworld_day", inworld_day]] as const) {
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!Number.isFinite(n) || (k === "inworld_month" && (n < 1 || n > 36)) || (k === "inworld_day" && (n < 1 || n > 60))) {
        return res.status(400).json({ error: `invalid ${k}` });
      }
    }
  }
  db.prepare(
    `UPDATE campaign_calendar_events SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       inworld_year = COALESCE(?, inworld_year),
       inworld_month = COALESCE(?, inworld_month),
       inworld_day = COALESCE(?, inworld_day),
       important = COALESCE(?, important)
     WHERE id = ?`
  ).run(
    title !== undefined ? (title === null ? null : String(title).trim() || null) : null,
    description ?? null,
    inworld_year ?? null,
    inworld_month ?? null,
    inworld_day ?? null,
    important === undefined ? null : important ? 1 : 0,
    req.params.eventId
  );
  const time = timePatch(req.body as Record<string, unknown>);
  if (time.sets.length > 0) {
    db.prepare(`UPDATE campaign_calendar_events SET ${time.sets.join(", ")} WHERE id = ?`).run(
      ...time.values,
      req.params.eventId
    );
  }
  res.json(db.prepare("SELECT * FROM campaign_calendar_events WHERE id = ?").get(req.params.eventId));
});

campaignsRouter.delete("/calendar-events/:eventId", (req, res) => {
  const existing = db.prepare("SELECT id FROM campaign_calendar_events WHERE id = ?").get(req.params.eventId) as { id: number } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM campaign_calendar_events WHERE id = ?").run(req.params.eventId);
  res.json({ ok: true });
});

// Preproduction (1:1 per campaign, upserted)
campaignsRouter.get("/:id/preproduction", (req, res) => {
  const row = db
    .prepare("SELECT * FROM preproduction WHERE campaign_id = ?")
    .get(req.params.id);
  res.json(
    row ?? {
      campaign_id: Number(req.params.id),
      adventure_challenge: "",
      gameplay_styles: "",
      background: "",
      adventure_stakes_hooks: "",
      threads_clues_lore: "",
    }
  );
});

campaignsRouter.put("/:id/preproduction", (req, res) => {
  const {
    adventure_challenge,
    gameplay_styles,
    background,
    adventure_stakes_hooks,
    threads_clues_lore,
  } = req.body as Record<string, string | undefined>;

  const existing = db
    .prepare("SELECT id FROM preproduction WHERE campaign_id = ?")
    .get(req.params.id) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE preproduction SET
         adventure_challenge = COALESCE(?, adventure_challenge),
         gameplay_styles = COALESCE(?, gameplay_styles),
         background = COALESCE(?, background),
         adventure_stakes_hooks = COALESCE(?, adventure_stakes_hooks),
         threads_clues_lore = COALESCE(?, threads_clues_lore)
       WHERE campaign_id = ?`
    ).run(
      adventure_challenge ?? null,
      gameplay_styles ?? null,
      background ?? null,
      adventure_stakes_hooks ?? null,
      threads_clues_lore ?? null,
      req.params.id
    );
  } else {
    db.prepare(
      `INSERT INTO preproduction
         (campaign_id, adventure_challenge, gameplay_styles, background, adventure_stakes_hooks, threads_clues_lore)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      req.params.id,
      adventure_challenge ?? "",
      gameplay_styles ?? "",
      background ?? "",
      adventure_stakes_hooks ?? "",
      threads_clues_lore ?? ""
    );
  }
  res.json(
    db.prepare("SELECT * FROM preproduction WHERE campaign_id = ?").get(req.params.id)
  );
});
