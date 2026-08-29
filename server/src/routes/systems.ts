import { Router } from "express";
import type { AuthedRequest } from "../services/auth";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { ensureDefaultMechanicsSection, ensureDefaultVehicleSection } from "../db/defaultSections";
import {
  entryImageFolder,
  readFileAsBase64,
  systemFolder,
  toFileUrl,
  writeReplacingOldFile,
} from "../services/filesystem";
import { removeOrArchive } from "../services/vaultDedup";
import { renameEntityFolder } from "../services/vaultPaths";
import {
  ImportedEntities,
  cleanCode,
  codeTakenBy,
  exportMention,
  rewritePayload,
  suggestCode,
} from "../services/mentions";
import {
  backfillCompendiumSummaries,
  writeDndCreatureSummary,
} from "../services/monsterSummary";
import { applyTidy, planTidy } from "../services/tidyCompendium";

export const systemsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function withThumbUrl<T extends { thumbnail_image_path?: string | null }>(row: T) {
  return {
    ...row,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

interface EntryRow {
  data: string;
  aliases?: string;
  avatar_image_path?: string | null;
  [key: string]: unknown;
}
// The `data` column is JSON text in SQLite; parse it so the client gets a
// ready object instead of a string it would have to JSON.parse itself.
// `aliases` — тем же способом и по той же причине, что у сущностей сеттинга.
function parseEntry(row: EntryRow | undefined) {
  if (!row) return row;
  let data: unknown = {};
  try {
    data = JSON.parse(row.data || "{}");
  } catch {
    data = {};
  }
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(row.aliases || "[]");
    if (Array.isArray(parsed)) aliases = parsed.map(String);
  } catch {
    aliases = [];
  }
  return {
    ...row,
    data,
    aliases,
    // Портрет записи — её собственный файл, а не картинка статблока: список
    // раздела, одиночная запись и batch отдают его одинаково, чтобы плитка
    // бестиария, модалка предпросмотра и карточка существа показывали одну
    // и ту же морду.
    avatar_image_url: row.avatar_image_path ? toFileUrl(String(row.avatar_image_path)) : null,
  };
}

// --- Compendium: per-system sections (tabs) ---

// The fixed reference lists a "mechanics" section always starts with
// (mirrors client/src/compendium.ts MECHANICS_GROUPS).
const MECHANICS_GROUPS = [
  "Типы существ и их особенности",
  "Особое восприятие",
  "Скорости передвижения и их особенности",
  "Типы урона",
  "Языки",
  "Владения инструментами",
  "Владения доспехами",
  "Владения оружием",
  "Особые владения",
  "Школы магии",
  "Свойства оружия",
  "Мастерство оружия",
  "Мировоззрение",
];

function seedMechanicsGroups(systemId: string | number, sectionId: number) {
  const existingRows = db
    .prepare("SELECT name FROM compendium_entries WHERE section_id = ? AND parent_id IS NULL")
    .all(sectionId) as { name: string }[];
  const existingNames = new Set(existingRows.map((r) => r.name));
  const insert = db.prepare(
    `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, data, description, position)
     VALUES (?, ?, NULL, 'mechanic_group', ?, '{}', '', ?)`
  );
  // On a brand-new section this seeds all groups; on an existing one it only
  // backfills groups added since (e.g. "Школы магии"), so upgrading doesn't
  // touch systems that already have their mechanics lists populated.
  let position = existingRows.length;
  for (const name of MECHANICS_GROUPS) {
    if (existingNames.has(name)) continue;
    insert.run(systemId, sectionId, name, position++);
  }
}

systemsRouter.get("/:id/sections", (req, res) => {
  // Досева здесь больше нет. Раньше каждый GET добирал недостающие группы из
  // MECHANICS_GROUPS — и удалённая группа возвращалась при следующем открытии
  // раздела, то есть удалить её насовсем было нельзя. Группы сеются один раз,
  // когда раздел заводят руками (POST/PUT ниже); «Справочник», который система
  // получает по умолчанию, остаётся пустым — «Школам магии» и «Владениям
  // доспехами» в Legend in the Mist делать нечего.
  res.json(
    db
      .prepare("SELECT * FROM system_sections WHERE system_id = ? ORDER BY position, id")
      .all(req.params.id)
  );
});

systemsRouter.post("/:id/sections", (req, res) => {
  const { name, kind } = req.body as { name: string; kind?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const { p } = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?")
    .get(req.params.id) as { p: number };
  const info = db
    .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, ?)")
    .run(req.params.id, p, name, kind || "wiki");
  const sectionId = Number(info.lastInsertRowid);
  if (kind === "mechanics") seedMechanicsGroups(req.params.id, sectionId);
  res.status(201).json(db.prepare("SELECT * FROM system_sections WHERE id = ?").get(sectionId));
});

systemsRouter.put("/sections/:sectionId", (req, res) => {
  const { name, kind, position } = req.body as { name?: string; kind?: string; position?: number };
  db.prepare(
    "UPDATE system_sections SET name = COALESCE(?, name), kind = COALESCE(?, kind), position = COALESCE(?, position) WHERE id = ?"
  ).run(name ?? null, kind ?? null, position ?? null, req.params.sectionId);
  const section = db.prepare("SELECT * FROM system_sections WHERE id = ?").get(req.params.sectionId) as
    | { id: number; system_id: number; kind: string }
    | undefined;
  if (kind === "mechanics" && section) seedMechanicsGroups(section.system_id, section.id);
  res.json(section);
});

systemsRouter.delete("/sections/:sectionId", (req, res) => {
  db.prepare("DELETE FROM system_sections WHERE id = ?").run(req.params.sectionId);
  res.json({ ok: true });
});

systemsRouter.put("/:id/sections/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE system_sections SET position = ? WHERE id = ? AND system_id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((sid, i) => upd.run(i, sid, req.params.id)));
  tx(order ?? []);
  res.json({ ok: true });
});

