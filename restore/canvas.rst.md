diff --git a/server/src/routes/canvas.ts b/server/src/routes/canvas.ts
index efd8d90..5ca8d9f 100644
--- a/server/src/routes/canvas.ts
+++ b/server/src/routes/canvas.ts
@@ -8,9 +8,13 @@ import {
   CONSEQUENCE_SECTION,
   setLinkQty,
 } from "../story/cast";
-import { toFileUrl } from "../services/filesystem";
+import { SCENE_SOUND_SECTION } from "../story/stage";
+import multer from "multer";
+import path from "path";
+import { ensureSubfolder, toFileUrl, VAULT_ROOT, writeReplacingOldFile } from "../services/filesystem";
 
 export const canvasRouter = Router();
+const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
 
 // ┬л╨Я╨╛╨╗╨╛╤В╨╜╨╛┬╗ тАФ ╤Г╨╖╨╗╨╛╨▓╨╛╨╣ ╤А╨╡╨┤╨░╨║╤В╨╛╤А. ╨Я╨╡╤А╨▓╤Л╨╣ ╨▓╨╕╨┤ ╤Е╨╛╨╗╤Б╤В╨░: ╨╛╨┤╨╜╨╛ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡, ╨╡╨│╨╛
 // ╤Б╤Ж╨╡╨╜╤Л ╨╜╨╛╨┤╨░╨╝╨╕ ╨╕ ╨┐╨╡╤А╨╡╤Е╨╛╨┤╤Л ╨╝╨╡╨╢╨┤╤Г ╨╜╨╕╨╝╨╕ ╤А╤С╨▒╤А╨░╨╝╨╕.
@@ -20,12 +24,12 @@ export const canvasRouter = Router();
 // ╤В╨╛╨╗╤М╨║╨╛ ╤А╨░╤Б╨║╨╗╨░╨┤╨║╨░ (canvas_boards/canvas_nodes) ╨╕ ╨╛╨┤╨╕╨╜ ╤Б╨▓╨╛╨┤╨╜╤Л╨╣ ╨╛╤В╨▓╨╡╤В, ╤З╤В╨╛╨▒╤Л
 // ╨╛╤В╨║╤А╤Л╤В╨╕╨╡ ╤Е╨╛╨╗╤Б╤В╨░ ╨╜╨╡ ╨┐╤А╨╡╨▓╤А╨░╤Й╨░╨╗╨╛╤Б╤М ╨▓ ╨┐╤П╤В╤М ╨╖╨░╨┐╤А╨╛╤Б╨╛╨▓ ╨┐╨╛╨┤╤А╤П╨┤.
 
