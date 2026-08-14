import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/db";
import {
  locationFolder,
  settingGeographyRoot,
  toFileUrl,
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
const upload = multer({ storage: multer.memoryStorage() });

function withMapUrl<T extends { map_image_path?: string | null }>(row: T) {
  return {
    ...row,
    map_image_url: row.map_image_path ? toFileUrl(row.map_image_path) : null,
  };
}

function withImageUrls<
  T extends { avatar_image_path?: string | null; thumbnail_image_path?: string | null }
>(row: T) {
  return {
    ...row,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
  };
}

function archiveDescendants(locationId: number) {
  const children = db
    .prepare("SELECT id FROM setting_locations WHERE parent_id = ? AND archived_at IS NULL")
    .all(locationId) as { id: number }[];
  for (const child of children) {
    db.prepare(
      "UPDATE setting_locations SET archived_at = datetime('now') WHERE id = ?"
    ).run(child.id);
    archiveDescendants(child.id);
  }
}

settingLocationsRouter.get("/", (req, res) => {
  const { setting_id, parent_id } = req.query as {
    setting_id?: string;
    parent_id?: string;
  };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  if (parent_id !== undefined) {
    const rows = db
      .prepare(
        parent_id === "null" || parent_id === ""
          ? "SELECT * FROM setting_locations WHERE setting_id = ? AND parent_id IS NULL AND archived_at IS NULL ORDER BY name"
          : "SELECT * FROM setting_locations WHERE setting_id = ? AND parent_id = ? AND archived_at IS NULL ORDER BY name"
      )
      .all(
        ...(parent_id === "null" || parent_id === ""
          ? [setting_id]
          : [setting_id, parent_id])
      ) as { avatar_image_path: string | null; thumbnail_image_path: string | null }[];
    return res.json(rows.map(withImageUrls));
  }
  const rows = db
    .prepare(
      "SELECT * FROM setting_locations WHERE setting_id = ? AND archived_at IS NULL ORDER BY name"
    )
    .all(setting_id) as { avatar_image_path: string | null; thumbnail_image_path: string | null }[];
  res.json(rows.map(withImageUrls));
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
    for (const r of descendantRows) {
      if (directIds.has(r.id)) continue;
      const list = locationNamesByBeing.get(r.id) ?? [];
      if (!list.includes(r.loc_name)) list.push(r.loc_name);
      locationNamesByBeing.set(r.id, list);
    }
    const dedupedRows = descendantRows.filter(
      (r, i) => !directIds.has(r.id) && descendantRows.findIndex((r2) => r2.id === r.id) === i
    );
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

settingLocationsRouter.post("/:id/important-dates", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title: string;
    recurrence: string;
    year?: number | null;
    month?: number | null;
    day: number;
  };
  if (!title || day == null) return res.status(400).json({ error: "title and day are required" });
  const info = db
    .prepare(
      `INSERT INTO important_dates (owner_type, owner_id, title, recurrence, year, month, day)
       VALUES ('location', ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, title, recurrence || "once", year ?? null, month ?? null, day);
  res.status(201).json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(info.lastInsertRowid));
});

settingLocationsRouter.put("/important-dates/:dateId", (req, res) => {
  const { title, recurrence, year, month, day } = req.body as {
    title?: string;
    recurrence?: string;
    year?: number | null;
    month?: number | null;
    day?: number;
  };
  db.prepare(
    `UPDATE important_dates SET
       title = COALESCE(?, title), recurrence = COALESCE(?, recurrence),
       year = ?, month = ?, day = COALESCE(?, day)
     WHERE id = ?`
  ).run(title ?? null, recurrence ?? null, year ?? null, month ?? null, day ?? null, req.params.dateId);
  res.json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(req.params.dateId));
});

settingLocationsRouter.delete("/important-dates/:dateId", (req, res) => {
  db.prepare("DELETE FROM important_dates WHERE id = ?").run(req.params.dateId);
  res.json({ ok: true });
});

// Habitats reverse direction: drag a being/community onto a location to
// add that location to its habitat set.
settingLocationsRouter.post("/:id/inhabitants", (req, res) => {
  const { type, id } = req.body as { type: "being" | "community"; id: number };
  if (!type || !id) return res.status(400).json({ error: "type and id are required" });
  if (type === "being") {
    db.prepare(
      "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
    ).run(id, req.params.id);
  } else if (type === "community") {
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
  if (type === "being") {
    db.prepare("DELETE FROM being_locations WHERE being_id = ? AND location_id = ?").run(
      targetId,
      req.params.id
    );
  } else if (type === "community") {
    db.prepare(
      "DELETE FROM community_locations WHERE community_id = ? AND location_id = ?"
    ).run(targetId, req.params.id);
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

  const ext = path.extname(req.file.originalname) || ".jpg";
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

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(location.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, location.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE setting_locations SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withImageUrls({ thumbnail_image_path: target }));
});

settingLocationsRouter.post("/:id/map", upload.single("file"), (req, res) => {
  const location = db
    .prepare("SELECT folder_path, map_image_path FROM setting_locations WHERE id = ?")
    .get(req.params.id) as { folder_path: string; map_image_path: string | null } | undefined;
  if (!location) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(location.folder_path, `map${ext}`);
  writeReplacingOldFile(target, req.file.buffer, location.map_image_path);

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

  const buffer = fs.readFileSync(source.map_image_path);
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

settingLocationsRouter.post("/", (req, res) => {
  const { setting_id, parent_id, name, kind } = req.body as {
    setting_id: number;
    parent_id?: number | null;
    name: string;
    kind?: string;
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });

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
  db.prepare(
    "UPDATE setting_locations SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  archiveDescendants(Number(req.params.id));
  res.json({ ok: true });
});

settingLocationsRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE setting_locations SET archived_at = NULL WHERE id = ?").run(
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_locations WHERE id = ?").get(req.params.id));
});
