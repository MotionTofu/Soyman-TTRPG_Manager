import { db } from "../db/db";
import { withLibraryContent } from "../story/library";
import { SESSION_NUMBER_SQL } from "./sessionNumber";

// «Что здесь было» карточки места (решения 2026-09-11, §2, п. 8).
//
// Место — это оно само и все его неархивные вложенные: сцена в комнате данжа
// — это и сцена данжа, с подписью комнаты, как у жителей.

export type VisitReason = "scene" | "panel" | "mention";

export interface AheadScene {
  campaign_id: number;
  campaign_name: string;
  scene_id: number;
  scene_name: string;
  /** Имя вложенного места, если сцена привязана не к самому месту. */
  place_name: string | null;
  /**
   * Последний запуск в сессиях кампании, если был. Сцена всё равно «впереди»:
   * запуск бывает прогоном пульта, а решает отметка «пройдена» (решение
   * владельца 2026-09-11) — подпись лишь подсказывает, что её пора поставить.
   */
  launched_at: string | null;
}

export interface SessionVisit {
  session_id: number;
  campaign_id: number;
  campaign_name: string;
  date: string;
  title: string | null;
  status: string;
  session_number: number;
  reasons: VisitReason[];
}

export interface PlaceHistory {
  ahead: AheadScene[];
  ahead_total: number;
  visits: SessionVisit[];
  visits_total: number;
}

/** Сколько строк в каждой группе без «все». */
export const HISTORY_LIMIT = 5;

interface SceneRow {
  id: number;
  campaign_id: number | null;
  source_scene_id: number | null;
  library_scene_id: number | null;
  name: string;
}

