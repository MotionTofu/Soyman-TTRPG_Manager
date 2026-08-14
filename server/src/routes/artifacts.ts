import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { artifactFolder, sanitizeName, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";
import { storeDeduped } from "../services/vaultDedup";

export const artifactsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Имя владельца и локации подставляются к строке предмета: сами по себе
// owner_type/owner_id ничего не говорят ни списку, ни профилю.
function withRefs<T extends Record<string, unknown>>(row: T) {
  const locationId = row.location_id as number | null;
  const ownerType = row.owner_type as string | null;
  const ownerId = row.owner_id as number | null;
  const location = locationId
    ? (db.prepare("SELECT id, name FROM setting_locations WHERE id = ?").get(locationId) as
        | { id: number; name: string }
        | undefined)
    : undefined;
  let ownerEntity: { type: string; id: number; name: string } | null = null;
  if (ownerType && ownerId) {
    const table = ownerType === "community" ? "setting_communities" : "setting_beings";
    const found = db.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(ownerId) as
      | { id: number; name: string }
      | undefined;
    if (found) ownerEntity = { type: ownerType, id: found.id, name: found.name };
  }
  return {
    ...row,
    location: location ?? null,
    owner_entity: ownerEntity,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path as string) : null,
  };
}

artifactsRouter.get("/", (req, res) => {
  const { setting_id } = req.query as { setting_id?: string };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const rows = db
    .prepare(
      "SELECT * FROM artifacts WHERE setting_id = ? AND archived_at IS NULL ORDER BY name"
    )
    .all(setting_id) as Record<string, unknown>[];
  res.json(rows.map(withRefs));
});

// Записи компендиумов, соответствующие этому предмету: «Кольцо защиты разума»
// приключения и «Кольцо защиты разума [Ring of Mind Shielding]» системы — одна
// вещь с двух сторон. Как и у существ, связь многие-ко-многим: один город
// водится сразу под две системы.
function getCompendiumLinks(artifactId: string | number) {
  return db
    .prepare(
      `SELECT ce.id, ce.name, ce.system_id, sy.name as system_name
       FROM artifact_compendium_links acl
       JOIN compendium_entries ce ON ce.id = acl.compendium_entry_id
       LEFT JOIN systems sy ON sy.id = ce.system_id
       WHERE acl.artifact_id = ? ORDER BY sy.name, ce.name`
    )
    .all(artifactId);
}

artifactsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  const chapters = db
    .prepare("SELECT * FROM artifact_chapters WHERE artifact_id = ? ORDER BY created_at")
    .all(req.params.id);
  res.json({ ...withRefs(row), chapters, compendium_links: getCompendiumLinks(req.params.id) });
});

