import { Router } from "express";
import { db } from "../db/db";
import { campaignPlayerSectionFolder, deleteVaultFolder } from "../services/filesystem";

// GM-authored custom subsections under a campaign's "Для игроков" tab, plus
// the articles inside "articles"-kind sections. Visibility toward players is
// handled entirely by ../routes/visibilityGrants — creating/editing content
// here never reveals anything on its own.
export const campaignPlayerSectionsRouter = Router();

campaignPlayerSectionsRouter.get("/", (req, res) => {
  const { campaign_id } = req.query as { campaign_id?: string };
  if (!campaign_id) return res.status(400).json({ error: "campaign_id is required" });
  const sections = db
    .prepare("SELECT * FROM campaign_player_sections WHERE campaign_id = ? ORDER BY position, id")
    .all(campaign_id);
  res.json(sections);
});

campaignPlayerSectionsRouter.post("/", (req, res) => {
  const { campaign_id, name, kind } = req.body as { campaign_id?: number; name?: string; kind?: string };
  if (!campaign_id || !name || !kind) {
    return res.status(400).json({ error: "campaign_id, name and kind are required" });
  }
  if (kind !== "gallery" && kind !== "articles") {
    return res.status(400).json({ error: "kind must be 'gallery' or 'articles'" });
  }
  const campaign = db.prepare("SELECT folder_path FROM campaigns WHERE id = ?").get(campaign_id) as
    | { folder_path: string | null }
    | undefined;
  if (!campaign) return res.status(404).json({ error: "campaign not found" });
  const folder = campaign.folder_path ? campaignPlayerSectionFolder(campaign.folder_path, name) : null;
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM campaign_player_sections WHERE campaign_id = ?")
    .get(campaign_id) as { m: number };
  const info = db
    .prepare(
      "INSERT INTO campaign_player_sections (campaign_id, name, kind, folder_path, position) VALUES (?, ?, ?, ?, ?)"
    )
    .run(campaign_id, name, kind, folder, maxPos.m + 1);
  res.status(201).json(db.prepare("SELECT * FROM campaign_player_sections WHERE id = ?").get(info.lastInsertRowid));
});

campaignPlayerSectionsRouter.put("/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE campaign_player_sections SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((id, i) => upd.run(i, id)));
  tx(order ?? []);
  res.json({ ok: true });
});

campaignPlayerSectionsRouter.put("/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  db.prepare("UPDATE campaign_player_sections SET name = COALESCE(?, name) WHERE id = ?").run(
    name ?? null,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM campaign_player_sections WHERE id = ?").get(req.params.id));
});

campaignPlayerSectionsRouter.delete("/:id", (req, res) => {
  const section = db.prepare("SELECT folder_path FROM campaign_player_sections WHERE id = ?").get(req.params.id) as
    | { folder_path: string | null }
    | undefined;
  // Articles cascade-delete via the DB's own FK (ON DELETE CASCADE on
  // section_id) below, which bypasses the per-article grant cleanup in
  // DELETE /articles/:id — clean those up explicitly first, since
  // player_visibility_grants has no FK to campaign_player_articles (its
  // target_id is polymorphic, like generic_links).
  const articleIds = db
    .prepare("SELECT id FROM campaign_player_articles WHERE section_id = ?")
    .all(req.params.id) as { id: number }[];
  const delArticleGrant = db.prepare(
    "DELETE FROM player_visibility_grants WHERE target_type = 'campaign_player_article' AND target_id = ?"
  );
  for (const a of articleIds) delArticleGrant.run(a.id);
  db.prepare("DELETE FROM campaign_player_sections WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM player_visibility_grants WHERE target_type = 'campaign_player_section' AND target_id = ?").run(
    req.params.id
  );
  if (section) deleteVaultFolder(section.folder_path);
  res.json({ ok: true });
});

// Articles within an "articles"-kind section.
campaignPlayerSectionsRouter.get("/:sectionId/articles", (req, res) => {
  const articles = db
    .prepare("SELECT * FROM campaign_player_articles WHERE section_id = ? ORDER BY position, id")
    .all(req.params.sectionId);
  res.json(articles);
});

campaignPlayerSectionsRouter.post("/:sectionId/articles", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM campaign_player_articles WHERE section_id = ?")
    .get(req.params.sectionId) as { m: number };
  const info = db
    .prepare("INSERT INTO campaign_player_articles (section_id, title, content, position) VALUES (?, ?, ?, ?)")
    .run(req.params.sectionId, title ?? "", content ?? "", maxPos.m + 1);
  res.status(201).json(db.prepare("SELECT * FROM campaign_player_articles WHERE id = ?").get(info.lastInsertRowid));
});

campaignPlayerSectionsRouter.put("/articles/reorder", (req, res) => {
  const { order } = req.body as { order: number[] };
  const upd = db.prepare("UPDATE campaign_player_articles SET position = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => ids.forEach((id, i) => upd.run(i, id)));
  tx(order ?? []);
  res.json({ ok: true });
});

campaignPlayerSectionsRouter.put("/articles/:id", (req, res) => {
  const { title, content } = req.body as { title?: string; content?: string };
  db.prepare(
    "UPDATE campaign_player_articles SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?"
  ).run(title ?? null, content ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM campaign_player_articles WHERE id = ?").get(req.params.id));
});

campaignPlayerSectionsRouter.delete("/articles/:id", (req, res) => {
  db.prepare("DELETE FROM campaign_player_articles WHERE id = ?").run(req.params.id);
  db.prepare(
    "DELETE FROM player_visibility_grants WHERE target_type = 'campaign_player_article' AND target_id = ?"
  ).run(req.params.id);
  res.json({ ok: true });
});
