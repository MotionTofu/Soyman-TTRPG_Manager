import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { VAULT_ROOT, ensureSubfolder, openInFileExplorer, sanitizeName, toFileUrl } from "../services/filesystem";
import { storeDeduped } from "../services/vaultDedup";

// Local Windows path ("C:\...") or a UNC share ("\\server\...") — the only
// kind of "folder" a link_url can point at (see client/src/resourceCategories.ts).
const LOCAL_PATH = /^[a-zA-Z]:[\\/]|^\\\\/;

// English subfolder names for uploaded files, one per resource category (see
// client/src/resourceCategories.ts) — keeps a session's "resources" folder
// organized on disk instead of one flat pile of mixed files.
const CATEGORY_SUBDIR: Record<string, string> = {
  pdf: "pdf",
  image: "images",
  audio: "audio",
  other: "other",
};

export const resourcesRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface ResourceBody {
  name: string;
  type?: string;
  scope: "global" | "campaign" | "session" | "setting" | "system";
  campaign_id?: string;
  session_id?: string;
  setting_id?: string;
  system_id?: string;
  template_kind?: string;
  template_format?: string;
  link_url?: string;
  category?: string;
  tags?: string;
  notes?: string;
}

function withFileUrl<T extends { file_path?: string | null }>(row: T) {
  return {
    ...row,
    file_url: row.file_path ? toFileUrl(row.file_path) : null,
  };
}

