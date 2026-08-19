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
import {
  CALENDAR_PRESETS,
  applyCalendarPreset,
  resolvePreset,
} from "../services/calendarPresets";
import {
  CrossLinkChoice,
  applySettingCrossLinks,
  planSettingCrossLinks,
  stripSettingCrossLinks,
} from "../import/crossLinks";
import {
  ImportedEntities,
  exportMention,
  healAllMentions,
  idOfUid,
  rewritePayload,
  uidOf,
} from "../services/mentions";

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

// Перекрёстные ссылки по всему сеттингу: тексты вне сцен — описания локаций,
// истории личностей, поля сообществ, сила предметов, синопсисы приключений.
// Сцены размечает свой проход на странице приключения: у него точнее отбор.
settingsRouter.get("/:id/cross-links", (req, res) => {
  res.json(planSettingCrossLinks(Number(req.params.id)));
});

settingsRouter.post("/:id/cross-links", (req, res) => {
  const { chosen } = req.body as { chosen?: CrossLinkChoice[] };
  if (!Array.isArray(chosen)) return res.status(400).json({ error: "chosen is required" });
  res.json(applySettingCrossLinks(Number(req.params.id), chosen));
});

settingsRouter.delete("/:id/cross-links", (req, res) => {
  res.json(stripSettingCrossLinks(Number(req.params.id)));
});

// Объявлено до «/:id»: иначе Express примет «calendar-presets» за номер
// сеттинга и вернёт 404.
// Список заготовок календаря для формы создания сеттинга.
settingsRouter.get("/calendar-presets", (_req, res) => {
  res.json(
    CALENDAR_PRESETS.map((p) => ({
      key: p.key,
      label: p.label,
      hint: p.hint,
      months: p.months.length,
      weekdays: p.weekdays.length,
      era: p.era?.name ?? null,
    }))
  );
});

settingsRouter.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM settings WHERE id = ?")
    .get(req.params.id) as { background_image_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withBgUrl(row));
});