function placesOf(locationId: number): Map<number, string> {
  const rows = db
    .prepare(
      `WITH RECURSIVE places(id) AS (
         SELECT id FROM setting_locations WHERE id = ?
         UNION ALL
         SELECT sl.id FROM setting_locations sl JOIN places p ON sl.parent_id = p.id
         WHERE sl.archived_at IS NULL
       )
       SELECT l.id, l.name FROM places p JOIN setting_locations l ON l.id = p.id`
    )
    .all(locationId) as { id: number; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Сцены, которые кампания показывает: исходники её приключений (с главами и
 * «Сценами вне приключений») с подменой копиями кампании, плюс её собственные.
 * То же правило, что у раздела «Главы и сцены» (routes/story.ts,
 * campaignScenesByArc); прогресс кампании хранится по показанной сцене.
 */
function campaignScenes(campaignId: number, settingId: number): SceneRow[] {
  const adventures = (
    db
      .prepare(
        `SELECT a.id FROM campaign_adventures ca
           JOIN story_arcs a ON a.id = ca.arc_id
          WHERE ca.campaign_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL`
      )
      .all(campaignId) as { id: number }[]
  ).map((r) => r.id);
  const defaults = (
    db
      .prepare("SELECT id FROM story_arcs WHERE setting_id = ? AND is_default = 1 AND archived_at IS NULL")
      .all(settingId) as { id: number }[]
  ).map((r) => r.id);
  const tops = [...adventures, ...defaults];
  if (tops.length === 0) return [];
  const chapters = (
    db
      .prepare(
        `SELECT id FROM story_arcs
          WHERE parent_id IN (${tops.map(() => "?").join(",")}) AND archived_at IS NULL AND campaign_id IS NULL`
      )
      .all(...tops) as { id: number }[]
  ).map((r) => r.id);
  const arcIds = [...tops, ...chapters];
  const arcs = arcIds.map(() => "?").join(",");

  const originals = db
    .prepare(
      `SELECT * FROM story_scenes
        WHERE arc_id IN (${arcs}) AND campaign_id IS NULL AND archived_at IS NULL
        ORDER BY position, id`
    )
    .all(...arcIds) as SceneRow[];
  const overrides = new Map(
    (
      db
        .prepare(
          "SELECT * FROM story_scenes WHERE campaign_id = ? AND source_scene_id IS NOT NULL AND archived_at IS NULL"
        )
        .all(campaignId) as SceneRow[]
    ).map((r) => [r.source_scene_id as number, r])
  );
  const own = db
    .prepare(
      `SELECT * FROM story_scenes
        WHERE campaign_id = ? AND arc_id IN (${arcs}) AND source_scene_id IS NULL AND archived_at IS NULL
        ORDER BY position, id`
    )
    .all(campaignId, ...arcIds) as SceneRow[];
  return [...originals.map((s) => overrides.get(s.id) ?? s), ...own];
}

export function placeHistory(
  locationId: number,
  opts: { campaignId?: number | null; all?: boolean } = {}
): PlaceHistory | null {
  const loc = db.prepare("SELECT id, setting_id FROM setting_locations WHERE id = ?").get(locationId) as
    | { id: number; setting_id: number }
    | undefined;
  if (!loc) return null;
  const places = placesOf(locationId);
  const ids = [...places.keys()];
  const inPlaces = ids.map(() => "?").join(",");
  const campaignId = opts.campaignId ?? null;

  // «Впереди» в профиле — у идущих кампаний: несыгранные сцены завершённой
  // уже никогда не случатся. Названная явно (пульт) берётся при любом статусе.
  // «Было» ниже фильтра по статусу не знает — это история.
  const campaigns = (
    campaignId != null
      ? db
          .prepare("SELECT id, name FROM campaigns WHERE id = ? AND setting_id = ? AND archived_at IS NULL")
          .all(campaignId, loc.setting_id)
      : db
          .prepare(
            "SELECT id, name FROM campaigns WHERE setting_id = ? AND archived_at IS NULL AND status <> 'completed' ORDER BY name, id"
          )
          .all(loc.setting_id)
  ) as { id: number; name: string }[];

  // Место сцены лежит на её «содержательной» строке: у вставки заготовки это
  // сама заготовка, у копии кампании — копия (связи копируются при клоне).
  const placeOfScene = db.prepare(
    `SELECT to_id FROM generic_links
      WHERE from_type = 'scene' AND from_id = ? AND section = 'scene_location'
        AND to_type = 'location' AND to_id IN (${inPlaces})
      ORDER BY id LIMIT 1`
  );
  const stateOf = db.prepare("SELECT status FROM campaign_scene_state WHERE campaign_id = ? AND scene_id = ?");
  // Сверяем и копию, и исходник: запуск мог случиться до того, как кампания
  // завела свою копию сцены.
  const lastLaunch = db.prepare(
    `SELECT MAX(ss.launched_at) AS at FROM session_scenes ss
       JOIN sessions s ON s.id = ss.session_id
      WHERE s.campaign_id = ? AND s.archived_at IS NULL AND ss.scene_id IN (?, ?)`
  );

  const ahead: AheadScene[] = [];
  for (const c of campaigns) {
    for (const s of campaignScenes(c.id, loc.setting_id)) {
      const status = (stateOf.get(c.id, s.id) as { status: string } | undefined)?.status;
      if (status === "done" || status === "skipped") continue;
      const hit = placeOfScene.get(s.library_scene_id ?? s.id, ...ids) as { to_id: number } | undefined;
      if (!hit) continue;
      const shown = withLibraryContent(s as never) as unknown as { name: string; library_name: string | null };
      ahead.push({
        campaign_id: c.id,
        campaign_name: c.name,
        scene_id: s.id,
        scene_name: shown.name?.trim() || shown.library_name || s.name,
        place_name: hit.to_id === locationId ? null : (places.get(hit.to_id) ?? null),
        launched_at: (lastLaunch.get(c.id, s.id, s.source_scene_id ?? s.id) as { at: string | null }).at,
      });
    }
  }

  // Сессии. Запуск сцены — «было» при любом статусе: сцену сыграли. Место,
  // брошенное рукой за столом (origin 'live'), — тоже. Подготовленное заранее
  // (origin 'planned') и упоминание в тексте — только у проведённой сессии,
  // иначе в «было» попадают планы на следующую пятницу. Связи с origin
  // 'scene' не смотрим: следующий запуск их стирает, их покрывает журнал.
  const panelLink = (origin: string) =>
    `EXISTS (SELECT 1 FROM generic_links gl
              WHERE gl.from_type = 'session' AND gl.from_id = s.id AND gl.section = 'locations'
                AND gl.to_type = 'location' AND gl.origin = '${origin}' AND gl.to_id IN (${inPlaces}))`;
  const rows = db
    .prepare(
      `SELECT s.id AS session_id, s.campaign_id, c.name AS campaign_name, s.date, s.title, s.status,
              ${SESSION_NUMBER_SQL} AS session_number,
              EXISTS (SELECT 1 FROM session_scenes ss
                        JOIN story_scenes sc ON sc.id = ss.scene_id
                        JOIN generic_links gl
                          ON gl.from_type = 'scene' AND gl.from_id = COALESCE(sc.library_scene_id, sc.id)
                       WHERE ss.session_id = s.id AND gl.section = 'scene_location'
                         AND gl.to_type = 'location' AND gl.to_id IN (${inPlaces})) AS by_scene,
              ${panelLink("live")} AS by_live,
              ${panelLink("planned")} AS by_planned,
              EXISTS (SELECT 1 FROM generic_links gl
                       WHERE gl.from_type = 'session' AND gl.from_id = s.id AND gl.section = 'mention'
                         AND gl.to_type = 'location' AND gl.to_id IN (${inPlaces})) AS by_mention
         FROM sessions s
         JOIN campaigns c ON c.id = s.campaign_id
        WHERE c.setting_id = ? AND c.archived_at IS NULL AND s.archived_at IS NULL
          ${campaignId != null ? "AND c.id = ?" : ""}
        ORDER BY s.date DESC, s.id DESC`
    )
    .all(...ids, ...ids, ...ids, ...ids, loc.setting_id, ...(campaignId != null ? [campaignId] : [])) as (Omit<
    SessionVisit,
    "reasons"
  > & { by_scene: number; by_live: number; by_planned: number; by_mention: number })[];

  const visits: SessionVisit[] = [];
  for (const r of rows) {
    const held = r.status === "held";
    const panel = r.by_live === 1 || (held && r.by_planned === 1);
    const mention = held && r.by_mention === 1;
    if (!r.by_scene && !panel && !mention) continue;
    const reasons: VisitReason[] = [];
    if (r.by_scene) reasons.push("scene");
    if (panel) reasons.push("panel");
    if (mention) reasons.push("mention");
    visits.push({
      session_id: r.session_id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      date: r.date,
      title: r.title,
      status: r.status,
      session_number: r.session_number,
      reasons,
    });
  }

  return {
    ahead: opts.all ? ahead : ahead.slice(0, HISTORY_LIMIT),
    ahead_total: ahead.length,
    visits: opts.all ? visits : visits.slice(0, HISTORY_LIMIT),
    visits_total: visits.length,
  };
}
