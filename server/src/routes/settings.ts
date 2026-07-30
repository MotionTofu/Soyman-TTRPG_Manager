import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, openInFileExplorer, settingFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";

export const settingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function withBgUrl<T extends { background_image_path?: string | null; thumbnail_image_path?: string | null }>(
  row: T
) {
  return {
    ...row,
    background_image_url: row.background_image_path ? toFileUrl(row.background_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

settingsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM settings WHERE archived_at IS NULL ORDER BY name")
    .all() as { background_image_path: string | null }[];
  res.json(rows.map(withBgUrl));
});

settingsRouter.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM settings WHERE id = ?")
    .get(req.params.id) as { background_image_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withBgUrl(row));
});

settingsRouter.post("/", (req, res) => {
  const { name, description } = req.body as {
    name: string;
    description?: string;
  };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = settingFolder(name);
  const info = db
    .prepare(
      "INSERT INTO settings (name, description, folder_path) VALUES (?, ?, ?)"
    )
    .run(name, description || "", folder);
  res.status(201).json(
    db.prepare("SELECT * FROM settings WHERE id = ?").get(info.lastInsertRowid)
  );
});

function getCalendar(settingId: string | number) {
  const months = db
    .prepare("SELECT * FROM setting_calendar_months WHERE setting_id = ? ORDER BY position")
    .all(settingId);
  const weekdays = db
    .prepare("SELECT * FROM setting_calendar_weekdays WHERE setting_id = ? ORDER BY position")
    .all(settingId);
  const setting = db
    .prepare("SELECT calendar_era FROM settings WHERE id = ?")
    .get(settingId) as { calendar_era: string } | undefined;
  return { months, weekdays, era: setting?.calendar_era ?? "" };
}

settingsRouter.get("/:id/calendar", (req, res) => {
  const exists = db.prepare("SELECT id FROM settings WHERE id = ?").get(req.params.id);
  if (!exists) return res.status(404).json({ error: "not found" });
  res.json(getCalendar(req.params.id));
});

settingsRouter.put("/:id/calendar", (req, res) => {
  const { months, weekdays, era } = req.body as {
    months?: { name: string; days: number }[];
    weekdays?: { name: string }[];
    era?: string;
  };
  if (months) {
    db.prepare("DELETE FROM setting_calendar_months WHERE setting_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO setting_calendar_months (setting_id, position, name, days) VALUES (?, ?, ?, ?)"
    );
    months.forEach((m, i) => insert.run(req.params.id, i + 1, m.name, m.days || 30));
  }
  if (weekdays) {
    db.prepare("DELETE FROM setting_calendar_weekdays WHERE setting_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO setting_calendar_weekdays (setting_id, position, name) VALUES (?, ?, ?)"
    );
    weekdays.forEach((w, i) => insert.run(req.params.id, i + 1, w.name));
  }
  if (era !== undefined) {
    db.prepare("UPDATE settings SET calendar_era = ? WHERE id = ?").run(era, req.params.id);
  }
  res.json(getCalendar(req.params.id));
});

// Aggregate of every important date belonging to any being/community in
// this setting — used to mark the setting's own calendar preview and every
// campaign calendar built on this setting.
settingsRouter.get("/:id/important-dates", (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, b.name as owner_name FROM important_dates d
       JOIN setting_beings b ON b.id = d.owner_id AND d.owner_type = 'being'
       WHERE b.setting_id = ? AND b.archived_at IS NULL
       UNION ALL
       SELECT d.*, c.name as owner_name FROM important_dates d
       JOIN setting_communities c ON c.id = d.owner_id AND d.owner_type = 'community'
       WHERE c.setting_id = ? AND c.archived_at IS NULL
       UNION ALL
       SELECT d.*, l.name as owner_name FROM important_dates d
       JOIN setting_locations l ON l.id = d.owner_id AND d.owner_type = 'location'
       WHERE l.setting_id = ? AND l.archived_at IS NULL`
    )
    .all(req.params.id, req.params.id, req.params.id);
  res.json(rows);
});

// In-world calendar events owned by the setting itself ("Хроника мира"),
// created from the setting's calendar tab. On creation, a copy is inserted
// into campaign_calendar_events for every campaign currently using this
// setting, so campaigns can freely delete their own copy afterwards without
// affecting this source row (deliberately no link back to the source).
settingsRouter.get("/:id/calendar-events", (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM setting_calendar_events WHERE setting_id = ?
       ORDER BY important DESC, inworld_year, inworld_month, inworld_day`
    )
    .all(req.params.id);
  res.json(rows);
});

