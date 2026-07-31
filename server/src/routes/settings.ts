import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import {
  beingFolder,
  communityFolder,
  ensureSubfolder,
  locationFolder,
  openInFileExplorer,
  readFileAsBase64,
  settingFolder,
  settingGeographyRoot,
  toFileUrl,
  writeBase64File,
  writeReplacingOldFile,
} from "../services/filesystem";
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
// By default this is metadata only, no uploaded files — pass "images" in
// `include` to additionally embed every avatar/background/thumbnail/resource
// file as base64 (same idea as systems.ts's ?images=1, just folded into the
// existing include-list param instead of a separate flag).
function buildSettingExportData(settingId: number | string, include: string[]): SettingExportData | null {
  const withImages = include.includes("images");
  const setting = db.prepare("SELECT * FROM settings WHERE id = ?").get(settingId) as
    | (SettingExportData["setting"] & { background_image_path?: string | null; thumbnail_image_path?: string | null })
    | undefined;
  if (!setting) return null;
  if (withImages) {
    setting.background_data = readFileAsBase64(setting.background_image_path);
    setting.thumbnail_data = readFileAsBase64(setting.thumbnail_image_path);
  }
  delete setting.background_image_path;
  delete setting.thumbnail_image_path;

  const locations = db
    .prepare("SELECT * FROM setting_locations WHERE setting_id = ? AND archived_at IS NULL")
    .all(settingId) as (SettingExportData["locations"][number] & {
    avatar_image_path?: string | null;
    thumbnail_image_path?: string | null;
    map_image_path?: string | null;
  })[];
  const beings = db
    .prepare("SELECT * FROM setting_beings WHERE setting_id = ? AND archived_at IS NULL")
    .all(settingId) as (SettingExportData["beings"][number] & {
    avatar_image_path?: string | null;
    thumbnail_image_path?: string | null;
  })[];
  const communities = db
    .prepare("SELECT * FROM setting_communities WHERE setting_id = ? AND archived_at IS NULL")
    .all(settingId) as (SettingExportData["communities"][number] & {
    avatar_image_path?: string | null;
    thumbnail_image_path?: string | null;
  })[];
  for (const rows of [locations, beings, communities]) {
    for (const row of rows) {
      if (withImages) {
        row.avatar_data = readFileAsBase64(row.avatar_image_path);
        row.thumbnail_data = readFileAsBase64(row.thumbnail_image_path);
      }
      delete row.avatar_image_path;
      delete row.thumbnail_image_path;
    }
  }
  // The raw map_image_path is a local absolute path — useless (and
  // possibly confusing) on another machine, same reasoning as avatar/
  // thumbnail paths above. Pins ride along with the map: they're just
  // coordinates + a reference to another entity, meaningless without the
  // map image itself, so gate both on the same "images" toggle.
  const getPins = db.prepare(
    "SELECT target_type, target_id, x, y, color, size, border_color FROM location_pins WHERE location_id = ?"
  );
  for (const loc of locations) {
    if (withImages) {
      loc.map_data = readFileAsBase64(loc.map_image_path);
      loc.pins = getPins.all(loc.id) as SettingExportData["locations"][number]["pins"];
    }
    delete loc.map_image_path;
  }

  const payload: SettingExportData = { setting, locations, beings, communities };

  if (include.includes("calendar")) {
    payload.calendarMonths = db
      .prepare("SELECT * FROM setting_calendar_months WHERE setting_id = ? ORDER BY position")
      .all(settingId) as SettingExportData["calendarMonths"];
    payload.calendarWeekdays = db
      .prepare("SELECT * FROM setting_calendar_weekdays WHERE setting_id = ? ORDER BY position")
      .all(settingId) as SettingExportData["calendarWeekdays"];
    payload.calendarEvents = db
      .prepare("SELECT * FROM setting_calendar_events WHERE setting_id = ?")
      .all(settingId) as SettingExportData["calendarEvents"];
  }
  if (include.includes("resources")) {
    payload.artifacts = db
      .prepare("SELECT * FROM artifacts WHERE setting_id = ? AND archived_at IS NULL")
      .all(settingId) as SettingExportData["artifacts"];
    const resources = db.prepare("SELECT * FROM resources WHERE setting_id = ? AND archived_at IS NULL").all(settingId) as (NonNullable<
      SettingExportData["resources"]
    >[number] & { file_path?: string | null })[];
    for (const r of resources) {
      if (withImages) r.file_data = readFileAsBase64(r.file_path);
      delete r.file_path;
    }
    payload.resources = resources;
  }

  return payload;
}

