import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/db";

export const pdfEntitySourcesRouter = Router();

const targets = {
  being: { table: "setting_beings", fields: ["description", "history", "behavior", "secret", "player_text"] },
  location: { table: "setting_locations", fields: ["description", "player_text"] },
  community: { table: "setting_communities", fields: ["description", "history", "current_situation", "features", "goals", "player_text"] },
  artifact: { table: "artifacts", fields: ["description", "history", "power", "notes", "secret"] },
  item: { table: "compendium_entries", fields: ["description"] },
  magic_item: { table: "compendium_entries", fields: ["description"] },
} as const;

const sourceInput = z.object({
  resource_id: z.number().int().positive(),
  target_kind: z.enum(["being", "location", "community", "artifact", "item", "magic_item"]),
  target_id: z.number().int().positive(),
  field_name: z.string(),
  page_number: z.number().int().positive().nullable(),
  quote: z.string().max(10_000),
});

function list(where: string, args: unknown[]) {
  return db.prepare(`SELECT s.*, r.name AS resource_name,
      COALESCE(b.name, l.name, c.name, a.name, ce.name) AS target_name,
      COALESCE(b.setting_id, l.setting_id, c.setting_id, a.setting_id) AS target_setting_id,
      ce.system_id AS target_system_id, ce.section_id AS target_section_id,
      CASE WHEN s.file_sha256 IS NOT NULL AND r.file_sha256 IS NOT NULL
        AND s.file_sha256 <> r.file_sha256 THEN 1 ELSE 0 END AS needs_reattach
    FROM pdf_entity_sources s JOIN resources r ON r.id = s.resource_id
    LEFT JOIN setting_beings b ON s.target_kind = 'being' AND b.id = s.target_id
    LEFT JOIN setting_locations l ON s.target_kind = 'location' AND l.id = s.target_id
    LEFT JOIN setting_communities c ON s.target_kind = 'community' AND c.id = s.target_id
    LEFT JOIN artifacts a ON s.target_kind = 'artifact' AND a.id = s.target_id
    LEFT JOIN compendium_entries ce ON s.target_kind IN ('item', 'magic_item') AND ce.id = s.target_id
    WHERE ${where} AND r.archived_at IS NULL ORDER BY s.created_at DESC, s.rowid DESC`).all(...args);
}

pdfEntitySourcesRouter.get("/resource/:resourceId", (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ error: "Неверный PDF" });
  res.json(list("s.resource_id = ?", [resourceId]));
});

pdfEntitySourcesRouter.get("/context/:resourceId", (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ error: "Неверный PDF" });
  const resource = db.prepare(`SELECT r.setting_id, r.system_id,
      COALESCE(r.campaign_id, se.campaign_id) AS campaign_id
    FROM resources r LEFT JOIN sessions se ON se.id = r.session_id
    WHERE r.id = ? AND r.category = 'pdf' AND r.archived_at IS NULL`).get(resourceId) as
    { setting_id: number | null; system_id: number | null; campaign_id: number | null } | undefined;
  if (!resource) return res.status(404).json({ error: "PDF не найден" });
  const settingIds = new Set<number>();
  const systemIds = new Set<number>();
  if (resource.setting_id) settingIds.add(resource.setting_id);
  if (resource.system_id) systemIds.add(resource.system_id);
  for (const row of db.prepare("SELECT setting_id FROM resource_setting_links WHERE owner_type = 'resource' AND owner_id = ?")
    .all(resourceId) as { setting_id: number }[]) settingIds.add(row.setting_id);
  if (resource.campaign_id) {
    const campaign = db.prepare("SELECT setting_id, system_id FROM campaigns WHERE id = ?")
      .get(resource.campaign_id) as { setting_id: number | null; system_id: number | null } | undefined;
    if (campaign?.setting_id) settingIds.add(campaign.setting_id);
    if (campaign?.system_id) systemIds.add(campaign.system_id);
  }
  res.json({ setting_id: settingIds.size === 1 ? [...settingIds][0] : null,
    system_id: systemIds.size === 1 ? [...systemIds][0] : null });
});

pdfEntitySourcesRouter.get("/entity/:kind/:targetId", (req, res) => {
  if (!Object.prototype.hasOwnProperty.call(targets, req.params.kind)) return res.status(400).json({ error: "Неверный вид Сущности" });
  const targetId = Number(req.params.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: "Неверная Сущность" });
  res.json(list("s.target_kind = ? AND s.target_id = ?", [req.params.kind, targetId]));
});

pdfEntitySourcesRouter.post("/", (req, res) => {
  const parsed = sourceInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неверная ссылка на PDF" });
  const source = parsed.data;
  const config = targets[source.target_kind];
  if (!(config.fields as readonly string[]).includes(source.field_name)) {
    return res.status(400).json({ error: "Поле не поддерживает цитаты из PDF" });
  }
  if ((source.page_number === null) !== (source.quote.trim() === "")) {
    return res.status(400).json({ error: "Страница и цитата должны быть указаны вместе" });
  }
  const resource = db.prepare("SELECT category, file_path, file_sha256 FROM resources WHERE id = ? AND archived_at IS NULL")
    .get(source.resource_id) as { category: string | null; file_path: string | null; file_sha256: string | null } | undefined;
  if (!resource || resource.category !== "pdf" || !resource.file_path) return res.status(404).json({ error: "PDF не найден" });
  const target = db.prepare(`SELECT id${config.table === "compendium_entries" ? ", kind" : ""} FROM ${config.table} WHERE id = ?`).get(source.target_id) as
    { id: number; kind?: string } | undefined;
  if (!target || (config.table === "compendium_entries" && target.kind !== source.target_kind)) {
    return res.status(404).json({ error: "Сущность не найдена" });
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO pdf_entity_sources
    (id, resource_id, target_kind, target_id, field_name, page_number, quote, file_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, source.resource_id, source.target_kind,
    source.target_id, source.field_name, source.page_number, source.quote.trim(), resource.file_sha256);
  res.status(201).json(list("s.id = ?", [id])[0]);
});