function resolveFolder(body: ResourceBody): string {
  if (body.scope === "campaign" && body.campaign_id) {
    const row = db
      .prepare("SELECT folder_path FROM campaigns WHERE id = ?")
      .get(body.campaign_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  if (body.scope === "session" && body.session_id) {
    const row = db
      .prepare("SELECT folder_path FROM sessions WHERE id = ?")
      .get(body.session_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "resources");
  }
  if (body.scope === "setting" && body.setting_id) {
    const row = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(body.setting_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  if (body.scope === "system" && body.system_id) {
    const row = db
      .prepare("SELECT folder_path FROM systems WHERE id = ?")
      .get(body.system_id) as { folder_path: string } | undefined;
    if (row) return ensureSubfolder(row.folder_path, "Resources");
  }
  return ensureSubfolder(VAULT_ROOT, "Resources");
}

resourcesRouter.get("/", (req, res) => {
  const { scope, campaign_id, session_id, setting_id, type, category, system_id, q } = req.query as Record<
    string,
    string | undefined
  >;
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (scope) {
    clauses.push("r.scope = @scope");
    params.scope = scope;
  }
  if (campaign_id) {
    clauses.push("r.campaign_id = @campaign_id");
    params.campaign_id = campaign_id;
  }
  if (session_id) {
    clauses.push("r.session_id = @session_id");
    params.session_id = session_id;
  }
  if (setting_id) {
    // Matches either the resource's home setting or one it was additionally
    // tagged into via resource_setting_links (see /:id/settings below).
    clauses.push(
      "(r.setting_id = @setting_id OR r.id IN (SELECT owner_id FROM resource_setting_links WHERE owner_type = 'resource' AND setting_id = @setting_id))"
    );
    params.setting_id = setting_id;
  }
  if (type) {
    clauses.push("r.type = @type");
    params.type = type;
  }
  if (category) {
    clauses.push("r.category = @category");
    params.category = category;
  }
  if (system_id) {
    clauses.push("r.system_id = @system_id");
    params.system_id = system_id;
  }
  if (q) {
    clauses.push("r.name LIKE @q");
    params.q = `%${q}%`;
  }
  clauses.push("r.archived_at IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // Only relevant when browsing without a specific setting_id (e.g. searching
  // audio across every setting for the playlist "add track" picker) — lets
  // the client show which setting a result belongs to.
  const rows = db
    .prepare(
      `SELECT r.*, sys.name as system_name, st.name as setting_name FROM resources r
       LEFT JOIN systems sys ON sys.id = r.system_id
       LEFT JOIN settings st ON st.id = r.setting_id
       ${where} ORDER BY r.position, r.name COLLATE NOCASE`
    )
    .all(params) as { id: number; file_path: string | null }[];

  // One extra query for the whole list (not N+1) to attach each resource's
  // additional setting tags, for the global Ресурсы library's multi-setting
  // membership feature.
  const linkRows = db
    .prepare("SELECT owner_id, setting_id FROM resource_setting_links WHERE owner_type = 'resource'")
    .all() as { owner_id: number; setting_id: number }[];
  const linksByResource = new Map<number, number[]>();
  for (const l of linkRows) {
    const list = linksByResource.get(l.owner_id) ?? [];
    list.push(l.setting_id);
    linksByResource.set(l.owner_id, list);
  }

  res.json(
    rows.map((row) => ({
      ...withFileUrl(row),
      also_in_settings: linksByResource.get(row.id) ?? [],
      size_bytes: row.file_path ? statSizeOrNull(row.file_path) : null,
    }))
  );
});

function statSizeOrNull(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

// --- "Also present in this setting" tags (global Ресурсы library) ---

resourcesRouter.get("/:id/settings", (req, res) => {
  const rows = db
    .prepare("SELECT setting_id FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ?")
    .all(req.params.id) as { setting_id: number }[];
  res.json(rows.map((r) => r.setting_id));
});

resourcesRouter.post("/:id/settings", (req, res) => {
  const { setting_id } = req.body as { setting_id?: number };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO resource_setting_links (owner_type, owner_id, setting_id) VALUES ('resource', ?, ?)"
  ).run(req.params.id, setting_id);
  res.json({ ok: true });
});

resourcesRouter.delete("/:id/settings/:settingId", (req, res) => {
  db.prepare(
    "DELETE FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ? AND setting_id = ?"
  ).run(req.params.id, req.params.settingId);
  res.json({ ok: true });
});

resourcesRouter.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT r.*, sys.name as system_name FROM resources r
       LEFT JOIN systems sys ON sys.id = r.system_id
       WHERE r.id = ?`
    )
    .get(req.params.id) as { file_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withFileUrl(row));
});

resourcesRouter.post("/", upload.single("file"), async (req, res) => {
  const body = req.body as ResourceBody;
  if (!body.name || !body.scope)
    return res.status(400).json({ error: "name and scope are required" });

  const folder = resolveFolder(body);
  let filePath: string | null = null;
  if (req.file) {
    const subdir = body.category ? CATEGORY_SUBDIR[body.category] : undefined;
    const targetFolder = subdir ? ensureSubfolder(folder, subdir) : folder;
    const target = path.join(targetFolder, sanitizeName(req.file.originalname));
    await storeDeduped(req.file.buffer, target);
    filePath = target;
  }

  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) as m FROM resources
       WHERE scope = ? AND campaign_id IS ? AND session_id IS ? AND setting_id IS ? AND system_id IS ?`
    )
    .get(
      body.scope,
      body.campaign_id ?? null,
      body.session_id ?? null,
      body.setting_id ?? null,
      body.system_id ?? null
    ) as { m: number };

  const info = db
    .prepare(
      `INSERT INTO resources (name, type, scope, campaign_id, session_id, setting_id, system_id, template_kind, template_format, file_path, link_url, category, tags, notes, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      body.name,
      body.type || "note",
      body.scope,
      body.campaign_id ?? null,
      body.session_id ?? null,
      body.setting_id ?? null,
      body.system_id ?? null,
      body.template_kind ?? null,
      body.template_format || "text",
      filePath,
      body.link_url || null,
      body.category ?? null,
      body.tags || "",
      body.notes || "",
      maxPos.m + 1
    );
  res
    .status(201)
    .json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }));
});

// Manual drag reorder — same "order: number[] of ids -> position = index"
// shape already used by /gallery/reorder and /playlists/:id/items/reorder.
// Not scoped server-side: the client only ever sends the ids of one
// category group within one owner, so this just persists that local order.
// Must be registered before PUT /:id or Express would match "reorder" as
// the :id param instead.
resourcesRouter.put("/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const setPos = db.prepare("UPDATE resources SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => setPos.run(i, id));
  });
  tx(order ?? []);
  res.json({ ok: true });
});

// Bulk-prepends/appends a shared prefix/suffix to the display name of
// several selected resources at once (e.g. renaming a batch of session
// handouts to "Сессия 3 - <name>").
resourcesRouter.post("/bulk-rename", (req, res) => {
  const { ids, prefix, suffix } = req.body as { ids: number[]; prefix?: string; suffix?: string };
  const getName = db.prepare("SELECT name FROM resources WHERE id = ?");
  const setName = db.prepare("UPDATE resources SET name = ? WHERE id = ?");
  const tx = db.transaction((targetIds: number[]) => {
    for (const id of targetIds) {
      const row = getName.get(id) as { name: string } | undefined;
      if (!row) continue;
      setName.run(`${prefix ?? ""}${row.name}${suffix ?? ""}`, id);
    }
  });
  tx(ids ?? []);
  res.json({ ok: true });
});

resourcesRouter.put("/:id", (req, res) => {
  const { name, type, tags, notes, system_id, template_kind, template_format, link_url, category } = req.body as {
    name?: string;
    type?: string;
    tags?: string;
    notes?: string;
    system_id?: number | null;
    template_kind?: string;
    template_format?: string;
    link_url?: string;
    category?: string;
  };
  db.prepare(
    `UPDATE resources SET
       name = COALESCE(?, name), type = COALESCE(?, type),
       tags = COALESCE(?, tags), notes = COALESCE(?, notes),
       system_id = COALESCE(?, system_id), template_kind = COALESCE(?, template_kind),
       template_format = COALESCE(?, template_format),
       link_url = COALESCE(?, link_url),
       category = COALESCE(?, category)
     WHERE id = ?`
  ).run(
    name ?? null,
    type ?? null,
    tags ?? null,
    notes ?? null,
    system_id ?? null,
    template_kind ?? null,
    template_format ?? null,
    link_url ?? null,
    category ?? null,
    req.params.id
  );
  res.json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id) as { file_path: string | null }));
});

// Reveals the resource's file (or, for a "folder" link, the folder itself) in
// the OS file explorer. Runs on the same machine as the vault, so shelling
// out locally is safe here — this is a desktop tool, not a public server.
resourcesRouter.post("/:id/reveal", (req, res) => {
  const row = db
    .prepare("SELECT file_path, link_url, category FROM resources WHERE id = ?")
    .get(req.params.id) as { file_path: string | null; link_url: string | null; category: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  const target =
    row.file_path || (row.category === "folder" && row.link_url && LOCAL_PATH.test(row.link_url) ? row.link_url : null);
  if (!target) return res.status(400).json({ error: "no local path to reveal" });

  openInFileExplorer(target, !!row.file_path);
  res.json({ ok: true });
});

// Avoids silently overwriting an unrelated same-named file in the target
// folder — appends "-2", "-3", … before the extension until free.
function uniqueTargetPath(folder: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(folder, filename);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(folder, `${base}-${n}${ext}`);
  }
  return candidate;
}

// Promotes a resource (typically session-scoped) up to setting scope, so it
// can be attached to other sessions instead of re-uploaded — copies the row
// and, if present, the physical file; the two rows are independent
// afterwards (editing/deleting one doesn't affect the other), same as the
// setting-calendar → campaign-calendar copy pattern elsewhere in this app.
resourcesRouter.post("/:id/promote", async (req, res) => {
  const { setting_id } = req.body as { setting_id?: number };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });

  const source = db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id) as
    | {
        name: string;
        type: string;
        category: string | null;
        file_path: string | null;
        link_url: string | null;
        tags: string;
        notes: string;
      }
    | undefined;
  if (!source) return res.status(404).json({ error: "not found" });

  const folder = resolveFolder({ scope: "setting", setting_id: String(setting_id) } as ResourceBody);
  let filePath: string | null = null;
  if (source.file_path && fs.existsSync(source.file_path)) {
    const subdir = source.category ? CATEGORY_SUBDIR[source.category] : undefined;
    const targetFolder = subdir ? ensureSubfolder(folder, subdir) : folder;
    const target = uniqueTargetPath(targetFolder, path.basename(source.file_path));
    await storeDeduped(fs.readFileSync(source.file_path), target);
    filePath = target;
  }

  const info = db
    .prepare(
      `INSERT INTO resources (name, type, scope, setting_id, template_format, file_path, link_url, category, tags, notes)
       VALUES (?, ?, 'setting', ?, 'text', ?, ?, ?, ?, ?)`
    )
    .run(source.name, source.type, setting_id, filePath, source.link_url, source.category, source.tags, source.notes);

  // Tracks that this source resource was already promoted, so the client can
  // grey out the "В сеттинг" button instead of letting it be promoted again —
  // and re-enable it if the promoted copy is later archived/deleted.
  db.prepare(
    `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
     VALUES ('resource', ?, 'resource', ?, 'promoted_to_setting')`
  ).run(req.params.id, info.lastInsertRowid);

  res
    .status(201)
    .json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }));
});

// Attaches a location's map image to a session as an ordinary image
// resource — same dedup-copy approach as /:id/promote above, since a map
// isn't itself a `resources` row (it lives on `setting_locations`).
resourcesRouter.post("/from-location-map", async (req, res) => {
  const { location_id, session_id } = req.body as { location_id?: number; session_id?: number };
  if (!location_id || !session_id) return res.status(400).json({ error: "location_id and session_id are required" });

  const location = db
    .prepare("SELECT name, map_image_path FROM setting_locations WHERE id = ?")
    .get(location_id) as { name: string; map_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "location not found" });
  if (!location.map_image_path) return res.status(400).json({ error: "location has no map" });

  const folder = resolveFolder({ scope: "session", session_id: String(session_id) } as ResourceBody);
  const targetFolder = ensureSubfolder(folder, CATEGORY_SUBDIR.image);
  const target = uniqueTargetPath(targetFolder, path.basename(location.map_image_path));
  await storeDeduped(fs.readFileSync(location.map_image_path), target);

  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) as m FROM resources WHERE scope = 'session' AND session_id = ?`
    )
    .get(session_id) as { m: number };

  const info = db
    .prepare(
      `INSERT INTO resources (name, type, scope, session_id, template_format, file_path, category, position)
       VALUES (?, 'file', 'session', ?, 'text', ?, 'image', ?)`
    )
    .run(`Карта: ${location.name}`, session_id, target, maxPos.m + 1);

  res
    .status(201)
    .json(withFileUrl(db.prepare("SELECT * FROM resources WHERE id = ?").get(info.lastInsertRowid) as { file_path: string | null }));
});

resourcesRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE resources SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});

resourcesRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE resources SET archived_at = NULL WHERE id = ?").run(req.params.id);
  res.json(db.prepare("SELECT * FROM resources WHERE id = ?").get(req.params.id));
});
