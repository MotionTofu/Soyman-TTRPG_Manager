import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/db";
import {
  locationFolder,
  settingGeographyRoot,
  toFileUrl,
  vaultAbs,
  writeReplacingOldFile,
} from "../services/filesystem";
import { renameEntityFolder, moveEntityFolder } from "../services/vaultPaths";
import { removeOrArchive, storeDeduped } from "../services/vaultDedup";
import {
  withAvatarUrl,
  getCreatureMetaByOwner,
  getStatblockCountsByOwner,
  getLocations,
} from "./settingBeings";

export const settingLocationsRouter = Router();
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|avif)$/.test(file.mimetype)) cb(null, true);
    else cb(null, false);
  },
});

function isSafeStoredPath(p: string | null | undefined): boolean {
  if (!p) return false;
  if (/["'\n\r]/.test(p)) return false;
  if (p.includes("..")) return false;
  return true;
}

function withMapUrl<T extends { map_image_path?: string | null }>(row: T) {
  return {
    ...row,
    map_image_url: row.map_image_path && isSafeStoredPath(row.map_image_path) ? toFileUrl(row.map_image_path) : null,
  };
}

function withImageUrls<
  T extends { avatar_image_path?: string | null; thumbnail_image_path?: string | null }
>(row: T) {
  return {
    ...row,
    avatar_image_url: row.avatar_image_path && isSafeStoredPath(row.avatar_image_path) ? toFileUrl(row.avatar_image_path) : null,
    thumbnail_image_url:
      row.thumbnail_image_path && isSafeStoredPath(row.thumbnail_image_path) ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

const MAX_NAME = 120;
const MAX_KIND = 40;
const MAX_SHORT = 20;
const MAX_ALIAS = 40;
const MAX_ALIASES = 10;
const MAX_ORIGINAL = 120;
const MAX_DESC = 4000;

function validateLocationPayload(body: {
  name?: string;
  kind?: string;
  description?: string;
  short_name?: string;
  aliases?: string[];
  name_original?: string;
}): string | null {
  if (body.name !== undefined) {
    const n = body.name.trim();
    if (!n) return "name must not be empty";
    if (n.length > MAX_NAME) return `name must be ≤${MAX_NAME} chars`;
  }
  if (body.kind !== undefined && body.kind !== null) {
    if (String(body.kind).length > MAX_KIND) return `kind must be ≤${MAX_KIND} chars`;
  }
  if (body.short_name !== undefined && body.short_name !== null) {
    if (String(body.short_name).length > MAX_SHORT) return `short_name must be ≤${MAX_SHORT} chars`;
  }
  if (body.name_original !== undefined && body.name_original !== null) {
    if (String(body.name_original).length > MAX_ORIGINAL) return `name_original must be ≤${MAX_ORIGINAL} chars`;
  }
  if (body.description !== undefined && body.description !== null) {
    if (String(body.description).length > MAX_DESC) return `description must be ≤${MAX_DESC} chars`;
  }
  if (body.aliases !== undefined && body.aliases !== null) {
    if (!Array.isArray(body.aliases)) return "aliases must be an array";
    if (body.aliases.length > MAX_ALIASES) return `aliases must be ≤${MAX_ALIASES} items`;
    for (const a of body.aliases) {
      if (typeof a !== "string") return "aliases must be strings";
      if (a.length > MAX_ALIAS) return `alias must be ≤${MAX_ALIAS} chars`;
    }
  }
  return null;
}

function archiveSubtree(rootId: number) {
  // One atomic recursive update — no JS recursion, no partial state on failure (C-P1-2).
  db.prepare(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM setting_locations WHERE id = ?
       UNION ALL
       SELECT sl.id FROM setting_locations sl JOIN descendants d ON sl.parent_id = d.id
     )
     UPDATE setting_locations SET archived_at = datetime('now')
     WHERE id IN (SELECT id FROM descendants) AND archived_at IS NULL`
  ).run(rootId);
}

settingLocationsRouter.get("/", (req, res) => {
  const { setting_id, parent_id } = req.query as {
    setting_id?: string;
    parent_id?: string;
  };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const includeArchived = req.query.archived === "include";
  const archivedClause = includeArchived ? "" : " AND archived_at IS NULL";
  if (parent_id !== undefined) {
    const rows = db
      .prepare(
        parent_id === "null" || parent_id === ""
          ? `SELECT * FROM setting_locations WHERE setting_id = ? AND parent_id IS NULL${archivedClause} ORDER BY name`
          : `SELECT * FROM setting_locations WHERE setting_id = ? AND parent_id = ?${archivedClause} ORDER BY name`
      )
      .all(
        ...(parent_id === "null" || parent_id === ""
          ? [setting_id]
          : [setting_id, parent_id])
      ) as { avatar_image_path: string | null; thumbnail_image_path: string | null; map_image_path: string | null }[];
    return res.json(rows.map((r) => withMapUrl(withImageUrls(r))));
  }
  const rows = db
    .prepare(
      `SELECT * FROM setting_locations WHERE setting_id = ?${archivedClause} ORDER BY name`
    )
    .all(setting_id) as { avatar_image_path: string | null; thumbnail_image_path: string | null; map_image_path: string | null }[];
  res.json(rows.map((r) => withMapUrl(withImageUrls(r))));
});

settingLocationsRouter.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM setting_locations WHERE id = ?")
    .get(req.params.id) as
    | {
        parent_id: number | null;
        map_image_path: string | null;
        avatar_image_path: string | null;
        thumbnail_image_path: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  const children = db
    .prepare(
      "SELECT * FROM setting_locations WHERE parent_id = ? AND archived_at IS NULL ORDER BY name"
    )
    .all(req.params.id);

  const ancestors: { id: number; name: string }[] = [];
  let currentParentId = row.parent_id;
  while (currentParentId) {
    const parent = db
      .prepare("SELECT id, name, parent_id FROM setting_locations WHERE id = ?")
      .get(currentParentId) as { id: number; name: string; parent_id: number | null } | undefined;
    if (!parent) break;
    ancestors.unshift({ id: parent.id, name: parent.name });
    currentParentId = parent.parent_id;
  }

  const pins = db
    .prepare("SELECT * FROM location_pins WHERE location_id = ? ORDER BY created_at")
    .all(req.params.id);

  const chapters = db
    .prepare("SELECT * FROM location_chapters WHERE location_id = ? ORDER BY created_at")
    .all(req.params.id);

  // Attaches each being's faction membership (for the Обитатели tab's
  // group-by-faction view) and dnd_creature meta (type/size/alignment line).
  function withBeingExtras<
    T extends { id: number; avatar_image_path: string | null; thumbnail_image_path: string | null; tags: string }
  >(rows: T[]) {
    const ids = rows.map((r) => r.id);
    const creatureMeta = getCreatureMetaByOwner("being", ids);
    const statblockCounts = getStatblockCountsByOwner("being", ids);
    const communitiesByBeing = new Map<number, { id: number; name: string }[]>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const rows2 = db
        .prepare(
          `SELECT bc.being_id, sc.id, sc.name FROM being_communities bc
           JOIN setting_communities sc ON sc.id = bc.community_id
           WHERE bc.being_id IN (${placeholders}) AND sc.archived_at IS NULL ORDER BY sc.name`
        )
        .all(...ids) as { being_id: number; id: number; name: string }[];
      for (const r of rows2) {
        const list = communitiesByBeing.get(r.being_id) ?? [];
        list.push({ id: r.id, name: r.name });
        communitiesByBeing.set(r.being_id, list);
      }
    }
    return rows.map(withAvatarUrl).map((b) => ({
      ...b,
      communities: communitiesByBeing.get(b.id) ?? [],
      creature_meta: creatureMeta.get(b.id) ?? null,
      statblock_count: statblockCounts.get(b.id) ?? 0,
      locations: getLocations(b.id),
    }));
  }

  const inhabitantBeings = withBeingExtras(
    db
      .prepare(
        `SELECT b.* FROM being_locations bl
         JOIN setting_beings b ON b.id = bl.being_id
         WHERE bl.location_id = ? AND b.archived_at IS NULL ORDER BY b.name`
      )
      .all(req.params.id) as { id: number; avatar_image_path: string | null; thumbnail_image_path: string | null; tags: string }[]
  );

  // Beings from nested (descendant) locations, opt-in via ?nested=1 — each
  // tagged with the names of the specific descendant locations they
  // actually inhabit, shown as "(location)" suffixes in the UI. Excludes
  // beings already listed directly above.
  let nestedInhabitantBeings: ReturnType<typeof withBeingExtras> = [];
  if (req.query.nested === "1") {
    const directIds = new Set(inhabitantBeings.map((b) => b.id));
    const descendantRows = db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM setting_locations WHERE parent_id = ?
           UNION ALL
           SELECT sl.id FROM setting_locations sl JOIN descendants d ON sl.parent_id = d.id
         )
         SELECT b.*, l.name as loc_name FROM being_locations bl
         JOIN setting_beings b ON b.id = bl.being_id
         JOIN setting_locations l ON l.id = bl.location_id
         WHERE bl.location_id IN (SELECT id FROM descendants) AND b.archived_at IS NULL
         ORDER BY b.name`
      )
      .all(req.params.id) as ({
      id: number;
      avatar_image_path: string | null;
      thumbnail_image_path: string | null;
      tags: string;
      loc_name: string;
    })[];
    const locationNamesByBeing = new Map<number, string[]>();
    const dedupMap = new Map<number, (typeof descendantRows)[number]>();
    for (const r of descendantRows) {
      if (directIds.has(r.id)) continue;
      const list = locationNamesByBeing.get(r.id) ?? [];
      if (!list.includes(r.loc_name)) list.push(r.loc_name);
      locationNamesByBeing.set(r.id, list);
      if (!dedupMap.has(r.id)) dedupMap.set(r.id, r);
    }
    const dedupedRows = Array.from(dedupMap.values());
    nestedInhabitantBeings = withBeingExtras(dedupedRows).map((b) => ({
      ...b,
      location_names: locationNamesByBeing.get(b.id) ?? [],
    }));
  }

  const inhabitantCommunities = db
    .prepare(
      `SELECT c.id, c.name FROM community_locations cl
       JOIN setting_communities c ON c.id = cl.community_id
       WHERE cl.location_id = ? AND c.archived_at IS NULL ORDER BY c.name`
    )
    .all(req.params.id);

  const importantDates = db
    .prepare("SELECT * FROM important_dates WHERE owner_type = 'location' AND owner_id = ?")
    .all(req.params.id);

  res.json({
    ...withImageUrls(withMapUrl(row)),
    children,
    ancestors,
    pins,
    chapters,
    inhabitant_beings: inhabitantBeings,
    nested_inhabitant_beings: nestedInhabitantBeings,
    inhabitant_communities: inhabitantCommunities,
    important_dates: importantDates,
  });
});

const ALLOWED_RECURRENCE = new Set(["once", "annual", "monthly", "weekly", "custom"]);

settingLocationsRouter.post("/:id/important-dates", (req, res) => {
  const { title, recurrence, year, month, day, description, date_type, color, custom_rule, createChronicleEvent } = req.body as {
    title: string;
    recurrence: string;
    year?: number | null;
    month?: number | null;
    day: number;
    description?: string;
    date_type?: string;
    color?: string;
    custom_rule?: string;
    createChronicleEvent?: boolean;
  };
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) return res.status(400).json({ error: "title is required" });
  if (trimmed.length > 200) return res.status(400).json({ error: "title too long (max 200)" });
  if (day == null) return res.status(400).json({ error: "day is required" });
  const d = Number(day);
  const m = month != null && (month as unknown) !== "" ? Number(month) : null;
  const y = year != null && (year as unknown) !== "" ? Number(year) : null;
  const rec = recurrence || "once";
  if (!ALLOWED_RECURRENCE.has(rec)) return res.status(400).json({ error: "invalid recurrence" });
  if (!Number.isFinite(d) || d < 1 || d > 60) return res.status(400).json({ error: "day must be 1..60" });
  if (m != null && (!Number.isFinite(m) || m < 1 || m > 36)) return res.status(400).json({ error: "month must be 1..36" });
  if (y != null && (!Number.isFinite(y) || y < 1 || y > 9999)) return res.status(400).json({ error: "year must be 1..9999" });
  if (rec === "annual" && m == null) return res.status(400).json({ error: "month is required for annual recurrence" });
  if (rec === "once" && m == null) return res.status(400).json({ error: "month is required for once recurrence" });
  if (rec === "once" && y == null) return res.status(400).json({ error: "year is required for once recurrence" });
  if (rec === "weekly" && (m != null || y != null)) {
    // weekly ignores month/year — warn but allow; store as null
  }
  if (description && description.length > 2000) return res.status(400).json({ error: "description too long (max 2000)" });
  if (date_type && date_type.length > 40) return res.status(400).json({ error: "date_type too long (max 40)" });
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: "color must be #RRGGBB" });
  // кросс-валидация дня с календарём сеттинга (фаза 0 — локация = частный срез сеттинга)
  const loc = db.prepare("SELECT setting_id FROM setting_locations WHERE id = ?").get(req.params.id) as { setting_id: number } | undefined;
  if (!loc) return res.status(404).json({ error: "location not found" });
  const calMonths = db.prepare("SELECT position, days FROM setting_calendar_months WHERE setting_id = ? ORDER BY position").all(loc.setting_id) as { position: number; days: number }[];
  if (calMonths.length > 0 && m != null) {
    const monthDef = calMonths.find((mo) => mo.position === m);
    if (monthDef && d > monthDef.days) return res.status(400).json({ error: `day ${d} exceeds ${monthDef.days} days in month ${monthDef.position}` });
  }
  if (custom_rule && custom_rule.length > 2000) return res.status(400).json({ error: "custom_rule too long" });
  if (custom_rule) {
    try { JSON.parse(custom_rule); } catch { return res.status(400).json({ error: "custom_rule must be valid JSON" }); }
  }

  // Двусторонняя связка: once + createChronicleEvent → создаём событие Хроники, sync сам вставит important_dates
  if (rec === "once" && createChronicleEvent === true) {
    const locRow = db.prepare("SELECT name FROM setting_locations WHERE id = ?").get(req.params.id) as { name: string } | undefined;
    const locName = locRow?.name ?? `location:${req.params.id}`;
    const mention = `[[location:${req.params.id}|${locName}]]`;
    const eventDesc = description ? `${mention}\n${description}` : mention;
    // импортируем логику из settings.ts — локально, без циклического импорта: прямой INSERT + syncImportantDatesFromMentions
    const yNum = y as number;
    const mNum = m as number;
    const months = calMonths;
    // проверка уже сделана выше, просто вставляем
    const run = db.transaction(() => {
      // статус события — как в settingsRouter.post calendar-events: upcoming/happened от pinned calendar
      const nowRow = db.prepare("SELECT pinned_calendar_year, pinned_calendar_month, pinned_calendar_day FROM settings WHERE id = ?").get(loc.setting_id) as { pinned_calendar_year: number | null; pinned_calendar_month: number | null; pinned_calendar_day: number | null } | undefined;
      let status = "happened";
      if (nowRow && nowRow.pinned_calendar_year != null) {
        // упрощённо: если дата в будущем относительно pinned — upcoming
        const nowMonths = months.length > 0 ? months : [];
        // Временная оценка через elapsedDays-подобную логику: год приоритетнее месяца
        if (yNum > nowRow.pinned_calendar_year) status = "upcoming";
        else if (yNum === nowRow.pinned_calendar_year && mNum > (nowRow.pinned_calendar_month ?? 1)) status = "upcoming";
        else if (yNum === nowRow.pinned_calendar_year && mNum === (nowRow.pinned_calendar_month ?? 1) && d > (nowRow.pinned_calendar_day ?? 1)) status = "upcoming";
      }
      const info = db.prepare(
        `INSERT INTO setting_calendar_events (setting_id, title, description, inworld_year, inworld_month, inworld_day, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(loc.setting_id, trimmed, eventDesc, yNum, mNum, d, status);
      const newEventId = Number(info.lastInsertRowid);
      // копия в кампании — как в settings.ts
      const campaigns = db.prepare("SELECT id FROM campaigns WHERE setting_id = ? AND archived_at IS NULL").all(loc.setting_id) as { id: number }[];
      const insCamp = db.prepare(`INSERT INTO campaign_calendar_events (campaign_id, title, description, inworld_year, inworld_month, inworld_day, status) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const c of campaigns) insCamp.run(c.id, trimmed, eventDesc, yNum, mNum, d, status);
      // syncImportantDatesFromMentions — inline копия
      db.prepare("DELETE FROM important_dates WHERE source_event_id = ?").run(newEventId);
      db.prepare(`INSERT INTO important_dates (owner_type, owner_id, title, description, date_type, color, recurrence, year, month, day, custom_rule, source_event_id) VALUES ('location', ?, ?, ?, ?, ?, 'once', ?, ?, ?, ?, ?)`).run(req.params.id, trimmed, description ?? "", date_type ?? "", color ?? "", yNum, mNum, d, custom_rule ?? "", newEventId);
      return newEventId;
    });
    const newEventId = run();
    const createdDate = db.prepare("SELECT * FROM important_dates WHERE source_event_id = ?").get(newEventId);
    return res.status(201).json(createdDate);
  }

  const info = db
    .prepare(
      `INSERT INTO important_dates (owner_type, owner_id, title, description, date_type, color, recurrence, year, month, day, custom_rule)
       VALUES ('location', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, trimmed, description ?? "", date_type ?? "", color ?? "", rec, y, m, d, custom_rule ?? "");
  res.status(201).json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(info.lastInsertRowid));
});

settingLocationsRouter.put("/important-dates/:dateId", (req, res) => {
  const { title, recurrence, year, month, day, description, date_type, color, custom_rule } = req.body as {
    title?: string;
    recurrence?: string;
    year?: number | null;
    month?: number | null;
    day?: number;
    description?: string;
    date_type?: string;
    color?: string;
    custom_rule?: string;
  };
  // защита владения + фикс NULL-бага (COALESCE для year/month)
  const existing = db.prepare("SELECT * FROM important_dates WHERE id = ? AND owner_type = 'location'").get(req.params.dateId) as { id: number; source_event_id: number | null } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  if (title !== undefined) {
    const t = String(title).trim();
    if (!t) return res.status(400).json({ error: "title cannot be empty" });
    if (t.length > 200) return res.status(400).json({ error: "title too long" });
  }
  if (recurrence !== undefined && !ALLOWED_RECURRENCE.has(recurrence)) return res.status(400).json({ error: "invalid recurrence" });
  if (day !== undefined && day !== null && (!Number.isFinite(Number(day)) || Number(day) < 1 || Number(day) > 60)) return res.status(400).json({ error: "day must be 1..60" });
  if (month !== undefined && month !== null && (!Number.isFinite(Number(month)) || Number(month) < 1 || Number(month) > 36)) return res.status(400).json({ error: "month must be 1..36" });
  if (year !== undefined && year !== null && (!Number.isFinite(Number(year)) || Number(year) < 1 || Number(year) > 9999)) return res.status(400).json({ error: "year must be 1..9999" });
  if (description !== undefined && description !== null && String(description).length > 2000) return res.status(400).json({ error: "description too long" });
  if (date_type !== undefined && date_type !== null && String(date_type).length > 40) return res.status(400).json({ error: "date_type too long" });
  if (color !== undefined && color !== null && color !== "" && !/^#[0-9a-fA-F]{6}$/.test(String(color))) return res.status(400).json({ error: "color must be #RRGGBB" });
  if (custom_rule !== undefined && custom_rule !== null && String(custom_rule).length > 2000) return res.status(400).json({ error: "custom_rule too long" });
  db.prepare(
    `UPDATE important_dates SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       date_type = COALESCE(?, date_type),
       color = COALESCE(?, color),
       recurrence = COALESCE(?, recurrence),
       year = COALESCE(?, year),
       month = COALESCE(?, month),
       day = COALESCE(?, day),
       custom_rule = COALESCE(?, custom_rule)
     WHERE id = ? AND owner_type = 'location'`
  ).run(
    title !== undefined ? String(title).trim() : null,
    description ?? null,
    date_type ?? null,
    color ?? null,
    recurrence ?? null,
    year ?? null,
    month ?? null,
    day ?? null,
    custom_rule ?? null,
    req.params.dateId
  );
  // если дата привязана к событию Хроники — правим и его (двусторонняя связка)
  if (existing.source_event_id) {
    const patchTitle = title !== undefined ? String(title).trim() : undefined;
    const patchDesc = description !== undefined ? String(description) : undefined;
    const ev = db.prepare("SELECT id, description FROM setting_calendar_events WHERE id = ?").get(existing.source_event_id) as { id: number; description: string } | undefined;
    if (ev) {
      let newDesc = ev.description;
      if (patchDesc !== undefined) {
        const mentionMatch = ev.description.match(/^\[\[location:\d+\|[^\]]+\]\]\n?/);
        const mention = mentionMatch ? mentionMatch[0] : "";
        newDesc = mention + patchDesc;
      }
      db.prepare(`UPDATE setting_calendar_events SET title = COALESCE(?, title), description = COALESCE(?, description), inworld_year = COALESCE(?, inworld_year), inworld_month = COALESCE(?, inworld_month), inworld_day = COALESCE(?, inworld_day) WHERE id = ?`).run(
        patchTitle ?? null, patchDesc !== undefined ? newDesc : null, year ?? null, month ?? null, day ?? null, existing.source_event_id
      );
    }
  }
  res.json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(req.params.dateId));
});

settingLocationsRouter.delete("/important-dates/:dateId", (req, res) => {
  const existing = db.prepare("SELECT source_event_id FROM important_dates WHERE id = ? AND owner_type = 'location'").get(req.params.dateId) as { source_event_id: number | null } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  // двусторонняя связка: если дата была создана из события Хроники — удаляем и событие
  if (existing.source_event_id) {
    db.prepare("DELETE FROM setting_calendar_events WHERE id = ?").run(existing.source_event_id);
  }
  db.prepare("DELETE FROM important_dates WHERE id = ? AND owner_type = 'location'").run(req.params.dateId);
  res.json({ ok: true });
});

// Habitats reverse direction: drag a being/community onto a location to
// add that location to its habitat set.
settingLocationsRouter.post("/:id/inhabitants", (req, res) => {
  const { type, id } = req.body as { type: "being" | "community"; id: number };
  if (!type || !id) return res.status(400).json({ error: "type and id are required" });
  const loc = db
    .prepare("SELECT setting_id FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { setting_id: number } | undefined;
  if (!loc) return res.status(404).json({ error: "location not found" });
  if (type === "being") {
    const being = db
      .prepare("SELECT setting_id, archived_at FROM setting_beings WHERE id = ?")
      .get(id) as { setting_id: number; archived_at: string | null } | undefined;
    if (!being) return res.status(404).json({ error: "being not found" });
    if (being.archived_at) return res.status(400).json({ error: "being is archived" });
    if (being.setting_id !== loc.setting_id)
      return res.status(400).json({ error: "being must belong to same setting as location" });
    db.prepare(
      "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
    ).run(id, req.params.id);
  } else if (type === "community") {
    const community = db
      .prepare("SELECT setting_id, archived_at FROM setting_communities WHERE id = ?")
      .get(id) as { setting_id: number; archived_at: string | null } | undefined;
    if (!community) return res.status(404).json({ error: "community not found" });
    if (community.archived_at) return res.status(400).json({ error: "community is archived" });
    if (community.setting_id !== loc.setting_id)
      return res.status(400).json({ error: "community must belong to same setting as location" });
    db.prepare(
      "INSERT OR IGNORE INTO community_locations (community_id, location_id) VALUES (?, ?)"
    ).run(id, req.params.id);
  } else {
    return res.status(400).json({ error: "type must be being or community" });
  }
  res.json({ ok: true });
});

settingLocationsRouter.delete("/:id/inhabitants/:type/:targetId", (req, res) => {
  const { type, targetId } = req.params;
  const loc = db
    .prepare("SELECT id FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { id: number } | undefined;
  if (!loc) return res.status(404).json({ error: "location not found" });
  if (type === "being") {
    db.prepare("DELETE FROM being_locations WHERE being_id = ? AND location_id = ?").run(
      targetId,
      req.params.id
    );
  } else if (type === "community") {
    db.prepare(
      "DELETE FROM community_locations WHERE community_id = ? AND location_id = ?"
    ).run(targetId, req.params.id);
  } else {
    return res.status(400).json({ error: "type must be being or community" });
  }
  res.json({ ok: true });
});

settingLocationsRouter.post("/:id/chapters", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  const info = db
    .prepare("INSERT INTO location_chapters (location_id, title, content) VALUES (?, ?, ?)")
    .run(req.params.id, title ?? "", content ?? "");
  res.status(201).json(db.prepare("SELECT * FROM location_chapters WHERE id = ?").get(info.lastInsertRowid));
});

settingLocationsRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content, visible_to_players } = req.body as {
    title?: string;
    content?: string;
    visible_to_players?: boolean;
  };
  db.prepare(
    `UPDATE location_chapters SET
       title = COALESCE(?, title), content = COALESCE(?, content),
       visible_to_players = COALESCE(?, visible_to_players)
     WHERE id = ?`
  ).run(
    title ?? null,
    content ?? null,
    visible_to_players === undefined ? null : visible_to_players ? 1 : 0,
    req.params.chapterId
  );
  res.json(db.prepare("SELECT * FROM location_chapters WHERE id = ?").get(req.params.chapterId));
});

settingLocationsRouter.delete("/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM location_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
});

settingLocationsRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const location = db
    .prepare("SELECT folder_path, avatar_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return res.status(400).json({ error: "Unsupported image type" });
  const target = path.join(location.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, location.avatar_image_path, "avatar");

  db.prepare("UPDATE setting_locations SET avatar_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withImageUrls({ avatar_image_path: target }));
});

// Wide thumbnail shown in the Setting's Geography list — cropped
// independently from the square avatar, mirroring setting_beings.
settingLocationsRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const location = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return res.status(400).json({ error: "Unsupported image type" });
  const target = path.join(location.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, location.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE setting_locations SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withImageUrls({ thumbnail_image_path: target }));
});

settingLocationsRouter.delete("/:id/avatar", (req, res) => {
  const { mode } = req.query as { mode?: "forever" | "archive" };
  const location = db
    .prepare("SELECT name, avatar_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { name: string; avatar_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (location.avatar_image_path) {
    const result = removeOrArchive(location.avatar_image_path, mode, "location_avatar", Number(req.params.id), `${location.name} — аватар`);
    if ("needsChoice" in result) return res.status(409).json({ needsChoice: true });
  }
  db.prepare("UPDATE setting_locations SET avatar_image_path = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

settingLocationsRouter.delete("/:id/thumbnail", (req, res) => {
  const { mode } = req.query as { mode?: "forever" | "archive" };
  const location = db
    .prepare("SELECT name, thumbnail_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { name: string; thumbnail_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (location.thumbnail_image_path) {
    const result = removeOrArchive(location.thumbnail_image_path, mode, "location_thumbnail", Number(req.params.id), `${location.name} — тамбнейл`);
    if ("needsChoice" in result) return res.status(409).json({ needsChoice: true });
  }
  db.prepare("UPDATE setting_locations SET thumbnail_image_path = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

settingLocationsRouter.post("/:id/map", upload.single("file"), async (req, res) => {
  const location = db
    .prepare("SELECT folder_path, map_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { folder_path: string; map_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return res.status(400).json({ error: "Unsupported image type" });
  const target = path.join(location.folder_path, `map${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, location.map_image_path);

  db.prepare("UPDATE setting_locations SET map_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withMapUrl({ map_image_path: target }));
});

