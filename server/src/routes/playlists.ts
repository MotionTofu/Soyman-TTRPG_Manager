import { Router } from "express";
import { db } from "../db/db";
import { toFileUrl } from "../services/filesystem";

export const playlistsRouter = Router();

interface PlaylistRow {
  id: number;
  name: string;
  scope: "session" | "setting";
  session_id: number | null;
  setting_id: number | null;
  created_at: string;
}

function withItemCount(row: PlaylistRow) {
  const count = db
    .prepare("SELECT COUNT(*) as c FROM playlist_items WHERE playlist_id = ?")
    .get(row.id) as { c: number };
  return { ...row, item_count: count.c };
}

// scope=session&session_id=X or scope=setting&setting_id=Y — playlists owned
// by that entity. Omit both to list every playlist (used by the player's
// "Открыть плейлист" navigation menu, joined with the owning session/setting
// name so it can group them).
playlistsRouter.get("/", (req, res) => {
  const { scope, session_id, setting_id } = req.query as {
    scope?: string;
    session_id?: string;
    setting_id?: string;
  };
  if (scope === "session" && session_id) {
    const rows = db
      .prepare("SELECT * FROM playlists WHERE scope = 'session' AND session_id = ? ORDER BY created_at")
      .all(session_id) as PlaylistRow[];
    return res.json(rows.map(withItemCount));
  }
  if (scope === "setting" && setting_id) {
    const rows = db
      .prepare("SELECT * FROM playlists WHERE scope = 'setting' AND setting_id = ? ORDER BY created_at")
      .all(setting_id) as PlaylistRow[];
    return res.json(rows.map(withItemCount));
  }
  const rows = db
    .prepare(
      `SELECT p.*, s.date as session_date, c.name as campaign_name, st.name as setting_name
       FROM playlists p
       LEFT JOIN sessions s ON s.id = p.session_id
       LEFT JOIN campaigns c ON c.id = s.campaign_id
       LEFT JOIN settings st ON st.id = p.setting_id
       ORDER BY st.name, c.name, p.created_at`
    )
    .all() as (PlaylistRow & { session_date: string | null; campaign_name: string | null; setting_name: string | null })[];

  // Same batched-lookup pattern as GET /resources — one extra query for the
  // whole list, not N+1 — for the global Ресурсы library's multi-setting tags.
  const linkRows = db
    .prepare("SELECT owner_id, setting_id FROM resource_setting_links WHERE owner_type = 'playlist'")
    .all() as { owner_id: number; setting_id: number }[];
  const linksByPlaylist = new Map<number, number[]>();
  for (const l of linkRows) {
    const list = linksByPlaylist.get(l.owner_id) ?? [];
    list.push(l.setting_id);
    linksByPlaylist.set(l.owner_id, list);
  }

  res.json(
    rows.map((row) => ({ ...withItemCount(row), also_in_settings: linksByPlaylist.get(row.id) ?? [] }))
  );
});

playlistsRouter.get("/:id", (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id) as
    | PlaylistRow
    | undefined;
  if (!playlist) return res.status(404).json({ error: "not found" });
  const items = db
    .prepare(
      `SELECT pi.id, pi.position, pi.custom_name, r.id as resource_id, r.name, r.file_path, r.link_url
       FROM playlist_items pi
       JOIN resources r ON r.id = pi.resource_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.position`
    )
    .all(req.params.id) as {
    id: number;
    position: number;
    custom_name: string | null;
    resource_id: number;
    name: string;
    file_path: string | null;
    link_url: string | null;
  }[];
  res.json({
    ...playlist,
    items: items.map((it) => ({
      id: it.id,
      position: it.position,
      resource_id: it.resource_id,
      name: it.custom_name || it.name,
      resource_name: it.name,
      custom_name: it.custom_name,
      src: it.file_path ? toFileUrl(it.file_path) : it.link_url,
    })),
  });
});

// --- "Also present in this setting" tags (global Ресурсы library) ---
// Marking a playlist also-in-a-setting cascades to every one of its tracks
// (each an individual resources row) — the whole point of the feature per
// the user's request ("если отметим плейлист, то и треки тоже отмечаются").

playlistsRouter.get("/:id/settings", (req, res) => {
  const rows = db
    .prepare("SELECT setting_id FROM resource_setting_links WHERE owner_type = 'playlist' AND owner_id = ?")
    .all(req.params.id) as { setting_id: number }[];
  res.json(rows.map((r) => r.setting_id));
});

