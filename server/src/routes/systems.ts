import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { readFileAsBase64, systemFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";

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
  [key: string]: unknown;
}
// The `data` column is JSON text in SQLite; parse it so the client gets a
// ready object instead of a string it would have to JSON.parse itself.
function parseEntry(row: EntryRow | undefined) {
  if (!row) return row;
  let data: unknown = {};
  try {
    data = JSON.parse(row.data || "{}");
  } catch {
    data = {};
  }
  return { ...row, data };
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
  const rows = db
    .prepare("SELECT * FROM system_sections WHERE system_id = ? ORDER BY position, id")
    .all(req.params.id) as { id: number; kind: string }[];
  // Backfills any mechanics groups added to MECHANICS_GROUPS since this
  // system's "mechanics" section was first created (e.g. "Школы магии").
  for (const row of rows) {
    if (row.kind === "mechanics") seedMechanicsGroups(req.params.id, row.id);
  }
  res.json(rows);
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

systemsRouter.get("/:id/entries", (req, res) => {
  const { section_id } = req.query as { section_id?: string };
  const rows = (
    section_id
      ? db.prepare("SELECT * FROM compendium_entries WHERE section_id = ? ORDER BY position, id").all(section_id)
      : db.prepare("SELECT * FROM compendium_entries WHERE system_id = ? ORDER BY position, id").all(req.params.id)
  ) as EntryRow[];
  res.json(rows.map(parseEntry));
});

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

systemsRouter.get("/entries/:entryId", (req, res) => {
  const row = db.prepare("SELECT * FROM compendium_entries WHERE id = ?").get(req.params.entryId) as
    | EntryRow
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(parseEntry(row));
});

systemsRouter.put("/entries/:entryId", (req, res) => {
  const { name, kind, level, data, description, position } = req.body as {
    name?: string;
    kind?: string;
    level?: number | null;
    data?: unknown;
    description?: string;
    position?: number;
  };
  db.prepare(
    `UPDATE compendium_entries SET
       name = COALESCE(?, name),
       kind = COALESCE(?, kind),
       level = COALESCE(?, level),
       data = COALESCE(?, data),
       description = COALESCE(?, description),
       position = COALESCE(?, position)
     WHERE id = ?`
  ).run(
    name ?? null,
    kind ?? null,
    level ?? null,
    data !== undefined ? JSON.stringify(data) : null,
    description ?? null,
    position ?? null,
    req.params.entryId
  );
  res.json(parseEntry(db.prepare("SELECT * FROM compendium_entries WHERE id = ?").get(req.params.entryId) as EntryRow));
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

systemsRouter.post("/", (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const folder = systemFolder(name);
  const info = db
    .prepare("INSERT INTO systems (name, description, folder_path) VALUES (?, ?, ?)")
    .run(name, description || "", folder);
  res.status(201).json(db.prepare("SELECT * FROM systems WHERE id = ?").get(info.lastInsertRowid));
});

systemsRouter.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id) as
    | { folder_path: string | null; name: string }
    | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { name, description } = req.body as { name?: string; description?: string };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    "UPDATE systems SET name = COALESCE(?, name), description = COALESCE(?, description), folder_path = ? WHERE id = ?"
  ).run(name ?? null, description ?? null, folderPath, req.params.id);
  res.json(db.prepare("SELECT * FROM systems WHERE id = ?").get(req.params.id));
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

  return { system: systemOut as SystemExportData["system"], sections, entries, templates };
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
    thumbnail_data?: { filename: string; mime: string; base64: string } | null;
  };
  sections: { id: number; position: number; name: string; kind: string }[];
  entries: {
    id: number;
    section_id: number;
    parent_id: number | null;
    kind: string;
    name: string;
    level: number | null;
    data: unknown;
    description: string;
    position: number;
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
export async function importSystemExport({ system, sections, entries, templates }: SystemExportData): Promise<number> {
  if (!system?.name) throw new Error("invalid export file");

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
    .prepare("INSERT INTO systems (name, description, folder_path, imported_at) VALUES (?, ?, ?, datetime('now'))")
    .run(importedName, system.description || "", folder);
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
  }
  const updateParent = db.prepare("UPDATE compendium_entries SET parent_id = ? WHERE id = ?");
  for (const e of entries ?? []) {
    if (e.parent_id == null) continue;
    const newId = entryIdMap.get(e.id);
    const newParentId = entryIdMap.get(e.parent_id);
    if (newId && newParentId) updateParent.run(newParentId, newId);
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
    insertTemplate.run(t.name, newSystemId, t.template_kind, t.template_format, t.tags || "", t.notes || "");
  }

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
  templatesAdded: number;
  templatesUpdated: number;
}

export async function updateSystemFromExport(
  targetSystemId: number,
  { system, sections, entries, templates }: SystemExportData
): Promise<SystemUpdateSummary> {
  const summary: SystemUpdateSummary = {
    sectionsAdded: 0,
    entriesAdded: 0,
    entriesUpdated: 0,
    entriesKeptLocal: 0,
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
