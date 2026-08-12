import { Router } from "express";
import { db } from "../db/db";
import { ensureSubfolder, openInFileExplorer, sessionFolder, toFileUrl } from "../services/filesystem";
import { sessionEarnings } from "../services/finance";

export const sessionsRouter = Router();

function getCampaignFolder(campaignId: number): string {
  const row = db
    .prepare("SELECT folder_path FROM campaigns WHERE id = ?")
    .get(campaignId) as { folder_path: string } | undefined;
  if (!row) throw new Error("campaign not found");
  return row.folder_path;
}

sessionsRouter.get("/:id", (req, res) => {
  const session = db
    .prepare(
      `SELECT s.*, c.name as campaign_name, c.payment_type as campaign_payment_type,
              c.session_rate as campaign_session_rate, c.currency,
              (SELECT COUNT(*) FROM sessions s2
                 WHERE s2.campaign_id = s.campaign_id AND s2.archived_at IS NULL
                   AND s2.date <= s.date) as session_number
       FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.id = ?`
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!session) return res.status(404).json({ error: "not found" });

  const attendance = db
    .prepare(
      `SELECT p.id as player_id, p.name,
              COALESCE(sa.attended, 0) as attended,
              COALESCE(sa.amount_paid, 0) as amount_paid
       FROM campaign_roster cr
       JOIN players p ON p.id = cr.player_id
       LEFT JOIN session_attendance sa
         ON sa.session_id = ? AND sa.player_id = p.id
       WHERE cr.campaign_id = (SELECT campaign_id FROM sessions WHERE id = ?)
       ORDER BY p.name`
    )
    .all(req.params.id, req.params.id);

  // archived_at filter matters here: without it, an "archived" (deleted)
  // resource kept showing forever on the session page since this was the
  // only place reading session.resources — the resources.ts router's own
  // GET / already filters archived rows, but this embedded query didn't.
  const resources = (
    db
      .prepare("SELECT * FROM resources WHERE session_id = ? AND archived_at IS NULL ORDER BY name")
      .all(req.params.id) as { file_path: string | null }[]
  ).map((r) => ({ ...r, file_url: r.file_path ? toFileUrl(r.file_path) : null }));

  res.json({
    ...session,
    effective_payment_type:
      (session.payment_override as string) || (session.campaign_payment_type as string),
    attendance,
    resources,
    earned: sessionEarnings(Number(req.params.id)),
  });
});

