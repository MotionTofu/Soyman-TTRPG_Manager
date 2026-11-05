import { Router } from "express";
import { db } from "../db/db";
import { adventureClueGraph, type ClueRow } from "../story/clues";
import { contentSceneId } from "../story/library";

/** Только чтение существующих улик. story.ts оставлен параллельной сессии. */
export const sceneProfileRouter = Router();
sceneProfileRouter.get("/scenes/:id/profile-clues", (req, res) => {
  const scene = db.prepare("SELECT id, arc_id, source_scene_id FROM story_scenes WHERE id = ?").get(req.params.id) as
    { id: number; arc_id: number | null; source_scene_id: number | null } | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  const campaignId = Number(req.query.campaign_id) || null;
  const graph = scene.arc_id ? adventureClueGraph(scene.arc_id, campaignId) : null;
  const originalId = scene.source_scene_id ?? scene.id;
  const shownId = campaignId == null || scene.source_scene_id != null ? scene.id : (db.prepare(
    "SELECT id FROM story_scenes WHERE source_scene_id = ? AND campaign_id = ? AND archived_at IS NULL"
  ).get(scene.id, campaignId) as { id: number } | undefined)?.id ?? scene.id;
  const sceneName = (id: number | null) => id == null ? null : (db.prepare("SELECT name FROM story_scenes WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? null;
  // Вход может начинаться в другом приключении: его нет в графе этого корня.
  // В кампании не удваиваем источник его собственным override.
  const incomingRows = db.prepare(`SELECT c.*, s.id AS from_scene_id, s.name AS from_scene_name FROM story_clues c
    LEFT JOIN story_scenes s ON s.id = c.scene_id
    LEFT JOIN story_arcs a ON a.id = c.arc_id
    WHERE c.target_type = 'scene' AND c.target_id = @target AND c.proposed = 0
      AND (a.id IS NULL OR (a.archived_at IS NULL AND (a.campaign_id IS NULL OR a.campaign_id = @campaign)))
      AND (s.id IS NULL OR (s.archived_at IS NULL AND
        (s.campaign_id = @campaign OR (s.campaign_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM story_scenes own WHERE own.source_scene_id = s.id AND own.campaign_id = @campaign AND own.archived_at IS NULL
        )))))
    ORDER BY c.position, c.id`).all({ target: originalId, campaign: campaignId }) as (ClueRow & { from_scene_id: number | null; from_scene_name: string | null })[];
  if (graph) {
    const node = graph.nodes.get(originalId);
    const clues = graph.clues.filter((c) => !c.proposed);
    const from = (id: number | null) => id == null ? null : graph.nodes.get(id);
    return res.json({
      outgoing: clues.filter((c) => c.node_id === originalId).map((c) => ({ ...c,
        target_title: c.target_type === "scene" && c.target_id != null ? graph.nodes.get(c.target_id)?.name ?? sceneName(c.target_id) : c.target_title })),
      incoming: [
        ...clues.filter((c) => c.target_type === "scene" && c.target_id === originalId).map((c) => ({ ...c,
          from_scene_id: from(c.node_id)?.shown_id ?? null, from_scene_name: from(c.node_id)?.name ?? "Лоток улик" })),
        ...incomingRows.filter((r) => !clues.some((c) => c.id === r.id && c.target_type === "scene" && c.target_id === originalId)),
      ],
      shown_id: node?.shown_id ?? scene.id,
    });
  }
  const contentId = contentSceneId(shownId);
  const outgoing = db.prepare(`SELECT c.*, CASE c.target_type WHEN 'scene' THEN s.name WHEN 'secret' THEN t.title WHEN 'adventure' THEN a.name END AS target_title
    FROM story_clues c LEFT JOIN story_scenes s ON c.target_type = 'scene' AND s.id = c.target_id
    LEFT JOIN story_secrets t ON c.target_type = 'secret' AND t.id = c.target_id
    LEFT JOIN story_arcs a ON c.target_type = 'adventure' AND a.id = c.target_id
    WHERE c.scene_id = ? AND c.proposed = 0 ORDER BY c.position, c.id`).all(contentId);
  return res.json({ outgoing, incoming: incomingRows, shown_id: shownId });
});
