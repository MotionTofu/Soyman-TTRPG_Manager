// Улики приключения целиком — для холста (стрелки и счётчики) и для списка
// выводов (гриллинг «Узловой дизайн» 2026-09-28).
//
// Правило трёх считается по ПРИКЛЮЧЕНИЮ, а не по холсту: у каждой главы свой
// холст (блок G6.2), и улика из сцены одной главы в сцену другой — обычное
// дело. Поэтому граф собирается по корню и всем его главам сразу.
//
// Узел называется id оригинала сеттинга (source_scene_id ?? id) — в этом же
// пространстве лежат цели улик. Кампания подменяет сцену своей копией, и
// улики тогда берутся с копии; нетронутая вставка заготовки читает улики с
// заготовки.

import { db } from "../db/db";
import { withLibraryContent } from "./library";

export interface ClueRow {
  id: number;
  arc_id: number | null;
  scene_id: number | null;
  source_clue_id: number | null;
  text: string;
  how: string;
  target_type: string | null;
  target_id: number | null;
  position: number;
  /** 1 — предложена, ещё не принята (Q29). */
  proposed: number;
}

interface SceneRow {
  id: number;
  arc_id: number | null;
  campaign_id: number | null;
  source_scene_id: number | null;
  library_scene_id: number | null;
  node_role: string;
  name: string;
}

export interface GraphNode {
  /** id оригинала — имя узла в графе. */
  id: number;
  /** Строка, которая показывается в кампании (копия или сам оригинал). */
  shown_id: number;
  arc_id: number | null;
  role: string;
  /** Имя показанной строки (с заготовки у нетронутой вставки). */
  name: string;
  node_type: string | null;
  /** «Когда приходит сам» — у проактивного. */
  trigger: string;
}

export interface GraphClue extends ClueRow {
  /** Узел, где улику находят; null — лоток. */
  node_id: number | null;
  root_id: number;
  found: boolean;
  target_missing: boolean;
  target_title: string | null;
}

export interface ClueGraph {
  root_arc_id: number;
  /** Корень и его главы. */
  arc_ids: number[];
  nodes: Map<number, GraphNode>;
  clues: GraphClue[];
  tray: GraphClue[];
  /** Узлы, в которые ведёт хоть один проход: правило трёх их не касается (Q31). */
  passage_targets: Set<number>;
  /** Откуда в узел ведут проходы — список выводов пишет «проход из …». */
  passage_sources: Map<number, number[]>;
}

export interface NodeCounts {
  clue_in: number;
  clue_out: number;
  passage_in: boolean;
}

/** Корень приключения: у главы — родитель. */
export function rootArcId(arcId: number): number | null {
  const arc = db.prepare("SELECT id, parent_id FROM story_arcs WHERE id = ?").get(arcId) as
    | { id: number; parent_id: number | null }
    | undefined;
  if (!arc) return null;
  return arc.parent_id ?? arc.id;
}

/** Оригинал сеттинга для копии приключения кампании — в нём лежат цели улик кампании. */
export function originalArcId(arcId: number | null): number | null {
  if (arcId == null) return null;
  const row = db.prepare("SELECT source_arc_id FROM story_arcs WHERE id = ?").get(arcId) as
    | { source_arc_id: number | null }
    | undefined;
  return row?.source_arc_id ?? arcId;
}