-type ScopeType = "arc";
+type ScopeType = "arc" | "setting" | "campaign";
 
 /** ╨а╨╡╨▒╤А╨╛ ╤Е╨╛╨╗╤Б╤В╨░ ╨▓ ╤В╨╛╨╝ ╨▓╨╕╨┤╨╡, ╨▓ ╨║╨░╨║╨╛╨╝ ╨╡╨│╨╛ ╨╢╨┤╤С╤В ╨║╨╗╨╕╨╡╨╜╤В. */
 interface EdgeOut {
   id: string;
-  kind: "transition" | "outcome" | "cast" | "member";
+  kind: "transition" | "outcome" | "cast" | "member" | "check";
   source: string;
   target: string;
   target_handle: string;
@@ -48,6 +52,7 @@ interface SceneRow {
   in_library: number;
   name: string;
   kind: string;
+  summary: string;
   position: number;
 }
 
@@ -122,7 +127,7 @@ const ENTITY_NODES: Record<string, { table: string; nameCol: string; thumbCol?:
     kindCol: "category",
   },
   location: { table: "setting_locations", nameCol: "name", thumbCol: "thumbnail_image_path" },
-  artifact: { table: "artifacts", nameCol: "name", thumbCol: "thumbnail_image_path" },
+  artifact: { table: "artifacts", nameCol: "name", thumbCol: "avatar_image_path" },
   community: { table: "setting_communities", nameCol: "name", thumbCol: "thumbnail_image_path" },
   compendium_entry: { table: "compendium_entries", nameCol: "name", kindCol: "kind" },
   // ╨б╨╛╨▒╤Л╤В╨╕╤П ╤Е╤А╨╛╨╜╨╕╨║╨╕ ╨╝╨╕╤А╨░ ╨╕ ╤А╨░╤Б╨┐╨╕╤Б╨░╨╜╨╕╤П ╨║╨░╨╝╨┐╨░╨╜╨╕╨╕ тАФ ╤В╨╛╨╢╨╡ ╨╜╨╛╨┤╤Л: ╤Б╨▓╤П╨╖╤М ┬л╤Н╤В╨░ ╤Б╤Ж╨╡╨╜╨░
@@ -130,6 +135,8 @@ const ENTITY_NODES: Record<string, { table: string; nameCol: string; thumbCol?:
   // ╨┐╨╡╤А╨╡╨╢╨╕╨▓╨░╨╡╤В ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜╨╕╨╡.
   setting_event: { table: "setting_calendar_events", nameCol: "title" },
   campaign_event: { table: "campaign_calendar_events", nameCol: "title" },
+  sound_set: { table: "sound_sets", nameCol: "name" },
+  playlist: { table: "playlists", nameCol: "name" },
 };
 
 interface PlacedNode {
@@ -248,6 +255,32 @@ function entityNodes(boardId: number, placed: PlacedNode[]) {
         };
       }
 
+      if (p.node_type === "sound_set") {
+        const row = db.prepare("SELECT name, battle_playlist_id FROM sound_sets WHERE id = ?").get(p.node_id) as { name: string; battle_playlist_id: number | null } | undefined;
+        if (!row) return null;
+        return {
+          key: `sound_set:${p.node_id}`,
+          node_type: "sound_set",
+          node_id: p.node_id,
+          x: p.x,
+          y: p.y,
+          placed: true,
+          sound_set: { id: p.node_id, name: row.name, battle_playlist_id: row.battle_playlist_id },
+        };
+      }
+      if (p.node_type === "playlist") {
+        const row = db.prepare("SELECT name FROM playlists WHERE id = ?").get(p.node_id) as { name: string } | undefined;
+        if (!row) return null;
+        return {
+          key: `playlist:${p.node_id}`,
+          node_type: "playlist",
+          node_id: p.node_id,
+          x: p.x,
+          y: p.y,
+          placed: true,
+          playlist: { id: p.node_id, name: row.name },
+        };
+      }
       const spec = ENTITY_NODES[p.node_type];
       if (!spec) return null;
       const row = db
@@ -357,7 +390,123 @@ function detachBundle(bundleId: number): number {
 }
 
 canvasRouter.get("/board", (req, res) => {
-  const { arc_id, campaign_id } = req.query as { arc_id?: string; campaign_id?: string };
+  const { arc_id, setting_id, campaign_id, free_id } = req.query as { arc_id?: string; setting_id?: string; campaign_id?: string; free_id?: string };
+
+  // ╨д╤А╨╕╤Д╨╛╤А╨╝-╨┤╨╛╤Б╨║╨░ ╨▓╨╜╨╡ ╤Б╨╡╤В╤В╨╕╨╜╨│╨╛╨▓ (Q1 ╨░, ┬з5 ╨Я╨╛╨╗╨╛╤В╨╜╨╛)
+  if (free_id) {
+    const freeId = Number(free_id);
+    const board = db.prepare("SELECT id, name FROM canvas_boards WHERE scope_type='free' AND scope_id=?").get(freeId) as { id: number; name: string } | undefined;
+    if (!board) return res.status(404).json({ error: "not found" });
+    const saved = db.prepare("SELECT node_type, node_id, x, y, z_index FROM canvas_nodes WHERE board_id=?").all(board.id) as { node_type: string; node_id: number; x: number; y: number; z_index: number }[];
+    // ╤Б╤В╨╕╨║╨╡╤А╤Л ╨╕ ╨║╨░╤А╤В╨╕╨╜╨║╨╕ тАФ ╨╛╤В╨┤╨╡╨╗╤М╨╜╤Л╨╡ ╤В╨░╨▒╨╗╨╕╤Ж╤Л, ╨╜╨╛ ╨╜╨░ ╨║╨╗╨╕╨╡╨╜╤В╨╡ ╨║╨░╨║ ╨╜╨╛╨┤╤Л
+    const stickers = db.prepare("SELECT id, text, name, note, color FROM canvas_stickers WHERE board_id=?").all(board.id) as { id: number; text: string; name: string; note: string; color: string }[];
+    const images = db.prepare("SELECT id, file_path, w, h FROM canvas_images WHERE board_id=?").all(board.id) as { id: number; file_path: string; w: number; h: number }[];
+    const frames = db.prepare("SELECT id, name, color, x, y, w, h FROM canvas_frames WHERE board_id=?").all(board.id) as { id: number; name: string; color: string; x: number; y: number; w: number; h: number }[];
+    const stickerNodes = stickers.map((s) => {
+      const pos = saved.find((p) => p.node_type === "sticker" && p.node_id === s.id) ?? { x: 0, y: 0, z_index: 0 };
+      return { key: `sticker:${s.id}`, node_type: "sticker" as const, node_id: s.id, x: pos.x, y: pos.y, z_index: pos.z_index, placed: !!saved.find((p) => p.node_type === "sticker" && p.node_id === s.id), sticker: { id: s.id, text: s.text, name: s.name || s.text, note: s.note, color: s.color } };
+    });
+    const imageNodes = images.map((im) => {
+      const pos = saved.find((p) => p.node_type === "image" && p.node_id === im.id) ?? { x: 0, y: 0, z_index: 0 };
+      return { key: `image:${im.id}`, node_type: "image" as const, node_id: im.id, x: pos.x, y: pos.y, z_index: pos.z_index, placed: !!saved.find((p) => p.node_type === "image" && p.node_id === im.id), image: { id: im.id, file_url: toFileUrl(im.file_path), w: im.w, h: im.h } };
+    });
+    const frameNodes = frames.map((f) => {
+      const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y, z_index: 0 };
+      return { key: `frame:${f.id}`, node_type: "frame" as const, node_id: f.id, x: pos.x ?? f.x, y: pos.y ?? f.y, z_index: pos.z_index, placed: true, frame: { id: f.id, name: f.name, color: f.color, w: f.w, h: f.h } };
+    });
+    // ╨░╨▓╤В╨╛-╤А╨░╤Б╤И╨╕╤А╨╡╨╜╨╕╨╡ ╤Д╤А╨╕╤Д╨╛╤А╨╝ ╤А╨░╨╝╨╛╨║: ╨╡╤Б╨╗╨╕ ╨▓╨╜╤Г╤В╤А╨╕ ╨╡╤Б╤В╤М ╤Г╨╖╨╗╤Л, ╨▓╤Л╤Е╨╛╨┤╤П╤Й╨╕╨╡ ╨╖╨░ ╨│╤А╨░╨╜╨╕╤Ж╤Г тАФ ╤А╨░╤Б╤В╤П╨│╨╕╨▓╨░╨╡╨╝
+    for (const f of frames) {
+      const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y };
+      const fx = pos.x ?? f.x;
+      const fy = pos.y ?? f.y;
+      const allNodesForFrame = [...stickerNodes, ...imageNodes, ...entityNodes(board.id, saved as never)];
+      // ╨╜╨░╤Е╨╛╨┤╨╕╨╝ ╤Г╨╖╨╗╤Л, ╤З╨╡╨╣ ╨╗╨╡╨▓╤Л╨╣-╨▓╨╡╤А╤Е╨╜╨╕╨╣ ╤Г╨│╨╛╨╗ ╨▓╨╜╤Г╤В╤А╨╕ ╤А╨░╨╝╨║╨╕ (╨║╨░╨║ ╨▓ ╨║╨╗╨╕╨╡╨╜╤В╨╡)
+      const inside = allNodesForFrame.filter((nn) => {
+        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { x: number; y: number };
+        const x = (p as unknown as { x: number }).x ?? (nn as unknown as { x: number }).x;
+        const y = (p as unknown as { y: number }).y ?? (nn as unknown as { y: number }).y;
+        return x >= fx && y >= fy && x <= fx + f.w && y <= fy + f.h;
+      });
+      if (inside.length === 0) continue;
+      // ╤А╨░╨╖╨╝╨╡╤А╤Л ╤Г╨╖╨╗╨╛╨▓ ╨┤╨╗╤П ╤А╨░╤Б╤З╤С╤В╨░ ╨┐╤А╨░╨▓╨╛╨╣/╨╜╨╕╨╢╨╜╨╡╨╣ ╨│╤А╨░╨╜╨╕╤Ж╤Л
+      const getW = (nn: unknown) => {
+        const t = (nn as { node_type?: string }).node_type;
+        if (t === "sticker") return 320;
+        if (t === "image") return 320;
+        return 200;
+      };
+      const getH = (nn: unknown) => {
+        const t = (nn as { node_type?: string }).node_type;
+        if (t === "sticker") return 120;
+        if (t === "image") return 240;
+        return 124;
+      };
+      const maxX = Math.max(...inside.map((nn) => {
+        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { x: number };
+        const x = (p as unknown as { x: number }).x ?? (nn as unknown as { x: number }).x;
+        return x + getW(nn);
+      }));
+      const maxY = Math.max(...inside.map((nn) => {
+        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { y: number };
+        const y = (p as unknown as { y: number }).y ?? (nn as unknown as { y: number }).y;
+        return y + getH(nn);
+      }));
+      const needW = Math.max(f.w, maxX - fx + 16);
+      const needH = Math.max(f.h, maxY - fy + 16);
+      if (needW !== f.w || needH !== f.h) {
+        db.prepare("UPDATE canvas_frames SET w = ?, h = ? WHERE id = ?").run(needW, needH, f.id);
+        f.w = needW;
+        f.h = needH;
+        // ╤В╨░╨║╨╢╨╡ ╨╛╨▒╨╜╨╛╨▓╨╗╤П╨╡╨╝ frameNodes ╨┤╨╗╤П ╨╛╤В╨▓╨╡╤В╨░
+        const fn = frameNodes.find((n) => n.node_id === f.id);
+        if (fn) fn.frame.w = needW, fn.frame.h = needH;
+      }
+    }
+    return res.json({ board_id: board.id, free: { id: freeId, name: board.name }, campaign_id: null, nodes: [...stickerNodes, ...imageNodes, ...frameNodes, ...entityNodes(board.id, saved as never)], groups: [], edges: [] });
+  }
+
+  // ╨б╨╡╤В╤В╨╕╨╜╨│-╤Е╨╛╨╗╤Б╤В: ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П ╨║╨░╨║ ╨╜╨╛╨┤╤Л (Q2, Q5 ╨▒, Q6)
+  if (setting_id && !arc_id && !campaign_id) {
+    const settingId = Number(setting_id);
+    const setting = db.prepare("SELECT id, name FROM settings WHERE id = ?").get(settingId) as { id: number; name: string } | undefined;
+    if (!setting) return res.status(404).json({ error: "not found" });
+    const boardId = ensureBoard("setting", settingId);
+    const saved = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(boardId) as { node_type: string; node_id: number; x: number; y: number }[];
+    const savedByKey = new Map(saved.map((n) => [`${n.node_type}:${n.node_id}`, n]));
+    const adventures = db.prepare(`SELECT id, name, setting_id, position FROM story_arcs WHERE setting_id = ? AND parent_id IS NULL AND archived_at IS NULL AND is_default = 0 ORDER BY position, id`).all(settingId) as { id: number; name: string; setting_id: number; position: number }[];
+    const nodes = adventures.map((a, i) => {
+      const placed = savedByKey.get(`adventure:${a.id}`);
+      const pos = placed ?? defaultPosition(i, 0);
+      return { key: `adventure:${a.id}`, node_type: "adventure" as const, node_id: a.id, x: pos.x, y: pos.y, placed: !!placed, adventure: { id: a.id, name: a.name } };
+    });
+    const arcIds = adventures.map((a) => a.id);
+    const arcTransitions = arcIds.length
+      ? (db
+          .prepare(`SELECT id, from_arc_id, to_arc_id, label FROM story_arc_transitions WHERE from_arc_id IN (${arcIds.map(() => "?").join(",")}) AND to_arc_id IN (${arcIds.map(() => "?").join(",")})`)
+          .all(...arcIds, ...arcIds) as { id: number; from_arc_id: number; to_arc_id: number; label: string }[])
+      : [];
+    const edges: EdgeOut[] = arcTransitions.map((t) => ({
+      id: `arc_transition:${t.id}`,
+      kind: "transition" as const,
+      source: `adventure:${t.from_arc_id}`,
+      target: `adventure:${t.to_arc_id}`,
+      target_handle: "story",
+      label: t.label,
+    }));
+    return res.json({ board_id: boardId, setting: { id: setting.id, name: setting.name }, campaign_id: null, nodes: [...nodes, ...entityNodes(boardId, saved as never)], groups: [], edges });
+  }
+
+  // ╨б╨▒╨╛╤А╨║╨░ ╨║╨░╨╝╨┐╨░╨╜╨╕╨╕: ╤Б╤Ж╨╡╨╜╤Л ╨▓╤Б╨╡╤Е ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╣ ╨║╨░╨╝╨┐╨░╨╜╨╕╨╕ (Q3) тАФ ╨┐╨╛╨║╨░ ╨╖╨░╨│╨╗╤Г╤И╨║╨░, ╨╢╨╕╨▓╤С╤В ╨▓ ╤В╨╛╨╝ ╨╢╨╡ ╤Б╨║╨╛╨┐╨╡
+  if (campaign_id && !arc_id) {
+    const campId = Number(campaign_id);
+    const camp = db.prepare("SELECT id, setting_id, name FROM campaigns WHERE id = ?").get(campId) as { id: number; setting_id: number | null; name: string } | undefined;
+    if (!camp) return res.status(404).json({ error: "not found" });
+    const boardId = ensureBoard("campaign", campId);
+    const saved = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(boardId) as { node_type: string; node_id: number; x: number; y: number }[];
+    // ╨┐╨╛╨║╨░ ╨┐╤Г╤Б╤В╨╛╨╣ тАФ ╤Б╨▒╨╛╤А╨║╨░ ╨╖╨░╨┐╨╛╨╗╨╜╨╕╤В╤Б╤П ╤Б╤Ж╨╡╨╜╨░╨╝╨╕ ╤З╨╡╤А╨╡╨╖ ╨┐╨░╨╗╨╕╤В╤А╤Г, ╨║╨░╨║ ╨╕ ╨░╤А╨║-╤Е╨╛╨╗╤Б╤В, ╨╜╨╛ ╨▒╨╡╨╖ arc-╤А╨░╨╝╨╛╨║
+    return res.json({ board_id: boardId, campaign: { id: camp.id, name: camp.name, setting_id: camp.setting_id }, campaign_id: campId, nodes: [...entityNodes(boardId, saved as never)], groups: [], edges: [] });
+  }
+
   if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
 
   const arcId = Number(arc_id);
@@ -413,8 +562,8 @@ canvasRouter.get("/board", (req, res) => {
 
   const boardId = ensureBoard("arc", arcId);
   const saved = db
-    .prepare("SELECT id, node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?")
-    .all(boardId) as { id: number; node_type: string; node_id: number; x: number; y: number }[];
+    .prepare("SELECT id, node_type, node_id, x, y, z_index FROM canvas_nodes WHERE board_id = ?")
+    .all(boardId) as { id: number; node_type: string; node_id: number; x: number; y: number; z_index: number }[];
   const savedByKey = new Map(saved.map((n) => [`${n.node_type}:${n.node_id}`, n]));
 
   // ╨Я╨╛╨╖╨╕╤Ж╨╕╤П ╨╜╨╛╨┤╤Л ╨╕╤Й╨╡╤В╤Б╤П ╨╕ ╨┐╨╛ ╨┐╨╛╨║╨░╨╖╨░╨╜╨╜╨╛╨╣ ╤Б╤Ж╨╡╨╜╨╡, ╨╕ ╨┐╨╛ ╨╡╤С ╨╛╤А╨╕╨│╨╕╨╜╨░╨╗╤Г: ╨║╨╛╨┐╨╕╤П
@@ -438,12 +587,12 @@ canvasRouter.get("/board", (req, res) => {
   const savedGroups = new Map(
     (
       db
-        .prepare("SELECT arc_id, x, y, w, h FROM canvas_groups WHERE board_id = ?")
-        .all(boardId) as { arc_id: number; x: number; y: number; w: number; h: number }[]
+        .prepare("SELECT arc_id, color, x, y, w, h FROM canvas_groups WHERE board_id = ?")
+        .all(boardId) as { arc_id: number; color: string; x: number; y: number; w: number; h: number }[]
     ).map((g) => [g.arc_id, g])
   );
   const newGroup = db.prepare(
-    "INSERT OR IGNORE INTO canvas_groups (board_id, arc_id, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?)"
+    "INSERT OR IGNORE INTO canvas_groups (board_id, arc_id, color, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)"
   );
   const fitGroup = db.prepare(
     "UPDATE canvas_groups SET x = ?, y = ?, w = ?, h = ? WHERE board_id = ? AND arc_id = ?"
@@ -466,7 +615,7 @@ canvasRouter.get("/board", (req, res) => {
 
   const groups = chapters.map((ch) => {
     const kept = savedGroups.get(ch.id);
-    if (kept) return { arc_id: ch.id, name: ch.name, x: kept.x, y: kept.y, w: kept.w, h: kept.h };
+    if (kept) return { arc_id: ch.id, name: ch.name, color: kept.color, x: kept.x, y: kept.y, w: kept.w, h: kept.h };
     const rows = Math.max(1, Math.ceil((unplacedByArc.get(ch.id) ?? 0) / COLS));
     const fresh = {
       x: 0,
@@ -475,8 +624,8 @@ canvasRouter.get("/board", (req, res) => {
       h: FRAME_HEAD + rows * ROW_H + FRAME_PAD,
     };
     frontier += fresh.h + GAP;
-    newGroup.run(boardId, ch.id, fresh.x, fresh.y, fresh.w, fresh.h);
-    return { arc_id: ch.id, name: ch.name, ...fresh };
+    newGroup.run(boardId, ch.id, "#2C3E50", fresh.x, fresh.y, fresh.w, fresh.h);
+    return { arc_id: ch.id, name: ch.name, color: "#2C3E50", ...fresh };
   });
   const groupByArc = new Map(groups.map((g) => [g.arc_id, g]));
 
@@ -518,6 +667,7 @@ canvasRouter.get("/board", (req, res) => {
         id: s.id,
         name: shown.name,
         kind: shown.kind,
+        summary: shown.summary ?? s.summary ?? "",
         arc_id: s.arc_id,
         is_override: s.campaign_id != null && s.source_scene_id != null,
         campaign_only: s.campaign_id != null && s.source_scene_id == null,
@@ -557,6 +707,61 @@ canvasRouter.get("/board", (req, res) => {
   });
 
   const lookup = [...shownByContent.keys()];
+
+  // ╨Я╤А╨╛╨▓╨╡╤А╨║╨╕ ╤Б╤Ж╨╡╨╜ тАФ ╨╛╤В╨┤╨╡╨╗╤М╨╜╤Л╨╡ ╨╜╨╛╨┤╤Л ╤Б╨┐╤А╨░╨▓╨░ ╨╛╤В ╤Б╤Ж╨╡╨╜╤Л (╤А╨╡╤И╨╡╨╜╨╕╨╡ Q1 ╨░, Q5 ╨░).
+  // ╨Я╨╛╨╖╨╕╤Ж╨╕╤П ╤Б╨┐╤А╨░╨▓╨░ +240, ╤Б╤В╨╛╨┐╨║╨╛╨╣ +90, ╨╡╤Б╨╗╨╕ ╨╜╨╡ ╨┤╨▓╨╕╨│╨░╨╗╨╕ тАФ default, ╨╕╨╜╨░╤З╨╡ ╨╕╨╖ canvas_nodes.
+  const checkRows = lookup.length
+    ? (db
+        .prepare(
+          `SELECT c.id, c.scene_id, c.what, c.difficulty FROM story_scene_checks c
+           WHERE c.scene_id IN (${lookup.map(() => "?").join(",")})
+           ORDER BY c.position, c.id`
+        )
+        .all(...lookup) as { id: number; scene_id: number; what: string; difficulty: string }[])
+    : [];
+  const savedCheckPos = new Map(
+    saved.filter((p) => p.node_type === "check").map((p) => [p.node_id, p] as const)
+  );
+  // ╨║╨░╤А╤В╨░ ╨┐╨╛╨╖╨╕╤Ж╨╕╨╣ ╤Б╤Ж╨╡╨╜ ╨┤╨╗╤П ╨┤╨╡╤Д╨╛╨╗╤В╨░ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╕
+  const scenePosById = new Map<number, { x: number; y: number }>();
+  nodes.forEach((n) => scenePosById.set(n.node_id, { x: n.x, y: n.y }));
+  const checkIndexByScene = new Map<number, number>();
+  const checkNodes = checkRows.map((ch) => {
+    const savedPos = savedCheckPos.get(ch.id);
+    let pos: { x: number; y: number };
+    let placed = false;
+    if (savedPos) {
+      pos = { x: savedPos.x, y: savedPos.y };
+      placed = true;
+    } else {
+      const base = scenePosById.get(ch.scene_id) ?? { x: 0, y: 0 };
+      const idx = checkIndexByScene.get(ch.scene_id) ?? 0;
+      checkIndexByScene.set(ch.scene_id, idx + 1);
+      pos = { x: base.x + 240, y: base.y + idx * 90 };
+    }
+    // ╨╕╤Б╤Е╨╛╨┤╤Л ╨┤╨╗╤П ╤Н╤В╨╛╨╣ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╕ тАФ ╤Е╨╡╨╜╨┤╨╗╤Л ╨╜╨░ ╨╜╨╛╨┤╨╡
+    const outs = db
+      .prepare(
+        `SELECT id, label, consequence, target_type, target_id FROM story_check_outcomes WHERE check_id = ? ORDER BY position, id`
+      )
+      .all(ch.id) as { id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[];
+    return {
+      key: `check:${ch.id}`,
+      node_type: "check" as const,
+      node_id: ch.id,
+      x: pos.x,
+      y: pos.y,
+      placed,
+      check: {
+        id: ch.id,
+        scene_id: ch.scene_id,
+        what: ch.what,
+        difficulty: ch.difficulty,
+        outcomes: outs,
+      },
+    };
+  });
+
   const transitions = lookup.length
     ? (db
         .prepare(
@@ -572,13 +777,12 @@ canvasRouter.get("/board", (req, res) => {
       }[])
     : [];
 
-  // ╨Ш╤Б╤Е╨╛╨┤╤Л ╨┐╤А╨╛╨▓╨╡╤А╨╛╨║, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╨▓╨╡╨┤╤Г╤В ╨▓ ╨┤╤А╤Г╨│╤Г╤О ╤Б╤Ж╨╡╨╜╤Г. ╨а╨░╨┤╨╕ ╨╜╨╕╤Е ╤Е╨╛╨╗╤Б╤В ╨╕ ╤А╨╕╤Б╤Г╨╡╤В╤Б╤П:
-  // ╨▓╨╡╤В╨▓╨╗╨╡╨╜╨╕╨╡ ╨┐╨╛╨┤╨╖╨╡╨╝╨╡╨╗╤М╤П ╨╖╨░╨┤╨░╤С╤В╤Б╤П ╨▓ ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╝ ╨┐╤А╨╛╨▓╨╡╤А╨║╨░╨╝╨╕, ╨░ ╨╜╨╡ ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨░╨╝╨╕, ╨╕
-  // ╨▒╨╡╨╖ ╤Н╤В╨╕╤Е ╤А╤С╨▒╨╡╤А ╤Б╤Е╨╡╨╝╨░ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╨░ ╨▒╤Л ╨┐╨╛╨╗╨╛╨▓╨╕╨╜╤Г ╨╕╤Б╤В╨╛╤А╨╕╨╕.
+  // ╨Ш╤Б╤Е╨╛╨┤╤Л тАФ ╤В╨╡╨┐╨╡╤А╤М ╨╛╤В check-╨╜╨╛╨┤╤Л ╨║ scene, ╨┐╨╛╨┤╨┐╨╕╤Б╤М ╨▓ ╤З╨╕╨┐-╤А╨░╨╝╨║╨╡ (Q2, Q7 ╨░).
+  // ╨Ф╨╗╤П ╨╛╨▒╤А╨░╤В╨╜╨╛╨╣ ╤Б╨╛╨▓╨╝╨╡╤Б╤В╨╕╨╝╨╛╤Б╤В╨╕ ╤Б╤Ж╨╡╨╜╤Л-╨╕╤Б╤Е╨╛╨┤╤Л ╨▒╨╡╨╖ check-╨╜╨╛╨┤╤Л ╨╜╨╡ ╤А╨╕╤Б╤Г╨╡╨╝ тАФ check-╨╜╨╛╨┤╨░ ╤Г╨╢╨╡ ╨╡╤Б╤В╤М.
   const outcomes = lookup.length
     ? (db
         .prepare(
-          `SELECT o.id, o.label, o.target_id, c.scene_id AS from_scene_id, c.what
+          `SELECT o.id, o.label, o.target_id, c.id AS check_id, c.scene_id AS from_scene_id, c.what
            FROM story_check_outcomes o
            JOIN story_scene_checks c ON c.id = o.check_id
            WHERE o.target_type = 'scene' AND o.target_id IS NOT NULL
@@ -589,6 +793,7 @@ canvasRouter.get("/board", (req, res) => {
         id: number;
         label: string;
         target_id: number;
+        check_id: number;
         from_scene_id: number;
         what: string;
       }[])
@@ -602,7 +807,19 @@ canvasRouter.get("/board", (req, res) => {
   // ╨║╨░╨╢╨┤╤Л╨╣ ╨╛╤В ╤Б╨▓╨╛╨╡╨╣ ╨╡╨┤╨╕╨╜╨╕╤Ж╤Л. ╨Р ╨╜╨╛╨┤╨░-╨╜╨░╤З╨░╨╗╨╛ ╨╜╤Г╨╢╨╜╨░ ╨┐╨╛╤В╨╛╨╝╤Г, ╤З╤В╨╛ ╨╛╨┤╨╜╨░ ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨░
   // ╨╝╨╛╨╢╨╡╤В ╤Б╤В╨╛╤П╤В╤М ╨▓ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╕ ╨┤╨▓╨░╨╢╨┤╤Л: ╨╡╤С ╨┐╨╡╤А╨╡╤Е╨╛╨┤ ╨┤╨░╤С╤В ╤В╨╛╨│╨┤╨░ ╨┤╨▓╨░ ╤А╨╡╨▒╤А╨░, ╨╕ ╨▒╨╡╨╖
   // ╤В╤А╨╡╤В╤М╨╡╨╣ ╤З╨░╤Б╤В╨╕ ╨║╨╗╤О╤З ╤Г ╨╜╨╕╤Е ╨▒╤Л╨╗ ╨▒╤Л ╨╛╨▒╤Й╨╕╨╝ тАФ React Flow ╨╛╤Б╤В╨░╨▓╨╕╨╗ ╨▒╤Л ╨╛╨┤╨╜╨╛.
+  const sceneCheckEdges = checkRows.flatMap((ch) =>
+    (shownByContent.get(ch.scene_id) ?? []).map((shownId) => ({
+      id: `scene_check:${ch.id}:${shownId}`,
+      kind: "check" as const,
+      source: `scene:${shownId}`,
+      target: `check:${ch.id}`,
+      target_handle: "story",
+      label: "",
+    }))
+  );
+
   const storyEdges = [
+    ...sceneCheckEdges,
     ...transitions.flatMap((t) =>
       (shownByContent.get(t.from_scene_id) ?? []).map((fromId) => ({
         id: `transition:${t.id}:${fromId}`,
@@ -613,16 +830,14 @@ canvasRouter.get("/board", (req, res) => {
         label: t.label,
       }))
     ),
-    ...outcomes.flatMap((o) =>
-      (shownByContent.get(o.from_scene_id) ?? []).map((fromId) => ({
-        id: `outcome:${o.id}:${fromId}`,
-        kind: "outcome" as const,
-        source: `scene:${fromId}`,
-        target: sceneKey(shownBySource.get(o.target_id)),
-        target_handle: "story",
-        label: o.what ? `${o.what} тАФ ${o.label}` : o.label,
-      }))
-    ),
+    ...outcomes.map((o) => ({
+      id: `outcome:${o.id}:check:${o.check_id}`,
+      kind: "outcome" as const,
+      source: `check:${o.check_id}`,
+      target: sceneKey(shownBySource.get(o.target_id)),
+      target_handle: "story",
+      label: o.what ? `${o.what} тАФ ${o.label}` : o.label,
+    })),
   ].flatMap((e): EdgeOut[] => (e.target == null ? [] : [{ ...e, target: e.target }]));
 
   // ╨а╤С╨▒╤А╨░ ╤Б╨╛╤Б╤В╨░╨▓╨░: ╤Б╤Г╤Й╨╜╨╛╤Б╤В╤М ╨Т╨в╨Х╨Ъ╨Р╨Х╨в ╨▓ ╤Б╤Ж╨╡╨╜╤Г, ╨░ ╨╜╨╡ ╨╜╨░╨╛╨▒╨╛╤А╨╛╤В. ╨б╤Ж╨╡╨╜╨░ ╤Б╨╛╨▒╨╕╤А╨░╨╡╤В╤Б╤П
@@ -642,12 +857,12 @@ canvasRouter.get("/board", (req, res) => {
           `SELECT l.id, l.from_id AS scene_id, l.to_type, l.to_id, l.section,
                   IFNULL(c.qty, '') AS qty
            FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
-           WHERE l.from_type = 'scene' AND l.section IN (${[...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION]
+           WHERE l.from_type = 'scene' AND l.section IN (${[...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, SCENE_SOUND_SECTION]
              .map(() => "?")
              .join(",")})
              AND l.from_id IN (${lookup.map(() => "?").join(",")})`
         )
-        .all(...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, ...lookup) as {
+        .all(...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, SCENE_SOUND_SECTION, ...lookup) as {
         id: number;
         scene_id: number;
         to_type: string;
@@ -665,6 +880,8 @@ canvasRouter.get("/board", (req, res) => {
     // ╤В╨░╨║╨╕╨╝ ╨╜╨░╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╨╡╨╝, ╨╕ ╤А╨╕╤Б╨╛╨▓╨░╤В╤М ╨╡╤С ╨║╨░╨║ ╨╛╤Б╤В╨░╨╗╤М╨╜╤Л╨╡ ╨╖╨╜╨░╤З╨╕╨╗╨╛ ╨▒╤Л ╤Б╨║╨░╨╖╨░╤В╤М, ╤З╤В╨╛
     // ╤Б╤Ж╨╡╨╜╨░ ╤Б╨╛╨▒╤А╨░╨╜╨░ ╨╕╨╖ ╨┐╨░╨┤╨╡╨╜╨╕╤П ╨║╤А╨╡╨┐╨╛╤Б╤В╨╕.
     const isConsequence = row.section === CONSEQUENCE_SECTION;
+    const isSound = row.section === SCENE_SOUND_SECTION;
+    const isBattle = row.section === "scene_battle";
     // ╨в╨░ ╨╢╨╡ ╨╛╨│╨╛╨▓╨╛╤А╨║╨░, ╤З╤В╨╛ ╤Г ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╛╨▓: ╨╛╨┤╨╜╨░ ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨░ ╨╝╨╛╨╢╨╡╤В ╤Б╤В╨╛╤П╤В╤М ╨▓
     // ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╕ ╨┤╨▓╨░╨╢╨┤╤Л, ╨╕ ╨╡╤С ╤Б╨╛╤Б╤В╨░╨▓ ╤А╨╕╤Б╤Г╨╡╤В╤Б╤П ╨╛╤В ╨╛╨▒╨╡╨╕╤Е ╨▓╤Б╤В╨░╨▓╨╛╨║.
     return (shownByContent.get(row.scene_id) ?? []).map((sceneId) => ({
@@ -672,10 +889,7 @@ canvasRouter.get("/board", (req, res) => {
       kind: "cast" as const,
       source: isConsequence ? `scene:${sceneId}` : entityKey,
       target: isConsequence ? entityKey : `scene:${sceneId}`,
-      target_handle: isConsequence ? "in" : CAST_ROLE_BY_SECTION[row.section] ?? "participants",
-      // ╨Ъ╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨╛ ╨┐╨╛╨┤╨┐╨╕╤Б╤М╤О ╨╜╨░ ╤А╨╡╨▒╤А╨╡: ╨╜╨░ ╨╜╨╛╨┤╨╡ ╨╛╨╜╨╛ ╤Б╨╛╨▓╤А╨░╨╗╨╛ ╨▒╤Л тАФ ╨│╨╛╨▒╨╗╨╕╨╜ ╨╛╨┤╨╕╨╜, ╨░
-      // ╤Б╤Ж╨╡╨╜ ╤Г ╨╜╨╡╨│╨╛ ╤В╤А╨╕, ╨╕ ╨▓ ╨║╨░╨╢╨┤╨╛╨╣ ╨╕╤Е ╤А╨░╨╖╨╜╨╛╨╡ ╤З╨╕╤Б╨╗╨╛. ╨Я╤Г╤Б╤В╨╛╨╡ ╨╜╨╡ ╨┐╨╛╨┤╨┐╨╕╤Б╤Л╨▓╨░╨╡╨╝:
-      // ┬л╨╛╨┤╨╕╨╜┬╗ ╤Н╤В╨╛ ╤Г╨╝╨╛╨╗╤З╨░╨╜╨╕╨╡.
+      target_handle: isConsequence ? "in" : isSound ? "audio" : isBattle ? "battle" : CAST_ROLE_BY_SECTION[row.section] ?? "participants",
       label: row.qty,
     }));
   });
@@ -740,16 +954,197 @@ canvasRouter.get("/board", (req, res) => {
     }
   }
 
+  // ╤Б╤В╨╕╨║╨╡╤А╤Л/╨║╨░╤А╤В╨╕╨╜╨║╨╕ ╨╕ ╨╜╨░ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╤З╨╡╤Б╨║╨╛╨╝ ╤Е╨╛╨╗╤Б╤В╨╡ (Q5, Q6)
+  const stickersArc = db.prepare("SELECT id, text, name, note, color FROM canvas_stickers WHERE board_id=?").all(boardId) as { id: number; text: string; name: string; note: string; color: string }[];
+  const imagesArc = db.prepare("SELECT id, file_path, w, h FROM canvas_images WHERE board_id=?").all(boardId) as { id: number; file_path: string; w: number; h: number }[];
+  const stickerNodesArc = stickersArc.map((s) => {
+    const pos = saved.find((p) => p.node_type === "sticker" && p.node_id === s.id) ?? { x: 0, y: 0 };
+    return { key: `sticker:${s.id}`, node_type: "sticker" as const, node_id: s.id, x: pos.x, y: pos.y, placed: !!saved.find((p) => p.node_type === "sticker" && p.node_id === s.id), sticker: { id: s.id, text: s.text, name: s.name || s.text, note: s.note, color: s.color } };
+  });
+  const imageNodesArc = imagesArc.map((im) => {
+    const pos = saved.find((p) => p.node_type === "image" && p.node_id === im.id) ?? { x: 0, y: 0 };
+    return { key: `image:${im.id}`, node_type: "image" as const, node_id: im.id, x: pos.x, y: pos.y, placed: !!saved.find((p) => p.node_type === "image" && p.node_id === im.id), image: { id: im.id, file_url: toFileUrl(im.file_path), w: im.w, h: im.h } };
+  });
+  const framesArc = db.prepare("SELECT id, name, color, x, y, w, h FROM canvas_frames WHERE board_id=?").all(boardId) as { id: number; name: string; color: string; x: number; y: number; w: number; h: number }[];
+  const frameNodesArc = framesArc.map((f) => {
+    const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y };
+    return { key: `frame:${f.id}`, node_type: "frame" as const, node_id: f.id, x: pos.x ?? f.x, y: pos.y ?? f.y, placed: true, frame: { id: f.id, name: f.name, color: f.color, w: f.w, h: f.h } };
+  });
+
   res.json({
     board_id: boardId,
     arc: { id: arc.id, name: arc.name, setting_id: arc.setting_id },
     campaign_id: campaignId,
-    nodes: [...nodes, ...entityNodes(boardId, saved)],
+    nodes: [...nodes, ...checkNodes, ...stickerNodesArc, ...imageNodesArc, ...frameNodesArc, ...entityNodes(boardId, saved)],
     groups,
     edges,
   });
 });
 
+// ╨д╤А╨╕╤Д╨╛╤А╨╝-╨┤╨╛╤Б╨║╨╕ ╨▓╨╜╨╡ ╤Б╨╡╤В╤В╨╕╨╜╨│╨╛╨▓ (Q1 ╨░, ┬з5)
+canvasRouter.get("/free-boards", (_req, res) => {
+  // ╤З╨╕╤Б╤В╨╕╨╝ ╨▒╨╕╤В╤Л╨╡ ╨╜╨╛╨┤╤Л (╤Б╤В╨╕╨║╨╡╤А/╨║╨░╤А╤В╨╕╨╜╨║╤Г ╤Г╨┤╨░╨╗╨╕╨╗╨╕, ╨░ canvas_nodes ╨╛╤Б╤В╨░╨╗╤Б╤П) тАФ ╨╕╨╜╨░╤З╨╡ ╤Б╤З╤С╤В╤З╨╕╨║ ╨▓╤А╤С╤В
+  db.prepare("DELETE FROM canvas_nodes WHERE node_type='sticker' AND node_id NOT IN (SELECT id FROM canvas_stickers)").run();
+  db.prepare("DELETE FROM canvas_nodes WHERE node_type='image' AND node_id NOT IN (SELECT id FROM canvas_images)").run();
+  db.prepare("DELETE FROM canvas_nodes WHERE node_type='frame' AND node_id NOT IN (SELECT id FROM canvas_frames)").run();
+  const rows = db.prepare(
+    `SELECT id, scope_id, name, created_at,
+      (
+        (SELECT count(*) FROM canvas_stickers WHERE board_id=canvas_boards.id) +
+        (SELECT count(*) FROM canvas_images WHERE board_id=canvas_boards.id) +
+        (SELECT count(*) FROM canvas_frames WHERE board_id=canvas_boards.id) +
+        (SELECT count(*) FROM canvas_nodes WHERE board_id=canvas_boards.id AND node_type NOT IN ('sticker','image','frame'))
+      ) as nodes
+     FROM canvas_boards WHERE scope_type='free' ORDER BY created_at DESC`
+  ).all();
+  res.json(rows);
+});
+canvasRouter.post("/free-boards", (req, res) => {
+  const name = String(req.body?.name ?? "╨Ф╨╛╤Б╨║╨░").trim() || "╨Ф╨╛╤Б╨║╨░";
+  const info = db.prepare("INSERT INTO canvas_boards (scope_type, scope_id, name) VALUES ('free', 0, ?)").run(name);
+  const id = Number(info.lastInsertRowid);
+  db.prepare("UPDATE canvas_boards SET scope_id=? WHERE id=?").run(id, id);
+  res.status(201).json({ id, scope_id: id, name });
+});
+canvasRouter.put("/free-boards/:id", (req, res) => {
+  const name = String(req.body?.name ?? "").trim();
+  if (!name) return res.status(400).json({ error: "name required" });
+  db.prepare("UPDATE canvas_boards SET name=? WHERE scope_type='free' AND scope_id=?").run(name, Number(req.params.id));
+  res.json({ ok: true });
+});
+canvasRouter.delete("/free-boards/:id", (req, res) => {
+  db.prepare("DELETE FROM canvas_boards WHERE scope_type='free' AND scope_id=?").run(Number(req.params.id));
+  res.json({ ok: true });
+});
+
+// ╨б╤В╨╕╨║╨╡╤А╤Л (Q5) тАФ name + note ╤Б MentionTextarea
+canvasRouter.post("/stickers", (req, res) => {
+  const { board_id, text, name, note, color, x, y } = req.body as { board_id?: number; text?: string; name?: string; note?: string; color?: string; x?: number; y?: number };
+  if (!board_id) return res.status(400).json({ error: "board_id required" });
+  const n = name ?? text ?? "";
+  const nt = note ?? "";
+  const info = db.prepare("INSERT INTO canvas_stickers (board_id, text, name, note, color) VALUES (?,?,?,?,?)").run(board_id, text ?? n, n, nt, color ?? "paper");
+  const sid = Number(info.lastInsertRowid);
+  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "sticker", sid, Number(x) || 0, Number(y) || 0);
+  res.status(201).json({ id: sid });
+});
+canvasRouter.put("/stickers/:id", (req, res) => {
+  const { text, name, note, color } = req.body as { text?: string; name?: string; note?: string; color?: string };
+  if (text !== undefined) db.prepare("UPDATE canvas_stickers SET text=?, name=? WHERE id=?").run(text, text, Number(req.params.id));
+  if (name !== undefined) db.prepare("UPDATE canvas_stickers SET name=? WHERE id=?").run(name, Number(req.params.id));
+  if (note !== undefined) db.prepare("UPDATE canvas_stickers SET note=? WHERE id=?").run(note, Number(req.params.id));
+  if (color !== undefined) db.prepare("UPDATE canvas_stickers SET color=? WHERE id=?").run(color, Number(req.params.id));
+  res.json({ ok: true });
+});
+canvasRouter.get("/stickers", (req, res) => {
+  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
+  const rows = board_id ? db.prepare("SELECT * FROM canvas_stickers WHERE board_id=?").all(board_id) : db.prepare("SELECT * FROM canvas_stickers").all();
+  res.json(rows);
+});
+canvasRouter.get("/stickers/:id", (req, res) => {
+  const row = db.prepare("SELECT * FROM canvas_stickers WHERE id=?").get(Number(req.params.id));
+  if (!row) return res.status(404).json({ error: "not found" });
+  res.json(row);
+});
+// ╨а╨░╨╝╨║╨╕-╨│╤А╤Г╨┐╨┐╤Л ╤Д╤А╨╕╤Д╨╛╤А╨╝ (Q4)
+canvasRouter.post("/frames", (req, res) => {
+  const { board_id, name, color, x, y, w, h } = req.body as { board_id?: number; name?: string; color?: string; x?: number; y?: number; w?: number; h?: number };
+  if (!board_id) return res.status(400).json({ error: "board_id required" });
+  const c = color ?? "#2C3E50";
+  const info = db.prepare("INSERT INTO canvas_frames (board_id, name, color, x, y, w, h) VALUES (?,?,?,?,?,?,?)").run(board_id, name ?? "╨У╤А╤Г╨┐╨┐╨░", c, Number(x) || 0, Number(y) || 0, Number(w) || 320, Number(h) || 240);
+  const fid = Number(info.lastInsertRowid);
+  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "frame", fid, Number(x) || 0, Number(y) || 0);
+  res.status(201).json({ id: fid });
+});
+canvasRouter.put("/frames/:id", (req, res) => {
+  const { name, color, x, y, w, h } = req.body as { name?: string; color?: string; x?: number; y?: number; w?: number; h?: number };
+  const sets: string[] = [];
+  const vals: unknown[] = [];
+  if (name !== undefined) { sets.push("name = ?"); vals.push(String(name).trim() || "╨У╤А╤Г╨┐╨┐╨░"); }
+  if (color !== undefined) { sets.push("color = ?"); vals.push(String(color)); }
+  if (x !== undefined) { sets.push("x = ?"); vals.push(Number(x)); }
+  if (y !== undefined) { sets.push("y = ?"); vals.push(Number(y)); }
+  if (w !== undefined) { sets.push("w = ?"); vals.push(Number(w)); }
+  if (h !== undefined) { sets.push("h = ?"); vals.push(Number(h)); }
+  if (sets.length) {
+    vals.push(Number(req.params.id));
+    db.prepare(`UPDATE canvas_frames SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
+  }
+  // ╤В╨░╨║╨╢╨╡ ╨┤╨▓╨╕╨│╨░╨╡╨╝ ╨╜╨╛╨┤╤Г ╨╡╤Б╨╗╨╕ x/y ╨╝╨╡╨╜╤П╨╗╨╕╤Б╤М
+  if (x !== undefined || y !== undefined) {
+    const row = db.prepare("SELECT board_id FROM canvas_frames WHERE id = ?").get(Number(req.params.id)) as { board_id: number } | undefined;
+    if (row && (x !== undefined || y !== undefined)) {
+      const cur = db.prepare("SELECT x, y FROM canvas_nodes WHERE node_type='frame' AND node_id=?").get(Number(req.params.id)) as { x: number; y: number } | undefined;
+      const nx = x !== undefined ? Number(x) : cur?.x ?? 0;
+      const ny = y !== undefined ? Number(y) : cur?.y ?? 0;
+      db.prepare("UPDATE canvas_nodes SET x = ?, y = ? WHERE node_type='frame' AND node_id = ?").run(nx, ny, Number(req.params.id));
+    }
+  }
+  res.json(db.prepare("SELECT * FROM canvas_frames WHERE id = ?").get(Number(req.params.id)));
+});
+canvasRouter.get("/frames", (req, res) => {
+  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
+  if (!board_id) return res.status(400).json({ error: "board_id required" });
+  res.json(db.prepare("SELECT * FROM canvas_frames WHERE board_id=?").all(board_id));
+});
+
+// ╨Ш╨╖╨╛╨▒╤А╨░╨╢╨╡╨╜╨╕╤П (Q6) тАФ ╨╖╨░╨│╤А╤Г╨╖╨║╨░ ╤Д╨░╨╣╨╗╨░ ╤Г╨╢╨╡ ╤З╨╡╤А╨╡╨╖ /filesystem, ╨╖╨┤╨╡╤Б╤М ╤В╨╛╨╗╤М╨║╨╛ ╨┐╤А╨╕╨▓╤П╨╖╨║╨░
+canvasRouter.post("/images", (req, res) => {
+  const { board_id, file_path, x, y, w, h } = req.body as { board_id?: number; file_path?: string; x?: number; y?: number; w?: number; h?: number };
+  if (!board_id || !file_path) return res.status(400).json({ error: "board_id and file_path required" });
+  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id, file_path, w ?? 320, h ?? 240);
+  const iid = Number(info.lastInsertRowid);
+  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "image", iid, Number(x) || 0, Number(y) || 0);
+  res.status(201).json({ id: iid, file_url: toFileUrl(file_path) });
+});
+canvasRouter.post("/images/upload", upload.single("file"), async (req, res) => {
+  const board_id = Number(req.body?.board_id);
+  const x = Number(req.body?.x) || 0;
+  const y = Number(req.body?.y) || 0;
+  if (!board_id || !req.file) return res.status(400).json({ error: "board_id and file required" });
+  const ext = path.extname(req.file.originalname) || ".png";
+  const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
+  if (!allowed.includes(ext.toLowerCase())) return res.status(400).json({ error: "allowed png/jpg/webp/gif" });
+  const sub = `canvas/${board_id}`;
+  await ensureSubfolder(VAULT_ROOT, sub);
+  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
+  const target = path.join(VAULT_ROOT, sub, fileName);
+  // write file directly (no old file to replace)
+  const fs = await import("fs/promises");
+  await fs.writeFile(target, req.file.buffer);
+  const file_path = target;
+  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id, file_path, 320, 240);
+  const iid = Number(info.lastInsertRowid);
+  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?,?,?)").run(board_id, "image", iid, x, y);
+  res.status(201).json({ id: iid, file_url: toFileUrl(file_path) });
+});
+
+// ╨н╨║╤Б╨┐╨╛╤А╤В ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П ╤Б╨╛ ╤Б╤Е╨╡╨╝╨╛╨╣ тАФ ╤Б╨╡╨║╤Ж╨╕╤П canvas ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨░, ╤Б╤Г╤Й╨╜╨╛╤Б╤В╨╕ uid-╤Б╤Б╤Л╨╗╨║╨░╨╝╨╕ (Q4, Q7)
+canvasRouter.get("/export", (req, res) => {
+  const { arc_id } = req.query as { arc_id?: string };
+  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
+  const arcId = Number(arc_id);
+  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(arcId) as { id: number; setting_id: number; name: string } | undefined;
+  if (!arc) return res.status(404).json({ error: "not found" });
+  const arcIds = [arcId, ...((db.prepare("SELECT id FROM story_arcs WHERE parent_id = ? AND archived_at IS NULL ORDER BY position, id").all(arcId) as { id: number }[]).map((r) => r.id))];
+  const ph = arcIds.map(() => "?").join(",");
+  const scenes = db.prepare(`SELECT * FROM story_scenes WHERE arc_id IN (${ph}) AND archived_at IS NULL ORDER BY position, id`).all(...arcIds);
+  const transitions = db.prepare(`SELECT * FROM story_scene_transitions WHERE from_scene_id IN (SELECT id FROM story_scenes WHERE arc_id IN (${ph})) ORDER BY position, id`).all(...arcIds);
+  const checks = db.prepare(`SELECT * FROM story_scene_checks WHERE scene_id IN (SELECT id FROM story_scenes WHERE arc_id IN (${ph})) ORDER BY position, id`).all(...arcIds);
+  const outcomes = checks.length ? db.prepare(`SELECT * FROM story_check_outcomes WHERE check_id IN (${checks.map(() => "?").join(",")}) ORDER BY position, id`).all(...(checks as { id: number }[]).map((c) => c.id)) : [];
+  const board = db.prepare("SELECT id FROM canvas_boards WHERE scope_type = 'arc' AND scope_id = ?").get(arcId) as { id: number } | undefined;
+  let canvas: unknown = null;
+  if (board) {
+    const nodes = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(board.id);
+    const groups = db.prepare("SELECT arc_id, x, y, w, h FROM canvas_groups WHERE board_id = ?").all(board.id);
+    const bundleIds = (nodes as { node_type: string; node_id: number }[]).filter((n) => n.node_type === "bundle").map((n) => n.node_id);
+    const bundles = bundleIds.length ? db.prepare(`SELECT * FROM canvas_bundles WHERE id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
+    const bundleLinks = bundleIds.length ? db.prepare(`SELECT l.*, IFNULL(c.qty,'') as qty FROM generic_links l LEFT JOIN link_cast c ON c.link_id=l.id WHERE l.from_type='bundle' AND l.from_id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
+    canvas = { board_id: board.id, nodes, groups, bundles, bundleLinks };
+  }
+  res.json({ arc, scenes, transitions, checks, outcomes, canvas });
+});
+
 /**
  * ╨Я╨╛╨┤╨▓╨╕╨╜╤Г╨╗╨╕ ╨╕╨╗╨╕ ╤А╨░╤Б╤В╤П╨╜╤Г╨╗╨╕ ╤А╨░╨╝╨║╤Г ╨│╨╗╨░╨▓╤Л.
  *
@@ -759,21 +1154,27 @@ canvasRouter.get("/board", (req, res) => {
  * ╨Ь╨░╤Б╤В╨╡╤А╨░, ╨┐╨╛╨┐╨░╨╗╨░ ╨╗╨╕ ╨▓ ╤А╨░╨╝╨║╤Г ╤Б╤Ж╨╡╨╜╨░ ╤Б╨╛╤Б╨╡╨┤╨╜╨╡╨╣ ╨│╨╗╨░╨▓╤Л.
  */
 canvasRouter.put("/groups/:arcId", (req, res) => {
-  const { board_id, x, y, w, h } = req.body as {
+  const { board_id, x, y, w, h, color, name } = req.body as {
     board_id?: number;
     x?: number;
     y?: number;
     w?: number;
     h?: number;
+    color?: string;
+    name?: string;
   };
   if (!board_id) return res.status(400).json({ error: "board_id is required" });
+  if (name !== undefined) {
+    db.prepare("UPDATE story_arcs SET name = ? WHERE id = ?").run(String(name).trim() || "╨У╨╗╨░╨▓╨░", req.params.arcId);
+  }
   db.prepare(
     `UPDATE canvas_groups SET
        x = COALESCE(?, x), y = COALESCE(?, y),
        w = COALESCE(?, w), h = COALESCE(?, h),
+       color = COALESCE(?, color),
        updated_at = datetime('now')
      WHERE board_id = ? AND arc_id = ?`
-  ).run(x ?? null, y ?? null, w ?? null, h ?? null, board_id, req.params.arcId);
+  ).run(x ?? null, y ?? null, w ?? null, h ?? null, color ?? null, board_id, req.params.arcId);
   res.json({ ok: true });
 });
 
@@ -785,23 +1186,25 @@ canvasRouter.put("/groups/:arcId", (req, res) => {
 canvasRouter.put("/board/nodes", (req, res) => {
   const body = req.body as {
     arc_id?: number;
-    nodes?: { node_type?: string; node_id?: number; x?: number; y?: number }[];
+    board_id?: number;
+    nodes?: { node_type?: string; node_id?: number; x?: number; y?: number; z_index?: number }[];
   };
-  if (!body.arc_id) return res.status(400).json({ error: "arc_id is required" });
   if (!Array.isArray(body.nodes)) return res.status(400).json({ error: "nodes must be an array" });
-
-  const boardId = ensureBoard("arc", Number(body.arc_id));
+  let boardId: number;
+  if (body.board_id) boardId = Number(body.board_id);
+  else if (body.arc_id) boardId = ensureBoard("arc", Number(body.arc_id));
+  else return res.status(400).json({ error: "arc_id or board_id required" });
   const upsert = db.prepare(
-    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, updated_at)
-     VALUES (?, ?, ?, ?, ?, datetime('now'))
+    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, z_index, updated_at)
+     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(board_id, node_type, node_id)
-     DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`
+     DO UPDATE SET x = excluded.x, y = excluded.y, z_index = excluded.z_index, updated_at = excluded.updated_at`
   );
 
   const write = db.transaction((rows: typeof body.nodes) => {
     (rows ?? []).forEach((n) => {
       if (!n.node_type || !n.node_id) return;
-      upsert.run(boardId, n.node_type, Number(n.node_id), Number(n.x) || 0, Number(n.y) || 0);
+      upsert.run(boardId, n.node_type, Number(n.node_id), Number(n.x) || 0, Number(n.y) || 0, Number((n as { z_index?: number }).z_index) || 0);
     });
   });
   write(body.nodes);
@@ -816,20 +1219,21 @@ canvasRouter.put("/board/nodes", (req, res) => {
  * ╨б╤Г╤Й╨╡╤Б╤В╨▓╨╛ ╨╢╨╡ ╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П ╨╜╨░ ╤Б╤Е╨╡╨╝╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨┐╨╛╤В╨╛╨╝╤Г, ╤З╤В╨╛ ╨╡╨│╨╛ ╤Б╤О╨┤╨░ ╨┐╨╛╨╗╨╛╨╢╨╕╨╗╨╕.
  */
 canvasRouter.post("/board/node", (req, res) => {
-  const { arc_id, node_type, node_id, x, y } = req.body as {
+  const { arc_id, board_id, node_type, node_id, x, y } = req.body as {
     arc_id?: number;
+    board_id?: number;
     node_type?: string;
     node_id?: number;
     x?: number;
     y?: number;
   };
-  if (!arc_id || !node_type || !node_id) {
-    return res.status(400).json({ error: "arc_id, node_type and node_id are required" });
+  if ((!arc_id && !board_id) || !node_type || !node_id) {
+    return res.status(400).json({ error: "arc_id or board_id, node_type and node_id are required" });
   }
   if (node_type === "scene") {
     return res.status(400).json({ error: "╤Б╤Ж╨╡╨╜╤Л ╨▓╤Л╨▓╨╛╨┤╤П╤В╤Б╤П ╨╕╨╖ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П, ╨║╨╗╨░╤Б╤В╤М ╨╕╤Е ╨╜╨╡ ╨╜╤Г╨╢╨╜╨╛" });
   }
-  const boardId = ensureBoard("arc", Number(arc_id));
+  const boardId = board_id ? Number(board_id) : ensureBoard("arc", Number(arc_id));
   db.prepare(
     `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
@@ -845,20 +1249,25 @@ canvasRouter.post("/board/node", (req, res) => {
  * ╨▓╤Л╨┐╨╛╤В╤А╨╛╤И╨╕╤В╤М ╤Б╤Ж╨╡╨╜╤Л. ╨б╨▓╤П╨╖╤М ╤Б╨╜╨╕╨╝╨░╨╡╤В╤Б╤П ╨╛╤В╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╨╡╨╝ ╤Б╤В╤А╨╡╨╗╨║╨╕.
  */
 canvasRouter.delete("/board/node", (req, res) => {
-  const { arc_id, node_type, node_id } = req.query as {
+  const { arc_id, board_id, node_type, node_id } = req.query as {
     arc_id?: string;
+    board_id?: string;
     node_type?: string;
     node_id?: string;
   };
-  if (!arc_id || !node_type || !node_id) {
-    return res.status(400).json({ error: "arc_id, node_type and node_id are required" });
+  if (!node_type || !node_id) return res.status(400).json({ error: "node_type and node_id are required" });
+  let boardId: number;
+  if (board_id) boardId = Number(board_id);
+  else if (arc_id) boardId = ensureBoard("arc", Number(arc_id));
+  else return res.status(400).json({ error: "arc_id or board_id required" });
+  db.prepare("DELETE FROM canvas_nodes WHERE board_id = ? AND node_type = ? AND node_id = ?").run(boardId, node_type, Number(node_id));
+  if (node_type === "sticker") db.prepare("DELETE FROM canvas_stickers WHERE id = ?").run(Number(node_id));
+  if (node_type === "image") {
+    const row = db.prepare("SELECT file_path FROM canvas_images WHERE id = ?").get(Number(node_id)) as { file_path: string } | undefined;
+    db.prepare("DELETE FROM canvas_images WHERE id = ?").run(Number(node_id));
+    void row;
   }
-  const boardId = ensureBoard("arc", Number(arc_id));
-  db.prepare("DELETE FROM canvas_nodes WHERE board_id = ? AND node_type = ? AND node_id = ?").run(
-    boardId,
-    node_type,
-    Number(node_id)
-  );
+  if (node_type === "frame") db.prepare("DELETE FROM canvas_frames WHERE id = ?").run(Number(node_id));
   res.json({ ok: true });
 });
 
@@ -889,19 +1298,23 @@ canvasRouter.get("/bundles", (req, res) => {
  * ╤Б╤В╨░╨╗, ╨╕ content_type ╤Г ╨╜╨╡╨│╨╛ ╨┐╤Г╤Б╤В╨╛╨╣, ╨┐╨╛╨║╨░ ╨▓ ╨╜╨╡╨│╨╛ ╨╜╨╡ ╨▓╤В╨░╤Й╨╕╨╗╨╕ ╨┐╨╡╤А╨▓╨╛╨│╨╛ ╤З╨╗╨╡╨╜╨░.
  */
 canvasRouter.post("/bundles", (req, res) => {
-  const { arc_id, name, setting_id, x, y } = req.body as {
+  const { arc_id, board_id, name, setting_id, x, y } = req.body as {
     arc_id?: number;
+    board_id?: number;
     name?: string;
     setting_id?: number | null;
     x?: number;
     y?: number;
   };
-  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
+  // free-╨┤╨╛╤Б╨║╨░: board_id ╨╜╨░╨┐╤А╤П╨╝╤Г╤О (Q1 ╨░), ╨╕╨╜╨░╤З╨╡ arc_id
+  let boardId: number;
+  if (board_id) boardId = Number(board_id);
+  else if (arc_id) boardId = ensureBoard("arc", Number(arc_id));
+  else return res.status(400).json({ error: "arc_id or board_id required" });
   const info = db
     .prepare("INSERT INTO canvas_bundles (name, setting_id) VALUES (?, ?)")
     .run(String(name ?? "╨Э╨░╨▒╨╛╤А").trim() || "╨Э╨░╨▒╨╛╤А", setting_id ?? null);
   const bundleId = Number(info.lastInsertRowid);
-  const boardId = ensureBoard("arc", Number(arc_id));
   db.prepare(
     `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?, 'bundle', ?, ?, ?)`
   ).run(boardId, bundleId, Number(x) || 0, Number(y) || 0);
@@ -995,8 +1408,8 @@ canvasRouter.delete("/bundles/:id", (req, res) => {
  * ╨▓╨╛╨┐╤А╨╛╤Б ┬л╨┐╨╛╤З╨╡╨╝╤Г ╤В╤Г╤В ╨┐╤А╨░╨▓╨║╨░ ╤А╨░╨╖╨╛╤И╨╗╨░╤Б╤М, ╨░ ╤В╤Г╤В ╤А╨░╨╖╤К╨╡╤Е╨░╨╗╨░╤Б╤М┬╗.
  */
 canvasRouter.post("/bundles/:id/insert", (req, res) => {
-  const { arc_id, x, y } = req.body as { arc_id?: number; x?: number; y?: number };
-  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
+  const { arc_id, board_id, x, y } = req.body as { arc_id?: number; board_id?: number; x?: number; y?: number };
+  if (!arc_id && !board_id) return res.status(400).json({ error: "arc_id or board_id is required" });
   const source = db.prepare("SELECT * FROM canvas_bundles WHERE id = ?").get(req.params.id) as
     | { id: number; name: string; content_type: string | null; setting_id: number | null }
     | undefined;
@@ -1009,7 +1422,7 @@ canvasRouter.post("/bundles/:id/insert", (req, res) => {
     )
     .run(source.id, source.setting_id);
   const bundleId = Number(info.lastInsertRowid);
-  const boardId = ensureBoard("arc", Number(arc_id));
+  const boardId = board_id ? Number(board_id) : ensureBoard("arc", Number(arc_id));
   db.prepare(
     "INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?, 'bundle', ?, ?, ?)"
   ).run(boardId, bundleId, Number(x) || 0, Number(y) || 0);