// When a setting-calendar event's description @-mentions a being/location/
// community, that date is also copied into the mentioned entity's own
// "Важные даты" list — tagged with source_event_id so re-saving the event
// (or deleting it) keeps that copy in sync instead of piling up duplicates.
const MENTION_RE = /\[\[(\w+):(\d+)\|[^\]]+\]\]/g;

function syncImportantDatesFromMentions(
  eventId: number,
  title: string,
  description: string,
  year: number,
  month: number,
  day: number
) {
  db.prepare("DELETE FROM important_dates WHERE source_event_id = ?").run(eventId);
  const seen = new Set<string>();
  const insert = db.prepare(
    `INSERT INTO important_dates (owner_type, owner_id, title, recurrence, year, month, day, source_event_id)
     VALUES (?, ?, ?, 'once', ?, ?, ?, ?)`
  );
  for (const m of description.matchAll(MENTION_RE)) {
    const type = m[1];
    const id = Number(m[2]);
    if (type !== "being" && type !== "location" && type !== "community") continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    insert.run(type, id, title, year, month, day, eventId);
  }
}

settingsRouter.post("/:id/calendar-events", (req, res) => {
  const { title, description, inworld_year, inworld_month, inworld_day, important } =
    req.body as {
      title: string;
      description?: string;
      inworld_year: number;
      inworld_month: number;
      inworld_day: number;
      important?: boolean;
    };
  if (!title || inworld_year == null || inworld_month == null || inworld_day == null) {
    return res
      .status(400)
      .json({ error: "title, inworld_year, inworld_month, inworld_day are required" });
  }
  const info = db
    .prepare(
      `INSERT INTO setting_calendar_events
         (setting_id, title, description, inworld_year, inworld_month, inworld_day, important)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      title,
      description ?? "",
      inworld_year,
      inworld_month,
      inworld_day,
      important ? 1 : 0
    );

  const campaigns = db
    .prepare("SELECT id FROM campaigns WHERE setting_id = ? AND archived_at IS NULL")
    .all(req.params.id) as { id: number }[];
  const insertIntoCampaign = db.prepare(
    `INSERT INTO campaign_calendar_events
       (campaign_id, title, description, inworld_year, inworld_month, inworld_day, important)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of campaigns) {
    insertIntoCampaign.run(
      c.id,
      title,
      description ?? "",
      inworld_year,
      inworld_month,
      inworld_day,
      important ? 1 : 0
    );
  }

  syncImportantDatesFromMentions(
    Number(info.lastInsertRowid),
    title,
    description ?? "",
    inworld_year,
    inworld_month,
    inworld_day
  );

  res
    .status(201)
    .json(db.prepare("SELECT * FROM setting_calendar_events WHERE id = ?").get(info.lastInsertRowid));
});

settingsRouter.put("/calendar-events/:eventId", (req, res) => {
  const { title, description, inworld_year, inworld_month, inworld_day, important, visible_to_players } =
    req.body as {
      title?: string;
      description?: string;
      inworld_year?: number;
      inworld_month?: number;
      inworld_day?: number;
      important?: boolean;
      visible_to_players?: boolean;
    };
  db.prepare(
    `UPDATE setting_calendar_events SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       inworld_year = COALESCE(?, inworld_year),
       inworld_month = COALESCE(?, inworld_month),
       inworld_day = COALESCE(?, inworld_day),
       important = COALESCE(?, important),
       visible_to_players = COALESCE(?, visible_to_players)
     WHERE id = ?`
  ).run(
    title ?? null,
    description ?? null,
    inworld_year ?? null,
    inworld_month ?? null,
    inworld_day ?? null,
    important === undefined ? null : important ? 1 : 0,
    visible_to_players === undefined ? null : visible_to_players ? 1 : 0,
    req.params.eventId
  );
  const updated = db
    .prepare("SELECT * FROM setting_calendar_events WHERE id = ?")
    .get(req.params.eventId) as {
    id: number;
    title: string;
    description: string;
    inworld_year: number;
    inworld_month: number;
    inworld_day: number;
  };
  syncImportantDatesFromMentions(
    updated.id,
    updated.title,
    updated.description,
    updated.inworld_year,
    updated.inworld_month,
    updated.inworld_day
  );
  res.json(updated);
});