export function adventureClueGraph(arcId: number, campaignId: number | null): ClueGraph | null {
  const root = rootArcId(arcId);
  if (root == null) return null;
  const arcIds = [
    root,
    ...(db
      .prepare("SELECT id FROM story_arcs WHERE parent_id = ? AND campaign_id IS NULL AND archived_at IS NULL")
      .all(root) as { id: number }[]).map((r) => r.id),
  ];
  const ph = arcIds.map(() => "?").join(",");

  const originals = db
    .prepare(
      `SELECT id, arc_id, campaign_id, source_scene_id, library_scene_id, node_role, name, node_type, node_trigger FROM story_scenes
       WHERE arc_id IN (${ph}) AND archived_at IS NULL
         AND (campaign_id IS NULL OR (campaign_id = ? AND source_scene_id IS NULL))`
    )
    .all(...arcIds, campaignId ?? -1) as SceneRow[];
  const overrides = new Map<number, SceneRow>();
  if (campaignId != null) {
    const rows = db
      .prepare(
        `SELECT id, arc_id, campaign_id, source_scene_id, library_scene_id, node_role, name, node_type, node_trigger FROM story_scenes
         WHERE campaign_id = ? AND source_scene_id IS NOT NULL AND archived_at IS NULL`
      )
      .all(campaignId) as SceneRow[];
    for (const r of rows) overrides.set(r.source_scene_id as number, r);
  }

  const found = new Set(
    campaignId != null
      ? (db.prepare("SELECT clue_id FROM campaign_clue_state WHERE campaign_id = ? AND found = 1").all(campaignId) as {
          clue_id: number;
        }[]).map((r) => r.clue_id)
      : []
  );
  const adventureTitles = new Map(
    (db
      .prepare("SELECT id, name FROM story_arcs WHERE kind = 'adventure' AND campaign_id IS NULL AND archived_at IS NULL")
      .all() as { id: number; name: string }[]).map((r) => [r.id, r.name])
  );
  const secretTitles = new Map(
    (db.prepare("SELECT id, title FROM story_secrets").all() as { id: number; title: string }[]).map((r) => [
      r.id,
      r.title,
    ])
  );

  const nodes = new Map<number, GraphNode>();
  const contentOf = new Map<number, number>();
  for (const s of originals) {
    const shown = overrides.get(s.id) ?? s;
    // Нетронутая вставка заготовки: роль и имя — с заготовки.
    const content = withLibraryContent(shown);
    const extra = content as unknown as { node_type: string | null; node_trigger: string };
    nodes.set(s.id, {
      id: s.id,
      shown_id: shown.id,
      arc_id: s.arc_id,
      role: content.node_role,
      name: content.name,
      node_type: extra.node_type ?? null,
      trigger: extra.node_trigger ?? "",
    });
    contentOf.set(s.id, shown.library_scene_id ?? shown.id);
  }

  const shape = (c: ClueRow, nodeId: number | null): GraphClue => ({
    ...c,
    node_id: nodeId,
    root_id: c.source_clue_id ?? c.id,
    found: found.has(c.source_clue_id ?? c.id),
    // Цель удалена, в архиве или вне приключения — «ведёт в никуда».
    target_missing:
      c.target_type === "scene"
        ? !nodes.has(c.target_id as number)
        : c.target_type === "secret"
          ? !secretTitles.has(c.target_id as number)
          : c.target_type === "adventure"
            ? !adventureTitles.has(c.target_id as number)
            : false,
    target_title:
      c.target_type === "secret"
        ? (secretTitles.get(c.target_id as number) ?? null)
        : c.target_type === "adventure"
          ? (adventureTitles.get(c.target_id as number) ?? null)
          : null,
  });

  const byScene = db.prepare("SELECT * FROM story_clues WHERE scene_id = ? ORDER BY position, id");
  const clues: GraphClue[] = [];
  for (const [nodeId, contentId] of contentOf) {
    for (const c of byScene.all(contentId) as ClueRow[]) clues.push(shape(c, nodeId));
  }
  const tray = (
    db
      .prepare(`SELECT * FROM story_clues WHERE arc_id IN (${ph}) AND scene_id IS NULL ORDER BY position, id`)
      .all(...arcIds) as ClueRow[]
  ).map((c) => shape(c, null));

  // Проходы — переходы между узлами приключения, в том же виде кампании.
  const passage_targets = new Set<number>();
  const passage_sources = new Map<number, number[]>();
  const nodesOfContent = new Map<number, number[]>();
  for (const [nodeId, contentId] of contentOf) nodesOfContent.set(contentId, [...(nodesOfContent.get(contentId) ?? []), nodeId]);
  const contentIds = [...nodesOfContent.keys()];
  if (contentIds.length) {
    const rows = db
      .prepare(
        `SELECT from_scene_id, to_scene_id FROM story_scene_transitions WHERE from_scene_id IN (${contentIds.map(() => "?").join(",")})`
      )
      .all(...contentIds) as { from_scene_id: number; to_scene_id: number }[];
    for (const r of rows) {
      if (!nodes.has(r.to_scene_id)) continue;
      passage_targets.add(r.to_scene_id);
      const from = nodesOfContent.get(r.from_scene_id) ?? [];
      passage_sources.set(r.to_scene_id, [...(passage_sources.get(r.to_scene_id) ?? []), ...from]);
    }
  }

  return { root_arc_id: root, arc_ids: arcIds, nodes, clues, tray, passage_targets, passage_sources };
}

/**
 * Уровень кампании (шаг 8): улики из приключения в приключение. Граф каждого
 * приключения уже знает копии кампании и заготовки, поэтому улики берутся
 * из него, а не отдельным запросом. Считаются только принятые, живые и
 * ведущие в приключение с этой же карты.
 */
export function adventureClueLayer(advIds: number[], campaignId: number | null) {
  const shown = new Set(advIds);
  const counts = new Map(advIds.map((id) => [id, { clue_in: 0, clue_out: 0 }]));
  const links = new Map<string, { from: number; to: number; n: number }>();
  for (const adv of advIds) {
    // ponytail: граф на каждое приключение карты — их там единицы; общий запрос, если карт станет с сотню.
    for (const c of adventureClueGraph(adv, campaignId)?.clues ?? []) {
      const to = c.target_id as number;
      if (c.target_type !== "adventure" || c.proposed || c.target_missing || to === adv || !shown.has(to)) continue;
      counts.get(adv)!.clue_out++;
      counts.get(to)!.clue_in++;
      const link = links.get(`${adv}:${to}`) ?? { from: adv, to, n: 0 };
      link.n++;
      links.set(`${adv}:${to}`, link);
    }
  }
  return { counts, links: [...links.values()] };
}

/** Стрелки улик между приключениями: `clue:a<откуда>:a<куда>`, «×N». */
export function adventureClueEdges(links: { from: number; to: number; n: number }[]) {
  return links.map((l) => ({
    id: `clue:a${l.from}:a${l.to}`,
    kind: "clue" as const,
    source: `adventure:${l.from}`,
    target: `adventure:${l.to}`,
    label: l.n > 1 ? `×${l.n}` : "",
  }));
}

/**
 * Счётчики правила трёх по узлам (Q11). Считаются только живые улики с целью:
 * «в никуда» и лоток ничего не доказывают. Бонусность (цель — тупик) и
 * освобождения (старт, проактивный, за проходом) решает показ — здесь только
 * числа, чтобы список выводов и холст не считали по-разному.
 */
export function nodeCounts(graph: ClueGraph): Map<number, NodeCounts> {
  const counts = new Map<number, NodeCounts>();
  for (const id of graph.nodes.keys()) {
    counts.set(id, { clue_in: 0, clue_out: 0, passage_in: graph.passage_targets.has(id) });
  }
  for (const c of graph.clues) {
    // Предложенная, но не принятая улика ничего не доказывает (Q29).
    if (c.target_missing || c.target_type == null || c.proposed) continue;
    if (c.node_id != null) counts.get(c.node_id)!.clue_out++;
    if (c.target_type === "scene") counts.get(c.target_id as number)!.clue_in++;
  }
  return counts;
}