artifactsRouter.post("/:id/compendium-links", (req, res) => {
  const { compendium_entry_id } = req.body as { compendium_entry_id?: number };
  if (!compendium_entry_id) return res.status(400).json({ error: "compendium_entry_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO artifact_compendium_links (artifact_id, compendium_entry_id) VALUES (?, ?)"
  ).run(req.params.id, compendium_entry_id);
  res.json(getCompendiumLinks(req.params.id));
});

artifactsRouter.delete("/:id/compendium-links/:entryId", (req, res) => {
  db.prepare(
    "DELETE FROM artifact_compendium_links WHERE artifact_id = ? AND compendium_entry_id = ?"
  ).run(req.params.id, req.params.entryId);
  res.json(getCompendiumLinks(req.params.id));
});

artifactsRouter.post("/", upload.single("file"), async (req, res) => {
  const {
    setting_id, name, owner, power, history, notes, item_class, item_type, rarity,
    requires_attunement,
    location_id, owner_type, owner_id, short_name, aliases, name_original, description,
  } = req.body as {
    setting_id: string;
    name: string;
    owner?: string;
    power?: string;
    history?: string;
    notes?: string;
    item_class?: string;
    item_type?: string;
    rarity?: string;
    requires_attunement?: string;
    // Визард создаёт предмет одним запросом, поэтому здесь принимается всё,
    // что он успел собрать по шагам, а не только имя.
    location_id?: number | null;
    owner_type?: string | null;
    owner_id?: number | null;
    short_name?: string;
    aliases?: string[];
    name_original?: string;
    description?: string;
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });
  const setting = db
    .prepare("SELECT folder_path FROM settings WHERE id = ?")
    .get(setting_id) as { folder_path: string } | undefined;
  if (!setting) return res.status(404).json({ error: "setting not found" });
  const folder = artifactFolder(setting.folder_path, name);

  let filePath: string | null = null;
  if (req.file) {
    const target = path.join(folder, sanitizeName(req.file.originalname));
    await storeDeduped(req.file.buffer, target);
    filePath = target;
  }

  const info = db
    .prepare(
      `INSERT INTO artifacts (setting_id, name, description, owner, power, history, notes, item_class, item_type, rarity, requires_attunement, location_id, owner_type, owner_id, short_name, aliases, name_original, file_path, folder_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      setting_id,
      name,
      description ?? "",
      owner ?? "",
      power ?? "",
      history ?? "",
      notes ?? "",
      item_class ?? null,
      item_type ?? null,
      rarity ?? null,
      requires_attunement ? 1 : 0,
      location_id ?? null,
      owner_type ?? null,
      owner_id ?? null,
      short_name ?? null,
      aliases ? JSON.stringify(aliases) : "[]",
      name_original ?? "",
      filePath,
      folder
    );
  res
    .status(201)
    .json(
      withRefs(
        db.prepare("SELECT * FROM artifacts WHERE id = ?").get(info.lastInsertRowid) as Record<
          string,
          unknown
        >
      )
    );
});

artifactsRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });

  const {
    name, owner, power, history, notes, short_name, item_class, item_type, rarity,
    requires_attunement, name_original, description,
  } = req.body as Record<string, string | boolean | undefined>;
  const { aliases, location_id, owner_type, owner_id } = req.body as {
    aliases?: string[];
    location_id?: number | null;
    owner_type?: string | null;
    owner_id?: number | null;
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name as string);
  }
  db.prepare(
    `UPDATE artifacts SET
       name = COALESCE(?, name), owner = COALESCE(?, owner),
       description = COALESCE(?, description),
       power = COALESCE(?, power), history = COALESCE(?, history),
       notes = COALESCE(?, notes),
       short_name = CASE WHEN ? THEN ? ELSE short_name END,
       item_class = CASE WHEN ? THEN ? ELSE item_class END,
       item_type = CASE WHEN ? THEN ? ELSE item_type END,
       rarity = CASE WHEN ? THEN ? ELSE rarity END,
       requires_attunement = CASE WHEN ? THEN ? ELSE requires_attunement END,
       aliases = COALESCE(?, aliases),
       name_original = COALESCE(?, name_original),
       location_id = CASE WHEN ? THEN ? ELSE location_id END,
       owner_type = CASE WHEN ? THEN ? ELSE owner_type END,
       owner_id = CASE WHEN ? THEN ? ELSE owner_id END,
       folder_path = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    owner ?? null,
    description ?? null,
    power ?? null,
    history ?? null,
    notes ?? null,
    short_name !== undefined ? 1 : 0,
    short_name ?? null,
    item_class !== undefined ? 1 : 0,
    (item_class as string | undefined) ?? null,
    item_type !== undefined ? 1 : 0,
    item_type ?? null,
    rarity !== undefined ? 1 : 0,
    rarity ?? null,
    requires_attunement !== undefined ? 1 : 0,
    requires_attunement ? 1 : 0,
    aliases ? JSON.stringify(aliases) : null,
    (name_original as string | undefined) ?? null,
    location_id !== undefined ? 1 : 0,
    location_id ?? null,
    owner_type !== undefined ? 1 : 0,
    owner_type ?? null,
    owner_id !== undefined ? 1 : 0,
    owner_id ?? null,
    folderPath,
    req.params.id
  );
  res.json(
    withRefs(
      db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id) as Record<
        string,
        unknown
      >
    )
  );
});

// Аватарка предмета — как у остальных сущностей: уменьшенная картинка для
// списков и карточек, отдельно от вложенного файла (file_path).
artifactsRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const artifact = db
    .prepare("SELECT folder_path, avatar_image_path FROM artifacts WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!artifact) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(artifact.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, artifact.avatar_image_path, "avatar");

  db.prepare("UPDATE artifacts SET avatar_image_path = ? WHERE id = ?").run(target, req.params.id);
  res.json({ avatar_image_url: toFileUrl(target) });
});

artifactsRouter.post("/:id/chapters", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  const info = db
    .prepare("INSERT INTO artifact_chapters (artifact_id, title, content) VALUES (?, ?, ?)")
    .run(req.params.id, title ?? "", content ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM artifact_chapters WHERE id = ?").get(info.lastInsertRowid));
});

artifactsRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE artifact_chapters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.chapterId);
  res.json(db.prepare("SELECT * FROM artifact_chapters WHERE id = ?").get(req.params.chapterId));
});

artifactsRouter.delete("/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM artifact_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
});

artifactsRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE artifacts SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

artifactsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE artifacts SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.id));
});