sessionsRouter.post("/", (req, res) => {
  const { campaign_id, date, status, payment_override, stake_override, start_time } =
    req.body as {
      campaign_id: number;
      date: string;
      status?: string;
      payment_override?: string | null;
      stake_override?: number;
      start_time?: string | null;
    };
  if (!campaign_id || !date)
    return res.status(400).json({ error: "campaign_id and date are required" });

  const campaignFolderPath = getCampaignFolder(campaign_id);
  const folder = sessionFolder(campaignFolderPath, date);

  const info = db
    .prepare(
      `INSERT INTO sessions (campaign_id, date, status, payment_override, stake_override, start_time, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      campaign_id,
      date,
      status ?? "planned",
      payment_override || null,
      stake_override ?? null,
      start_time || null,
      folder
    );
  res
    .status(201)
    .json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid));
});

sessionsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id) as
    | {
        title: string | null;
        payment_override: string | null;
        stake_override: number | null;
        inworld_year: number | null;
        inworld_month: number | null;
        inworld_day: number | null;
        inworld_year_end: number | null;
        inworld_month_end: number | null;
        inworld_day_end: number | null;
        start_time: string | null;
        battle_playlist_id: number | null;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const {
    status,
    title,
    payment_override,
    stake_override,
    idea_notes,
    main_events,
    main_events_visible,
    inworld_year,
    inworld_month,
    inworld_day,
    inworld_year_end,
    inworld_month_end,
    inworld_day_end,
    start_time,
    battle_playlist_id,
    cheatsheet_data,
  } = req.body as {
    status?: string;
    title?: string | null;
    payment_override?: string | null;
    stake_override?: number | null;
    idea_notes?: string;
    main_events?: string;
    main_events_visible?: boolean;
    inworld_year?: number | null;
    inworld_month?: number | null;
    inworld_day?: number | null;
    inworld_year_end?: number | null;
    inworld_month_end?: number | null;
    inworld_day_end?: number | null;
    start_time?: string | null;
    battle_playlist_id?: number | null;
    cheatsheet_data?: string | null;
  };

  db.prepare(
    `UPDATE sessions SET
       status = COALESCE(?, status),
       title = ?,
       payment_override = ?,
       stake_override = ?,
       idea_notes = COALESCE(?, idea_notes),
       main_events = COALESCE(?, main_events),
       main_events_visible = COALESCE(?, main_events_visible),
       inworld_year = ?,
       inworld_month = ?,
       inworld_day = ?,
       inworld_year_end = ?,
       inworld_month_end = ?,
       inworld_day_end = ?,
       start_time = ?,
       battle_playlist_id = ?,
       cheatsheet_data = CASE WHEN ? THEN ? ELSE cheatsheet_data END
     WHERE id = ?`
  ).run(
    status ?? null,
    title === undefined ? existing.title : title || null,
    payment_override === undefined ? existing.payment_override : payment_override || null,
    stake_override === undefined ? existing.stake_override : stake_override,
    idea_notes ?? null,
    main_events ?? null,
    main_events_visible === undefined ? null : main_events_visible ? 1 : 0,
    inworld_year === undefined ? existing.inworld_year : inworld_year,
    inworld_month === undefined ? existing.inworld_month : inworld_month,
    inworld_day === undefined ? existing.inworld_day : inworld_day,
    inworld_year_end === undefined ? existing.inworld_year_end : inworld_year_end,
    inworld_month_end === undefined ? existing.inworld_month_end : inworld_month_end,
    inworld_day_end === undefined ? existing.inworld_day_end : inworld_day_end,
    start_time === undefined ? existing.start_time : start_time || null,
    battle_playlist_id === undefined ? existing.battle_playlist_id : battle_playlist_id,
    cheatsheet_data !== undefined ? 1 : 0,
    cheatsheet_data ?? null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

// Combat/turn-order state — always fully overwritten (not the optional-field
// COALESCE pattern above), since Старт/Следующий/Предыдущий always know the
// exact target state rather than "leave unspecified fields alone".
sessionsRouter.put("/:id/combat", (req, res) => {
  const { active, turn_entry_id } = req.body as { active: boolean; turn_entry_id: number | null };
  db.prepare("UPDATE sessions SET combat_active = ?, combat_turn_entry_id = ? WHERE id = ?").run(
    active ? 1 : 0,
    turn_entry_id ?? null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

sessionsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE sessions SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

// Reveals the session's whole "resources" folder in the OS file explorer —
// the general-purpose storage the "Ресурсы" section's category subfolders
// (pdf/images/audio/other) live under, see resources.ts's CATEGORY_SUBDIR.
sessionsRouter.post("/:id/reveal-resources", (req, res) => {
  const row = db
    .prepare("SELECT folder_path FROM sessions WHERE id = ?")
    .get(req.params.id) as { folder_path: string | null } | undefined;
  if (!row || !row.folder_path) return res.status(404).json({ error: "not found" });
  const folder = ensureSubfolder(row.folder_path, "resources");
  openInFileExplorer(folder, false);
  res.json({ ok: true });
});

sessionsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE sessions SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id));
});

sessionsRouter.put("/:id/attendance", (req, res) => {
  const { attendance } = req.body as {
    attendance: { player_id: number; attended: boolean; amount_paid: number }[];
  };
  const upsert = db.prepare(
    `INSERT INTO session_attendance (session_id, player_id, attended, amount_paid)
     VALUES (@session_id, @player_id, @attended, @amount_paid)
     ON CONFLICT(session_id, player_id) DO UPDATE SET attended = @attended, amount_paid = @amount_paid`
  );
  const tx = db.transaction((rows: typeof attendance) => {
    for (const row of rows) {
      upsert.run({
        session_id: Number(req.params.id),
        player_id: row.player_id,
        attended: row.attended ? 1 : 0,
        amount_paid: row.amount_paid || 0,
      });
    }
  });
  tx(attendance || []);
  res.json({ ok: true, earned: sessionEarnings(Number(req.params.id)) });
});

sessionsRouter.post("/:id/reschedule", (req, res) => {
  const { to_date } = req.body as { to_date: string };
  if (!to_date) return res.status(400).json({ error: "to_date is required" });

  const original = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.id) as
    | { campaign_id: number; payment_override: string | null; stake_override: number | null }
    | undefined;
  if (!original) return res.status(404).json({ error: "not found" });

  const campaignFolderPath = getCampaignFolder(original.campaign_id);
  const folder = sessionFolder(campaignFolderPath, to_date);

  const info = db
    .prepare(
      `INSERT INTO sessions (campaign_id, date, status, payment_override, stake_override, folder_path, rescheduled_from_id)
       VALUES (?, ?, 'planned', ?, ?, ?, ?)`
    )
    .run(
      original.campaign_id,
      to_date,
      original.payment_override,
      original.stake_override,
      folder,
      req.params.id
    );

  db.prepare(
    "UPDATE sessions SET status = 'rescheduled', rescheduled_to_id = ? WHERE id = ?"
  ).run(info.lastInsertRowid, req.params.id);

  res.status(201).json({
    original: db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id),
    newSession: db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(info.lastInsertRowid),
  });
});