settingsRouter.delete("/calendar-events/:eventId", (req, res) => {
  db.prepare("DELETE FROM setting_calendar_events WHERE id = ?").run(req.params.eventId);
  res.json({ ok: true });
});

// Эпохи for grouping the Хроника мира event list (Эпоха > Столетие >
// Десятилетие > Года > События) — an era spans from its own start_year up
// to the next era's start_year (by ascending start_year), so ordering alone
// defines the ranges without a redundant end_year column.
settingsRouter.get("/:id/calendar-eras", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM setting_calendar_eras WHERE setting_id = ? ORDER BY start_year")
    .all(req.params.id);
  res.json(rows);
});

settingsRouter.post("/:id/calendar-eras", (req, res) => {
  const { name, start_year } = req.body as { name: string; start_year: number };
  if (!name || start_year == null) return res.status(400).json({ error: "name and start_year are required" });
  const info = db
    .prepare("INSERT INTO setting_calendar_eras (setting_id, name, start_year) VALUES (?, ?, ?)")
    .run(req.params.id, name, start_year);
  res.status(201).json(db.prepare("SELECT * FROM setting_calendar_eras WHERE id = ?").get(info.lastInsertRowid));
});

settingsRouter.put("/calendar-eras/:eraId", (req, res) => {
  const { name, start_year } = req.body as { name?: string; start_year?: number };
  db.prepare("UPDATE setting_calendar_eras SET name = COALESCE(?, name), start_year = COALESCE(?, start_year) WHERE id = ?").run(
    name ?? null,
    start_year ?? null,
    req.params.eraId
  );
  res.json(db.prepare("SELECT * FROM setting_calendar_eras WHERE id = ?").get(req.params.eraId));
});

settingsRouter.delete("/calendar-eras/:eraId", (req, res) => {
  db.prepare("DELETE FROM setting_calendar_eras WHERE id = ?").run(req.params.eraId);
  res.json({ ok: true });
});

settingsRouter.put("/:id/pinned-calendar", (req, res) => {
  const { year, month } = req.body as { year: number | null; month: number | null };
  db.prepare("UPDATE settings SET pinned_calendar_year = ?, pinned_calendar_month = ? WHERE id = ?").run(
    year ?? null,
    month ?? null,
    req.params.id
  );
  res.json({ pinned_calendar_year: year ?? null, pinned_calendar_month: month ?? null });
});