// `mode` mirrors gallery.ts's delete route — a 409 means this is the last
// remaining link to that map image, and the client should re-call with an
// explicit choice after asking the user.
settingLocationsRouter.delete("/:id/map", (req, res) => {
  const { mode } = req.query as { mode?: "forever" | "archive" };
  const location = db
    .prepare("SELECT name, map_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { name: string; map_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });

  if (location.map_image_path) {
    const result = removeOrArchive(
      location.map_image_path,
      mode,
      "location_map",
      Number(req.params.id),
      `${location.name} — карта`
    );
    if ("needsChoice" in result) return res.status(409).json({ needsChoice: true });
  }
  db.prepare("UPDATE setting_locations SET map_image_path = NULL WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM location_pins WHERE location_id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Moves (or copies) a location's map image + all its pins to a different
// location — for the "I built up the wrong location's map" recovery case.
// Refuses when the target already has its own map, rather than guessing how
// to merge two maps/pin sets.
settingLocationsRouter.post("/:id/map/transfer", async (req, res) => {
  const { targetLocationId, keepCopy } = req.body as { targetLocationId: number; keepCopy?: boolean };
  const source = db
    .prepare(
      "SELECT folder_path, map_image_path, map_max_zoom, map_start_zoom, map_goto_zoom, map_labels_always FROM setting_locations WHERE id = ?"
    )
    .get(req.params.id) as
    | {
        folder_path: string;
        map_image_path: string | null;
        map_max_zoom: number | null;
        map_start_zoom: number | null;
        map_goto_zoom: number | null;
        map_labels_always: number;
      }
    | undefined;
  if (!source) return res.status(404).json({ error: "source not found" });
  if (!source.map_image_path) return res.status(400).json({ error: "source has no map" });

  const target = db
    .prepare("SELECT folder_path, map_image_path FROM setting_locations WHERE id = ?")
    .get(targetLocationId) as { folder_path: string; map_image_path: string | null } | undefined;
  if (!target) return res.status(404).json({ error: "target not found" });
  if (target.map_image_path) return res.status(409).json({ error: "target already has a map" });

  const buffer = fs.readFileSync(vaultAbs(source.map_image_path));
  const ext = path.extname(source.map_image_path) || ".jpg";
  const targetPath = path.join(target.folder_path, `map${ext}`);

  // Write the file first — only touch the DB once the bytes actually exist
  // at the new path, so a mid-transfer failure can't leave the DB pointing
  // at a map file that was never written.
  if (keepCopy) {
    await storeDeduped(buffer, targetPath);
  } else {
    await writeReplacingOldFile(targetPath, buffer, source.map_image_path);
  }

  db.transaction(() => {
    if (keepCopy) {
      for (const pin of db.prepare("SELECT * FROM location_pins WHERE location_id = ?").all(req.params.id) as {
        target_type: string;
        target_id: number;
        x: number;
        y: number;
        color: string | null;
        size: number | null;
        border_color: string | null;
      }[]) {
        db.prepare(
          `INSERT INTO location_pins (location_id, target_type, target_id, x, y, color, size, border_color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(targetLocationId, pin.target_type, pin.target_id, pin.x, pin.y, pin.color, pin.size, pin.border_color);
      }
    } else {
      db.prepare("UPDATE location_pins SET location_id = ? WHERE location_id = ?").run(
        targetLocationId,
        req.params.id
      );
      db.prepare(
        "UPDATE setting_locations SET map_image_path = NULL, map_max_zoom = NULL, map_start_zoom = NULL, map_goto_zoom = NULL, map_labels_always = 0 WHERE id = ?"
      ).run(req.params.id);
    }
    db.prepare(
      "UPDATE setting_locations SET map_image_path = ?, map_max_zoom = ?, map_start_zoom = ?, map_goto_zoom = ?, map_labels_always = ? WHERE id = ?"
    ).run(
      targetPath,
      source.map_max_zoom,
      source.map_start_zoom,
      source.map_goto_zoom,
      source.map_labels_always,
      targetLocationId
    );
  })();

  res.json({ ok: true });
});

settingLocationsRouter.put("/:id/map-settings", (req, res) => {
  const { max_zoom, start_zoom, goto_zoom, labels_always } = req.body as {
    max_zoom?: number | null;
    start_zoom?: number | null;
    goto_zoom?: number | null;
    labels_always?: boolean;
  };
  db.prepare(
    `UPDATE setting_locations SET
       map_max_zoom = COALESCE(?, map_max_zoom),
       map_start_zoom = COALESCE(?, map_start_zoom),
       map_goto_zoom = COALESCE(?, map_goto_zoom),
       map_labels_always = COALESCE(?, map_labels_always)
     WHERE id = ?`
  ).run(
    max_zoom ?? null,
    start_zoom ?? null,
    goto_zoom ?? null,
    labels_always === undefined ? null : labels_always ? 1 : 0,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(req.params.id));
});

settingLocationsRouter.post("/:id/pins", (req, res) => {
  const { target_type, target_id, x, y, color, size, border_color } = req.body as {
    target_type: string;
    target_id: number;
    x: number;
    y: number;
    color?: string | null;
    size?: number | null;
    border_color?: string | null;
  };
  if (!target_type || !target_id || x == null || y == null)
    return res.status(400).json({ error: "target_type, target_id, x, y are required" });
  const info = db
    .prepare(
      `INSERT INTO location_pins (location_id, target_type, target_id, x, y, color, size, border_color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, target_type, target_id, x, y, color ?? null, size ?? null, border_color ?? null);
  res.status(201).json(db.prepare("SELECT * FROM location_pins WHERE id = ?").get(info.lastInsertRowid));
});

settingLocationsRouter.put("/pins/:pinId", (req, res) => {
  const { x, y, color, size, border_color, clear_color, clear_border_color } = req.body as {
    x?: number;
    y?: number;
    color?: string | null;
    size?: number | null;
    border_color?: string | null;
    clear_color?: boolean;
    clear_border_color?: boolean;
  };
  db.prepare(
    `UPDATE location_pins SET
       x = COALESCE(?, x), y = COALESCE(?, y),
       color = CASE WHEN ? THEN NULL ELSE COALESCE(?, color) END,
       size = COALESCE(?, size),
       border_color = CASE WHEN ? THEN NULL ELSE COALESCE(?, border_color) END
     WHERE id = ?`
  ).run(
    x ?? null,
    y ?? null,
    clear_color ? 1 : 0,
    color ?? null,
    size ?? null,
    clear_border_color ? 1 : 0,
    border_color ?? null,
    req.params.pinId
  );
  res.json(db.prepare("SELECT * FROM location_pins WHERE id = ?").get(req.params.pinId));
});

settingLocationsRouter.delete("/pins/:pinId", (req, res) => {
  db.prepare("DELETE FROM location_pins WHERE id = ?").run(req.params.pinId);
  res.json({ ok: true });
});

settingLocationsRouter.post("/resolve-labels", (req, res) => {
  const { pins } = req.body as { pins: { target_type: string; target_id: number }[] };
  if (!Array.isArray(pins) || pins.length === 0) return res.json({ labels: [] });

  const results: { target_type: string; target_id: number; label: string }[] = [];

  const SHORT_NAME_MAP: Record<string, { table: string; nameCol: string }> = {
    being: { table: "setting_beings", nameCol: "name" },
    character: { table: "characters", nameCol: "character_name" },
    location: { table: "setting_locations", nameCol: "name" },
    artifact: { table: "artifacts", nameCol: "name" },
    compendium_entry: { table: "compendium_entries", nameCol: "title" },
  };

  const grouped = new Map<string, { target_type: string; target_id: number }[]>();
  for (const pin of pins) {
    const key = pin.target_type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(pin);
  }

  for (const [type, items] of grouped) {
    const mapping = SHORT_NAME_MAP[type];
    if (!mapping) {
      for (const item of items) {
        results.push({ target_type: type, target_id: item.target_id, label: `${type} #${item.target_id}` });
      }
      continue;
    }

    const ids = [...new Set(items.map((i) => i.target_id))];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, short_name, ${mapping.nameCol} FROM ${mapping.table} WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; short_name: string | null; [key: string]: unknown }[];

    const rowMap = new Map(rows.map((r) => [r.id, r]));
    for (const item of items) {
      const row = rowMap.get(item.target_id);
      if (!row) {
        results.push({ target_type: type, target_id: item.target_id, label: `${type} #${item.target_id} (не найдено)` });
        continue;
      }
      const label = row.short_name || String(row[mapping.nameCol] ?? item.target_id);
      results.push({ target_type: type, target_id: item.target_id, label });
    }
  }

  res.json({ labels: results });
});

settingLocationsRouter.post("/", (req, res) => {
  const { setting_id, parent_id, name, kind } = req.body as {
    setting_id: number;
    parent_id?: number | null;
    name: string;
    kind?: string;
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });
  const err = validateLocationPayload({ name, kind });
  if (err) return res.status(400).json({ error: err });
  if (!String(name).trim()) return res.status(400).json({ error: "name must not be empty" });

  let baseFolder: string;
  if (parent_id) {
    const parent = db
      .prepare("SELECT folder_path FROM setting_locations WHERE id = ?")
      .get(parent_id) as { folder_path: string } | undefined;
    if (!parent) return res.status(404).json({ error: "parent location not found" });
    baseFolder = parent.folder_path;
  } else {
    const setting = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(setting_id) as { folder_path: string } | undefined;
    if (!setting) return res.status(404).json({ error: "setting not found" });
    baseFolder = settingGeographyRoot(setting.folder_path);
  }
  const folder = locationFolder(baseFolder, name);

  const info = db
    .prepare(
      "INSERT INTO setting_locations (setting_id, parent_id, name, kind, folder_path) VALUES (?, ?, ?, ?, ?)"
    )
    .run(setting_id, parent_id ?? null, name, kind ?? "", folder);
  res
    .status(201)
    .json(
      db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(info.lastInsertRowid)
    );
});

settingLocationsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const { name, kind, description, short_name, aliases, name_original } = req.body as {
    name?: string;
    kind?: string;
    description?: string;
    short_name?: string;
    aliases?: string[];
    name_original?: string;
  };
  const err = validateLocationPayload({ name, kind, description, short_name, aliases, name_original });
  if (err) return res.status(400).json({ error: err });
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    `UPDATE setting_locations SET
       name = COALESCE(?, name), kind = COALESCE(?, kind),
       description = COALESCE(?, description),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       aliases = COALESCE(?, aliases),
       name_original = COALESCE(?, name_original),
       folder_path = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    kind ?? null,
    description ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    aliases ? JSON.stringify(aliases) : null,
    name_original ?? null,
    folderPath,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(req.params.id));
});

// Re-parents a location (nest it under another location, or move it back to
// the setting's top level with parent_id: null) — also moves its folder on
// disk under the new parent (or the setting's Geography root) and rewrites
// every stored vault path underneath it.
settingLocationsRouter.put("/:id/parent", (req, res) => {
  const { parent_id } = req.body as { parent_id?: number | null };
  const location = db
    .prepare("SELECT * FROM setting_locations WHERE id = ?")
    .get(req.params.id) as
    | { id: number; setting_id: number; folder_path: string }
    | undefined;
  if (!location) return res.status(404).json({ error: "not found" });

  if (parent_id) {
    if (parent_id === location.id) {
      return res.status(400).json({ error: "a location cannot be nested under itself" });
    }
    // Walk up from the proposed parent — if we ever reach this location, the
    // proposed parent is one of its own descendants, which would create a cycle.
    let cursorId: number | null = parent_id;
    while (cursorId !== null) {
      if (cursorId === location.id) {
        return res.status(400).json({ error: "cannot nest a location under its own descendant" });
      }
      const row = db.prepare("SELECT parent_id FROM setting_locations WHERE id = ?").get(cursorId) as
        | { parent_id: number | null }
        | undefined;
      cursorId = row ? row.parent_id : null;
    }
  }

  let baseFolder: string;
  if (parent_id) {
    const parent = db
      .prepare("SELECT folder_path, setting_id FROM setting_locations WHERE id = ?")
      .get(parent_id) as { folder_path: string; setting_id: number } | undefined;
    if (!parent) return res.status(404).json({ error: "parent location not found" });
    if (parent.setting_id !== location.setting_id) {
      return res.status(400).json({ error: "parent must be in the same setting" });
    }
    baseFolder = parent.folder_path;
  } else {
    const setting = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(location.setting_id) as { folder_path: string } | undefined;
    if (!setting) return res.status(404).json({ error: "setting not found" });
    baseFolder = settingGeographyRoot(setting.folder_path);
  }

  const newFolderPath = moveEntityFolder(location.folder_path, baseFolder);
  db.prepare("UPDATE setting_locations SET parent_id = ?, folder_path = ? WHERE id = ?").run(
    parent_id ?? null,
    newFolderPath,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(req.params.id));
});

settingLocationsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
  const tx = db.transaction(() => archiveSubtree(id));
  tx();
  res.json({ ok: true });
});

settingLocationsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE setting_locations SET archived_at = NULL WHERE id = ?").run(
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(req.params.id));
});