// --- Compendium: entries within a section (self-nesting via parent_id) ---

systemsRouter.get("/:id/entries", (req: AuthedRequest, res) => {
  const { section_id } = req.query as { section_id?: string };
  const rows = (
    section_id
      ? db.prepare("SELECT * FROM compendium_entries WHERE section_id = ? ORDER BY position, id").all(section_id)
      : db.prepare("SELECT * FROM compendium_entries WHERE system_id = ? ORDER BY position, id").all(req.params.id)
  ) as EntryRow[];
  // Сколько карточек статблока у записи — по этому числу бестиарий помечает
  // значком монстров, у которых статблок уже разобран, а не лежит прозой в
  // описании. Одним запросом на весь список, а не по записи.
  const ids = rows.map((r) => Number(r.id));
  const counts = statblockCounts(ids);
  // Звёздочка — тем же приёмом: один запрос на весь список. По ней бестиарий
  // ещё и сортирует, поэтому догружать её по записи значило бы 535 запросов
  // на открытие раздела. Портрет догружать не нужно вовсе — он лежит в самой
  // строке записи.
  const favourites = favouriteEntryIds(req.user?.id ?? null, ids);
  res.json(
    rows.map((row) => ({
      ...parseEntry(row),
      statblock_count: counts.get(Number(row.id)) ?? 0,
      favourite: favourites.has(Number(row.id)),
    }))
  );
});

function favouriteEntryIds(userId: number | null, entryIds: number[]): Set<number> {
  const set = new Set<number>();
  if (userId == null || entryIds.length === 0) return set;
  const placeholders = entryIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT entry_id FROM compendium_favourites
       WHERE user_id = ? AND entry_id IN (${placeholders})`
    )
    .all(userId, ...entryIds) as { entry_id: number }[];
  for (const r of rows) set.add(r.entry_id);
  return set;
}

// Звёздочка бестиария. Своя у каждого мастера — см. таблицу в db.ts.
systemsRouter.put("/entries/:entryId/favourite", (req: AuthedRequest, res) => {
  const userId = req.user?.id;
  if (userId == null) return res.status(401).json({ error: "unauthorized" });
  const entryId = Number(req.params.entryId);
  const { favourite } = req.body as { favourite?: boolean };
  if (favourite) {
    db.prepare(
      "INSERT OR IGNORE INTO compendium_favourites (user_id, entry_id) VALUES (?, ?)"
    ).run(userId, entryId);
  } else {
    db.prepare("DELETE FROM compendium_favourites WHERE user_id = ? AND entry_id = ?").run(
      userId,
      entryId
    );
  }
  res.json({ ok: true, favourite: !!favourite });
});

function statblockCounts(entryIds: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (entryIds.length === 0) return map;
  const placeholders = entryIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT owner_id, COUNT(*) as count FROM statblocks
       WHERE owner_type = 'compendium_entry' AND owner_id IN (${placeholders})
       GROUP BY owner_id`
    )
    .all(...entryIds) as { owner_id: number; count: number }[];
  for (const r of rows) map.set(r.owner_id, r.count);
  return map;
}

systemsRouter.post("/:id/entries", (req, res) => {
  const { section_id, parent_id, kind, name, level, data, description } = req.body as {
    section_id: number;
    parent_id?: number | null;
    kind?: string;
    name?: string;
    level?: number | null;
    data?: unknown;
    description?: string;
  };
  if (!section_id) return res.status(400).json({ error: "section_id is required" });
  const { p } = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE section_id = ? AND parent_id IS ?"
    )
    .get(section_id, parent_id ?? null) as { p: number };
  const info = db
    .prepare(
      `INSERT INTO compendium_entries
         (system_id, section_id, parent_id, kind, name, level, data, description, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      section_id,
      parent_id ?? null,
      kind || "wiki",
      name || "",
      level ?? null,
      JSON.stringify(data ?? {}),
      description || "",
      p
    );
  res
    .status(201)
    .json(parseEntry(db.prepare("SELECT * FROM compendium_entries WHERE id = ?").get(info.lastInsertRowid) as EntryRow));
});

// Пачкой по списку id — чтобы лист персонажа мог подтянуть свои заклинания и
// умения одним запросом вместо GET на каждое. Объявлено до "/entries/:entryId",
// иначе "batch" уедет в него как значение параметра.
//
// Отсутствующие id молча пропускаются: заклинание могли удалить из
// компендиума уже после того, как его вписали в лист, и ронять из-за этого
// весь запрос нельзя — лист покажет такую запись по сохранённому имени.
systemsRouter.get("/entries/batch", (req, res) => {
  const raw = String(req.query.ids ?? "");
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return res.json([]);
  // Ограничение SQLite на число переменных — 999; листов с таким количеством
  // записей не бывает, но обрезать безопаснее, чем упасть.
  const capped = ids.slice(0, 900);
  const placeholders = capped.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM compendium_entries WHERE id IN (${placeholders})`)
    .all(...capped) as EntryRow[];
  res.json(rows.map(parseEntry));
});

