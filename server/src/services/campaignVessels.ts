// Корабль кампании (спека profiles-paper-2, «Корабль кампании»): сборка
// записи из своего (имя, хиты, экипаж, груз) и живой ссылки на основу —
// судно компендиума с постами и чертежом. Общая для Мастера и игрока:
// игроку уходит тот же корабль без заметок Мастера.
import { db } from "../db/db";
import { toFileUrl } from "./filesystem";

export interface VesselRow {
  id: number;
  campaign_id: number;
  entry_id: number | null;
  name: string;
  hull_hp: number | null;
  notes: string;
  position: number;
  archived_at: string | null;
  created_at: string;
}

interface EntryRow {
  id: number;
  name: string;
  data: string;
  avatar_image_path: string | null;
  blueprint_image_path: string | null;
}

/** Первое число строки: «500 (порог 20)» → 500, «13 + 20 гребцов» → 13. */
export function leadingNumber(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/\s/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (data: Record<string, unknown>, key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "");

/** Текущие не выше максимума: максимум в компендиуме могли уменьшить (Q-хиты). */
function current(stored: number | null, max: number | null): number | null {
  if (stored == null) return max;
  return max == null ? stored : Math.min(stored, max);
}

export function vesselRow(id: unknown): VesselRow | undefined {
  return db.prepare("SELECT * FROM campaign_vessels WHERE id = ?").get(id) as VesselRow | undefined;
}

function baseOf(entryId: number | null): EntryRow | undefined {
  if (entryId == null) return undefined;
  return db
    .prepare("SELECT id, name, data, avatar_image_path, blueprint_image_path FROM compendium_entries WHERE id = ?")
    .get(entryId) as EntryRow | undefined;
}

interface CrewRow {
  id: number;
  post_id: number;
  character_id: number | null;
  being_id: number | null;
  name: string | null;
  avatar_image_path: string | null;
}

/** Полная запись корабля: шапка, посты с экипажем и хитами, чертёж, груз. */
export function vesselView(v: VesselRow, opts: { gm: boolean }) {
  const base = baseOf(v.entry_id);
  const data = base ? parseData(base.data) : {};
  const postRows = base
    ? (db
        .prepare(
          "SELECT id, name, data FROM compendium_entries WHERE parent_id = ? AND kind = 'vehicle_post' ORDER BY position, id"
        )
        .all(base.id) as { id: number; name: string; data: string }[])
    : [];
  const state = new Map(
    (
      db.prepare("SELECT post_id, hp, unnamed FROM campaign_vessel_posts WHERE vessel_id = ?").all(v.id) as {
        post_id: number;
        hp: number | null;
        unnamed: number;
      }[]
    ).map((s) => [s.post_id, s])
  );
  const crew = db
    .prepare(
      `SELECT cr.id, cr.post_id, cr.character_id, cr.being_id,
              COALESCE(ch.character_name, b.name) AS name,
              COALESCE(ch.avatar_image_path, b.avatar_image_path) AS avatar_image_path
         FROM campaign_vessel_crew cr
         LEFT JOIN characters ch ON ch.id = cr.character_id
         LEFT JOIN setting_beings b ON b.id = cr.being_id
        WHERE cr.vessel_id = ?
        ORDER BY cr.created_at, cr.id`
    )
    .all(v.id) as CrewRow[];

  const posts = postRows.map((p) => {
    const pd = parseData(p.data);
    const max = leadingNumber(pd.hp);
    const s = state.get(p.id);
    const hp = current(s?.hp ?? null, max);
    return {
      id: p.id,
      name: p.name,
      ac: str(pd, "ac"),
      hp,
      hp_max: max,
      broken: max != null && hp != null && hp <= 0,
      unnamed: s?.unnamed ?? 0,
      crew: crew
        .filter((c) => c.post_id === p.id)
        .map((c) => ({
          id: c.id,
          kind: c.character_id != null ? ("character" as const) : ("being" as const),
          ref_id: (c.character_id ?? c.being_id) as number,
          name: c.name ?? "",
          avatar_image_url: c.avatar_image_path ? toFileUrl(c.avatar_image_path) : null,
        })),
    };
  });

  const hullMax = leadingNumber(data.hp);
  const named = posts.reduce((n, p) => n + p.crew.length, 0);
  const unnamed = posts.reduce((n, p) => n + p.unnamed, 0);
  const pins = base
    ? (db
        .prepare(
          `SELECT p.id, p.post_id, p.text, p.x, p.y, post.name AS post_name FROM blueprint_pins p
           LEFT JOIN compendium_entries post ON post.id = p.post_id
           WHERE p.entry_id = ? ORDER BY p.created_at, p.id`
        )
        .all(base.id) as { id: number; post_id: number | null; text: string; x: number; y: number; post_name: string | null }[])
    : [];
  const cargo = db
    .prepare("SELECT id, text, amount FROM campaign_vessel_cargo WHERE vessel_id = ? ORDER BY position, id")
    .all(v.id) as { id: number; text: string; amount: string }[];

  return {
    id: v.id,
    campaign_id: v.campaign_id,
    name: v.name,
    archived_at: v.archived_at,
    ...(opts.gm ? { notes: v.notes } : {}),
    base: base
      ? {
          id: base.id,
          name: base.name,
          category: str(data, "category"),
          size: str(data, "size"),
          speed: str(data, "speed"),
          ac: str(data, "ac"),
          cargo: str(data, "cargo"),
          avatar_image_url: base.avatar_image_path ? toFileUrl(base.avatar_image_path) : null,
        }
      : null,
    hull: {
      hp: current(v.hull_hp, hullMax),
      max: hullMax,
      threshold: leadingNumber(data.damage_threshold),
    },
    crew_total: { named, unnamed, capacity: leadingNumber(data.crew) },
    blueprint_image_url: base?.blueprint_image_path ? toFileUrl(base.blueprint_image_path) : null,
    pins: pins.map((p) => ({ id: p.id, post_id: p.post_id, label: p.post_name ?? p.text, x: p.x, y: p.y })),
    posts,
    cargo,
  };
}

export type VesselView = ReturnType<typeof vesselView>;

/** Строка списка: имя, основа, прочность, экипаж и кто на постах поимённо. */
export function vesselSummary(v: VesselRow) {
  const full = vesselView(v, { gm: true });
  return {
    id: full.id,
    name: full.name,
    archived_at: full.archived_at,
    base: full.base ? { id: full.base.id, name: full.base.name, category: full.base.category } : null,
    image_url: full.blueprint_image_url ?? full.base?.avatar_image_url ?? null,
    hull: full.hull,
    crew_total: full.crew_total,
    broken_posts: full.posts.filter((p) => p.broken).map((p) => p.name),
    // «штурвал — Ренна»: первый пост с поимённым экипажем.
    lead: (() => {
      const p = full.posts.find((x) => x.crew.length > 0);
      return p ? { post: p.name, names: p.crew.map((c) => c.name) } : null;
    })(),
  };
}
