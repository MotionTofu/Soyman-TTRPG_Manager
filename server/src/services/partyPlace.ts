import { db } from "../db/db";
import { contentSceneId, withLibraryContent } from "../story/library";

// «Партия здесь» (решения 2026-09-11, §3).
//
// Точка кампании, а не сессии: партия стоит там, где закончила, пока её не
// сдвинут. По умолчанию — место последней запущенной сцены кампании; поверх —
// ручная отметка «Мы здесь», которая живёт до следующего запуска.

interface Named {
  id: number;
  name: string;
}

export interface PartyPlace {
  location: (Named & { role: string; parent_id: number | null }) | null;
  /** От корня мира до места включительно. */
  path: Named[];
  source: "scene" | "manual" | null;
  /** Последняя запущенная сцена, если место взято из неё (или у неё места нет). */
  scene: Named | null;
  /** Другие места той же сцены — «также в сцене». */
  also: Named[];
  set_at: string | null;
}

const EMPTY: PartyPlace = { location: null, path: [], source: null, scene: null, also: [], set_at: null };

function liveLocation(id: number): PartyPlace["location"] {
  return (
    (db
      .prepare("SELECT id, name, role, parent_id FROM setting_locations WHERE id = ? AND archived_at IS NULL")
      .get(id) as PartyPlace["location"] | undefined) ?? null
  );
}

function pathTo(id: number): Named[] {
  const chain: Named[] = [];
  const seen = new Set<number>();
  let cur = db.prepare("SELECT id, name, parent_id FROM setting_locations WHERE id = ?").get(id) as
    | (Named & { parent_id: number | null })
    | undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift({ id: cur.id, name: cur.name });
    cur =
      cur.parent_id != null
        ? (db.prepare("SELECT id, name, parent_id FROM setting_locations WHERE id = ?").get(cur.parent_id) as
            | (Named & { parent_id: number | null })
            | undefined)
        : undefined;
  }
  return chain;
}

export function partyPlace(campaignId: number): PartyPlace {
  const launch = db
    .prepare(
      `SELECT ss.scene_id, ss.launched_at FROM session_scenes ss
         JOIN sessions s ON s.id = ss.session_id
        WHERE s.campaign_id = ? AND s.archived_at IS NULL
        ORDER BY ss.launched_at DESC, ss.id DESC LIMIT 1`
    )
    .get(campaignId) as { scene_id: number; launched_at: string } | undefined;
  const manual = db.prepare("SELECT location_id, set_at FROM campaign_party_place WHERE campaign_id = ?").get(campaignId) as
    | { location_id: number; set_at: string }
    | undefined;

  // Отметка в архиве не считается — тогда решает сцена.
  const manualLocation = manual ? liveLocation(manual.location_id) : null;
  if (manual && manualLocation && (!launch || manual.set_at >= launch.launched_at)) {
    return { location: manualLocation, path: pathTo(manualLocation.id), source: "manual", scene: null, also: [], set_at: manual.set_at };
  }
  if (!launch) return EMPTY;

  const sceneRow = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(launch.scene_id) as
    | { id: number; name: string; library_scene_id: number | null }
    | undefined;
  const shown = sceneRow
    ? (withLibraryContent(sceneRow as never) as unknown as { name: string; library_name: string | null })
    : null;
  const scene = sceneRow ? { id: sceneRow.id, name: shown?.name?.trim() || shown?.library_name || sceneRow.name } : null;
  const places = db
    .prepare(
      `SELECT l.id, l.name, l.role, l.parent_id FROM generic_links gl
         JOIN setting_locations l ON l.id = gl.to_id
        WHERE gl.from_type = 'scene' AND gl.from_id = ? AND gl.section = 'scene_location'
          AND gl.to_type = 'location' AND l.archived_at IS NULL
        ORDER BY gl.id`
    )
    .all(contentSceneId(launch.scene_id)) as NonNullable<PartyPlace["location"]>[];
  // Сцена без места: партия ушла, а куда — не сказано. Прошлую отметку она
  // всё равно перебила: запуск и есть заявление «мы переместились».
  if (places.length === 0) return { ...EMPTY, scene, set_at: launch.launched_at };
  return {
    location: places[0],
    path: pathTo(places[0].id),
    source: "scene",
    scene,
    also: places.slice(1).map((p) => ({ id: p.id, name: p.name })),
    set_at: launch.launched_at,
  };
}

/**
 * «Мы здесь» из пульта: отметка кампании и место в панели локаций сессии
 * (`origin='live'`) — чтобы «Что здесь было» видело и песочницу без сцен.
 */
export function setPartyPlace(sessionId: number, locationId: number): { campaignId: number } | { status: number; error: string } {
  const session = db
    .prepare(
      `SELECT s.id, s.campaign_id, c.setting_id FROM sessions s
         JOIN campaigns c ON c.id = s.campaign_id
        WHERE s.id = ? AND s.archived_at IS NULL`
    )
    .get(sessionId) as { id: number; campaign_id: number; setting_id: number | null } | undefined;
  if (!session) return { status: 404, error: "not found" };
  const loc = db.prepare("SELECT id, setting_id, archived_at FROM setting_locations WHERE id = ?").get(locationId) as
    | { id: number; setting_id: number; archived_at: string | null }
    | undefined;
  if (!loc || loc.archived_at) return { status: 400, error: "place not found" };
  if (loc.setting_id !== session.setting_id) return { status: 400, error: "place is not in the campaign's setting" };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO campaign_party_place (campaign_id, location_id, session_id, set_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
       ON CONFLICT(campaign_id) DO UPDATE SET
         location_id = excluded.location_id, session_id = excluded.session_id, set_at = excluded.set_at`
    ).run(session.campaign_id, loc.id, session.id);
    db.prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
       VALUES ('session', ?, 'location', ?, 'locations', 'live')`
    ).run(session.id, loc.id);
  })();
  return { campaignId: session.campaign_id };
}

/**
 * Флажки Географии: где партии идущих кампаний сеттинга. Завершённая кампания
 * флажка не ставит — иначе её партия навсегда осталась бы стоять в мире;
 * приостановленная ставит: к ней возвращаются и к ней готовятся.
 */
export function settingPartyPlaces(
  settingId: number
): { campaign_id: number; campaign_name: string; location_id: number; path_ids: number[] }[] {
  const campaigns = db
    .prepare(
      "SELECT id, name FROM campaigns WHERE setting_id = ? AND archived_at IS NULL AND status <> 'completed' ORDER BY name, id"
    )
    .all(settingId) as Named[];
  const out: { campaign_id: number; campaign_name: string; location_id: number; path_ids: number[] }[] = [];
  for (const c of campaigns) {
    const p = partyPlace(c.id);
    if (!p.location) continue;
    out.push({ campaign_id: c.id, campaign_name: c.name, location_id: p.location.id, path_ids: p.path.map((x) => x.id) });
  }
  return out;
}