systemsRouter.get("/entries/:entryId", (req, res) => {
  // Чтение не пишет: сводку дозаполняют стартовый проход, импорт и живая
  // синхронизация статблока, так что профиль видит готовую data.
  const row = db.prepare("SELECT * FROM compendium_entries WHERE id = ?").get(req.params.entryId) as
    | EntryRow
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const chapters = db
    .prepare("SELECT * FROM compendium_entry_chapters WHERE entry_id = ? ORDER BY created_at, id")
    .all(req.params.entryId);
  res.json({ ...parseEntry(row), chapters });
});

systemsRouter.put("/entries/:entryId", (req, res) => {
  const {
    name,
    kind,
    level,
    data,
    description,
    position,
    aliases,
    name_original,
    short_name,
    combat_roles,
    tactics,
    secret,
  } = req.body as {
    name?: string;
    kind?: string;
    level?: number | null;
    data?: unknown;
    description?: string;
    position?: number;
    aliases?: string[];
    name_original?: string;
    short_name?: string | null;
    // Карточка существа (шаг 4): её же поля есть у setting_beings, личность
    // наследует их отсюда на лету, пока не заполнит свои.
    combat_roles?: string[];
    tactics?: string[];
    secret?: string;
  };
  db.prepare(
    `UPDATE compendium_entries SET
       name = COALESCE(?, name),
       kind = COALESCE(?, kind),
       level = COALESCE(?, level),
       data = COALESCE(?, data),
       description = COALESCE(?, description),
       position = COALESCE(?, position),
       aliases = COALESCE(?, aliases),
       name_original = COALESCE(?, name_original),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       combat_roles = COALESCE(?, combat_roles),
       tactics = COALESCE(?, tactics),
       secret = COALESCE(?, secret)
     WHERE id = ?`
  ).run(
    name ?? null,
    kind ?? null,
    level ?? null,
    data !== undefined ? JSON.stringify(data) : null,
    description ?? null,
    position ?? null,
    aliases !== undefined ? JSON.stringify(aliases) : null,
    name_original ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    combat_roles ? JSON.stringify(combat_roles.slice(0, 2)) : null,
    tactics ? JSON.stringify(tactics) : null,
    secret ?? null,
    req.params.entryId
  );

  // Правка сводки уходит в статблоки того же существа: размер, тип и
  // мировоззрение хранятся и там, и в data, и разъехавшись показывают на
  // одной странице два разных ответа на один вопрос.
  if (data !== undefined && data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const type = d.creature_type as { name?: string } | undefined;
    writeDndCreatureSummary(db, Number(req.params.entryId), {
      ...(typeof d.size === "string" ? { size: d.size } : {}),
      ...(typeof d.alignment === "string" ? { alignment: d.alignment } : {}),
      ...(type && typeof type.name === "string" ? { creatureType: type.name } : {}),
    });
  }

  res.json(parseEntry(db.prepare("SELECT * FROM compendium_entries WHERE id = ?").get(req.params.entryId) as EntryRow));
});

// --- Главы «История» и «Поведение» существа бестиария ---
//
// Форма маршрутов та же, что у существа сеттинга и персонажа: ChapterList
// принимает apiBase и дальше сам знает, куда стучаться.
systemsRouter.post("/entries/:entryId/chapters", (req, res) => {
  const { section, title, content } = req.body as {
    section?: string;
    title?: string;
    content?: string;
  };
  const info = db
    .prepare(
      "INSERT INTO compendium_entry_chapters (entry_id, section, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.entryId, section ?? "", title ?? "", content ?? "");
  res
    .status(201)
    .json(
      db.prepare("SELECT * FROM compendium_entry_chapters WHERE id = ?").get(info.lastInsertRowid)
    );
});

systemsRouter.put("/entries/chapters/:chapterId", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    `UPDATE compendium_entry_chapters SET
       title = COALESCE(?, title),
       content = COALESCE(?, content)
     WHERE id = ?`
  ).run(title ?? null, content ?? null, req.params.chapterId);
  res.json(db.prepare("SELECT * FROM compendium_entry_chapters WHERE id = ?").get(req.params.chapterId));
});

systemsRouter.delete("/entries/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM compendium_entry_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
});

