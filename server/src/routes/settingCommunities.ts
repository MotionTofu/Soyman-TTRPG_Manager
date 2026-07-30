import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { communityFolder, locationFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { renameEntityFolder } from "../services/vaultPaths";
import { withAvatarUrl } from "./settingBeings";

export const settingCommunitiesRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function withThumbUrl<
  T extends {
    thumbnail_image_path?: string | null;
    avatar_image_path?: string | null;
    tags?: string | string[];
  }
>(row: T) {
  return {
    ...row,
    thumbnail_image_url: row.thumbnail_image_path ? toFileUrl(row.thumbnail_image_path) : null,
    avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null,
    tags: parseTags(row.tags),
  };
}

function parseTags(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function archiveDescendants(communityId: number) {
  const children = db
    .prepare("SELECT id FROM setting_communities WHERE parent_id = ? AND archived_at IS NULL")
    .all(communityId) as { id: number }[];
  for (const child of children) {
    db.prepare(
      "UPDATE setting_communities SET archived_at = datetime('now') WHERE id = ?"
    ).run(child.id);
    archiveDescendants(child.id);
  }
}

settingCommunitiesRouter.get("/", (req, res) => {
  const { setting_id, parent_id } = req.query as { setting_id?: string; parent_id?: string };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const rows =
    parent_id === undefined
      ? db
          .prepare(
            "SELECT * FROM setting_communities WHERE setting_id = ? AND archived_at IS NULL ORDER BY name"
          )
          .all(setting_id)
      : db
          .prepare(
            parent_id === "null" || parent_id === ""
              ? "SELECT * FROM setting_communities WHERE setting_id = ? AND parent_id IS NULL AND archived_at IS NULL ORDER BY name"
              : "SELECT * FROM setting_communities WHERE setting_id = ? AND parent_id = ? AND archived_at IS NULL ORDER BY name"
          )
          .all(
            ...(parent_id === "null" || parent_id === "" ? [setting_id] : [setting_id, parent_id])
          );
  res.json((rows as { thumbnail_image_path: string | null }[]).map(withThumbUrl));
});

settingCommunitiesRouter.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM setting_communities WHERE id = ?")
    .get(req.params.id) as { parent_id: number | null; thumbnail_image_path: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });

  const children = db
    .prepare(
      "SELECT * FROM setting_communities WHERE parent_id = ? AND archived_at IS NULL ORDER BY name"
    )
    .all(req.params.id);

  const ancestors: { id: number; name: string }[] = [];
  let currentParentId = row.parent_id;
  while (currentParentId) {
    const parent = db
      .prepare("SELECT id, name, parent_id FROM setting_communities WHERE id = ?")
      .get(currentParentId) as { id: number; name: string; parent_id: number | null } | undefined;
    if (!parent) break;
    ancestors.unshift({ id: parent.id, name: parent.name });
    currentParentId = parent.parent_id;
  }

  // Members of this community AND all its descendants — membership in a
  // sub-community (e.g. "Салионцы") implies membership in the parent
  // ("Сандарцы"), so the parent's roster shows everyone underneath it too.
  const members = (
    db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM setting_communities WHERE id = ?
           UNION ALL
           SELECT sc.id FROM setting_communities sc JOIN descendants d ON sc.parent_id = d.id
         )
         SELECT DISTINCT b.* FROM being_communities bc
         JOIN setting_beings b ON b.id = bc.being_id
         WHERE bc.community_id IN (SELECT id FROM descendants) AND b.archived_at IS NULL
         ORDER BY b.name`
      )
      .all(req.params.id) as { avatar_image_path: string | null; thumbnail_image_path: string | null; tags: string }[]
  ).map(withAvatarUrl);

  const chapters = db
    .prepare("SELECT * FROM community_chapters WHERE community_id = ? ORDER BY created_at")
    .all(req.params.id);

  const locations = db
    .prepare(
      `SELECT l.id, l.name FROM community_locations cl
       JOIN setting_locations l ON l.id = cl.location_id
       WHERE cl.community_id = ? AND l.archived_at IS NULL ORDER BY l.name`
    )
    .all(req.params.id);

  const importantDates = db
    .prepare("SELECT * FROM important_dates WHERE owner_type = 'community' AND owner_id = ? ORDER BY created_at")
    .all(req.params.id);

  res.json({ ...withThumbUrl(row), children, ancestors, members, chapters, locations, important_dates: importantDates });
});

settingCommunitiesRouter.post("/:id/thumbnail", upload.single("file"), async (req, res) => {
  const community = db
    .prepare("SELECT folder_path, thumbnail_image_path FROM setting_communities WHERE id = ?")
    .get(req.params.id) as { folder_path: string; thumbnail_image_path: string | null } | undefined;
  if (!community) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(community.folder_path, `thumbnail${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, community.thumbnail_image_path, "thumbnail");

  db.prepare("UPDATE setting_communities SET thumbnail_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withThumbUrl({ thumbnail_image_path: target }));
});

settingCommunitiesRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const community = db
    .prepare("SELECT folder_path, avatar_image_path FROM setting_communities WHERE id = ?")
    .get(req.params.id) as { folder_path: string; avatar_image_path: string | null } | undefined;
  if (!community) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(community.folder_path, `avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, community.avatar_image_path, "avatar");

  db.prepare("UPDATE setting_communities SET avatar_image_path = ? WHERE id = ?").run(
    target,
    req.params.id
  );
  res.json(withThumbUrl({ avatar_image_path: target }));
});

settingCommunitiesRouter.post("/:id/chapters", (req, res) => {
  const { section, title, content } = req.body as {
    section?: string;
    title?: string;
    content?: string;
  };
  const info = db
    .prepare(
      "INSERT INTO community_chapters (community_id, section, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(req.params.id, section ?? "", title ?? "", content ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM community_chapters WHERE id = ?").get(info.lastInsertRowid));
});

settingCommunitiesRouter.put("/chapters/:chapterId", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE community_chapters SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.chapterId);
  res.json(
    db.prepare("SELECT * FROM community_chapters WHERE id = ?").get(req.params.chapterId)
  );
});

settingCommunitiesRouter.delete("/chapters/:chapterId", (req, res) => {
  db.prepare("DELETE FROM community_chapters WHERE id = ?").run(req.params.chapterId);
  res.json({ ok: true });
});

settingCommunitiesRouter.post("/", (req, res) => {
  const { setting_id, parent_id, name, description, tags } = req.body as {
    setting_id: number;
    parent_id?: number | null;
    name: string;
    description?: string;
    tags?: string[];
  };
  if (!setting_id || !name)
    return res.status(400).json({ error: "setting_id and name are required" });

  let folder: string;
  if (parent_id) {
    const parent = db
      .prepare("SELECT folder_path FROM setting_communities WHERE id = ?")
      .get(parent_id) as { folder_path: string } | undefined;
    if (!parent) return res.status(404).json({ error: "parent community not found" });
    folder = locationFolder(parent.folder_path, name);
  } else {
    const setting = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(setting_id) as { folder_path: string } | undefined;
    if (!setting) return res.status(404).json({ error: "setting not found" });
    folder = communityFolder(setting.folder_path, name);
  }

  const info = db
    .prepare(
      "INSERT INTO setting_communities (setting_id, parent_id, name, description, folder_path, tags) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(setting_id, parent_id ?? null, name, description ?? "", folder, JSON.stringify(tags ?? []));
  res
    .status(201)
    .json(db.prepare("SELECT * FROM setting_communities WHERE id = ?").get(info.lastInsertRowid));
});

settingCommunitiesRouter.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM setting_communities WHERE id = ?")
    .get(req.params.id) as { folder_path: string; name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "not found" });
  const { name, description, history, current_situation, features, goals, tags } = req.body as {
    name?: string;
    description?: string;
    history?: string;
    current_situation?: string;
    features?: string;
    goals?: string;
    tags?: string[];
  };
  let folderPath = existing.folder_path;
  if (name && name !== existing.name) {
    folderPath = renameEntityFolder(existing.folder_path, name);
  }
  db.prepare(
    `UPDATE setting_communities SET
       name = COALESCE(?, name), description = COALESCE(?, description),
       history = COALESCE(?, history), current_situation = COALESCE(?, current_situation),
       features = COALESCE(?, features), goals = COALESCE(?, goals),
       tags = COALESCE(?, tags),
       folder_path = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    description ?? null,
    history ?? null,
    current_situation ?? null,
    features ?? null,
    goals ?? null,
    tags ? JSON.stringify(tags) : null,
    folderPath,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_communities WHERE id = ?").get(req.params.id));
});