settingsRouter.get("/:id/export", (req, res) => {
  const include = String(req.query.include || "").split(",");
  const payload = buildSettingExportData(req.params.id, include);
  if (!payload) return res.status(404).json({ error: "not found" });
  res.json(payload);
});

interface FileData {
  filename: string;
  mime: string;
  base64: string;
}

export interface SettingExportData {
  setting: {
    name: string;
    description: string;
    calendar_era: string;
    background_data?: FileData | null;
    thumbnail_data?: FileData | null;
  };
  locations: {
    id: number;
    parent_id: number | null;
    name: string;
    kind: string;
    description: string;
    avatar_data?: FileData | null;
    thumbnail_data?: FileData | null;
    map_data?: FileData | null;
    map_max_zoom?: number | null;
    map_start_zoom?: number | null;
    map_goto_zoom?: number | null;
    map_labels_always?: number;
    pins?: {
      target_type: string;
      target_id: number;
      x: number;
      y: number;
      color: string | null;
      size: number | null;
      border_color: string | null;
    }[];
  }[];
  beings: {
    id: number;
    name: string;
    category: string;
    location_id: number | null;
    statblock_short: string;
    statblock_full: string;
    history: string;
    behavior: string;
    avatar_data?: FileData | null;
    thumbnail_data?: FileData | null;
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
    avatar_data?: FileData | null;
    thumbnail_data?: FileData | null;
  }[];
  calendarMonths?: { position: number; name: string; days: number }[];
  calendarWeekdays?: { position: number; name: string }[];
  calendarEvents?: { title: string; description: string; recurrence: string; day: number; month: number | null; year: number | null; important: number }[];
  artifacts?: { name: string; owner: string; power: string; history: string; notes: string }[];
  resources?: {
    name: string;
    type: string;
    category?: string | null;
    tags: string;
    notes: string;
    link_url: string | null;
    file_data?: FileData | null;
  }[];
}

// Materializes an exported setting (see GET /:id/export) as a brand-new
// setting, remapping location/community parent-chain ids. Shared by the
// direct-import route and by the modules "enable" flow.
// English subfolder names for embedded resource files on import — mirrors
// resources.ts's own CATEGORY_SUBDIR (duplicated rather than imported, same
// as that constant is already duplicated elsewhere in the codebase).
const RESOURCE_CATEGORY_SUBDIR: Record<string, string> = {
  pdf: "pdf",
  image: "images",
  audio: "audio",
  other: "other",
};

async function writeEntityImages(
  folder: string,
  data: { avatar_data?: FileData | null; thumbnail_data?: FileData | null }
): Promise<{ avatarPath: string | null; thumbnailPath: string | null }> {
  const avatarPath = data.avatar_data
    ? await writeBase64File(folder, `avatar-${data.avatar_data.filename}`, data.avatar_data.base64)
    : null;
  const thumbnailPath = data.thumbnail_data
    ? await writeBase64File(folder, `thumbnail-${data.thumbnail_data.filename}`, data.thumbnail_data.base64)
    : null;
  return { avatarPath, thumbnailPath };
}

