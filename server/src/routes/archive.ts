import { Router } from "express";
import { db } from "../db/db";
import { sweepOrphans } from "../services/orphans";
import { deleteVaultFolder } from "../services/filesystem";

export const archiveRouter = Router();

// Types whose folder on disk is entity-exclusive and should be removed on
// permanent delete. Excludes `mastering` (no folder) and `resource` (a single
// file living in a shared Resources folder — removed with its parent's folder).
const FOLDER_OWNED_TYPES = new Set([
  "campaign",
  "system",
  "setting",
  "player",
  "character",
  "session",
  "location",
  "being",
  "community",
  "artifact",
]);

interface ArchiveItem {
  type: string;
  id: number;
  title: string;
  subtitle?: string;
  archived_at: string;
}

archiveRouter.get("/", (_req, res) => {
  const items: ArchiveItem[] = [];

  const campaigns = db
    .prepare("SELECT id, name, archived_at FROM campaigns WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...campaigns.map((r) => ({ type: "campaign", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const systems = db
    .prepare("SELECT id, name, archived_at FROM systems WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...systems.map((r) => ({ type: "system", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const settings = db
    .prepare("SELECT id, name, archived_at FROM settings WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...settings.map((r) => ({ type: "setting", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const players = db
    .prepare("SELECT id, name, archived_at FROM players WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...players.map((r) => ({ type: "player", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const characters = db
    .prepare(
      "SELECT id, character_name, archived_at FROM characters WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; character_name: string; archived_at: string }[];
  items.push(
    ...characters.map((r) => ({
      type: "character",
      id: r.id,
      title: r.character_name,
      archived_at: r.archived_at,
    }))
  );

  const sessions = db
    .prepare(
      `SELECT s.id, s.date, c.name as campaign_name, s.archived_at FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.archived_at IS NOT NULL`
    )
    .all() as { id: number; date: string; campaign_name: string; archived_at: string }[];
  items.push(
    ...sessions.map((r) => ({
      type: "session",
      id: r.id,
      title: `${r.campaign_name} — ${r.date}`,
      archived_at: r.archived_at,
    }))
  );

  const resources = db
    .prepare(
      "SELECT id, name, scope, archived_at FROM resources WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; scope: string; archived_at: string }[];
  items.push(
    ...resources.map((r) => ({
      type: "resource",
      id: r.id,
      title: r.name,
      subtitle: r.scope,
      archived_at: r.archived_at,
    }))
  );

  const mastering = db
    .prepare(
      "SELECT id, title, category, archived_at FROM mastering_notes WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; title: string; category: string; archived_at: string }[];
  items.push(
    ...mastering.map((r) => ({
      type: "mastering",
      id: r.id,
      title: r.title,
      subtitle: r.category,
      archived_at: r.archived_at,
    }))
  );

  const locations = db
    .prepare(
      "SELECT id, name, kind, archived_at FROM setting_locations WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; kind: string; archived_at: string }[];
  items.push(
    ...locations.map((r) => ({
      type: "location",
      id: r.id,
      title: r.name,
      subtitle: r.kind,
      archived_at: r.archived_at,
    }))
  );

  const beings = db
    .prepare(
      "SELECT id, name, category, archived_at FROM setting_beings WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; category: string; archived_at: string }[];
  items.push(
    ...beings.map((r) => ({
      type: "being",
      id: r.id,
      title: r.name,
      subtitle: r.category,
      archived_at: r.archived_at,
    }))
  );

  const artifacts = db
    .prepare(
      "SELECT id, name, archived_at FROM artifacts WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...artifacts.map((r) => ({
      type: "artifact",
      id: r.id,
      title: r.name,
      archived_at: r.archived_at,
    }))
  );

  const communities = db
    .prepare(
      "SELECT id, name, archived_at FROM setting_communities WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...communities.map((r) => ({
      type: "community",
      id: r.id,
      title: r.name,
      archived_at: r.archived_at,
    }))
  );

  items.sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1));
  res.json(items);
});

// The one place permanent, irreversible deletion lives — uniform across every
// archivable type. Only rows that are *already archived* can be hard-deleted,
// so nothing active is ever destroyed by a stray call. Table names come from a
// fixed whitelist (never from the request), so `${table}` is injection-safe.
// FK cascades (schema.sql) drop child rows; polymorphic satellites
// (statblocks/gallery_images/important_dates) are cleaned up separately.
const ARCHIVE_TABLES: Record<string, string> = {
  campaign: "campaigns",
  system: "systems",
  setting: "settings",
  player: "players",
  character: "characters",
  session: "sessions",
  resource: "resources",
  mastering: "mastering_notes",
  location: "setting_locations",
  being: "setting_beings",
  artifact: "artifacts",
  community: "setting_communities",
};

archiveRouter.delete("/:type/:id", (req, res) => {
  const table = ARCHIVE_TABLES[req.params.type];
  if (!table) return res.status(400).json({ error: "unknown type" });

  const row = db
    .prepare(`SELECT archived_at FROM ${table} WHERE id = ?`)
    .get(req.params.id) as { archived_at: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.archived_at == null) {
    return res.status(400).json({ error: "можно удалить навсегда только из архива" });
  }

  // Grab the folder path before the row (and its nested children) are gone; the
  // recursive delete on disk happens last, after the DB is consistent.
  let folderPath: string | null = null;
  if (FOLDER_OWNED_TYPES.has(req.params.type)) {
    const withFolder = db
      .prepare(`SELECT folder_path FROM ${table} WHERE id = ?`)
      .get(req.params.id) as { folder_path: string | null } | undefined;
    folderPath = withFolder?.folder_path ?? null;
  }

  // Drop any module wrapper pointing at a system/setting we're deleting, so it
  // doesn't linger as a dangling row (its FK is ON DELETE SET NULL, not cascade).
  if (req.params.type === "system") {
    db.prepare("DELETE FROM modules WHERE system_id = ?").run(req.params.id);
  } else if (req.params.type === "setting") {
    db.prepare("DELETE FROM modules WHERE setting_id = ?").run(req.params.id);
  }
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
  // The delete above (and any FK cascade it triggered) may have removed owners
  // of polymorphic statblocks/gallery/dates — reconcile those away too.
  sweepOrphans();
  // Finally, remove the entity's folder tree on disk (nested children's folders
  // live inside it, so this one recursive delete matches the DB cascade).
  deleteVaultFolder(folderPath);
  res.json({ ok: true });
});