playlistsRouter.post("/:id/settings", (req, res) => {
  const { setting_id } = req.body as { setting_id?: number };
  if (!setting_id) return res.status(400).json({ error: "setting_id is required" });
  const trackIds = db
    .prepare("SELECT resource_id FROM playlist_items WHERE playlist_id = ?")
    .all(req.params.id) as { resource_id: number }[];
  const insertPlaylistLink = db.prepare(
    "INSERT OR IGNORE INTO resource_setting_links (owner_type, owner_id, setting_id) VALUES ('playlist', ?, ?)"
  );
  const insertResourceLink = db.prepare(
    "INSERT OR IGNORE INTO resource_setting_links (owner_type, owner_id, setting_id) VALUES ('resource', ?, ?)"
  );
  const tx = db.transaction(() => {
    insertPlaylistLink.run(req.params.id, setting_id);
    for (const t of trackIds) insertResourceLink.run(t.resource_id, setting_id);
  });
  tx();
  res.json({ ok: true });
});

playlistsRouter.delete("/:id/settings/:settingId", (req, res) => {
  const trackIds = db
    .prepare("SELECT resource_id FROM playlist_items WHERE playlist_id = ?")
    .all(req.params.id) as { resource_id: number }[];
  const deletePlaylistLink = db.prepare(
    "DELETE FROM resource_setting_links WHERE owner_type = 'playlist' AND owner_id = ? AND setting_id = ?"
  );
  const deleteResourceLink = db.prepare(
    "DELETE FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ? AND setting_id = ?"
  );
  const tx = db.transaction(() => {
    deletePlaylistLink.run(req.params.id, req.params.settingId);
    for (const t of trackIds) deleteResourceLink.run(t.resource_id, req.params.settingId);
  });
  tx();
  res.json({ ok: true });
});

// Must be registered before PUT /:id/items/:itemId below — Express matches
// route patterns in registration order, and "/:id/items/:itemId" matches a
// "/:id/items/reorder" request just as well (itemId="reorder"), silently
// swallowing every reorder request otherwise (see resources.ts's identical
// /reorder-before-/:id comment for the same trap).
playlistsRouter.put("/:id/items/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?");
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => upd.run(i, id, req.params.id));
  });
  tx(order ?? []);
  res.json({ ok: true });
});

// Renames a track's display in just this one playlist (custom_name), without
// touching the underlying resource — see PUT /resources/:id for the "rename
// everywhere" alternative.
playlistsRouter.put("/:id/items/:itemId", (req, res) => {
  const { custom_name } = req.body as { custom_name?: string | null };
  db.prepare("UPDATE playlist_items SET custom_name = ? WHERE id = ? AND playlist_id = ?").run(
    custom_name?.trim() || null,
    req.params.itemId,
    req.params.id
  );
  res.json({ ok: true });
});

playlistsRouter.post("/", (req, res) => {
  const { name, scope, session_id, setting_id } = req.body as {
    name?: string;
    scope?: string;
    session_id?: number;
    setting_id?: number;
  };
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (scope !== "session" && scope !== "setting") return res.status(400).json({ error: "invalid scope" });
  if (scope === "session" && !session_id) return res.status(400).json({ error: "session_id is required" });
  if (scope === "setting" && !setting_id) return res.status(400).json({ error: "setting_id is required" });
  const info = db
    .prepare("INSERT INTO playlists (name, scope, session_id, setting_id) VALUES (?, ?, ?, ?)")
    .run(name.trim(), scope, session_id ?? null, setting_id ?? null);
  res
    .status(201)
    .json(withItemCount(db.prepare("SELECT * FROM playlists WHERE id = ?").get(info.lastInsertRowid) as PlaylistRow));
});

playlistsRouter.put("/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  const row = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id) as PlaylistRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(withItemCount(row));
});

playlistsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM playlists WHERE id = ?").run(req.params.id);
  // Attachments (generic_links section='attached_playlist') pointing at a
  // now-deleted playlist just resolve to nothing on the client — no explicit
  // cleanup needed here, same as attached_resource.
  res.json({ ok: true });
});

playlistsRouter.post("/:id/items", (req, res) => {
  const { resource_id } = req.body as { resource_id?: number };
  if (!resource_id) return res.status(400).json({ error: "resource_id is required" });
  const already = db
    .prepare("SELECT id FROM playlist_items WHERE playlist_id = ? AND resource_id = ?")
    .get(req.params.id, resource_id);
  if (already) return res.status(200).json({ ok: true });
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM playlist_items WHERE playlist_id = ?")
    .get(req.params.id) as { m: number };
  db.prepare("INSERT INTO playlist_items (playlist_id, resource_id, position) VALUES (?, ?, ?)").run(
    req.params.id,
    resource_id,
    maxPos.m + 1
  );
  res.status(201).json({ ok: true });
});

playlistsRouter.delete("/:id/items/:itemId", (req, res) => {
  db.prepare("DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?").run(
    req.params.itemId,
    req.params.id
  );
  res.json({ ok: true });
});
