import { Router } from "express";
import { db } from "../db/db";

export const campaignEntriesRouter = Router();

campaignEntriesRouter.get("/", (req, res) => {
  const { campaign_id, category } = req.query as { campaign_id?: string; category?: string };
  if (!campaign_id || !category)
    return res.status(400).json({ error: "campaign_id and category are required" });
  const rows = db
    .prepare(
      "SELECT * FROM campaign_entries WHERE campaign_id = ? AND category = ? ORDER BY created_at"
    )
    .all(campaign_id, category);
  res.json(rows);
});

campaignEntriesRouter.post("/", (req, res) => {
  const { campaign_id, category, title, content } = req.body as {
    campaign_id: number;
    category: string;
    title?: string;
    content?: string;
  };
  if (!campaign_id || !category)
    return res.status(400).json({ error: "campaign_id and category are required" });
  const info = db
    .prepare(
      "INSERT INTO campaign_entries (campaign_id, category, title, content) VALUES (?, ?, ?, ?)"
    )
    .run(campaign_id, category, title ?? "", content ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM campaign_entries WHERE id = ?").get(info.lastInsertRowid));
});

campaignEntriesRouter.put("/:id", (req, res) => {
  const { title, content, status, priority } = req.body as {
    title?: string;
    content?: string;
    status?: string;
    priority?: boolean;
  };
  db.prepare(
    `UPDATE campaign_entries SET
       title = COALESCE(?, title), content = COALESCE(?, content),
       status = COALESCE(?, status),
       priority = COALESCE(?, priority)
     WHERE id = ?`
  ).run(
    title ?? null,
    content ?? null,
    status ?? null,
    priority === undefined ? null : priority ? 1 : 0,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM campaign_entries WHERE id = ?").get(req.params.id));
});

campaignEntriesRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM campaign_entries WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