settingsRouter.post("/", (req, res) => {
  const { name, description, calendar } = req.body as {
    name: string;
    description?: string;
    // Заготовка календаря: без неё сеттинг заводится с пустым календарём, как
    // и раньше, и хроника мира до заполнения месяцев ничего не показывает.
    calendar?: {
      preset?: string;
      withEra?: boolean;
      months?: number;
      daysPerMonth?: number;
      weekdays?: number;
    };
  };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = settingFolder(name);
  const info = db
    .prepare(
      "INSERT INTO settings (name, description, folder_path) VALUES (?, ?, ?)"
    )
    .run(name, description || "", folder);
  const newId = info.lastInsertRowid as number;
  const preset = calendar ? resolvePreset(calendar) : null;
  if (preset) applyCalendarPreset(newId, preset, calendar?.withEra === true);
  res.status(201).json(db.prepare("SELECT * FROM settings WHERE id = ?").get(newId));
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

// Одиночное событие — для его профиля. Участники и локации своей таблицы не
// заводят: они живут в общем графе (generic_links) со стороной setting_event,
// откуда их и берёт карточка «Участники и локации».
settingsRouter.get("/calendar-events/:eventId", (req, res) => {
  const event = db
    .prepare(
      `SELECT e.*, s.name as setting_name FROM setting_calendar_events e
       JOIN settings s ON s.id = e.setting_id
       WHERE e.id = ?`
    )
    .get(req.params.eventId) as Record<string, unknown> | undefined;
  if (!event) return res.status(404).json({ error: "not found" });
  res.json(event);
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
  const {
    title, description, inworld_year, inworld_month, inworld_day, important,
    full_description, consequences,
  } = req.body as {
      title: string;
      description?: string;
      inworld_year: number;
      inworld_month: number;
      inworld_day: number;
      important?: boolean;
      // Профиль события: развёрнутый текст и последствия. В хронике по-прежнему
      // показывается только краткое description.
      full_description?: string;
      consequences?: string;
    };
  if (!title || inworld_year == null || inworld_month == null || inworld_day == null) {
    return res
      .status(400)
      .json({ error: "title, inworld_year, inworld_month, inworld_day are required" });
  }
  const info = db
    .prepare(
      `INSERT INTO setting_calendar_events
         (setting_id, title, description, full_description, consequences,
          inworld_year, inworld_month, inworld_day, important)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      title,
      description ?? "",
      full_description ?? "",
      consequences ?? "",
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
  const {
    title, description, inworld_year, inworld_month, inworld_day, important, visible_to_players,
    full_description, consequences,
  } = req.body as {
      title?: string;
      description?: string;
      inworld_year?: number;
      inworld_month?: number;
      inworld_day?: number;
      important?: boolean;
      visible_to_players?: boolean;
      full_description?: string;
      consequences?: string;
    };
  db.prepare(
    `UPDATE setting_calendar_events SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       inworld_year = COALESCE(?, inworld_year),
       inworld_month = COALESCE(?, inworld_month),
       inworld_day = COALESCE(?, inworld_day),
       important = COALESCE(?, important),
       visible_to_players = COALESCE(?, visible_to_players),
       full_description = COALESCE(?, full_description),
       consequences = COALESCE(?, consequences)
     WHERE id = ?`
  ).run(
    title ?? null,
    description ?? null,
    inworld_year ?? null,
    inworld_month ?? null,
    inworld_day ?? null,
    important === undefined ? null : important ? 1 : 0,
    visible_to_players === undefined ? null : visible_to_players ? 1 : 0,
    full_description ?? null,
    consequences ?? null,
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
  // Связи с участниками внешним ключом не держатся (граф полиморфный), а
  // осиротев, показываются в чужих профилях как «setting_event #40 (не
  // найдено)» — поэтому убираются вместе с событием.
  db.prepare(
    `DELETE FROM generic_links
     WHERE (from_type = 'setting_event' AND from_id = ?) OR (to_type = 'setting_event' AND to_id = ?)`
  ).run(req.params.eventId, req.params.eventId);
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
/**
 * Досылает в только что вставленную строку всё, что приехало в файле, но не
 * попало в перечень колонок `INSERT`.
 *
 * Выгрузка строится через `SELECT *` и несёт все колонки таблицы, а вставки
 * перечисляют их поимённо — и всё незанесённое в перечень терялось молча:
 * описания существ, синонимы, оригинальные названия, короткие имена,
 * настройки масштаба карт, редкость предметов. Копирование по пересечению
 * «что приехало» с «что есть в таблице» закрывает это разом и не потребует
 * правки, когда в таблицу добавят следующую колонку.
 */
const NEVER_COPY = new Set([
  "id",
  "uid",
  "created_at",
  "archived_at",
  "imported_at",
  "folder_path",
  // Принадлежность и родство расставляются с пересчётом id, копировать их
  // как есть значило бы притащить чужие номера.
  "setting_id",
  "campaign_id",
  "session_id",
  "system_id",
  "parent_id",
  "location_id",
  "being_id",
  "community_id",
  "artifact_id",
  "base_monster_id",
  // Пути к файлам пишутся при распаковке вложений, а не переносятся строкой.
  "avatar_image_path",
  "thumbnail_image_path",
  "background_image_path",
  "map_image_path",
  "file_path",
]);

function copyPlainFields(table: string, newId: number, row: Record<string, unknown>): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((c) => c.name)
    .filter((c) => !NEVER_COPY.has(c) && c in row);
  const usable = cols.filter((c) => {
    const v = row[c];
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  });
  if (!usable.length) return;
  db.prepare(`UPDATE ${table} SET ${usable.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...usable.map((c) => (typeof row[c] === "boolean" ? (row[c] ? 1 : 0) : (row[c] as string | number | null))),
    newId
  );
}

/** Главы сущности, с пересчётом владельца. */
function insertChapters(
  table: string,
  ownerColumn: string,
  ownerId: number,
  chapters: ChapterData[] | undefined
): void {
  if (!chapters?.length) return;
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
  for (const ch of chapters) {
    const fields = ["title", "content", "section", "important", "visible_to_players"].filter(
      (f) => cols.includes(f) && ch[f as keyof ChapterData] != null
    );
    db.prepare(
      `INSERT INTO ${table} (${ownerColumn}${fields.length ? ", " + fields.join(", ") : ""})
       VALUES (?${fields.map(() => ", ?").join("")})`
    ).run(ownerId, ...fields.map((f) => ch[f as keyof ChapterData] as string | number));
  }
}

/**
 * Всё, что связывает уже вставленные строки друг с другом: принадлежность
 * личностей и сообществ, отношения, ссылки на компендиум, события хроники.
 *
 * Отдельным проходом, потому что каждой из этих таблиц нужны готовые карты
 * пересчёта id — раньше их не существовало, и вся эта часть сеттинга при
 * переносе просто исчезала.
 */
function linkImportedSetting(
  body: SettingExportData,
  maps: {
    locationIdMap: Map<number, number>;
    beingIdMap: Map<number, number>;
    communityIdMap: Map<number, number>;
    newSettingId: number;
  }
): void {
  const { locationIdMap, beingIdMap, communityIdMap, newSettingId } = maps;

  const linkBeingLocation = db.prepare(
    "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
  );
  const linkBeingCommunity = db.prepare(
    "INSERT OR IGNORE INTO being_communities (being_id, community_id) VALUES (?, ?)"
  );
  const linkCommunityLocation = db.prepare(
    "INSERT OR IGNORE INTO community_locations (community_id, location_id) VALUES (?, ?)"
  );
  const linkCompendium = db.prepare(
    "INSERT OR IGNORE INTO being_compendium_links (being_id, compendium_entry_id) VALUES (?, ?)"
  );

  for (const b of body.beings ?? []) {
    const newBeingId = beingIdMap.get(b.id);
    if (!newBeingId) continue;
    for (const oldId of b.inLocations ?? []) {
      const to = locationIdMap.get(oldId);
      if (to) linkBeingLocation.run(newBeingId, to);
    }
    for (const oldId of b.inCommunities ?? []) {
      const to = communityIdMap.get(oldId);
      if (to) linkBeingCommunity.run(newBeingId, to);
    }
    // Записи компендиума живут в другом модуле — системе. Ссылка приезжает
    // глобальным ключом и оживает, только если эта система на устройстве
    // стоит; иначе тихо пропускается, как и подвешенный меншен.
    if (b.baseMonsterUid) {
      const entryId = idOfUid("compendium_entry", b.baseMonsterUid);
      if (entryId) {
        db.prepare("UPDATE setting_beings SET base_monster_id = ? WHERE id = ?").run(
          entryId,
          newBeingId
        );
      }
    }
    for (const uid of b.compendiumUids ?? []) {
      const entryId = idOfUid("compendium_entry", uid);
      if (entryId) linkCompendium.run(newBeingId, entryId);
    }
  }

  for (const c of body.communities ?? []) {
    const newCommunityId = communityIdMap.get(c.id);
    if (!newCommunityId) continue;
    for (const oldId of c.inLocations ?? []) {
      const to = locationIdMap.get(oldId);
      if (to) linkCommunityLocation.run(newCommunityId, to);
    }
  }

  return;
}

/** Раскладывает галереи по хранилищу и заводит записи. */
async function insertGalleries(
  body: SettingExportData,
  folder: string,
  maps: { locationIdMap: Map<number, number>; beingIdMap: Map<number, number>; communityIdMap: Map<number, number> }
): Promise<void> {
  const insert = db.prepare(
    "INSERT INTO gallery_images (owner_type, owner_id, image_path, caption, position) VALUES (?, ?, ?, ?, ?)"
  );
  // Галерея устроена одинаково у всех трёх типов, а их полные типы разные —
  // сводим к тому минимуму, который здесь нужен.
  type GalleryOwner = { id: number; gallery?: GalleryData[] };
  const groups: [string, GalleryOwner[], Map<number, number>][] = [
    ["location", body.locations ?? [], maps.locationIdMap],
    ["being", body.beings ?? [], maps.beingIdMap],
    ["community", body.communities ?? [], maps.communityIdMap],
  ];
  for (const [ownerType, rows, map] of groups) {
    for (const row of rows ?? []) {
      const newId = map.get(row.id);
      if (!newId || !row.gallery?.length) continue;
      const target = ensureSubfolder(folder, "Gallery");
      for (const g of row.gallery) {
        if (!g.file_data) continue;
        const filePath = await writeBase64File(target, g.file_data.filename, g.file_data.base64);
        insert.run(ownerType, newId, filePath, g.caption || "", g.position ?? 0);
      }
    }
  }
}

function linkRelationsAndCalendar(
  body: SettingExportData,
  maps: {
    locationIdMap: Map<number, number>;
    beingIdMap: Map<number, number>;
    communityIdMap: Map<number, number>;
    newSettingId: number;
  }
): void {
  const { locationIdMap, beingIdMap, communityIdMap, newSettingId } = maps;
  const remap: Record<string, Map<number, number>> = {
    location: locationIdMap,
    being: beingIdMap,
    community: communityIdMap,
  };
  const insertRelation = db.prepare(
    `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // Своей уникальности у отношений нет, а слияние зовут повторно — без сверки
  // каждое «⟳ Обновить» плодило бы вторую копию каждой связи.
  const relationExists = db.prepare(
    `SELECT 1 FROM entity_relations
      WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND label = ?`
  );
  for (const r of body.relations ?? []) {
    const from = remap[r.from_type]?.get(r.from_id);
    const to = remap[r.to_type]?.get(r.to_id);
    if (!from || !to) continue;
    if (relationExists.get(r.from_type, from, r.to_type, to, r.label)) continue;
    insertRelation.run(r.from_type, from, r.to_type, to, r.tone, r.label, r.description);
  }

  // События хроники выгружались и раньше, но вставки для них не было вовсе —
  // календарь приезжал с месяцами и днями недели, но без единого события.
  if (body.calendarEvents?.length) {
    const cols = (
      db.prepare("PRAGMA table_info(setting_calendar_events)").all() as { name: string }[]
    )
      .map((c) => c.name)
      .filter((c) => !NEVER_COPY.has(c));
    const insertEvent = db.prepare(
      `INSERT INTO setting_calendar_events (setting_id${cols.length ? ", " + cols.join(", ") : ""})
       VALUES (?${cols.map(() => ", ?").join("")})`
    );
    // По той же причине, что и отношения: слияние зовут повторно, а второго
    // «Основания Глубоководья» в хронике быть не должно.
    const eventExists = db.prepare(
      `SELECT 1 FROM setting_calendar_events
        WHERE setting_id = ? AND title = ? AND inworld_year = ? AND inworld_month = ? AND inworld_day = ?`
    );
    for (const e of body.calendarEvents) {
      const row = e as unknown as Record<string, unknown>;
      if (
        eventExists.get(
          newSettingId,
          row.title ?? "",
          row.inworld_year ?? 0,
          row.inworld_month ?? 0,
          row.inworld_day ?? 0
        )
      ) {
        continue;
      }
      insertEvent.run(
        newSettingId,
        ...cols.map((c) => {
          const v = row[c];
          return v === undefined || typeof v === "object" ? null : (v as string | number);
        })
      );
    }
  }
}

/** Галерея сущности: подписи вместе с самими файлами. */
function attachGallery(rows: { id: number; gallery?: GalleryData[] }[], ownerType: string): void {
  if (!rows.length) return;
  const stmt = db.prepare(
    "SELECT image_path, caption, position FROM gallery_images WHERE owner_type = ? AND owner_id = ? ORDER BY position, id"
  );
  for (const row of rows) {
    const list = (stmt.all(ownerType, row.id) as {
      image_path: string;
      caption: string;
      position: number;
    }[])
      .map((g) => ({
        caption: g.caption,
        position: g.position,
        file_data: readFileAsBase64(g.image_path),
      }))
      .filter((g) => g.file_data);
    if (list.length) row.gallery = list as GalleryData[];
  }
}

/**
 * Выбрасывает из выгрузки все вложенные файлы, оставляя данные.
 *
 * Так работает снятая галочка «с изображениями» на импорте: файл уже скачан
 * целиком, но раскладывать сотни мегабайт по хранилищу человек не обязан.
 * Проще выкинуть вложения на входе, чем протаскивать флаг через два десятка
 * мест, каждое из которых пишет свой файл.
 */
function stripEmbeddedFiles(body: SettingExportData): void {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (/_data$/.test(key)) obj[key] = null;
      else walk(obj[key]);
    }
  };
  walk(body);
  for (const rows of [body.locations, body.beings, body.communities]) {
    for (const row of rows ?? []) delete (row as { gallery?: unknown }).gallery;
  }
}

/**
 * То же для пути слияния: добавляются только главы, которых у сущности ещё
 * нет.
 *
 * Сверка по заголовку, как и всё остальное в слиянии сеттинга. Правило здесь
 * то же, что и для локаций с личностями: своё не трогаем, чужое новое
 * добавляем. Иначе повторное «⟳ Обновить» удваивало бы текст каждой главы.
 */
function mergeChapters(
  table: string,
  ownerColumn: string,
  ownerId: number,
  chapters: ChapterData[] | undefined
): void {
  if (!chapters?.length) return;
  const existing = new Set(
    (
      db
        .prepare(`SELECT title FROM ${table} WHERE ${ownerColumn} = ?`)
        .all(ownerId) as { title: string }[]
    ).map((r) => (r.title ?? "").trim())
  );
  const fresh = chapters.filter((ch) => !existing.has((ch.title ?? "").trim()));
  insertChapters(table, ownerColumn, ownerId, fresh);
}

/** Один столбец выборки списком чисел — связки «многие ко многим» читаются так. */
function pluck(sql: string, id: number, column: string): number[] {
  return (db.prepare(sql).all(id) as Record<string, number>[]).map((r) => r[column]);
}

/**
 * Главы сущности — её настоящее содержимое.
 *
 * Карточка несёт имя и несколько полей, а всё написанное про локацию или
 * личность лежит главами. Выгрузка их не собирала, поэтому перенесённый
 * сеттинг приезжал списком имён: 90 глав локаций и 92 главы существ одного
 * только Вотердипа оставались дома.
 */
function attachChapters(
  rows: { id: number; chapters?: ChapterData[] }[],
  table: string,
  ownerColumn: string
): void {
  if (!rows.length) return;
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
  // У глав существ есть поля, которых нет у остальных (section, important,
  // campaign_id): берём пересечение, чтобы один запрос обслуживал все четыре
  // таблицы глав.
  const wanted = ["title", "content", "section", "important", "visible_to_players"].filter((c) =>
    cols.includes(c)
  );
  const stmt = db.prepare(
    `SELECT ${wanted.join(", ")} FROM ${table} WHERE ${ownerColumn} = ?
      ${cols.includes("campaign_id") ? "AND campaign_id IS NULL" : ""} ORDER BY id`
  );
  for (const row of rows) {
    const list = stmt.all(row.id) as ChapterData[];
    if (list.length) row.chapters = list;
  }
}

/**
 * Отношения, оба конца которых уезжают в этот же файл.
 *
 * Односторонние отбрасываются намеренно: связь с сущностью, которой у
 * получателя нет, восстановить не по чему — в отличие от меншена, у
 * `entity_relations` нет подписи, которая осталась бы читаемой прозой.
 */
function collectRelations(payload: SettingExportData): SettingExportData["relations"] {
  const scope = new Map<string, Set<number>>([
    ["location", new Set(payload.locations.map((l) => l.id))],
    ["being", new Set(payload.beings.map((b) => b.id))],
    ["community", new Set(payload.communities.map((c) => c.id))],
    ["artifact", new Set((payload.artifacts ?? []).map((a) => a.id))],
  ]);
  const inScope = (type: string, id: number) => scope.get(type)?.has(id) ?? false;
  const rows = db
    .prepare(
      "SELECT from_type, from_id, to_type, to_id, tone, label, description FROM entity_relations"
    )
    .all() as SettingExportData["relations"];
  return (rows ?? []).filter(
    (r) => inScope(r.from_type, r.from_id) && inScope(r.to_type, r.to_id)
  );
}

export function buildSettingExportData(
  settingId: number | string,
  include: string[]
): SettingExportData | null {
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

  // A being's actual combat statblock (D&D/LitM structured card) lives in
  // the separate polymorphic `statblocks` table, not on setting_beings
  // itself — statblock_short/statblock_full above are just the older
  // plain-text fields. Always included (not gated on "images"): it's text/
  // JSON data, same as statblock_short/statblock_full.
  const beingIds = beings.map((b) => b.id);
  if (beingIds.length) {
    const statblockRows = db
      .prepare(
        `SELECT owner_id, kind, format, content, note, theme, density FROM statblocks
         WHERE owner_type = 'being' AND owner_id IN (${beingIds.map(() => "?").join(",")})`
      )
      .all(...beingIds) as {
      owner_id: number;
      kind: string;
      format: string;
      content: string;
      note: string;
      theme: string | null;
      density: string | null;
    }[];
    const statblocksByBeing = new Map<number, SettingExportData["beings"][number]["statblocks"]>();
    for (const { owner_id, ...sb } of statblockRows) {
      const list = statblocksByBeing.get(owner_id) ?? [];
      list!.push(sb);
      statblocksByBeing.set(owner_id, list);
    }
    for (const b of beings) {
      const list = statblocksByBeing.get(b.id);
      if (list) b.statblocks = list;
    }
  }

  // Главы — это и есть содержимое страницы: карточка сущности несёт имя и
  // пару полей, а всё написанное про неё живёт здесь. До сих пор выгрузка их
  // не собирала вовсе, и перенесённый сеттинг приезжал списком имён.
  attachChapters(locations, "location_chapters", "location_id");
  attachChapters(beings, "being_chapters", "being_id");
  attachChapters(communities, "community_chapters", "community_id");

  // Галерея — единственная часть сеттинга, которая тащит за собой мегабайты,
  // поэтому едет под тем же флагом, что аватары и карты. Без файлов записи
  // галереи бессмысленны (подпись без картинки), так что гейт общий.
  if (withImages) {
    attachGallery(locations, "location");
    attachGallery(beings, "being");
    attachGallery(communities, "community");
  }

  // Принадлежность: где существо живёт, в каких сообществах состоит, какие
  // локации сообщество занимает. Хранится отдельными таблицами-связками, и
  // без них перенесённое население висит в пустоте.
  for (const b of beings) {
    b.inLocations = pluck("SELECT location_id FROM being_locations WHERE being_id = ?", b.id, "location_id");
    b.inCommunities = pluck(
      "SELECT community_id FROM being_communities WHERE being_id = ?",
      b.id,
      "community_id"
    );
    // Ссылка на запись компендиума ведёт в другой модуль — систему. Едет
    // глобальным ключом, а не локальным id: у получателя система своя.
    b.baseMonsterUid = b.base_monster_id != null ? uidOf("compendium_entry", b.base_monster_id) : null;
    b.compendiumUids = pluck(
      "SELECT compendium_entry_id FROM being_compendium_links WHERE being_id = ?",
      b.id,
      "compendium_entry_id"
    )
      .map((id) => uidOf("compendium_entry", id))
      .filter((u): u is string => !!u);
  }
  for (const c of communities) {
    c.inLocations = pluck(
      "SELECT location_id FROM community_locations WHERE community_id = ?",
      c.id,
      "location_id"
    );
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

  // Отношения между сущностями. Собираются последними, когда состав файла уже
  // известен: берутся только те, у которых оба конца уезжают в этот же файл —
  // половина отношения на чужом устройстве это связь в никуда.
  payload.relations = collectRelations(payload);

  // Ссылки внутри текстов переводятся в глобальную форму: локальный id в
  // файле означал бы на чужом устройстве другую сущность (services/mentions.ts).
  return rewritePayload(payload, exportMention);
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

export interface GalleryData {
  caption: string;
  position: number;
  file_data: FileData | null;
}

export interface ChapterData {
  title: string;
  content: string;
  section?: string | null;
  important?: number | null;
  visible_to_players?: number | null;
}

export interface SettingExportData {
  setting: {
    uid?: string;
    name: string;
    description: string;
    calendar_era: string;
    background_data?: FileData | null;
    thumbnail_data?: FileData | null;
  };
  locations: {
    id: number;
    uid?: string;
    chapters?: ChapterData[];
    gallery?: GalleryData[];
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
    uid?: string;
    chapters?: ChapterData[];
    gallery?: GalleryData[];
    /** Локации и сообщества, к которым личность приписана (таблицы-связки). */
    inLocations?: number[];
    inCommunities?: number[];
    /** Записи компендиума — из другого модуля, поэтому глобальными ключами. */
    base_monster_id?: number | null;
    baseMonsterUid?: string | null;
    compendiumUids?: string[];
    name: string;
    category: string;
    location_id: number | null;
    statblock_short: string;
    statblock_full: string;
    history: string;
    behavior: string;
    avatar_data?: FileData | null;
    thumbnail_data?: FileData | null;
    statblocks?: {
      kind: string;
      format: string;
      content: string;
      note: string;
      theme: string | null;
      density: string | null;
    }[];
  }[];
  communities: {
    id: number;
    uid?: string;
    chapters?: ChapterData[];
    gallery?: GalleryData[];
    inLocations?: number[];
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
  artifacts?: {
    id: number;
    uid?: string;
    name: string;
    owner: string;
    power: string;
    history: string;
    notes: string;
  }[];
  /**
   * Отношения между сущностями сеттинга. Оба конца всегда внутри этого файла —
   * см. collectRelations.
   */
  relations?: {
    from_type: string;
    from_id: number;
    to_type: string;
    to_id: number;
    tone: string;
    label: string;
    description: string;
  }[];
  resources?: {
    uid?: string;
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

export async function importSettingExport(
  body: SettingExportData,
  options: { withImages?: boolean } = {}
): Promise<number> {
  if (!body.setting?.name) throw new Error("invalid export file");
  // Файл может нести изображения, а ставить их — не обязательно: на слабой
  // машине или ради быстрой примерки модуля картинки только мешают.
  const withImages = options.withImages !== false;
  if (!withImages) stripEmbeddedFiles(body);

  // Ссылки переводятся не до вставки, а после: пока строки не созданы, их
  // новых id ещё нет, а глобальный поиск по uid склеил бы новый сеттинг со
  // старым, если тот же модуль уже стоит (см. ImportedEntities).
  const imported = new ImportedEntities();

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
  imported.claim("setting", newSettingId, body.setting.uid);
  copyPlainFields("settings", newSettingId, body.setting as Record<string, unknown>);

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
    imported.claim("location", r.lastInsertRowid as number, l.uid);
    copyPlainFields("setting_locations", r.lastInsertRowid as number, l as Record<string, unknown>);
    insertChapters("location_chapters", "location_id", r.lastInsertRowid as number, l.chapters);
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
  const insertBeingStatblock = db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
     VALUES ('being', ?, ?, ?, ?, ?, ?, ?)`
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
    imported.claim("being", newBeingId, b.uid);
    copyPlainFields("setting_beings", newBeingId, b as Record<string, unknown>);
    insertChapters("being_chapters", "being_id", newBeingId, b.chapters);
    if (b.avatar_data || b.thumbnail_data) {
      const beingFolderPath = beingFolder(folder, b.name);
      const { avatarPath, thumbnailPath } = await writeEntityImages(beingFolderPath, b);
      db.prepare(
        "UPDATE setting_beings SET folder_path = ?, avatar_image_path = ?, thumbnail_image_path = ? WHERE id = ?"
      ).run(beingFolderPath, avatarPath, thumbnailPath, newBeingId);
    }
    for (const sb of b.statblocks ?? []) {
      const sbRow = insertBeingStatblock.run(newBeingId, sb.kind, sb.format, sb.content, sb.note || "", sb.theme, sb.density);
      // Статблок своего uid не имеет, но ссылки в его содержимом есть.
      imported.track("statblocks", sbRow.lastInsertRowid as number);
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
    imported.claim("community", r.lastInsertRowid as number, c.uid);
    copyPlainFields("setting_communities", r.lastInsertRowid as number, c as Record<string, unknown>);
    insertChapters("community_chapters", "community_id", r.lastInsertRowid as number, c.chapters);
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
      const ar = insertArtifact.run(newSettingId, a.name, a.owner || "", a.power || "", a.history || "", a.notes || "");
      imported.claim("artifact", ar.lastInsertRowid as number, a.uid);
      copyPlainFields("artifacts", ar.lastInsertRowid as number, a as Record<string, unknown>);
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
      const rr = insertResource.run(
        r.name,
        r.type || "note",
        newSettingId,
        r.tags || "",
        r.notes || "",
        r.link_url ?? null,
        r.category ?? null,
        filePath
      );
      imported.claim("resource", rr.lastInsertRowid as number, r.uid);
      copyPlainFields("resources", rr.lastInsertRowid as number, r as Record<string, unknown>);
    }
  }

  const maps = { locationIdMap, beingIdMap, communityIdMap, newSettingId };
  linkImportedSetting(body, maps);
  linkRelationsAndCalendar(body, maps);
  if (withImages) await insertGalleries(body, folder, maps);

  imported.resolve();
  // Сеттинг принёс сущности — подвешенные ссылки на них в текстах других
  // модулей могли ждать именно этого момента.
  healAllMentions();
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
  statblocksAdded: number;
  statblocksUpdated: number;
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

  // См. updateSystemFromExport: при слиянии uid из файла побеждает локальный.
  const imported = new ImportedEntities();

  const summary: SettingUpdateSummary = {
    locationsAdded: 0,
    locationsUpdated: 0,
    locationsKeptLocal: 0,
    beingsAdded: 0,
    beingsUpdated: 0,
    beingsKeptLocal: 0,
    statblocksAdded: 0,
    statblocksUpdated: 0,
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
      imported.claim("location", existingId, l.uid);
      copyPlainFields("setting_locations", existingId, l as Record<string, unknown>);
      mergeChapters("location_chapters", "location_id", existingId, l.chapters);
      touchedLocationIds.add(existingId);
      summary.locationsUpdated++;
    } else {
      const newParentId = l.parent_id == null ? null : locationIdMap.get(l.parent_id) ?? null;
      const info = insertLocation.run(targetSettingId, newParentId, l.name, l.kind || "", l.description || "");
      const insertedId = info.lastInsertRowid as number;
      locationIdMap.set(l.id, insertedId);
      imported.claim("location", insertedId, l.uid);
      copyPlainFields("setting_locations", insertedId, l as Record<string, unknown>);
      mergeChapters("location_chapters", "location_id", insertedId, l.chapters);
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
      imported.claim("community", existingId, c.uid);
      copyPlainFields("setting_communities", existingId, c as Record<string, unknown>);
      mergeChapters("community_chapters", "community_id", existingId, c.chapters);
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
      imported.claim("community", insertedId, c.uid);
      copyPlainFields("setting_communities", insertedId, c as Record<string, unknown>);
      mergeChapters("community_chapters", "community_id", insertedId, c.chapters);
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
  const beingIdMap = new Map<number, number>();
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
      beingIdMap.set(b.id, existingId);
      imported.claim("being", existingId, b.uid);
      copyPlainFields("setting_beings", existingId, b as Record<string, unknown>);
      mergeChapters("being_chapters", "being_id", existingId, b.chapters);
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
      beingIdMap.set(b.id, insertedId);
      imported.claim("being", insertedId, b.uid);
      copyPlainFields("setting_beings", insertedId, b as Record<string, unknown>);
      mergeChapters("being_chapters", "being_id", insertedId, b.chapters);
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

  // --- Being statblocks: match by (being, format) — same "refresh official
  // content, leave any extra hand-added format alone" philosophy as entry
  // statblocks in updateSystemFromExport. Scoped to touchedBeingIds.
  const touchedBeingIdList = [...touchedBeingIds];
  const existingBeingStatblocks = touchedBeingIdList.length
    ? (db
        .prepare(
          `SELECT id, owner_id, format FROM statblocks
           WHERE owner_type = 'being' AND owner_id IN (${touchedBeingIdList.map(() => "?").join(",")})`
        )
        .all(...touchedBeingIdList) as { id: number; owner_id: number; format: string }[])
    : [];
  const existingBeingStatblockByKey = new Map(
    existingBeingStatblocks.map((s) => [`${s.owner_id}:${s.format}`, s.id])
  );
  const insertBeingStatblock = db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
     VALUES ('being', ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateBeingStatblock = db.prepare(
    "UPDATE statblocks SET kind = ?, content = ?, note = ?, theme = ?, density = ? WHERE id = ?"
  );
  for (const b of body.beings ?? []) {
    const newBeingId = beingIdMap.get(b.id);
    if (!newBeingId || !b.statblocks) continue;
    for (const sb of b.statblocks) {
      const existingId = existingBeingStatblockByKey.get(`${newBeingId}:${sb.format}`);
      if (existingId) {
        updateBeingStatblock.run(sb.kind, sb.content, sb.note || "", sb.theme, sb.density, existingId);
        summary.statblocksUpdated++;
      } else {
        insertBeingStatblock.run(newBeingId, sb.kind, sb.format, sb.content, sb.note || "", sb.theme, sb.density);
        summary.statblocksAdded++;
      }
    }
  }

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

  const mergeMaps = { locationIdMap, beingIdMap, communityIdMap, newSettingId: targetSettingId };
  linkImportedSetting(body, mergeMaps);
  linkRelationsAndCalendar(body, mergeMaps);

  imported.resolve();
  healAllMentions();
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
    // ?images=0 — поставить сеттинг без картинок: файл уже скачан целиком, но
    // раскладывать сотни мегабайт по хранилищу человек не обязан.
    newSettingId = await importSettingExport(req.body as SettingExportData, {
      withImages: req.query.images !== "0",
    });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }
  res.status(201).json(db.prepare("SELECT * FROM settings WHERE id = ?").get(newSettingId));
});