export async function importSettingExport(body: SettingExportData): Promise<number> {
  if (!body.setting?.name) throw new Error("invalid export file");

  // settings.name has no UNIQUE constraint, so unlike importSystemExport
  // there's no collision to resolve — keep the name exactly as exported.
  // The "imported" origin is surfaced via imported_at (badge in
  // SettingsListPage) instead of baking "(импорт)" into the name.
  const folder = settingFolder(body.setting.name);
  const info = db
    .prepare(
      "INSERT INTO settings (name, description, folder_path, calendar_era, imported_at) VALUES (?, ?, ?, ?, datetime('now'))"
    )
    .run(body.setting.name, body.setting.description || "", folder, body.setting.calendar_era || "");
  const newSettingId = info.lastInsertRowid as number;

  if (body.setting.background_data || body.setting.thumbnail_data) {
    const { avatarPath: background, thumbnailPath } = await writeEntityImages(folder, {
      avatar_data: body.setting.background_data,
      thumbnail_data: body.setting.thumbnail_data,
    });
    db.prepare("UPDATE settings SET background_image_path = ?, thumbnail_image_path = ? WHERE id = ?").run(
      background,
      thumbnailPath,
      newSettingId
    );
  }

  // Locations form a tree, so their folders (and thus where an embedded
  // avatar/thumbnail lands) depend on the parent's *new* folder — insert
  // flat first (as before) to get id remapping, then walk root-to-leaf
  // assigning folder_path the same way settingLocations.ts's POST / does
  // for a hand-created location (settingGeographyRoot for roots,
  // parent.folder_path otherwise).
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

  const geoRoot = settingGeographyRoot(folder);
  const locationFolderByOldId = new Map<number, string>();
  let frontier = (body.locations ?? []).filter((l) => l.parent_id == null);
  while (frontier.length) {
    const next: SettingExportData["locations"] = [];
    for (const l of frontier) {
      const newId = locationIdMap.get(l.id);
      if (!newId) continue;
      const baseFolder = l.parent_id != null ? locationFolderByOldId.get(l.parent_id) ?? geoRoot : geoRoot;
      const locFolder = locationFolder(baseFolder, l.name);
      locationFolderByOldId.set(l.id, locFolder);
      const { avatarPath, thumbnailPath } = await writeEntityImages(locFolder, l);
      const mapPath = l.map_data
        ? await writeBase64File(locFolder, `map-${l.map_data.filename}`, l.map_data.base64)
        : null;
      db.prepare(
        `UPDATE setting_locations
         SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ?,
             map_image_path = ?, map_max_zoom = ?, map_start_zoom = ?, map_goto_zoom = ?, map_labels_always = ?
         WHERE id = ?`
      ).run(
        locFolder,
        avatarPath,
        thumbnailPath,
        mapPath,
        l.map_max_zoom ?? null,
        l.map_start_zoom ?? null,
        l.map_goto_zoom ?? null,
        l.map_labels_always ?? 0,
        newId
      );
    }
    for (const l of body.locations ?? []) {
      if (l.parent_id != null && locationFolderByOldId.has(l.parent_id) && !locationFolderByOldId.has(l.id)) {
        next.push(l);
      }
    }
    frontier = next;
  }

  const beingIdMap = new Map<number, number>();
  const insertBeing = db.prepare(
    `INSERT INTO setting_beings (setting_id, name, category, location_id, statblock_short, statblock_full, history, behavior)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const b of body.beings ?? []) {
    const r = insertBeing.run(
      newSettingId,
      b.name,
      b.category || "bestiary",
      b.location_id != null ? locationIdMap.get(b.location_id) ?? null : null,
      b.statblock_short || "",
      b.statblock_full || "",
      b.history || "",
      b.behavior || ""
    );
    const newBeingId = r.lastInsertRowid as number;
    beingIdMap.set(b.id, newBeingId);
    if (b.avatar_data || b.thumbnail_data) {
      const beingFolderPath = beingFolder(folder, b.name);
      const { avatarPath, thumbnailPath } = await writeEntityImages(beingFolderPath, b);
      db.prepare(
        "UPDATE setting_beings SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ? WHERE id = ?"
      ).run(beingFolderPath, avatarPath, thumbnailPath, newBeingId);
    }
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
    if (c.avatar_data || c.thumbnail_data) {
      const communityFolderPath = communityFolder(folder, c.name);
      const { avatarPath, thumbnailPath } = await writeEntityImages(communityFolderPath, c);
      db.prepare(
        "UPDATE setting_communities SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ? WHERE id = ?"
      ).run(communityFolderPath, avatarPath, thumbnailPath, r.lastInsertRowid);
    }
  }
  const updateCommunityParent = db.prepare("UPDATE setting_communities SET parent_id = ? WHERE id = ?");
  for (const c of body.communities ?? []) {
    if (c.parent_id == null) continue;
    const newId = communityIdMap.get(c.id);
    const newParentId = communityIdMap.get(c.parent_id);
    if (newId && newParentId) updateCommunityParent.run(newParentId, newId);
  }

  // Pins can target arbitrary entity types (per location_pins' comment in
  // schema.sql), but only location/being/community are actually part of
  // this setting export and have an id-remap available — a pin pointing at
  // a character/session/resource from the source instance can't be
  // resolved here (that entity may not exist, or exist under a different
  // id), so it's silently dropped rather than imported broken.
  const insertPin = db.prepare(
    "INSERT INTO location_pins (location_id, target_type, target_id, x, y, color, size, border_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const l of body.locations ?? []) {
    const newLocationId = locationIdMap.get(l.id);
    if (!newLocationId || !l.pins) continue;
    for (const pin of l.pins) {
      const remappedTargetId =
        pin.target_type === "location"
          ? locationIdMap.get(pin.target_id)
          : pin.target_type === "being"
            ? beingIdMap.get(pin.target_id)
            : pin.target_type === "community"
              ? communityIdMap.get(pin.target_id)
              : undefined;
      if (!remappedTargetId) continue;
      insertPin.run(
        newLocationId,
        pin.target_type,
        remappedTargetId,
        pin.x,
        pin.y,
        pin.color,
        pin.size,
        pin.border_color
      );
    }
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
      "INSERT INTO resources (name, type, scope, setting_id, tags, notes, link_url, category, file_path) VALUES (?, ?, 'setting', ?, ?, ?, ?, ?, ?)"
    );
    const resourcesRoot = ensureSubfolder(folder, "Resources");
    for (const r of body.resources) {
      let filePath: string | null = null;
      if (r.file_data) {
        const subdir = r.category ? RESOURCE_CATEGORY_SUBDIR[r.category] : undefined;
        const targetFolder = subdir ? ensureSubfolder(resourcesRoot, subdir) : resourcesRoot;
        filePath = await writeBase64File(targetFolder, r.file_data.filename, r.file_data.base64);
      }
      insertResource.run(
        r.name,
        r.type || "note",
        newSettingId,
        r.tags || "",
        r.notes || "",
        r.link_url ?? null,
        r.category ?? null,
        filePath
      );
    }
  }

  return newSettingId;
}

// Merges a newer export into an already-materialized setting IN PLACE — same
// philosophy as updateSystemFromExport in systems.ts: match by name (plus
// parent-name-path for the two hierarchical tables), keep ids for anything
// that still exists in the new file so links survive, insert anything new,
// and never touch/delete rows that only exist in the *old* copy (hand-added
// locations/beings/communities are left alone). Call sites are expected to
// snapshot a backup first (see POST /:id/update).
function buildNamePathKey(
  row: { id: number; parent_id: number | null; name: string },
  byId: Map<number, { parent_id: number | null; name: string }>
): string {
  const parts: string[] = [];
  const seen = new Set<number>();
  let cur: { parent_id: number | null; name: string } | undefined = row;
  let curId: number | null = row.id;
  while (cur) {
    parts.unshift(cur.name);
    if (cur.parent_id == null || seen.has(cur.parent_id)) break;
    seen.add(cur.parent_id);
    curId = cur.parent_id;
    cur = byId.get(curId);
  }
  return parts.join("/");
}

export interface SettingUpdateSummary {
  locationsAdded: number;
  locationsUpdated: number;
  locationsKeptLocal: number;
  beingsAdded: number;
  beingsUpdated: number;
  beingsKeptLocal: number;
  communitiesAdded: number;
  communitiesUpdated: number;
  communitiesKeptLocal: number;
}

export async function updateSettingFromExport(
  targetSettingId: number,
  body: SettingExportData
): Promise<SettingUpdateSummary> {
  const targetSetting = db.prepare("SELECT folder_path FROM settings WHERE id = ?").get(targetSettingId) as {
    folder_path: string;
  };
  const geoRoot = settingGeographyRoot(targetSetting.folder_path);

  const summary: SettingUpdateSummary = {
    locationsAdded: 0,
    locationsUpdated: 0,
    locationsKeptLocal: 0,
    beingsAdded: 0,
    beingsUpdated: 0,
    beingsKeptLocal: 0,
    communitiesAdded: 0,
    communitiesUpdated: 0,
    communitiesKeptLocal: 0,
  };

  // --- Locations: match by name-path through parent_id ---
  const existingLocations = db
    .prepare("SELECT id, parent_id, name, kind, description FROM setting_locations WHERE setting_id = ? AND archived_at IS NULL")
    .all(targetSettingId) as { id: number; parent_id: number | null; name: string; kind: string; description: string }[];
  const existingLocationById = new Map(existingLocations.map((l) => [l.id, l]));
  const existingLocationByKey = new Map(existingLocations.map((l) => [buildNamePathKey(l, existingLocationById), l.id]));
  const locationIdMap = new Map<number, number>();
  const insertLocation = db.prepare(
    "INSERT INTO setting_locations (setting_id, parent_id, name, kind, description) VALUES (?, ?, ?, ?, ?)"
  );
  const updateLocation = db.prepare("UPDATE setting_locations SET kind = ?, description = ? WHERE id = ?");
  const touchedLocationIds = new Set<number>();
  for (const l of body.locations ?? []) {
    const key = buildNamePathKey(l, new Map((body.locations ?? []).map((x) => [x.id, x])));
    const existingId = existingLocationByKey.get(key);
    if (existingId) {
      updateLocation.run(l.kind || "", l.description || "", existingId);
      locationIdMap.set(l.id, existingId);
      touchedLocationIds.add(existingId);
      summary.locationsUpdated++;
    } else {
      const newParentId = l.parent_id == null ? null : locationIdMap.get(l.parent_id) ?? null;
      const info = insertLocation.run(targetSettingId, newParentId, l.name, l.kind || "", l.description || "");
      const insertedId = info.lastInsertRowid as number;
      locationIdMap.set(l.id, insertedId);
      touchedLocationIds.add(insertedId);
      summary.locationsAdded++;
      if (l.avatar_data || l.thumbnail_data || l.map_data) {
        const parentFolder =
          newParentId != null
            ? (
                db.prepare("SELECT folder_path FROM setting_locations WHERE id = ?").get(newParentId) as
                  | { folder_path: string | null }
                  | undefined
              )?.folder_path ?? geoRoot
            : geoRoot;
        const locFolder = locationFolder(parentFolder, l.name);
        const { avatarPath, thumbnailPath } = await writeEntityImages(locFolder, l);
        const mapPath = l.map_data
          ? await writeBase64File(locFolder, `map-${l.map_data.filename}`, l.map_data.base64)
          : null;
        db.prepare(
          `UPDATE setting_locations
           SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ?,
               map_image_path = ?, map_max_zoom = ?, map_start_zoom = ?, map_goto_zoom = ?, map_labels_always = ?
           WHERE id = ?`
        ).run(
          locFolder,
          avatarPath,
          thumbnailPath,
          mapPath,
          l.map_max_zoom ?? null,
          l.map_start_zoom ?? null,
          l.map_goto_zoom ?? null,
          l.map_labels_always ?? 0,
          insertedId
        );
      }
      // Pins aren't remapped on the merge/update path — matching pins would
      // need beingIdMap/communityIdMap built ahead of when they're actually
      // populated further down this function (locations are processed first
      // here), and merge-updates already lean conservative (never touching
      // what a GM might have hand-edited locally). A full re-export/import
      // (see importSettingExport) is the reliable way to bring pins over.
    }
  }
  summary.locationsKeptLocal = existingLocations.filter((l) => !touchedLocationIds.has(l.id)).length;

  // --- Communities: same name-path matching as locations ---
  const existingCommunities = db
    .prepare(
      "SELECT id, parent_id, name, description, history, current_situation, features, goals FROM setting_communities WHERE setting_id = ? AND archived_at IS NULL"
    )
    .all(targetSettingId) as {
    id: number;
    parent_id: number | null;
    name: string;
    description: string;
    history: string;
    current_situation: string;
    features: string;
    goals: string;
  }[];
  const existingCommunityById = new Map(existingCommunities.map((c) => [c.id, c]));
  const existingCommunityByKey = new Map(
    existingCommunities.map((c) => [buildNamePathKey(c, existingCommunityById), c.id])
  );
  const communityIdMap = new Map<number, number>();
  const insertCommunity = db.prepare(
    `INSERT INTO setting_communities (setting_id, parent_id, name, description, history, current_situation, features, goals)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateCommunity = db.prepare(
    "UPDATE setting_communities SET description = ?, history = ?, current_situation = ?, features = ?, goals = ? WHERE id = ?"
  );
  const touchedCommunityIds = new Set<number>();
  for (const c of body.communities ?? []) {
    const key = buildNamePathKey(c, new Map((body.communities ?? []).map((x) => [x.id, x])));
    const existingId = existingCommunityByKey.get(key);
    if (existingId) {
      updateCommunity.run(
        c.description || "",
        c.history || "",
        c.current_situation || "",
        c.features || "",
        c.goals || "",
        existingId
      );
      communityIdMap.set(c.id, existingId);
      touchedCommunityIds.add(existingId);
      summary.communitiesUpdated++;
    } else {
      const newParentId = c.parent_id == null ? null : communityIdMap.get(c.parent_id) ?? null;
      const info = insertCommunity.run(
        targetSettingId,
        newParentId,
        c.name,
        c.description || "",
        c.history || "",
        c.current_situation || "",
        c.features || "",
        c.goals || ""
      );
      const insertedId = info.lastInsertRowid as number;
      communityIdMap.set(c.id, insertedId);
      touchedCommunityIds.add(insertedId);
      summary.communitiesAdded++;
      if (c.avatar_data || c.thumbnail_data) {
        const communityFolderPath = communityFolder(targetSetting.folder_path, c.name);
        const { avatarPath, thumbnailPath } = await writeEntityImages(communityFolderPath, c);
        db.prepare(
          "UPDATE setting_communities SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ? WHERE id = ?"
        ).run(communityFolderPath, avatarPath, thumbnailPath, insertedId);
      }
    }
  }
  summary.communitiesKeptLocal = existingCommunities.filter((c) => !touchedCommunityIds.has(c.id)).length;

  // --- Beings: matched by name (no hierarchy of their own) ---
  const existingBeings = db
    .prepare(
      "SELECT id, name, category, location_id, statblock_short, statblock_full, history, behavior FROM setting_beings WHERE setting_id = ? AND archived_at IS NULL"
    )
    .all(targetSettingId) as {
    id: number;
    name: string;
    category: string;
    location_id: number | null;
    statblock_short: string;
    statblock_full: string;
    history: string;
    behavior: string;
  }[];
  const existingBeingByName = new Map(existingBeings.map((b) => [b.name, b.id]));
  const insertBeing = db.prepare(
    `INSERT INTO setting_beings (setting_id, name, category, location_id, statblock_short, statblock_full, history, behavior)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateBeing = db.prepare(
    "UPDATE setting_beings SET category = ?, location_id = ?, statblock_short = ?, statblock_full = ?, history = ?, behavior = ? WHERE id = ?"
  );
  const touchedBeingIds = new Set<number>();
  for (const b of body.beings ?? []) {
    const newLocationId = b.location_id != null ? locationIdMap.get(b.location_id) ?? null : null;
    const existingId = existingBeingByName.get(b.name);
    if (existingId) {
      updateBeing.run(
        b.category || "bestiary",
        newLocationId,
        b.statblock_short || "",
        b.statblock_full || "",
        b.history || "",
        b.behavior || "",
        existingId
      );
      touchedBeingIds.add(existingId);
      summary.beingsUpdated++;
    } else {
      const info = insertBeing.run(
        targetSettingId,
        b.name,
        b.category || "bestiary",
        newLocationId,
        b.statblock_short || "",
        b.statblock_full || "",
        b.history || "",
        b.behavior || ""
      );
      const insertedId = info.lastInsertRowid as number;
      touchedBeingIds.add(insertedId);
      summary.beingsAdded++;
      if (b.avatar_data || b.thumbnail_data) {
        const beingFolderPath = beingFolder(targetSetting.folder_path, b.name);
        const { avatarPath, thumbnailPath } = await writeEntityImages(beingFolderPath, b);
        db.prepare(
          "UPDATE setting_beings SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ? WHERE id = ?"
        ).run(beingFolderPath, avatarPath, thumbnailPath, insertedId);
      }
    }
  }
  summary.beingsKeptLocal = existingBeings.filter((b) => !touchedBeingIds.has(b.id)).length;

  // --- Calendar / artifacts / setting-scoped resources: match by name,
  // update or insert, never delete a local-only row. Small, low-conflict
  // config-like tables, so no summary counters for these — kept simple.
  if (body.calendarMonths) {
    const existing = db
      .prepare("SELECT id, name FROM setting_calendar_months WHERE setting_id = ?")
      .all(targetSettingId) as { id: number; name: string }[];
    const byName = new Map(existing.map((m) => [m.name, m.id]));
    const insert = db.prepare(
      "INSERT INTO setting_calendar_months (setting_id, position, name, days) VALUES (?, ?, ?, ?)"
    );
    const update = db.prepare("UPDATE setting_calendar_months SET position = ?, days = ? WHERE id = ?");
    for (const m of body.calendarMonths) {
      const existingId = byName.get(m.name);
      if (existingId) update.run(m.position, m.days, existingId);
      else insert.run(targetSettingId, m.position, m.name, m.days);
    }
  }
  if (body.calendarWeekdays) {
    const existing = db
      .prepare("SELECT id, name FROM setting_calendar_weekdays WHERE setting_id = ?")
      .all(targetSettingId) as { id: number; name: string }[];
    const byName = new Map(existing.map((w) => [w.name, w.id]));
    const insert = db.prepare("INSERT INTO setting_calendar_weekdays (setting_id, position, name) VALUES (?, ?, ?)");
    const update = db.prepare("UPDATE setting_calendar_weekdays SET position = ? WHERE id = ?");
    for (const w of body.calendarWeekdays) {
      const existingId = byName.get(w.name);
      if (existingId) update.run(w.position, existingId);
      else insert.run(targetSettingId, w.position, w.name);
    }
  }
  if (body.artifacts) {
    const existing = db.prepare("SELECT id, name FROM artifacts WHERE setting_id = ? AND archived_at IS NULL").all(
      targetSettingId
    ) as { id: number; name: string }[];
    const byName = new Map(existing.map((a) => [a.name, a.id]));
    const insert = db.prepare(
      "INSERT INTO artifacts (setting_id, name, owner, power, history, notes) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const update = db.prepare("UPDATE artifacts SET owner = ?, power = ?, history = ?, notes = ? WHERE id = ?");
    for (const a of body.artifacts) {
      const existingId = byName.get(a.name);
      if (existingId) update.run(a.owner || "", a.power || "", a.history || "", a.notes || "", existingId);
      else insert.run(targetSettingId, a.name, a.owner || "", a.power || "", a.history || "", a.notes || "");
    }
  }
  if (body.resources) {
    const existing = db
      .prepare("SELECT id, name FROM resources WHERE setting_id = ? AND archived_at IS NULL")
      .all(targetSettingId) as { id: number; name: string }[];
    const byName = new Map(existing.map((r) => [r.name, r.id]));
    const insert = db.prepare(
      "INSERT INTO resources (name, type, scope, setting_id, tags, notes, link_url, category, file_path) VALUES (?, ?, 'setting', ?, ?, ?, ?, ?, ?)"
    );
    const update = db.prepare("UPDATE resources SET tags = ?, notes = ?, link_url = ? WHERE id = ?");
    const resourcesRoot = ensureSubfolder(targetSetting.folder_path, "Resources");
    for (const r of body.resources) {
      const existingId = byName.get(r.name);
      if (existingId) {
        update.run(r.tags || "", r.notes || "", r.link_url ?? null, existingId);
      } else {
        let filePath: string | null = null;
        if (r.file_data) {
          const subdir = r.category ? RESOURCE_CATEGORY_SUBDIR[r.category] : undefined;
          const targetFolder = subdir ? ensureSubfolder(resourcesRoot, subdir) : resourcesRoot;
          filePath = await writeBase64File(targetFolder, r.file_data.filename, r.file_data.base64);
        }
        insert.run(
          r.name,
          r.type || "note",
          targetSettingId,
          r.tags || "",
          r.notes || "",
          r.link_url ?? null,
          r.category ?? null,
          filePath
        );
      }
    }
  }

  return summary;
}

// Snapshots the current state of a setting as an archived backup setting,
// shared by the file-upload update route and the GitHub-catalog update route
// (modules.ts) — both merge a newer export into an existing setting and both
// need the same "one Archive-page restore away" safety net first.
export async function createSettingBackup(targetId: number, targetName: string) {
  const backupData = buildSettingExportData(targetId, ["calendar", "resources"]);
  if (!backupData) throw new Error("not found");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  backupData.setting = { ...backupData.setting, name: `${targetName} (резерв перед обновлением, ${stamp})` };
  const backupSettingId = await importSettingExport(backupData);
  db.prepare("UPDATE settings SET archived_at = datetime('now') WHERE id = ?").run(backupSettingId);
  return { id: backupSettingId, name: db.prepare("SELECT name FROM settings WHERE id = ?").get(backupSettingId) };
}

// Updates an already-materialized setting in place from a newer export file.
// Always snapshots the current state as an archived backup setting first
// (restorable from the Archive page) before merging — see
// updateSettingFromExport for the merge rules.
settingsRouter.post("/:id/update", async (req, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare("SELECT id, name FROM settings WHERE id = ?").get(targetId) as
    | { id: number; name: string }
    | undefined;
  if (!target) return res.status(404).json({ error: "not found" });

  let backup: { id: number; name: unknown };
  try {
    backup = await createSettingBackup(targetId, target.name);
  } catch (e) {
    return res.status(500).json({ error: "не удалось создать резервную копию: " + String(e) });
  }

  let summary: SettingUpdateSummary;
  try {
    summary = await updateSettingFromExport(targetId, req.body as SettingExportData);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }

  res.json({
    setting: db.prepare("SELECT * FROM settings WHERE id = ?").get(targetId),
    backup,
    summary,
  });
});

settingsRouter.post("/import", async (req, res) => {
  let newSettingId: number;
  try {
    newSettingId = await importSettingExport(req.body as SettingExportData);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }
  res.status(201).json(db.prepare("SELECT * FROM settings WHERE id = ?").get(newSettingId));
});