settingsRouter.post("/:id/background", upload.single("file"), async (req, res) => {
  const setting = db
    .prepare("SELECT folder_path, background_image_path FROM settings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; background_image_path: string | null } | undefined;
  if (!setting) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(setting.folder_path, `background${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, setting.background_image_path, "background");

  db.prepare("UPDATE settings SET background_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withBgUrl({ background_image_path: target }));
});

settingsRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const setting = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM settings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!setting) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(setting.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, setting.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE settings SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withBgUrl({ thumbnail_image_path: target }));
});

settingsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM settings WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { name, description } = req.body as {
    name?: string;
    description?: string;
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    "UPDATE settings SET name = COALESCE(?, name), description = COALESCE(?, description), folder_path = ? WHERE id = ?"
  ).run(name ?? null, description ?? null, folderPath, req.params.id);
  res.json(db.prepare("SELECT * FROM settings WHERE id = ?").get(req.params.id));
});

settingsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE settings SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

settingsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE settings SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM settings WHERE id = ?").get(req.params.id));
});

// Reveals the setting's "Resources" folder in the OS file explorer — mirrors
// sessions.ts's /:id/reveal-resources for the same UI (ResourcesSection.tsx).
settingsRouter.post("/:id/reveal-resources", (req, res) => {
  const row = db
    .prepare("SELECT folder_path FROM settings WHERE id = ?")
    .get(req.params.id) as { folder_path: string | null } | undefined;
  if (!row || !row.folder_path) return res.status(404).json({ error: "not found" });
  const folder = ensureSubfolder(row.folder_path, "Resources");
  openInFileExplorer(folder, false);
  res.json({ ok: true });
});

// --- Export/import: geography + population + communities (always), plus
// calendar and setting-scoped resources/artifacts as opt-in via ?include=.
// Metadata only, no uploaded files — same lightweight scope as system export.
settingsRouter.get("/:id/export", (req, res) => {
  const setting = db.prepare("SELECT * FROM settings WHERE id = ?").get(req.params.id);
  if (!setting) return res.status(404).json({ error: "not found" });
  const include = String(req.query.include || "").split(",");

  const locations = db
    .prepare("SELECT * FROM setting_locations WHERE setting_id = ? AND archived_at IS NULL")
    .all(req.params.id);
  const beings = db
    .prepare("SELECT * FROM setting_beings WHERE setting_id = ? AND archived_at IS NULL")
    .all(req.params.id);
  const communities = db
    .prepare("SELECT * FROM setting_communities WHERE setting_id = ? AND archived_at IS NULL")
    .all(req.params.id);

  const payload: Record<string, unknown> = { setting, locations, beings, communities };

  if (include.includes("calendar")) {
    payload.calendarMonths = db
      .prepare("SELECT * FROM setting_calendar_months WHERE setting_id = ? ORDER BY position")
      .all(req.params.id);
    payload.calendarWeekdays = db
      .prepare("SELECT * FROM setting_calendar_weekdays WHERE setting_id = ? ORDER BY position")
      .all(req.params.id);
    payload.calendarEvents = db
      .prepare("SELECT * FROM setting_calendar_events WHERE setting_id = ?")
      .all(req.params.id);
  }
  if (include.includes("resources")) {
    payload.artifacts = db
      .prepare("SELECT * FROM artifacts WHERE setting_id = ? AND archived_at IS NULL")
      .all(req.params.id);
    payload.resources = db
      .prepare("SELECT * FROM resources WHERE setting_id = ? AND archived_at IS NULL")
      .all(req.params.id);
  }

  res.json(payload);
});

export interface SettingExportData {
  setting: { name: string; description: string; calendar_era: string };
  locations: { id: number; parent_id: number | null; name: string; kind: string; description: string }[];
  beings: {
    id: number;
    name: string;
    category: string;
    location_id: number | null;
    statblock_short: string;
    statblock_full: string;
    history: string;
    behavior: string;
  }[];
  communities: {
    id: number;
    parent_id: number | null;
    name: string;
    description: string;
    history: string;
    current_situation: string;
    features: string;
    goals: string;
  }[];
  calendarMonths?: { position: number; name: string; days: number }[];
  calendarWeekdays?: { position: number; name: string }[];
  calendarEvents?: { title: string; description: string; recurrence: string; day: number; month: number | null; year: number | null; important: number }[];
  artifacts?: { name: string; owner: string; power: string; history: string; notes: string }[];
  resources?: { name: string; type: string; tags: string; notes: string; link_url: string | null }[];
}

// Materializes an exported setting (see GET /:id/export) as a brand-new
// setting, remapping location/community parent-chain ids. Shared by the
// direct-import route and by the modules "enable" flow.
export function importSettingExport(body: SettingExportData): number {
  if (!body.setting?.name) throw new Error("invalid export file");

  const folder = settingFolder(body.setting.name);
  const info = db
    .prepare(
      "INSERT INTO settings (name, description, folder_path, calendar_era) VALUES (?, ?, ?, ?)"
    )
    .run(`${body.setting.name} (импорт)`, body.setting.description || "", folder, body.setting.calendar_era || "");
  const newSettingId = info.lastInsertRowid as number;

  const locationIdMap = new Map<number, number>();
  const insertLocation = db.prepare(
    "INSERT INTO setting_locations (setting_id, parent_id, name, kind, description) VALUES (?, NULL, ?, ?, ?)"
  );
  for (const l of body.locations ?? []) {
    const r = insertLocation.run(newSettingId, l.name, l.kind || "", l.description || "");
    locationIdMap.set(l.id, r.lastInsertRowid as number);
  }
  const updateLocationParent = db.prepare("UPDATE setting_locations SET parent_id = ? WHERE id = ?");
  for (const l of body.locations ?? []) {
    if (l.parent_id == null) continue;
    const newId = locationIdMap.get(l.id);
    const newParentId = locationIdMap.get(l.parent_id);
    if (newId && newParentId) updateLocationParent.run(newParentId, newId);
  }

  const insertBeing = db.prepare(
    `INSERT INTO setting_beings (setting_id, name, category, location_id, statblock_short, statblock_full, history, behavior)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const b of body.beings ?? []) {
    insertBeing.run(
      newSettingId,
      b.name,
      b.category || "bestiary",
      b.location_id != null ? locationIdMap.get(b.location_id) ?? null : null,
      b.statblock_short || "",
      b.statblock_full || "",
      b.history || "",
      b.behavior || ""
    );
  }

  const communityIdMap = new Map<number, number>();
  const insertCommunity = db.prepare(
    `INSERT INTO setting_communities (setting_id, parent_id, name, description, history, current_situation, features, goals)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of body.communities ?? []) {
    const r = insertCommunity.run(
      newSettingId,
      c.name,
      c.description || "",
      c.history || "",
      c.current_situation || "",
      c.features || "",
      c.goals || ""
    );
    communityIdMap.set(c.id, r.lastInsertRowid as number);
  }
  const updateCommunityParent = db.prepare("UPDATE setting_communities SET parent_id = ? WHERE id = ?");
  for (const c of body.communities ?? []) {
    if (c.parent_id == null) continue;
    const newId = communityIdMap.get(c.id);
    const newParentId = communityIdMap.get(c.parent_id);
    if (newId && newParentId) updateCommunityParent.run(newParentId, newId);
  }

  if (body.calendarMonths) {
    const insertMonth = db.prepare(
      "INSERT INTO setting_calendar_months (setting_id, position, name, days) VALUES (?, ?, ?, ?)"
    );
    for (const m of body.calendarMonths) insertMonth.run(newSettingId, m.position, m.name, m.days);
  }
  if (body.calendarWeekdays) {
    const insertWeekday = db.prepare(
      "INSERT INTO setting_calendar_weekdays (setting_id, position, name) VALUES (?, ?, ?)"
    );
    for (const w of body.calendarWeekdays) insertWeekday.run(newSettingId, w.position, w.name);
  }

  if (body.artifacts) {
    const insertArtifact = db.prepare(
      "INSERT INTO artifacts (setting_id, name, owner, power, history, notes) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const a of body.artifacts) {
      insertArtifact.run(newSettingId, a.name, a.owner || "", a.power || "", a.history || "", a.notes || "");
    }
  }
  if (body.resources) {
    const insertResource = db.prepare(
      "INSERT INTO resources (name, type, scope, setting_id, tags, notes, link_url) VALUES (?, ?, 'setting', ?, ?, ?, ?)"
    );
    for (const r of body.resources) {
      insertResource.run(r.name, r.type || "note", newSettingId, r.tags || "", r.notes || "", r.link_url ?? null);
    }
  }

  return newSettingId;
}

settingsRouter.post("/import", (req, res) => {
  let newSettingId: number;
  try {
    newSettingId = importSettingExport(req.body as SettingExportData);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }
  res.status(201).json(db.prepare("SELECT * FROM settings WHERE id = ?").get(newSettingId));
});