settingCommunitiesRouter.post("/:id/members", (req, res) => {
  const { being_id } = req.body as { being_id: number };
  if (!being_id) return res.status(400).json({ error: "being_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO being_communities (being_id, community_id) VALUES (?, ?)"
  ).run(being_id, req.params.id);
  const members = db
    .prepare(
      `SELECT b.* FROM being_communities bc
       JOIN setting_beings b ON b.id = bc.being_id
       WHERE bc.community_id = ? AND b.archived_at IS NULL ORDER BY b.name`
    )
    .all(req.params.id);
  res.json(members);
});

settingCommunitiesRouter.delete("/:id/members/:beingId", (req, res) => {
  db.prepare(
    "DELETE FROM being_communities WHERE community_id = ? AND being_id = ?"
  ).run(req.params.id, req.params.beingId);
  res.json({ ok: true });
});

// Habitats ("Места обитания") — a community can be based in several locations.
settingCommunitiesRouter.post("/:id/locations", (req, res) => {
  const { location_id } = req.body as { location_id: number };
  if (!location_id) return res.status(400).json({ error: "location_id is required" });
  db.prepare(
    "INSERT OR IGNORE INTO community_locations (community_id, location_id) VALUES (?, ?)"
  ).run(req.params.id, location_id);
  const locations = db
    .prepare(
      `SELECT l.id, l.name FROM community_locations cl
       JOIN setting_locations l ON l.id = cl.location_id
       WHERE cl.community_id = ? ORDER BY l.name`
    )
    .all(req.params.id);
  res.json(locations);
});

settingCommunitiesRouter.delete("/:id/locations/:locationId", (req, res) => {
  db.prepare(
    "DELETE FROM community_locations WHERE community_id = ? AND location_id = ?"
  ).run(req.params.id, req.params.locationId);
  res.json({ ok: true });
});

// Important dates ("Важные даты")
settingCommunitiesRouter.post("/:id/important-dates", (req, res) => {
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
       VALUES ('community', ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, title, recurrence || "once", year ?? null, month ?? null, day);
  res.status(201).json(db.prepare("SELECT * FROM important_dates WHERE id = ?").get(info.lastInsertRowid));
});

settingCommunitiesRouter.put("/important-dates/:dateId", (req, res) => {
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

settingCommunitiesRouter.delete("/important-dates/:dateId", (req, res) => {
  db.prepare("DELETE FROM important_dates WHERE id = ?").run(req.params.dateId);
  res.json({ ok: true });
});

settingCommunitiesRouter.delete("/:id", (req, res) => {
  db.prepare(
    "UPDATE setting_communities SET archived_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  archiveDescendants(Number(req.params.id));
  res.json({ ok: true });
});

settingCommunitiesRouter.put("/:id/restore", (req, res) => {
  db.prepare("UPDATE setting_communities SET archived_at = NULL WHERE id = ?").run(
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM setting_communities WHERE id = ?").get(req.params.id));
});