// Портрет записи — свой файл в папке раздела системы (Bestiary/Vehicles).
// Загружается с вкладки «Изображения» профиля; картинки статблоков лежат
// там же на вкладке, но грузятся своим маршрутом (routes/statblocks.ts).
systemsRouter.post("/entries/:entryId/avatar", upload.single("file"), async (req, res) => {
  const entry = db
    .prepare(
      `SELECT ce.id, ce.kind, ce.avatar_image_path, sy.folder_path AS system_folder_path
         FROM compendium_entries ce JOIN systems sy ON sy.id = ce.system_id
        WHERE ce.id = ?`
    )
    .get(req.params.entryId) as
    | { id: number; kind: string; avatar_image_path: string | null; system_folder_path: string | null }
    | undefined;
  if (!entry) return res.status(404).json({ error: "not found" });
  if (!entry.system_folder_path) return res.status(400).json({ error: "system folder is missing" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const folder = entryImageFolder(entry.system_folder_path, entry.kind);
  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `entry-${entry.id}-avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, entry.avatar_image_path, "avatar");

  db.prepare("UPDATE compendium_entries SET avatar_image_path = ? WHERE id = ?").run(target, entry.id);
  res.json({ avatar_image_url: toFileUrl(target) });
});

// «Убрать» — не только отвязать: оставленный файл никому уже не принадлежит,
// а папка раздела за полгода зарастает такими. Последняя ссылка на байты
// уходит в _Archive (removeOrArchive), чтобы случайное удаление можно было
// откатить; если теми же байтами владеет кто-то ещё — просто снимается link.
systemsRouter.delete("/entries/:entryId/avatar", (req, res) => {
  const entry = db
    .prepare("SELECT id, name, avatar_image_path FROM compendium_entries WHERE id = ?")
    .get(req.params.entryId) as
    | { id: number; name: string; avatar_image_path: string | null }
    | undefined;
  if (!entry) return res.status(404).json({ error: "not found" });
  if (entry.avatar_image_path) {
    removeOrArchive(entry.avatar_image_path, "archive", "compendium_entry", entry.id, entry.name);
  }
  db.prepare("UPDATE compendium_entries SET avatar_image_path = NULL WHERE id = ?").run(entry.id);
  res.json({ avatar_image_url: null });
});

systemsRouter.delete("/entries/:entryId", (req, res) => {
  db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(req.params.entryId);
  res.json({ ok: true });
});

systemsRouter.put("/:id/entries/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE compendium_entries SET position = ? WHERE id = ? AND system_id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((eid, i) => upd.run(i, eid, req.params.id)));
  tx(order ?? []);
  res.json({ ok: true });
});

systemsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM systems WHERE archived_at IS NULL ORDER BY name")
    .all() as { thumbnail_image_path: string | null }[];
  res.json(rows.map(withThumbUrl));
});

systemsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id) as
    | { thumbnail_image_path: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withThumbUrl(row));
});

systemsRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const system = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM systems WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!system) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(system.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, system.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE systems SET thumbnail_image_path = ? WHERE id = ?").run(target, req.params.id);
  res.json(withThumbUrl({ thumbnail_image_path: target }));
});

// «Привести справочник в порядок»: сперва план — сколько работы нашлось и что
// предлагается перенести в «Транспорт», — потом применение с отмеченным.
// Разделены не ради красоты: подтверждение с числами и экран сверки читают
// ровно то, что потом и запишется.
systemsRouter.get("/:id/tidy", (req, res) => {
  res.json(planTidy(db, Number(req.params.id)));
});

systemsRouter.post("/:id/tidy", (req, res) => {
  const { move_ids } = req.body as { move_ids?: unknown };
  const ids = Array.isArray(move_ids)
    ? move_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  res.json(applyTidy(db, Number(req.params.id), ids));
});

systemsRouter.post("/", (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = systemFolder(name);
  const info = db
    .prepare("INSERT INTO systems (name, description, folder_path, code) VALUES (?, ?, ?, ?)")
    .run(name, description || "", folder, suggestCode("systems", name));
  ensureDefaultMechanicsSection(db, Number(info.lastInsertRowid));
  ensureDefaultVehicleSection(db, Number(info.lastInsertRowid));
  res.status(201).json(db.prepare("SELECT * FROM systems WHERE id = ?").get(info.lastInsertRowid));
});

systemsRouter.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id) as
    | { folder_path: string | null; name: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { name, description, code } = req.body as {
    name?: string;
    description?: string;
    code?: string;
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    "UPDATE systems SET name = COALESCE(?, name), description = COALESCE(?, description), folder_path = ?, code = COALESCE(?, code) WHERE id = ?"
  ).run(name ?? null, description ?? null, folderPath, code == null ? null : cleanCode(code), req.params.id);
  // Двойник кода называется, но не запрещается — см. settingsRouter.put("/:id").
  res.json({
    ...(db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id) as object),
    code_taken_by: code ? codeTakenBy(code, "systems", Number(req.params.id)) : null,
  });
});

systemsRouter.delete("/:id", (req, res) => {
  db.prepare("UPDATE systems SET archived_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

systemsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE systems SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id));
});

// --- Export/import: compendium (sections + entries) + this system's statblock
// templates, as one JSON file. Metadata only by default — pass ?images=1 to
// additionally embed the system thumbnail as base64 (the only image type a
// system row owns; compendium entries and templates carry no images).
function buildSystemExportData(systemId: number | string, includeImages: boolean): SystemExportData | null {
  const system = db.prepare("SELECT * FROM systems WHERE id = ?").get(systemId) as
    | { name: string; description: string; thumbnail_image_path: string | null }
    | undefined;
  if (!system) return null;
  const sections = db
    .prepare("SELECT * FROM system_sections WHERE system_id = ? ORDER BY position")
    .all(systemId) as SystemExportData["sections"];
  const entries = (
    db
      .prepare("SELECT * FROM compendium_entries WHERE system_id = ? ORDER BY position, id")
      .all(systemId) as EntryRow[]
  ).map(parseEntry) as unknown as SystemExportData["entries"];

  // Bestiary/statblock entries (dnd_creature etc.) carry their actual
  // statblock in the separate polymorphic `statblocks` table, not in
  // compendium_entries.data — attach it here so a system export takes the
  // full creature card along, not just its catalog metadata.
  const entryIds = entries.map((e) => e.id);
  if (entryIds.length) {
    const statblockRows = db
      .prepare(
        `SELECT owner_id, kind, format, content, note, theme, density FROM statblocks
         WHERE owner_type = 'compendium_entry' AND owner_id IN (${entryIds.map(() => "?").join(",")})`
      )
      .all(...entryIds) as {
      owner_id: number;
      kind: string;
      format: string;
      content: string;
      note: string;
      theme: string | null;
      density: string | null;
    }[];
    const statblocksByEntry = new Map<number, SystemExportData["entries"][number]["statblocks"]>();
    for (const { owner_id, ...sb } of statblockRows) {
      const list = statblocksByEntry.get(owner_id) ?? [];
      list!.push(sb);
      statblocksByEntry.set(owner_id, list);
    }
    for (const e of entries) {
      const list = statblocksByEntry.get(e.id);
      if (list) e.statblocks = list;
    }
  }

  const templates = db
    .prepare(
      "SELECT * FROM resources WHERE system_id = ? AND type = 'statblock_template' AND archived_at IS NULL"
    )
    .all(systemId) as SystemExportData["templates"];

  const systemOut: Record<string, unknown> = { ...system };
  if (includeImages) {
    systemOut.thumbnail_data = readFileAsBase64(system.thumbnail_image_path);
  }
  delete systemOut.thumbnail_image_path;

  // См. buildSettingExportData: в файле не должно остаться локальных id.
  return rewritePayload(
    { system: systemOut as SystemExportData["system"], sections, entries, templates },
    exportMention
  );
}

systemsRouter.get("/:id/export", (req, res) => {
  const data = buildSystemExportData(req.params.id, req.query.images === "1");
  if (!data) return res.status(404).json({ error: "not found" });
  res.json(data);
});

export interface SystemExportData {
  system: {
    name: string;
    description: string;
    /** Короткое общее сокращение модуля — «phb». Едет с файлом: см. SettingExportData. */
    code?: string | null;
    thumbnail_data?: { filename: string; mime: string; base64: string } | null;
  };
  sections: { id: number; position: number; name: string; kind: string }[];
  entries: {
    id: number;
    uid?: string;
    section_id: number;
    parent_id: number | null;
    kind: string;
    name: string;
    level: number | null;
    data: unknown;
    description: string;
    position: number;
    statblocks?: {
      kind: string;
      format: string;
      content: string;
      note: string;
      theme: string | null;
      density: string | null;
    }[];
  }[];
  templates: {
    name: string;
    template_kind: string | null;
    template_format: string;
    tags: string;
    notes: string;
  }[];
}

// Materializes an exported system (see GET /:id/export) as a brand-new
// system, remapping every internal id (sections, entries, and the id
// references embedded in entry `data`). Shared by the direct-import route
// and by the modules "enable" flow.
export async function importSystemExport(data: SystemExportData): Promise<number> {
  if (!data.system?.name) throw new Error("invalid export file");
  const { system, sections, entries, templates } = data;
  // Ссылки правятся после вставки — почему именно так, см. ImportedEntities.
  const imported = new ImportedEntities();

  // Only disambiguate the name if it actually collides — a fresh install
  // importing "D&D 5.5" should end up with a system named exactly
  // "D&D 5.5" (matters because findDndSystemId() on the client resolves
  // the D&D wizard's system by exact name match against "D&D 5.5"). The
  // "imported" origin itself is surfaced via imported_at (badge in
  // SystemsListPage), not baked into the name — only a bare numeric
  // suffix is added here, purely to satisfy the UNIQUE constraint.
  let importedName = system.name;
  const nameTaken = db.prepare("SELECT 1 FROM systems WHERE name = ?");
  for (let n = 2; nameTaken.get(importedName); n++) {
    importedName = `${system.name} (${n})`;
  }
  const folder = systemFolder(importedName);
  const sysInfo = db
    .prepare(
      "INSERT INTO systems (name, description, folder_path, code, imported_at) VALUES (?, ?, ?, ?, datetime('now'))"
    )
    .run(
      importedName,
      system.description || "",
      folder,
      system.code ? cleanCode(system.code) : suggestCode("systems", importedName)
    );
  const newSystemId = sysInfo.lastInsertRowid as number;

  if (system.thumbnail_data) {
    const { filename, base64 } = system.thumbnail_data;
    const ext = path.extname(filename) || ".jpg";
    const target = path.join(folder, `thumbnail${ext}`);
    await writeReplacingOldFile(target, Buffer.from(base64, "base64"), null, "thumbnail");
    db.prepare("UPDATE systems SET thumbnail_image_path = ? WHERE id = ?").run(target, newSystemId);
  }

  const sectionIdMap = new Map<number, number>();
  const insertSection = db.prepare(
    "INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, ?)"
  );
  for (const s of sections ?? []) {
    const info = insertSection.run(newSystemId, s.position, s.name, s.kind);
    sectionIdMap.set(s.id, info.lastInsertRowid as number);
  }
  // Импорт может не содержать «Справочника» вовсе — базовый раздел всё равно
  // должен быть, как у системы, заведённой руками. Если он в выгрузке был,
  // вызов ничего не делает.
  ensureDefaultMechanicsSection(db, newSystemId);
  ensureDefaultVehicleSection(db, newSystemId);

  const entryIdMap = new Map<number, number>();
  const insertEntry = db.prepare(
    `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, level, data, description, position)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  );
  for (const e of entries ?? []) {
    const newSectionId = sectionIdMap.get(e.section_id);
    if (!newSectionId) continue;
    const info = insertEntry.run(
      newSystemId,
      newSectionId,
      e.kind,
      e.name,
      e.level,
      JSON.stringify(e.data ?? {}),
      e.description || "",
      e.position
    );
    entryIdMap.set(e.id, info.lastInsertRowid as number);
    imported.claim("compendium_entry", info.lastInsertRowid as number, e.uid);
  }
  const updateParent = db.prepare("UPDATE compendium_entries SET parent_id = ? WHERE id = ?");
  for (const e of entries ?? []) {
    if (e.parent_id == null) continue;
    const newId = entryIdMap.get(e.id);
    const newParentId = entryIdMap.get(e.parent_id);
    if (newId && newParentId) updateParent.run(newParentId, newId);
  }

  const insertEntryStatblock = db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
     VALUES ('compendium_entry', ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const e of entries ?? []) {
    const newEntryId = entryIdMap.get(e.id);
    if (!newEntryId || !e.statblocks) continue;
    for (const sb of e.statblocks) {
      const sbRow = insertEntryStatblock.run(newEntryId, sb.kind, sb.format, sb.content, sb.note || "", sb.theme, sb.density);
      imported.track("statblocks", sbRow.lastInsertRowid as number);
    }
  }

  // A spell's `classes`, a species' `creature_type`/`senses`/`speeds`, and a
  // background's `origin_feat` all embed { id, name } references to other
  // compendium_entries in this same export — remap those ids too, or they'd
  // silently point at rows in the *source* system after import.
  function remapRef(ref: unknown): unknown {
    if (!ref || typeof ref !== "object" || !("id" in ref)) return ref;
    const r = ref as { id: number };
    const mapped = entryIdMap.get(r.id);
    return mapped ? { ...r, id: mapped } : ref;
  }
  const updateData = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  for (const e of entries ?? []) {
    const newId = entryIdMap.get(e.id);
    if (!newId || !e.data) continue;
    const data = e.data as Record<string, unknown>;
    const remapped: Record<string, unknown> = { ...data };
    if (Array.isArray(data.classes)) remapped.classes = data.classes.map(remapRef);
    if (Array.isArray(data.senses)) remapped.senses = data.senses.map(remapRef);
    if (Array.isArray(data.speeds)) remapped.speeds = data.speeds.map(remapRef);
    if (data.creature_type) remapped.creature_type = remapRef(data.creature_type);
    if (data.origin_feat) remapped.origin_feat = remapRef(data.origin_feat);
    updateData.run(JSON.stringify(remapped), newId);
  }

  const insertTemplate = db.prepare(
    `INSERT INTO resources (name, type, scope, system_id, template_kind, template_format, tags, notes)
     VALUES (?, 'statblock_template', 'system', ?, ?, ?, ?, ?)`
  );
  for (const t of templates ?? []) {
    const tr = insertTemplate.run(t.name, newSystemId, t.template_kind, t.template_format, t.tags || "", t.notes || "");
    imported.track("resources", tr.lastInsertRowid as number);
  }

  imported.resolve();
  // Импорт принёс data пустой (дача её хранит в статблоках) — заполняем сводку
  // тут же, а не на каждый GET. См. backfillEntrySummary/backfillCompendiumSummaries.
  backfillCompendiumSummaries(db, newSystemId);
  // См. importSettingExport: зачёркнутые ссылки на принесённое оживают сами.
  return newSystemId;
}

// Merges a newer export into an already-materialized system IN PLACE,
// instead of creating a duplicate — the point of "update this module" over
// "import as a new module". Matches sections by (kind, name) and entries by
// (section key, kind, name-path via parent_id) so anything that still exists
// in the new file keeps its database id (existing links from statblocks/
// relations into that entry survive). Anything only in the new file gets
// inserted; anything only in the *old* copy (e.g. a hand-added spell) is
// left completely untouched — this never deletes local content. Call sites
// are expected to snapshot a backup first (see POST /:id/update).
function buildEntryPathKey(
  entry: { id: number; parent_id: number | null; kind: string; name: string; section_id: number },
  byId: Map<number, { parent_id: number | null; kind: string; name: string; section_id: number }>
): string {
  const parts: string[] = [];
  let cur: { parent_id: number | null; kind: string; name: string; section_id: number } | undefined = entry;
  const seen = new Set<number>();
  let curId: number | null = entry.id;
  while (cur) {
    parts.unshift(`${cur.kind}:${cur.name}`);
    if (cur.parent_id == null || seen.has(cur.parent_id)) break;
    seen.add(cur.parent_id);
    curId = cur.parent_id;
    cur = byId.get(curId);
  }
  return `${entry.section_id}|${parts.join("/")}`;
}

export interface SystemUpdateSummary {
  sectionsAdded: number;
  entriesAdded: number;
  entriesUpdated: number;
  entriesKeptLocal: number;
  statblocksAdded: number;
  statblocksUpdated: number;
  templatesAdded: number;
  templatesUpdated: number;
}

export async function updateSystemFromExport(
  targetSystemId: number,
  { system, sections, entries, templates }: SystemExportData
): Promise<SystemUpdateSummary> {
  // При слиянии побеждает uid из файла: он — «издательская» личность записи,
  // общая у всех, кто ставил этот модуль. Локальный ключ такой записи никто
  // снаружи не видел, и держаться за него незачем.
  const imported = new ImportedEntities();
  const summary: SystemUpdateSummary = {
    sectionsAdded: 0,
    entriesAdded: 0,
    entriesUpdated: 0,
    entriesKeptLocal: 0,
    statblocksAdded: 0,
    statblocksUpdated: 0,
    templatesAdded: 0,
    templatesUpdated: 0,
  };

  // --- Sections: match by (kind, name) ---
  const existingSections = db
    .prepare("SELECT id, position, name, kind FROM system_sections WHERE system_id = ?")
    .all(targetSystemId) as { id: number; position: number; name: string; kind: string }[];
  const existingSectionByKey = new Map(existingSections.map((s) => [`${s.kind}:${s.name}`, s.id]));
  const maxSectionPosition = existingSections.reduce((m, s) => Math.max(m, s.position), -1);
  const sectionIdMap = new Map<number, number>();
  const insertSection = db.prepare(
    "INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, ?)"
  );
  let nextSectionPosition = maxSectionPosition + 1;
  for (const s of sections ?? []) {
    const key = `${s.kind}:${s.name}`;
    const existingId = existingSectionByKey.get(key);
    if (existingId) {
      sectionIdMap.set(s.id, existingId);
    } else {
      const info = insertSection.run(targetSystemId, nextSectionPosition++, s.name, s.kind);
      sectionIdMap.set(s.id, info.lastInsertRowid as number);
      summary.sectionsAdded++;
    }
  }

  // --- Entries: match by (section, kind, name-path) ---
  const existingEntries = (
    db.prepare("SELECT * FROM compendium_entries WHERE system_id = ?").all(targetSystemId) as EntryRow[]
  ).map(parseEntry) as unknown as {
    id: number;
    parent_id: number | null;
    kind: string;
    name: string;
    section_id: number;
  }[];
  const existingById = new Map(existingEntries.map((e) => [e.id, e]));
  const existingByKey = new Map(existingEntries.map((e) => [buildEntryPathKey(e, existingById), e.id]));
  const touchedIds = new Set<number>();

  // Same lookup shape as existingById, but for the *new* file's entries —
  // section ids remapped up front so buildEntryPathKey produces keys
  // directly comparable to existingByKey's.
  const newByIdMappedSection = new Map(
    (entries ?? []).map((e) => [e.id, { ...e, section_id: sectionIdMap.get(e.section_id) ?? e.section_id }])
  );
  const entryIdMap = new Map<number, number>();
  const insertEntry = db.prepare(
    `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, level, data, description, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateEntry = db.prepare(
    "UPDATE compendium_entries SET name = ?, level = ?, data = ?, description = ?, position = ? WHERE id = ?"
  );
  for (const e of entries ?? []) {
    const newSectionId = sectionIdMap.get(e.section_id);
    if (!newSectionId) continue;
    const key = buildEntryPathKey(newByIdMappedSection.get(e.id)!, newByIdMappedSection);
    const existingId = existingByKey.get(key);
    if (existingId) {
      updateEntry.run(e.name, e.level, JSON.stringify(e.data ?? {}), e.description || "", e.position, existingId);
      entryIdMap.set(e.id, existingId);
      touchedIds.add(existingId);
      imported.claim("compendium_entry", existingId, e.uid);
      summary.entriesUpdated++;
    } else {
      const newParentId = e.parent_id == null ? null : entryIdMap.get(e.parent_id) ?? null;
      const info = insertEntry.run(
        targetSystemId,
        newSectionId,
        newParentId,
        e.kind,
        e.name,
        e.level,
        JSON.stringify(e.data ?? {}),
        e.description || "",
        e.position
      );
      const insertedId = info.lastInsertRowid as number;
      entryIdMap.set(e.id, insertedId);
      touchedIds.add(insertedId);
      imported.claim("compendium_entry", insertedId, e.uid);
      summary.entriesAdded++;
    }
  }
  summary.entriesKeptLocal = existingEntries.filter((e) => !touchedIds.has(e.id)).length;

  // Same embedded-reference remap as importSystemExport (classes/senses/
  // speeds/creature_type/origin_feat point at other entries by id).
  function remapRef(ref: unknown): unknown {
    if (!ref || typeof ref !== "object" || !("id" in ref)) return ref;
    const r = ref as { id: number };
    const mapped = entryIdMap.get(r.id);
    return mapped ? { ...r, id: mapped } : ref;
  }
  const updateData = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  for (const e of entries ?? []) {
    const newId = entryIdMap.get(e.id);
    if (!newId || !e.data) continue;
    const data = e.data as Record<string, unknown>;
    const remapped: Record<string, unknown> = { ...data };
    if (Array.isArray(data.classes)) remapped.classes = data.classes.map(remapRef);
    if (Array.isArray(data.senses)) remapped.senses = data.senses.map(remapRef);
    if (Array.isArray(data.speeds)) remapped.speeds = data.speeds.map(remapRef);
    if (data.creature_type) remapped.creature_type = remapRef(data.creature_type);
    if (data.origin_feat) remapped.origin_feat = remapRef(data.origin_feat);
    updateData.run(JSON.stringify(remapped), newId);
  }

  // --- Entry statblocks: match by (entry, format) — same "refresh official
  // content, leave any extra hand-added format alone" philosophy as entries
  // themselves above. Scoped to touchedIds (entries that came from this
  // export), matching how templates/entries never touch untouched rows.
  const touchedEntryIds = [...touchedIds];
  const existingEntryStatblocks = touchedEntryIds.length
    ? (db
        .prepare(
          `SELECT id, owner_id, format FROM statblocks
           WHERE owner_type = 'compendium_entry' AND owner_id IN (${touchedEntryIds.map(() => "?").join(",")})`
        )
        .all(...touchedEntryIds) as { id: number; owner_id: number; format: string }[])
    : [];
  const existingEntryStatblockByKey = new Map(
    existingEntryStatblocks.map((s) => [`${s.owner_id}:${s.format}`, s.id])
  );
  const insertEntryStatblock = db.prepare(
    `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, theme, density)
     VALUES ('compendium_entry', ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateEntryStatblock = db.prepare(
    "UPDATE statblocks SET kind = ?, content = ?, note = ?, theme = ?, density = ? WHERE id = ?"
  );
  for (const e of entries ?? []) {
    const newEntryId = entryIdMap.get(e.id);
    if (!newEntryId || !e.statblocks) continue;
    for (const sb of e.statblocks) {
      const existingId = existingEntryStatblockByKey.get(`${newEntryId}:${sb.format}`);
      if (existingId) {
        updateEntryStatblock.run(sb.kind, sb.content, sb.note || "", sb.theme, sb.density, existingId);
        imported.track("statblocks", existingId);
        summary.statblocksUpdated++;
      } else {
        const sbRow = insertEntryStatblock.run(newEntryId, sb.kind, sb.format, sb.content, sb.note || "", sb.theme, sb.density);
        imported.track("statblocks", sbRow.lastInsertRowid as number);
        summary.statblocksAdded++;
      }
    }
  }

  // --- Statblock templates: match by name ---
  const existingTemplates = db
    .prepare(
      "SELECT id, name FROM resources WHERE system_id = ? AND type = 'statblock_template' AND archived_at IS NULL"
    )
    .all(targetSystemId) as { id: number; name: string }[];
  const existingTemplateByName = new Map(existingTemplates.map((t) => [t.name, t.id]));
  const insertTemplate = db.prepare(
    `INSERT INTO resources (name, type, scope, system_id, template_kind, template_format, tags, notes)
     VALUES (?, 'statblock_template', 'system', ?, ?, ?, ?, ?)`
  );
  const updateTemplate = db.prepare(
    "UPDATE resources SET template_kind = ?, template_format = ?, tags = ?, notes = ? WHERE id = ?"
  );
  for (const t of templates ?? []) {
    const existingId = existingTemplateByName.get(t.name);
    if (existingId) {
      updateTemplate.run(t.template_kind, t.template_format, t.tags || "", t.notes || "", existingId);
      summary.templatesUpdated++;
    } else {
      insertTemplate.run(t.name, targetSystemId, t.template_kind, t.template_format, t.tags || "", t.notes || "");
      summary.templatesAdded++;
    }
  }

  // Thumbnail is cosmetic — refresh it if the new export carries one.
  if (system.thumbnail_data) {
    const target = db.prepare("SELECT folder_path FROM systems WHERE id = ?").get(targetSystemId) as
      | { folder_path: string }
      | undefined;
    if (target) {
      const { filename, base64 } = system.thumbnail_data;
      const ext = path.extname(filename) || ".jpg";
      const file = path.join(target.folder_path, `thumbnail${ext}`);
      await writeReplacingOldFile(file, Buffer.from(base64, "base64"), null, "thumbnail");
      db.prepare("UPDATE systems SET thumbnail_image_path = ? WHERE id = ?").run(file, targetSystemId);
    }
  }

  imported.resolve();
  // Слияние могло принести data пустой — дозаполнить сводку так же, как при
  // новом импорте (пустые поля из статблоков, руками заданные не трогаем).
  backfillCompendiumSummaries(db, targetSystemId);
  return summary;
}

// Snapshots the current state of a system as an archived backup system,
// shared by the file-upload update route and the GitHub-catalog update route
// (modules.ts) — both merge a newer export into an existing system and both
// need the same "one Archive-page restore away" safety net first.
export async function createSystemBackup(targetId: number, targetName: string) {
  const backupData = buildSystemExportData(targetId, true);
  if (!backupData) throw new Error("not found");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  backupData.system = { ...backupData.system, name: `${targetName} (резерв перед обновлением, ${stamp})` };
  const backupSystemId = await importSystemExport(backupData);
  db.prepare("UPDATE systems SET archived_at = datetime('now') WHERE id = ?").run(backupSystemId);
  return { id: backupSystemId, name: db.prepare("SELECT name FROM systems WHERE id = ?").get(backupSystemId) };
}

// Updates an already-materialized system in place from a newer export file.
// Always snapshots the current state as an archived backup system first (so
// "оказалось, что-то отвязалось" is always one Archive-page restore away)
// before merging — see updateSystemFromExport for the merge rules.
systemsRouter.post("/:id/update", async (req, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare("SELECT id, name FROM systems WHERE id = ?").get(targetId) as
    | { id: number; name: string }
    | undefined;
  if (!target) return res.status(404).json({ error: "not found" });

  let backup: { id: number; name: unknown };
  try {
    backup = await createSystemBackup(targetId, target.name);
  } catch (e) {
    return res.status(500).json({ error: "не удалось создать резервную копию: " + String(e) });
  }

  let summary: SystemUpdateSummary;
  try {
    summary = await updateSystemFromExport(targetId, req.body as SystemExportData);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }

  res.json({
    system: db.prepare("SELECT * FROM systems WHERE id = ?").get(targetId),
    backup,
    summary,
  });
});

systemsRouter.post("/import", async (req, res) => {
  let newSystemId: number;
  try {
    newSystemId = await importSystemExport(req.body as SystemExportData);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "invalid export file" });
  }
  res.status(201).json(db.prepare("SELECT * FROM systems WHERE id = ?").get(newSystemId));
});
