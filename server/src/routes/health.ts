import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { ensureSubfolder, sanitizeName, vaultAbs, VAULT_ROOT, vaultRel } from "../services/filesystem";
import { findMissingFiles, relinkResource } from "../services/fileHealth";
import { sweepOrphans, getLastOrphanBackup, restoreLastOrphanBackup } from "../services/orphans";
import { openInFileExplorer } from "../services/filesystem";
import rateLimit from "express-rate-limit";
import { MENTIONABLE, mentionTextColumns, scanMentions, exists, rewriteAllMentions, idOfUid, normUid, rewriteMentions, prefixOf, sourceCodeOf, formatRef, type Mention, type RefMention, type LegacyMention } from "../services/mentions";

const healthScanLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many scans, wait a minute" },
});

export const healthRouter = Router();

function auditLog(req: { ip?: string; headers?: Record<string, unknown>; user?: { id?: number; role?: string } }, action: string, details: Record<string, unknown> = {}) {
  const user = (req as { user?: { id?: number; role?: string } }).user;
  console.log(`[health] ${action}`, { user: user?.id ?? "?", role: user?.role ?? "?", ip: req.ip, ...details });
}

// --- helpers ---

const PATH_TABLES: { table: string; column: string; idCol?: string }[] = [
  { table: "systems", column: "folder_path" },
  { table: "systems", column: "thumbnail_image_path" },
  { table: "settings", column: "folder_path" },
  { table: "settings", column: "background_image_path" },
  { table: "settings", column: "thumbnail_image_path" },
  { table: "campaigns", column: "folder_path" },
  { table: "campaigns", column: "background_image_path" },
  { table: "campaigns", column: "thumbnail_image_path" },
  { table: "players", column: "folder_path" },
  { table: "players", column: "avatar_image_path" },
  { table: "players", column: "thumbnail_image_path" },
  { table: "characters", column: "folder_path" },
  { table: "characters", column: "avatar_image_path" },
  { table: "characters", column: "thumbnail_image_path" },
  { table: "character_chapters", column: "image_path" },
  { table: "setting_locations", column: "folder_path" },
  { table: "setting_locations", column: "avatar_image_path" },
  { table: "setting_locations", column: "thumbnail_image_path" },
  { table: "setting_locations", column: "map_image_path" },
  { table: "setting_beings", column: "folder_path" },
  { table: "setting_beings", column: "avatar_image_path" },
  { table: "setting_beings", column: "thumbnail_image_path" },
  { table: "setting_communities", column: "folder_path" },
  { table: "setting_communities", column: "avatar_image_path" },
  { table: "setting_communities", column: "thumbnail_image_path" },
  { table: "artifacts", column: "folder_path" },
  { table: "artifacts", column: "avatar_image_path" },
  { table: "artifacts", column: "file_path" },
  { table: "resources", column: "file_path" },
  { table: "statblocks", column: "avatar_image_path" },
  { table: "gallery_images", column: "image_path" },
  { table: "compendium_entries", column: "avatar_image_path" },
  { table: "archived_files", column: "archive_path" },
];

function scanBrokenPaths(): { entries: { table: string; column: string; id: number; path: string }[]; total: number; truncated: boolean } {
  const out: { table: string; column: string; id: number; path: string }[] = [];
  let total = 0;
  for (const { table, column } of PATH_TABLES) {
    try {
      const rows = db.prepare(`SELECT id, ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all() as { id: number; p: string }[];
      for (const r of rows) {
        const p = r.p;
        let broken = false;
        try {
          if (!fs.existsSync(vaultAbs(p))) broken = true;
        } catch { broken = true; }
        if (broken) {
          total++;
          if (out.length < 200) out.push({ table, column, id: r.id, path: p });
        }
      }
    } catch {
      // таблица/колонка может отсутствовать в старых БД
    }
  }
  return { entries: out, total, truncated: total > out.length };
}

function countOrphans(): Record<string, number> {
  const counts: Record<string, number> = {};
  const OWNER_TABLE: Record<string, string> = {
    character: "characters",
    being: "setting_beings",
    community: "setting_communities",
    location: "setting_locations",
    compendium_entry: "compendium_entries",
  };
  const SATELLITES: { table: string; ownerTypes: string[] }[] = [
    { table: "statblocks", ownerTypes: ["character", "being", "compendium_entry"] },
    { table: "gallery_images", ownerTypes: ["character", "being"] },
    { table: "important_dates", ownerTypes: ["being", "community", "location", "character"] },
  ];
  for (const { table, ownerTypes } of SATELLITES) {
    for (const ownerType of ownerTypes) {
      const ownerTable = OWNER_TABLE[ownerType];
      try {
        const row = db.prepare(`SELECT count(*) as c FROM ${table} WHERE owner_type = ? AND owner_id NOT IN (SELECT id FROM ${ownerTable})`).get(ownerType) as { c: number };
        if (row.c > 0) counts[`${table}:${ownerType}`] = row.c;
      } catch {}
    }
  }
  const LINK_ENDPOINT_TABLE: Record<string, string> = {
    campaign: "campaigns", setting: "settings", player: "players", character: "characters",
    location: "setting_locations", being: "setting_beings", artifact: "artifacts",
    community: "setting_communities", resource: "resources", mastering: "mastering_notes",
    session: "sessions", compendium_entry: "compendium_entries", playlist: "playlists",
    scene: "story_scenes", adventure: "story_arcs", bundle: "canvas_bundles", sound_set: "sound_sets",
  };
  for (const [type, table] of Object.entries(LINK_ENDPOINT_TABLE)) {
    try {
      const c1 = (db.prepare(`SELECT count(*) as c FROM generic_links WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`).get(type) as { c: number }).c;
      const c2 = (db.prepare(`SELECT count(*) as c FROM generic_links WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`).get(type) as { c: number }).c;
      if (c1) counts[`generic_links:from:${type}`] = c1;
      if (c2) counts[`generic_links:to:${type}`] = c2;
    } catch {}
  }
  const RELATION_ENDPOINT_TABLE: Record<string, string> = {
    being: "setting_beings", character: "characters", community: "setting_communities",
    compendium_entry: "compendium_entries", location: "setting_locations", artifact: "artifacts",
  };
  for (const [type, table] of Object.entries(RELATION_ENDPOINT_TABLE)) {
    try {
      const c1 = (db.prepare(`SELECT count(*) as c FROM entity_relations WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`).get(type) as { c: number }).c;
      const c2 = (db.prepare(`SELECT count(*) as c FROM entity_relations WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`).get(type) as { c: number }).c;
      if (c1) counts[`entity_relations:from:${type}`] = c1;
      if (c2) counts[`entity_relations:to:${type}`] = c2;
    } catch {}
  }
  try {
    const c = (db.prepare(`SELECT count(*) as c FROM canvas_boards WHERE scope_type = 'arc' AND scope_id NOT IN (SELECT id FROM story_arcs)`).get() as { c: number }).c;
    if (c) counts["canvas_boards:arc"] = c;
  } catch {}
  return counts;
}

function seqDrift(): { table: string; seq: number; maxId: number | null; drift: number }[] {
  const out: { table: string; seq: number; maxId: number | null; drift: number }[] = [];
  const rows = db.prepare("SELECT name, seq FROM sqlite_sequence").all() as { name: string; seq: number }[];
  for (const r of rows) {
    try {
      const mx = (db.prepare(`SELECT max(id) as m FROM ${r.name}`).get() as { m: number | null }).m;
      const drift = mx == null ? r.seq : r.seq - mx;
      out.push({ table: r.name, seq: r.seq, maxId: mx, drift });
    } catch {}
  }
  return out.sort((a, b) => b.drift - a.drift);
}

function scanBrokenLinks(cols?: ReturnType<typeof mentionTextColumns>): { count: number; samples: { type: string; label: string }[] } {
  const columns = cols ?? mentionTextColumns();
  const samples: { type: string; label: string }[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const { table, column } of columns) {
    const rows = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%' LIMIT 5000`).all() as { v: string | null }[];
    for (const row of rows) {
      for (const m of scanMentions(row.v || "")) {
        if ((m as { kind: string }).kind !== "legacy" || !MENTIONABLE[(m as { type: string }).type] || exists((m as { type: string }).type, (m as { id: number }).id)) continue;
        count++;
        const key = `${(m as { type: string }).type}:${(m as { id: number }).id}`;
        if (seen.has(key) || samples.length >= 12) continue;
        seen.add(key);
        samples.push({ type: (m as { type: string }).type, label: (m as { label: string }).label });
      }
    }
  }
  return { count, samples };
}

interface LegacyEntry {
  type: string;
  id: number;
  label: string;
  table: string;
  column: string;
  hostId: number;
  hostRoute: string | null;
  hostLabel: string | null;
  resolvable: boolean;
  preview: string;
}

function scanLegacyMentions(cols?: ReturnType<typeof mentionTextColumns>): { entries: LegacyEntry[]; count: number; total: number; resolvable: number; broken: number; truncated: boolean } {
  const columns = cols ?? mentionTextColumns();
  const entries: LegacyEntry[] = [];
  let total = 0;
  let resolvable = 0;
  let broken = 0;
  for (const { table, column } of columns) {
    const rows = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%:%|%' LIMIT 5000`).all() as { id: number; v: string | null }[];
    for (const row of rows) {
      if (!row.v || !row.v.includes("[[")) continue;
      for (const m of scanMentions(row.v)) {
        if (m.kind !== "legacy" || !MENTIONABLE[m.type]) continue;
        const lm = m as LegacyMention;
        const ok = exists(lm.type, lm.id);
        if (ok) resolvable++; else broken++;
        const host = resolveHost(table, row.id);
        let preview = lm.label;
        if (ok) {
          const prefix = prefixOf(lm.type, lm.id);
          if (prefix) preview = formatRef(lm.type, prefix, sourceCodeOf(lm.type, lm.id), lm.label);
        }
        if (entries.length < 100) {
          entries.push({
            type: lm.type,
            id: lm.id,
            label: lm.label,
            table,
            column,
            hostId: row.id,
            hostRoute: host.route,
            hostLabel: host.label,
            resolvable: ok,
            preview,
          });
        }
        total++;
        // продолжаем считать total даже после 100 shown
      }
    }
  }
  return { entries, count: total, total, resolvable, broken, truncated: total > entries.length };
}

function collectLegacyMentionsDetailed(): LegacyEntry[] {
  return scanLegacyMentions().entries;
}

interface DanglingEntry {
  type: string;
  uid: string;
  code: string;
  label: string;
  table: string;
  column: string;
  id: number;
  hostRoute: string | null;
  hostLabel: string | null;
}

// Маршруты хозяев для кликабельных ошибок здоровья — зеркало client/src/entityTypes DETAIL_ROUTES + спутники.
const DIRECT_HOST_ROUTE: Record<string, string> = {
  campaigns: "/campaigns",
  settings: "/settings",
  systems: "/systems",
  players: "/players",
  characters: "/characters",
  setting_locations: "/locations",
  setting_beings: "/beings",
  setting_communities: "/communities",
  artifacts: "/artifacts",
  story_arcs: "/adventures",
  story_scenes: "/scenes",
  sessions: "/sessions",
  compendium_entries: "/compendium",
  setting_calendar_events: "/events",
};

function resolveHost(table: string, id: number): { route: string | null; label: string | null } {
  try {
    if (DIRECT_HOST_ROUTE[table]) {
      const route = `${DIRECT_HOST_ROUTE[table]}/${id}`;
      let label: string | null = null;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const has = (c: string) => cols.some((x) => x.name === c);
      if (has("name")) label = (db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? null;
      else if (has("character_name")) label = (db.prepare(`SELECT character_name as name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? null;
      else if (has("title")) label = (db.prepare(`SELECT title as name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? null;
      else label = `#${id}`;
      return { route, label };
    }
    if (table === "character_chapters") {
      const row = db.prepare(`SELECT character_id, title FROM character_chapters WHERE id = ?`).get(id) as { character_id: number; title: string } | undefined;
      if (row) {
        const lb = (db.prepare(`SELECT character_name as name FROM characters WHERE id = ?`).get(row.character_id) as { name: string } | undefined)?.name ?? `Персонаж #${row.character_id}`;
        return { route: `/characters/${row.character_id}`, label: lb };
      }
    }
    if (table === "being_chapters") {
      const row = db.prepare(`SELECT being_id FROM being_chapters WHERE id = ?`).get(id) as { being_id: number } | undefined;
      if (row) {
        const lb = (db.prepare(`SELECT name FROM setting_beings WHERE id = ?`).get(row.being_id) as { name: string } | undefined)?.name ?? `Существо #${row.being_id}`;
        return { route: `/beings/${row.being_id}`, label: lb };
      }
    }
    if (table === "community_chapters") {
      const row = db.prepare(`SELECT community_id FROM community_chapters WHERE id = ?`).get(id) as { community_id: number } | undefined;
      if (row) {
        const lb = (db.prepare(`SELECT name FROM setting_communities WHERE id = ?`).get(row.community_id) as { name: string } | undefined)?.name ?? `Сообщество #${row.community_id}`;
        return { route: `/communities/${row.community_id}`, label: lb };
      }
    }
    if (table === "location_chapters") {
      const row = db.prepare(`SELECT location_id FROM location_chapters WHERE id = ?`).get(id) as { location_id: number } | undefined;
      if (row) {
        const lb = (db.prepare(`SELECT name FROM setting_locations WHERE id = ?`).get(row.location_id) as { name: string } | undefined)?.name ?? `Локация #${row.location_id}`;
        return { route: `/locations/${row.location_id}`, label: lb };
      }
    }
    if (table === "artifact_chapters") {
      const row = db.prepare(`SELECT artifact_id FROM artifact_chapters WHERE id = ?`).get(id) as { artifact_id: number } | undefined;
      if (row) {
        const lb = (db.prepare(`SELECT name FROM artifacts WHERE id = ?`).get(row.artifact_id) as { name: string } | undefined)?.name ?? `Артефакт #${row.artifact_id}`;
        return { route: `/artifacts/${row.artifact_id}`, label: lb };
      }
    }
    if (table === "statblocks" || table === "gallery_images" || table === "important_dates") {
      const row = db.prepare(`SELECT owner_type, owner_id FROM ${table} WHERE id = ?`).get(id) as { owner_type: string; owner_id: number } | undefined;
      if (row?.owner_type && row.owner_id) {
        const prefixMap: Record<string, string> = { character: "/characters", being: "/beings", community: "/communities", location: "/locations", compendium_entry: "/compendium" };
        const routePrefix = prefixMap[row.owner_type];
        if (routePrefix) {
          const ownerTableMap: Record<string, string> = { character: "characters", being: "setting_beings", community: "setting_communities", location: "setting_locations", compendium_entry: "compendium_entries" };
          const ownerTable = ownerTableMap[row.owner_type];
          let lb: string | null = null;
          if (ownerTable) {
            const col = row.owner_type === "character" ? "character_name" : "name";
            try { lb = (db.prepare(`SELECT ${col} as name FROM ${ownerTable} WHERE id = ?`).get(row.owner_id) as { name: string } | undefined)?.name ?? null; } catch {}
          }
          return { route: `${routePrefix}/${row.owner_id}`, label: lb ?? `${row.owner_type} #${row.owner_id}` };
        }
      }
    }
    if (table === "campaign_entries") {
      const row = db.prepare(`SELECT campaign_id, title FROM campaign_entries WHERE id = ?`).get(id) as { campaign_id: number; title: string } | undefined;
      if (row) return { route: `/campaigns/${row.campaign_id}`, label: row.title || `Кампания #${row.campaign_id}` };
    }
    if (table === "setting_entries") {
      const row = db.prepare(`SELECT setting_id, title FROM setting_entries WHERE id = ?`).get(id) as { setting_id: number; title: string } | undefined;
      if (row) return { route: `/settings/${row.setting_id}`, label: row.title || `Сеттинг #${row.setting_id}` };
    }
    if (table === "story_scene_checks") {
      const row = db.prepare(`SELECT scene_id FROM story_scene_checks WHERE id = ?`).get(id) as { scene_id: number } | undefined;
      if (row) return { route: `/scenes/${row.scene_id}`, label: `Сцена #${row.scene_id}` };
    }
    if (table === "story_scene_rewards") {
      const row = db.prepare(`SELECT scene_id, arc_id FROM story_scene_rewards WHERE id = ?`).get(id) as { scene_id: number | null; arc_id: number | null } | undefined;
      if (row?.scene_id) return { route: `/scenes/${row.scene_id}`, label: `Сцена #${row.scene_id}` };
      if (row?.arc_id) return { route: `/adventures/${row.arc_id}`, label: `Приключение #${row.arc_id}` };
    }
    if (table === "entity_relations") {
      const row = db.prepare(`SELECT from_type, from_id FROM entity_relations WHERE id = ?`).get(id) as { from_type: string; from_id: number } | undefined;
      if (row) {
        const map: Record<string, string> = { character: "/characters", being: "/beings", community: "/communities", location: "/locations", artifact: "/artifacts", player: "/players", setting: "/settings", campaign: "/campaigns" };
        const prefix = map[row.from_type];
        if (prefix) return { route: `${prefix}/${row.from_id}`, label: `${row.from_type} #${row.from_id}` };
      }
    }
  } catch {}
  return { route: null, label: null };
}

function scanDanglingModules(cols?: ReturnType<typeof mentionTextColumns>): { code: string; label: string; count: number; samples: DanglingEntry[] }[] {
  const columns = cols ?? mentionTextColumns();
  const byCode = new Map<string, { label: string; count: number; samples: DanglingEntry[] }>();
  for (const { table, column } of columns) {
    const rows = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%@%' LIMIT 5000`).all() as { id: number; v: string | null }[];
    for (const row of rows) {
      for (const m of scanMentions(row.v || "")) {
        const kind = (m as unknown as { kind: string }).kind;
        if (kind !== "ref") continue;
        const rm = m as unknown as { type: string; uid: string; source: string; label: string };
        if (!MENTIONABLE[rm.type] || idOfUid(rm.type, rm.uid) != null) continue;
        const code = rm.source || "unknown";
        const label = rm.label || rm.uid.slice(0, 8);
        const host = resolveHost(table, row.id);
        const entry: DanglingEntry = { type: rm.type, uid: rm.uid, code, label, table, column, id: row.id, hostRoute: host.route, hostLabel: host.label };
        const cur = byCode.get(code);
        if (cur) {
          cur.count++;
          if (cur.samples.length < 5) cur.samples.push(entry);
        } else byCode.set(code, { label, count: 1, samples: [entry] });
      }
    }
  }
  return [...byCode.entries()].map(([code, v]) => ({ code, label: v.label, count: v.count, samples: v.samples })).sort((a, b) => b.count - a.count).slice(0, 20);
}

/**
 * Подробный список всех мёртвых UID-ссылок: тип, uid, таблица, колонка.
 * Используется repair-эндпоинтом для починки и кликабельным списком здоровья.
 */
function collectDeadUidMentions(cols?: ReturnType<typeof mentionTextColumns>): DanglingEntry[] {
  const columns = cols ?? mentionTextColumns();
  const out: DanglingEntry[] = [];
  for (const { table, column } of columns) {
    const rows = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%@%' LIMIT 5000`).all() as { id: number; v: string | null }[];
    for (const row of rows) {
      for (const m of scanMentions(row.v || "")) {
        if (m.kind !== "ref") continue;
        const rm = m as RefMention;
        if (!MENTIONABLE[rm.type] || idOfUid(rm.type, rm.uid) != null) continue;
        const host = resolveHost(table, row.id);
        out.push({ type: rm.type, uid: rm.uid, code: rm.source, label: rm.label, table, column, id: row.id, hostRoute: host.route, hostLabel: host.label });
      }
    }
  }
  return out;
}

const hostScopePragmaCache = new Map<string, Set<string>>();
function getHostScope(table: string, id: number): { system_id?: number; setting_id?: number } {
  try {
    let colSet = hostScopePragmaCache.get(table);
    if (!colSet) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      colSet = new Set(cols.map((c) => c.name));
      hostScopePragmaCache.set(table, colSet);
    }
    const has = (c: string) => colSet!.has(c);
    if (has("system_id")) {
      const r = db.prepare(`SELECT system_id FROM ${table} WHERE id = ?`).get(id) as { system_id: number | null } | undefined;
      if (r?.system_id) return { system_id: r.system_id };
    }
    if (has("setting_id")) {
      const r = db.prepare(`SELECT setting_id FROM ${table} WHERE id = ?`).get(id) as { setting_id: number | null } | undefined;
      if (r?.setting_id) return { setting_id: r.setting_id };
    }
    if (table === "story_scenes") {
      const r = db.prepare(`SELECT setting_id FROM story_scenes WHERE id = ?`).get(id) as { setting_id: number | null } | undefined;
      if (r?.setting_id) return { setting_id: r.setting_id };
    }
    if (table === "story_arcs") {
      const r = db.prepare(`SELECT setting_id FROM story_arcs WHERE id = ?`).get(id) as { setting_id: number | null } | undefined;
      if (r?.setting_id) return { setting_id: r.setting_id };
    }
  } catch {}
  return {};
}

interface DeadCandidate {
  id: number;
  name: string;
  uid: string;
  prefix: string;
  source: string;
  tier: "exact" | "likely" | "doubtful";
  via: string;
}

type CandidateRow = { id: number; uid: string; name: string; name_original: string | null; aliases: string | null; _aliasesParsed?: string[] | null };

function resolveScope(
  type: string,
  hostTable: string,
  hostId: number,
  code: string
): { scopeSystemId?: number; scopeSettingId?: number } {
  const hostScope = getHostScope(hostTable, hostId);
  let scopeSystemId: number | undefined = hostScope.system_id;
  let scopeSettingId: number | undefined = hostScope.setting_id;
  if (type === "compendium_entry" && code && code !== "unknown") {
    const sys = db.prepare(`SELECT id FROM systems WHERE lower(code)=lower(?) OR lower(name)=lower(?)`).get(code, code) as { id: number } | undefined;
    if (sys) scopeSystemId = sys.id;
  } else if (["being", "location", "community", "artifact", "setting", "adventure", "scene"].includes(type) && code && code !== "unknown") {
    const st = db.prepare(`SELECT id FROM settings WHERE lower(code)=lower(?) OR lower(name)=lower(?)`).get(code, code) as { id: number } | undefined;
    if (st) scopeSettingId = st.id;
  }
  return { scopeSystemId, scopeSettingId };
}

function fetchCandidateRows(
  type: string,
  scopeSystemId: number | undefined,
  scopeSettingId: number | undefined,
  cache: Map<string, CandidateRow[]>
): CandidateRow[] {
  const table = MENTIONABLE[type];
  if (!table) return [];
  const cacheKey = `${type}|${scopeSystemId ?? ""}|${scopeSettingId ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  let rows: CandidateRow[] = [];
  try {
    if (type === "compendium_entry" && scopeSystemId != null) {
      rows = db.prepare(`SELECT id, uid, name, name_original, aliases FROM ${table} WHERE uid IS NOT NULL AND system_id = ?`).all(scopeSystemId) as CandidateRow[];
    } else if (scopeSettingId != null && table !== "compendium_entries" && table !== "systems") {
      const colSet = hostScopePragmaCache.get(table);
      const hasSetting = colSet ? colSet.has("setting_id") : (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === "setting_id");
      if (hasSetting) {
        rows = db.prepare(`SELECT id, uid, name, name_original, aliases FROM ${table} WHERE uid IS NOT NULL AND setting_id = ?`).all(scopeSettingId) as CandidateRow[];
      } else {
        rows = db.prepare(`SELECT id, uid, name, name_original, aliases FROM ${table} WHERE uid IS NOT NULL`).all() as CandidateRow[];
      }
    } else {
      rows = db.prepare(`SELECT id, uid, name, name_original, aliases FROM ${table} WHERE uid IS NOT NULL`).all() as CandidateRow[];
    }
  } catch {
    cache.set(cacheKey, []);
    return [];
  }
  // Парсим aliases один раз на строку (без среза до фильтра — иначе пропускаем «Туманный шаг» за пределами 500)
  for (const r of rows) {
    if (r.aliases && r.aliases.startsWith("[")) {
      try { r._aliasesParsed = JSON.parse(r.aliases) as string[]; } catch { r._aliasesParsed = null; }
    } else r._aliasesParsed = null;
  }
  cache.set(cacheKey, rows);
  return rows;
}

function rankCandidatesForNeedle(rows: CandidateRow[], type: string, needle: string): DeadCandidate[] {
  if (!needle) return [];
  const out: DeadCandidate[] = [];
  for (const r of rows) {
    const nameLow = r.name.trim().toLowerCase();
    const origLow = (r.name_original || "").trim().toLowerCase();
    let tier: DeadCandidate["tier"] | null = null;
    let via = "";
    if (nameLow === needle) { tier = "exact"; via = "имя"; }
    else if (origLow && origLow === needle) { tier = "likely"; via = "оригинал"; }
    else {
      const al = r._aliasesParsed;
      if (al) {
        const found = al.find((a) => a.trim().toLowerCase() === needle);
        if (found) { tier = "likely"; via = `синоним «${found}»`; }
      }
    }
    if (!tier && (nameLow.includes(needle) || needle.includes(nameLow))) { tier = "doubtful"; via = "часть названия"; }
    if (!tier && r._aliasesParsed) {
      const aliasHit = r._aliasesParsed.find((a) => {
        const al = a.trim().toLowerCase();
        return al.includes(needle) || needle.includes(al);
      });
      if (aliasHit) { tier = "doubtful"; via = `синоним «${aliasHit}»`; }
    }
    if (!tier) continue;
    const prefix = prefixOf(type, r.id) || normUid(r.uid).slice(0, 8);
    const source = sourceCodeOf(type, r.id);
    out.push({ id: r.id, name: r.name, uid: normUid(r.uid), prefix, source, tier, via });
  }
  const order = { exact: 0, likely: 1, doubtful: 2 } as const;
  out.sort((a, b) => order[a.tier] - order[b.tier] || a.name.localeCompare(b.name, "ru"));
  return out.slice(0, 10);
}

function findCandidatesForDead(
  type: string,
  label: string,
  hostTable: string,
  hostId: number,
  code: string
): DeadCandidate[] {
  const needle = label.trim().toLowerCase();
  if (!needle || !MENTIONABLE[type]) return [];
  const { scopeSystemId, scopeSettingId } = resolveScope(type, hostTable, hostId, code);
  const cache = new Map<string, CandidateRow[]>();
  const rows = fetchCandidateRows(type, scopeSystemId, scopeSettingId, cache);
  return rankCandidatesForNeedle(rows, type, needle);
}

interface DeadUidGroup {
  type: string;
  uid: string;
  code: string;
  label: string;
  count: number;
  samples: DanglingEntry[];
  candidates: DeadCandidate[];
}

function getDeadUidGroups(): DeadUidGroup[] {
  const all = collectDeadUidMentions();
  const byKey = new Map<string, { type: string; uid: string; code: string; label: string; samples: DanglingEntry[] }>();
  for (const e of all) {
    const key = `${e.type}:${normUid(e.uid)}`;
    const g = byKey.get(key);
    if (g) g.samples.push(e);
    else byKey.set(key, { type: e.type, uid: normUid(e.uid), code: e.code, label: e.label, samples: [e] });
  }
  // Батч: один Map кэша строк на весь вызов — 33 группы → 4-6 SELECT вместо 33
  const rowCache = new Map<string, CandidateRow[]>();
  const groups: DeadUidGroup[] = [];
  for (const g of byKey.values()) {
    const needle = g.label.trim().toLowerCase();
    if (!needle || !MENTIONABLE[g.type]) {
      groups.push({ type: g.type, uid: g.uid, code: g.code, label: g.label, count: g.samples.length, samples: g.samples.slice(0, 20), candidates: [] });
      continue;
    }
    const { scopeSystemId, scopeSettingId } = resolveScope(g.type, g.samples[0].table, g.samples[0].id, g.code);
    const rows = fetchCandidateRows(g.type, scopeSystemId, scopeSettingId, rowCache);
    const candidates = rankCandidatesForNeedle(rows, g.type, needle);
    groups.push({ type: g.type, uid: g.uid, code: g.code, label: g.label, count: g.samples.length, samples: g.samples.slice(0, 20), candidates });
  }
  groups.sort((a, b) => b.count - a.count);
  return groups.slice(0, 50);
}

/**
 * Ищет UID цели по имени метки в пределах системы.
 * Спеллы, фичи, monster_item — по точному имени; для механик-групп ищет по подстроке.
 */
function findBestUidByLabel(type: string, label: string, systemId?: number): string | null {
  const table = MENTIONABLE[type];
  if (!table) return null;

  // Точное совпадение по имени
  let rows: { uid: string }[];
  if (systemId != null) {
    rows = db.prepare(`SELECT uid FROM ${table} WHERE uid IS NOT NULL AND name = ? AND system_id = ?`)
      .all(label, systemId) as { uid: string }[];
  } else {
    rows = db.prepare(`SELECT uid FROM ${table} WHERE uid IS NOT NULL AND name = ?`)
      .all(label) as { uid: string }[];
  }
  if (rows.length === 1) return normUid(rows[0].uid);

  // Совпадение по имени в скобках: "Благословение [Bless]" → ищем "Благословение"
  if (rows.length === 0 && systemId != null) {
    rows = db.prepare(`SELECT uid FROM ${table} WHERE uid IS NOT NULL AND name LIKE ? AND system_id = ?`)
      .all(`${label}%`, systemId) as { uid: string }[];
    if (rows.length === 1) return normUid(rows[0].uid);
  }

  // Fuzzy: первое точное совпадение по нижнему регистру
  if (rows.length === 0 && systemId != null) {
    const fuzzyRows = db.prepare(`SELECT uid, name FROM ${table} WHERE uid IS NOT NULL AND system_id = ?`)
      .all(systemId) as { uid: string; name: string }[];
    const lower = label.toLowerCase();
    const hit = fuzzyRows.find(r => r.name.toLowerCase() === lower || r.name.toLowerCase().startsWith(lower + " "));
    if (hit) return normUid(hit.uid);
  }

  return null;
}

function findBestUidScoped(type: string, label: string, hostTable: string, hostId: number, code: string): string | null {
  const needle = label.trim().toLowerCase();
  if (!needle || !MENTIONABLE[type]) return null;
  const { scopeSystemId, scopeSettingId } = resolveScope(type, hostTable, hostId, code);
  const cache = new Map<string, CandidateRow[]>();
  const rows = fetchCandidateRows(type, scopeSystemId, scopeSettingId, cache);
  const ranked = rankCandidatesForNeedle(rows, type, needle);
  const best = ranked.find((c) => c.tier === "exact" || c.tier === "likely");
  if (!best) return null;
  return best.uid;
}

function scanOrphanFiles(): { path: string; size: number }[] {
  const known = new Set<string>();
  for (const { table, column } of PATH_TABLES) {
    try {
      const rows = db.prepare(`SELECT ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all() as { p: string }[];
      for (const r of rows) {
        const rel = r.p.replace(/\//g, path.sep);
        known.add(rel.toLowerCase());
        try { known.add(path.relative(VAULT_ROOT, vaultAbs(r.p)).toLowerCase()); } catch {}
      }
    } catch {}
  }
  try {
    const arch = db.prepare("SELECT archive_path as p FROM archived_files").all() as { p: string }[];
    for (const r of arch) if (r.p) known.add(path.relative(VAULT_ROOT, vaultAbs(r.p)).toLowerCase());
  } catch {}

  const out: { path: string; size: number }[] = [];
  const stack: string[] = [VAULT_ROOT];
  const skipDirs = new Set(["_Archive"]);
  let walked = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        walked++;
        if (walked > 5000) break;
        const rel = path.relative(VAULT_ROOT, full).toLowerCase();
        if (!known.has(rel)) {
          try {
            const st = fs.statSync(full);
            out.push({ path: path.relative(VAULT_ROOT, full), size: st.size });
          } catch {}
        }
        if (out.length >= 100) break;
      }
    }
    if (out.length >= 100 || walked > 5000) break;
  }
  return out;
}

function scanBracketNames(): { table: string; count: number; sample: string }[] {
  const out: { table: string; count: number; sample: string }[] = [];
  for (const tbl of ["compendium_entries", "setting_beings", "setting_locations", "setting_communities", "artifacts"] as const) {
    try {
      const c = (db.prepare(`SELECT count(*) as c FROM ${tbl} WHERE name LIKE '%[%'`).get() as { c: number }).c;
      if (c === 0) continue;
      const s = (db.prepare(`SELECT name FROM ${tbl} WHERE name LIKE '%[%' LIMIT 1`).get() as { name: string } | undefined)?.name ?? "";
      out.push({ table: tbl, count: c, sample: s });
    } catch {}
  }
  return out;
}

function scanRelinkCandidates(): { resource_id: number; name: string; old_path: string; new_path: string; match: string }[] {
  const missing = findMissingFiles();
  if (missing.length === 0) return [];
  const byName = new Map<string, string>();
  const stack: string[] = [VAULT_ROOT];
  let walked = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "_Archive") continue;
        stack.push(full);
      } else if (e.isFile()) {
        walked++;
        if (walked > 5000) break;
        const low = e.name.toLowerCase();
        if (!byName.has(low)) byName.set(low, full);
      }
    }
    if (walked > 5000) break;
  }
  const out: { resource_id: number; name: string; old_path: string; new_path: string; match: string }[] = [];
  for (const m of missing) {
    const base = path.basename(m.file_path).toLowerCase();
    const found = byName.get(base);
    if (found) {
      out.push({ resource_id: m.resource_id, name: m.name, old_path: m.file_path, new_path: path.relative(VAULT_ROOT, found), match: "name_only" });
      if (out.length >= 20) break;
    }
  }
  return out;
}

async function scanBrokenPathsAsync(): Promise<{ entries: { table: string; column: string; id: number; path: string }[]; total: number; truncated: boolean }> {
  const out: { table: string; column: string; id: number; path: string }[] = [];
  let total = 0;
  for (const { table, column } of PATH_TABLES) {
    try {
      const rows = db.prepare(`SELECT id, ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all() as { id: number; p: string }[];
      for (const r of rows) {
        let broken = false;
        try { await fs.promises.access(vaultAbs(r.p), fs.constants.F_OK); } catch { broken = true; }
        if (broken) {
          total++;
          if (out.length < 200) out.push({ table, column, id: r.id, path: r.p });
        }
      }
    } catch {}
  }
  return { entries: out, total, truncated: total > out.length };
}

async function scanOrphanFilesAsync(): Promise<{ path: string; size: number }[]> {
  const known = new Set<string>();
  for (const { table, column } of PATH_TABLES) {
    try {
      const rows = db.prepare(`SELECT ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all() as { p: string }[];
      for (const r of rows) {
        const rel = r.p.replace(/\//g, path.sep);
        known.add(rel.toLowerCase());
        try { known.add(path.relative(VAULT_ROOT, vaultAbs(r.p)).toLowerCase()); } catch {}
      }
    } catch {}
  }
  try {
    const arch = db.prepare("SELECT archive_path as p FROM archived_files").all() as { p: string }[];
    for (const r of arch) if (r.p) known.add(path.relative(VAULT_ROOT, vaultAbs(r.p)).toLowerCase());
  } catch {}
  const out: { path: string; size: number }[] = [];
  const stack: string[] = [VAULT_ROOT];
  const skipDirs = new Set(["_Archive"]);
  let walked = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        walked++;
        if (walked > 5000) break;
        const rel = path.relative(VAULT_ROOT, full).toLowerCase();
        if (!known.has(rel)) {
          try {
            const st = await fs.promises.stat(full);
            out.push({ path: path.relative(VAULT_ROOT, full), size: st.size });
          } catch {}
        }
        if (out.length >= 100) break;
      }
    }
    if (out.length >= 100 || walked > 5000) break;
    if (walked % 200 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  return out;
}

async function scanRelinkCandidatesAsync(): Promise<{ resource_id: number; name: string; old_path: string; new_path: string; match: string }[]> {
  const missing = findMissingFiles();
  if (missing.length === 0) return [];
  const byName = new Map<string, string[]>();
  const stack: string[] = [VAULT_ROOT];
  let walked = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "_Archive") continue;
        stack.push(full);
      } else if (e.isFile()) {
        walked++;
        if (walked > 5000) break;
        const low = e.name.toLowerCase();
        const list = byName.get(low);
        if (!list) byName.set(low, [full]);
        else list.push(full);
      }
    }
    if (walked > 5000) break;
    if (walked % 200 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  const out: { resource_id: number; name: string; old_path: string; new_path: string; match: string }[] = [];
  for (const m of missing) {
    const base = path.basename(m.file_path).toLowerCase();
    const candidates = byName.get(base);
    if (!candidates || candidates.length === 0) continue;
    let best = candidates[0];
    let match: string = "name_only";
    const known = db.prepare("SELECT size_bytes FROM resource_file_sizes WHERE resource_id = ?").get(m.resource_id) as { size_bytes: number } | undefined;
    if (known) {
      for (const cand of candidates) {
        try {
          const sz = (await fs.promises.stat(cand)).size;
          if (sz === known.size_bytes) { best = cand; match = "name_and_size"; break; }
        } catch {}
      }
    }
    out.push({ resource_id: m.resource_id, name: m.name, old_path: m.file_path, new_path: path.relative(VAULT_ROOT, best), match });
    if (out.length >= 20) break;
  }
  return out;
}

// GET /api/health/scan — только чтение, по кнопке (C-P0-6: 1× mentionTextColumns вместо 4×, C-P1-1: total vs shown)
healthRouter.get("/scan", healthScanLimiter, async (_req, res) => {
  const cols = mentionTextColumns();
  const [brokenPathsRes, orphanFiles, relinkCandidates] = await Promise.all([
    scanBrokenPathsAsync(),
    scanOrphanFilesAsync(),
    scanRelinkCandidatesAsync(),
  ]);
  const missingFiles = findMissingFiles();
  const orphans = countOrphans();
  const orphansTotal = Object.values(orphans).reduce((a, b) => a + b, 0);
  const seq = seqDrift();
  const brokenLinks = scanBrokenLinks(cols);
  const legacy = scanLegacyMentions(cols);
  const danglingModules = scanDanglingModules(cols);
  const deadUidMentions = collectDeadUidMentions(cols);
  const bracketNames = scanBracketNames();
  res.json({
    brokenPaths: brokenPathsRes.entries, brokenPathsCount: brokenPathsRes.total, brokenPathsShown: brokenPathsRes.entries.length, brokenPathsTruncated: brokenPathsRes.truncated,
    missingFiles, missingFilesCount: missingFiles.length,
    orphans, orphansTotal,
    seq, seqWorst: seq[0] ?? null,
    brokenLinks, brokenLinksCount: brokenLinks.count,
    legacy, legacyCount: legacy.count, legacyResolvable: legacy.resolvable, legacyBroken: legacy.broken, legacyShown: legacy.entries.length, legacyTruncated: legacy.truncated,
    danglingModules, danglingModulesCount: danglingModules.reduce((a, b) => a + b.count, 0),
    deadUidMentions, deadUidMentionsCount: deadUidMentions.length,
    orphanFiles, orphanFilesCount: orphanFiles.length,
    relinkCandidates, relinkCandidatesCount: relinkCandidates.length,
    bracketNames, bracketNamesCount: bracketNames.reduce((a, b) => a + b.count, 0),
  });
});

// POST /api/health/orphans/clean
healthRouter.post("/orphans/clean", (req, res) => {
  const removed = sweepOrphans();
  auditLog(req as never, "orphans/clean", { removed });
  res.json({ removed, canUndo: !!getLastOrphanBackup() });
});
healthRouter.post("/orphans/undo", (req, res) => {
  const backup = getLastOrphanBackup();
  if (!backup) return res.status(404).json({ error: "nothing to undo" });
  const restored = restoreLastOrphanBackup();
  auditLog(req as never, "orphans/undo", { restored, at: backup.at });
  res.json({ restored });
});
healthRouter.get("/orphans/undo", (req, res) => {
  const backup = getLastOrphanBackup();
  res.json({ canUndo: !!backup, at: backup?.at ?? null, count: backup ? Object.values(backup.rows).reduce((a, r) => a + r.length, 0) : 0 });
});

// POST /api/health/links/strip — убрать битые legacy-ссылки
healthRouter.post("/links/strip", (req, res) => {
  const removed = rewriteAllMentions((m) =>
    (m as { kind: string }).kind === "legacy" && MENTIONABLE[(m as { type: string }).type] && !exists((m as { type: string }).type, (m as { id: number }).id) ? (m as { label: string }).label : null
  );
  auditLog(req as never, "links/strip", { removed });
  res.json({ removed });
});

// POST /api/health/uid-links/fix — починить мёртвые UID-ссылки, заменив UID на актуальные (C-P0-7: rewriteAllMentions + ключ type:uid, без коллизий)
healthRouter.post("/uid-links/fix", (req, res) => {
  const dead = collectDeadUidMentions();
  if (dead.length === 0) return res.json({ fixed: 0, unresolved: 0 });

  const deadByKey = new Map<string, DanglingEntry>();
  for (const e of dead) {
    const k = `${e.type}:${normUid(e.uid)}`;
    if (!deadByKey.has(k)) deadByKey.set(k, e);
  }

  let fixed = 0;
  let unresolved = 0;
  const fixMap = new Map<string, string | null>(); // "type:oldUidNorm" -> newUidNorm | null

  rewriteAllMentions((m) => {
    if (m.kind !== "ref") return null;
    const rm = m as RefMention;
    if (!MENTIONABLE[rm.type]) return null;
    if (idOfUid(rm.type, rm.uid) != null) return null; // уже живая

    const key = `${rm.type}:${normUid(rm.uid)}`;
    let newUid: string | null | undefined = fixMap.get(key);
    if (newUid === undefined) {
      const sample = deadByKey.get(key);
      const found = sample ? findBestUidScoped(rm.type, rm.label, sample.table, sample.id, sample.code) : findBestUidByLabel(rm.type, rm.label);
      fixMap.set(key, found ?? null);
      newUid = found ?? null;
    }
    if (!newUid) { unresolved++; return rm.label; } // не нашли — схлопнуть в текст
    fixed++;
    const newId = idOfUid(rm.type, newUid);
    const source = newId ? (sourceCodeOf(rm.type, newId) || rm.source) : rm.source;
    return `[[${rm.type}@${newUid}|${source}|${rm.label}]]`;
  });

  auditLog(req as never, "uid-links/fix", { fixed, unresolved });
  res.json({ fixed, unresolved });
});

// GET /api/health/legacy-details — превью id→uid без записи
healthRouter.get("/legacy-details", (_req, res) => {
  const data = scanLegacyMentions();
  res.json(data);
});

// POST /api/health/legacy-fix — перевести все legacy на uid (resolvable) или схлопнуть (broken)
healthRouter.post("/legacy-fix", (req, res) => {
  let fixed = 0;
  let stripped = 0;
  const changed = rewriteAllMentions((m) => {
    if (m.kind !== "legacy" || !MENTIONABLE[m.type]) return null;
    const lm = m as LegacyMention;
    if (!exists(lm.type, lm.id)) { stripped++; return lm.label; }
    const prefix = prefixOf(lm.type, lm.id);
    if (!prefix) { stripped++; return lm.label; }
    fixed++;
    return formatRef(lm.type, prefix, sourceCodeOf(lm.type, lm.id), lm.label);
  });
  auditLog(req as never, "legacy-fix", { fixed, stripped, changed });
  res.json({ fixed, stripped, changed });
});

// GET /api/health/dead-uid-search — ручной поиск кандидата: ?type=being&q=мир&limit=20
healthRouter.get("/dead-uid-search", (req, res) => {
  const type = String(req.query.type || "").trim();
  const q = String(req.query.q || "").trim();
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 20));
  const table = MENTIONABLE[type];
  if (!table) return res.status(400).json({ error: "unknown type" });
  if (q.length < 2) return res.status(400).json({ error: "q too short (≥2)" });
  if (q.length > 80) return res.status(400).json({ error: "q too long" });
  const needle = q.toLowerCase();
  let rows: { id: number; uid: string; name: string; name_original: string | null; aliases: string | null }[] = [];
  try {
    const like = `%${q.toLowerCase()}%`;
    // SQL pre-filter via lower_u (unicode-aware) — 80 instead of 3115 rows, then JS rank + aliases
    const pre = db.prepare(
      `SELECT id, uid, name, name_original, aliases FROM ${table}
       WHERE uid IS NOT NULL AND (lower_u(name) LIKE lower_u(?) OR lower_u(COALESCE(name_original,'')) LIKE lower_u(?) OR lower_u(COALESCE(aliases,'')) LIKE lower_u(?))
       LIMIT 80`
    ).all(like, like, like) as typeof rows;
    const filtered = pre.filter((r) => {
      const n = r.name.toLowerCase();
      const o = (r.name_original || "").toLowerCase();
      if (n.includes(needle) || o.includes(needle)) return true;
      try {
        const al = r.aliases ? (JSON.parse(r.aliases) as string[]) : [];
        return al.some((a) => a.toLowerCase().includes(needle));
      } catch { return false; }
    });
    filtered.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aExact = an === needle ? 0 : an.startsWith(needle) ? 1 : 2;
      const bExact = bn === needle ? 0 : bn.startsWith(needle) ? 1 : 2;
      return aExact - bExact || a.name.localeCompare(b.name, "ru");
    });
    rows = filtered.slice(0, limit);
  } catch {
    return res.json({ results: [] });
  }
  const results = rows.map((r) => {
    const prefix = prefixOf(type, r.id) || normUid(r.uid).slice(0, 8);
    const source = sourceCodeOf(type, r.id);
    const nl = r.name.trim().toLowerCase();
    const ol = (r.name_original || "").trim().toLowerCase();
    let tier: DeadCandidate["tier"] = "doubtful";
    let via = "часть";
    if (nl === needle) { tier = "exact"; via = "имя"; }
    else if (ol && ol === needle) { tier = "likely"; via = "оригинал"; }
    else {
      try {
        const al = r.aliases ? (JSON.parse(r.aliases) as string[]) : [];
        const hit = al.find((a) => a.trim().toLowerCase() === needle);
        if (hit) { tier = "likely"; via = `синоним «${hit}»`; }
        else if (nl.startsWith(needle)) { tier = "likely"; via = "начинается"; }
        else {
          const aliasHit = al.find((a) => {
            const alLow = a.trim().toLowerCase();
            return alLow.includes(needle) || needle.includes(alLow);
          });
          if (aliasHit) { tier = "doubtful"; via = `синоним «${aliasHit}»`; }
        }
      } catch {
        if (nl.startsWith(needle)) { tier = "likely"; via = "начинается"; }
      }
    }
    // Если до сих пор doubtful но startsWith — повысить до likely
    if (tier === "doubtful" && nl.startsWith(needle)) { tier = "likely"; via = "начинается"; }
    return { id: r.id, name: r.name, uid: normUid(r.uid), prefix, source, tier, via };
  });
  res.json({ results });
});

// GET /api/health/dead-uid-details — мёртвые uid с кандидатами для ручной верификации
healthRouter.get("/dead-uid-details", (_req, res) => {
  const groups = getDeadUidGroups();
  res.json({ groups, count: groups.reduce((a, g) => a + g.count, 0) });
});

// POST /api/health/dead-uid-fix — ручной выбор: fixes=[{type, uid, newId|null}]
healthRouter.post("/dead-uid-fix", (req, res) => {
  const fixes = (req.body as { fixes?: { type: string; uid: string; newId: number | null }[] })?.fixes;
  if (!Array.isArray(fixes) || fixes.length === 0) return res.status(400).json({ error: "fixes required" });
  if (fixes.length > 100) return res.status(400).json({ error: "too many fixes (max 100)" });
  const fixMap = new Map<string, { prefix: string; source: string } | null>(); // "type:oldUidNorm" -> {prefix,source}|null
  for (const f of fixes) {
    if (!f || typeof f.type !== "string" || typeof f.uid !== "string") continue;
    const type = f.type.trim();
    const rawUid = f.uid.trim();
    if (!MENTIONABLE[type]) continue;
    if (!/^[0-9a-fA-F-]{8,36}$/.test(rawUid)) continue;
    if (f.newId != null && (!Number.isInteger(f.newId) || f.newId <= 0 || f.newId > 1_000_000_000)) continue;
    const key = `${type}:${normUid(rawUid)}`;
    if (f.newId == null) { fixMap.set(key, null); continue; }
    const table = MENTIONABLE[type];
    const uidRow = db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(f.newId) as { uid: string } | undefined;
    if (!uidRow?.uid) { fixMap.set(key, null); continue; }
    const newUid = normUid(uidRow.uid);
    const prefix = prefixOf(type, f.newId) || newUid.slice(0, 8);
    const source = sourceCodeOf(type, f.newId);
    fixMap.set(key, { prefix, source });
  }
  if (fixMap.size === 0) return res.status(400).json({ error: "no valid fixes" });
  let fixed = 0;
  let stripped = 0;
  let changedFields = 0;
  changedFields = rewriteAllMentions((m) => {
    if (m.kind !== "ref" || !MENTIONABLE[m.type]) return null;
    const rm = m as RefMention;
    if (idOfUid(rm.type, rm.uid) != null) return null;
    const key = `${rm.type}:${normUid(rm.uid)}`;
    if (!fixMap.has(key)) return null; // не выбран — не трогаем
    const choice = fixMap.get(key);
    if (!choice) { stripped++; return rm.label; }
    fixed++;
    return formatRef(rm.type, choice.prefix, choice.source, rm.label);
  });
  auditLog(req as never, "dead-uid-fix", { fixed, stripped, changedFields, fixes: fixes.length });
  res.json({ fixed, stripped, changedFields });
});

// POST /api/health/relink — перепривязать один пропавший файл по кандидату (C-P0-8: проверка существования)
healthRouter.post("/relink", (req, res) => {
  const { resource_id, new_path } = req.body as { resource_id?: number; new_path?: string };
  if (!resource_id || !new_path) return res.status(400).json({ error: "resource_id и new_path обязательны" });
  if (new_path.includes("\0") || new_path.includes("..") || /[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(new_path)) return res.status(400).json({ error: "Недопустимый путь" });
  const abs = path.isAbsolute(new_path) ? path.resolve(new_path) : vaultAbs(new_path);
  const resolved = path.resolve(abs);
  if (!path.isAbsolute(new_path)) {
    const root = path.resolve(VAULT_ROOT);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return res.status(400).json({ error: "path outside vault" });
  }
  if (!fs.existsSync(resolved)) return res.status(400).json({ error: "файл не найден: " + new_path });
  relinkResource(resource_id, new_path);
  auditLog(req as never, "relink", { resource_id, new_path });
  res.json({ ok: true });
});

// POST /api/health/path/clear — убрать битый путь (U-P0-2: ставить NULL вместо битого *_path)
healthRouter.post("/path/clear", (req, res) => {
  const { table, column, id } = req.body as { table?: string; column?: string; id?: number };
  if (!table || !column || !id) return res.status(400).json({ error: "table, column, id required" });
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) return res.status(400).json({ error: "invalid name" });
  const allowed = PATH_TABLES.some((p) => p.table === table && p.column === column);
  if (!allowed) return res.status(400).json({ error: "column not allowed" });
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return res.status(404).json({ error: "table not found" });
  // Проверка существования строки и что колонка действительно содержит путь
  const row = db.prepare(`SELECT ${column} as v FROM ${table} WHERE id=?`).get(id) as { v: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "row not found" });
  db.prepare(`UPDATE ${table} SET ${column}=NULL WHERE id=?`).run(id);
  auditLog(req as never, "path/clear", { table, column, id });
  res.json({ ok: true, cleared: `${table}.${column}#${id}` });
});

// POST /api/health/open-folder — открыть папку в проводнике (C-P0-4: только в Electron, case-insensitive на Windows)
healthRouter.post("/open-folder", (req, res) => {
  const { path: relPath } = req.body as { path?: string };
  if (!relPath) return res.status(400).json({ error: "path required" });
  // Защита: только внутри vault (case-insensitive на Windows)
  const abs = vaultAbs(relPath);
  const resolved = path.resolve(abs);
  const root = path.resolve(VAULT_ROOT);
  const isWin = process.platform === "win32";
  const normResolved = isWin ? resolved.toLowerCase() : resolved;
  const normRoot = isWin ? root.toLowerCase() : root;
  if (normResolved !== normRoot && !normResolved.startsWith(normRoot + path.sep.toLowerCase())) {
    return res.status(400).json({ error: "path outside vault" });
  }
  try {
    // Если путь — файл, открываем его папку с выделением; если папка — саму папку
    const st = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    if (st?.isFile()) openInFileExplorer(resolved, true);
    else openInFileExplorer(st ? resolved : path.dirname(resolved), false);
  } catch {}
  auditLog(req as never, "open-folder", { path: relPath });
  res.json({ ok: true });
});

// POST /api/health/orphan/archive — перенести сироты в _Archive/orphans/YYYY-MM-DD
healthRouter.post("/orphan/archive", (req, res) => {
  const { paths } = req.body as { paths?: string[] };
  if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: "paths required" });
  if (paths.length > 100) return res.status(400).json({ error: "too many paths (max 100)" });
  const day = new Date().toISOString().slice(0, 10);
  const archiveBase = path.join(VAULT_ROOT, "_Archive", "orphans", day);
  try { fs.mkdirSync(archiveBase, { recursive: true }); } catch {}
  let moved = 0;
  const errors: string[] = [];
  for (const rel of paths) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("..")) { errors.push(rel); continue; }
    const abs = vaultAbs(rel);
    const resolved = path.resolve(abs);
    const root = path.resolve(VAULT_ROOT);
    if (resolved === root || !resolved.startsWith(root + path.sep)) { errors.push(rel); continue; }
    if (resolved.toLowerCase().includes(path.join("_archive").toLowerCase())) { errors.push(rel); continue; }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { errors.push(rel); continue; }
    const base = sanitizeName(path.basename(resolved));
    let target = path.join(archiveBase, base);
    const ext = path.extname(base);
    const nameNoExt = path.basename(base, ext);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(archiveBase, `${nameNoExt}-${n}${ext}`);
    try { fs.renameSync(resolved, target); moved++; } catch { errors.push(rel); }
  }
  auditLog(req as never, "orphan/archive", { moved, requested: paths.length, errors: errors.length });
  res.json({ moved, errors });
});

// POST /api/health/orphan/create-resources — создать ресурсы из сирот (global scope)
healthRouter.post("/orphan/create-resources", (req, res) => {
  const { paths } = req.body as { paths?: string[] };
  if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: "paths required" });
  if (paths.length > 100) return res.status(400).json({ error: "too many paths" });
  let created = 0;
  const maxPosRow = db.prepare("SELECT COALESCE(MAX(position), -1) as m FROM resources").get() as { m: number };
  let pos = maxPosRow.m + 1;
  for (const rel of paths) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("..")) continue;
    const abs = vaultAbs(rel);
    const resolved = path.resolve(abs);
    const root = path.resolve(VAULT_ROOT);
    if (resolved === root || !resolved.startsWith(root + path.sep)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    const base = path.basename(rel);
    const name = base.replace(/\.[^.]+$/, "") || base;
    const ext = path.extname(base).toLowerCase();
    const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].includes(ext);
    const category = isImage ? "image" : ext === ".pdf" ? "pdf" : ext === ".mp3" || ext === ".ogg" || ext === ".wav" ? "audio" : "other";
    db.prepare(
      `INSERT INTO resources (name, type, scope, category, file_path, position) VALUES (?, 'note', 'global', ?, ?, ?)`
    ).run(name, category, vaultRel(rel), pos++);
    created++;
  }
  auditLog(req as never, "orphan/create-resources", { created, requested: paths.length });
  res.json({ created });
});

// POST /api/health/orphan/attach — пришить сироту к сущности в указанный *_path
healthRouter.post("/orphan/attach", (req, res) => {
  const { orphanPath, table, column, id } = req.body as { orphanPath?: string; table?: string; column?: string; id?: number };
  if (!orphanPath || !table || !column || !id) return res.status(400).json({ error: "orphanPath, table, column, id required" });
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) return res.status(400).json({ error: "invalid name" });
  const allowed = PATH_TABLES.some((p) => p.table === table && p.column === column);
  if (!allowed) return res.status(400).json({ error: "column not allowed" });
  if (typeof orphanPath !== "string" || orphanPath.includes("\0") || orphanPath.includes("..")) return res.status(400).json({ error: "invalid orphanPath" });
  const abs = vaultAbs(orphanPath);
  const resolved = path.resolve(abs);
  const root = path.resolve(VAULT_ROOT);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return res.status(400).json({ error: "orphanPath outside vault" });
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return res.status(404).json({ error: "orphan file not found" });
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!tableExists) return res.status(404).json({ error: "table not found" });
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id) as { id: number } | undefined;
  if (!row) return res.status(404).json({ error: "row not found" });
  const rel = vaultRel(orphanPath);
  db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(rel, id);
  auditLog(req as never, "orphan/attach", { orphanPath: rel, table, column, id });
  res.json({ ok: true, path: rel });
});

// POST /api/health/orphan/attach-batch — пакетное пришивание (браузер сирот, выбор много сразу)
healthRouter.post("/orphan/attach-batch", (req, res) => {
  const body = req.body as { items?: { orphanPath: string; table: string; column: string; id: number }[]; paths?: string[]; table?: string; column?: string; id?: number };
  let items: { orphanPath: string; table: string; column: string; id: number }[] = [];
  if (Array.isArray(body.items) && body.items.length > 0) {
    items = body.items;
  } else if (Array.isArray(body.paths) && body.table && body.column && body.id) {
    items = body.paths.map((p) => ({ orphanPath: p, table: body.table!, column: body.column!, id: body.id! }));
  } else {
    return res.status(400).json({ error: "items (or paths+table+column+id) required" });
  }
  if (items.length === 0) return res.status(400).json({ error: "items required" });
  if (items.length > 100) return res.status(400).json({ error: "too many items (max 100)" });
  const errors: { orphanPath: string; error: string }[] = [];
  let attached = 0;
  for (const it of items) {
    const { orphanPath, table, column, id } = it as { orphanPath?: string; table?: string; column?: string; id?: number };
    if (!orphanPath || !table || !column || !id) { errors.push({ orphanPath: String(orphanPath ?? ""), error: "missing fields" }); continue; }
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) { errors.push({ orphanPath, error: "invalid name" }); continue; }
    const allowed = PATH_TABLES.some((p) => p.table === table && p.column === column);
    if (!allowed) { errors.push({ orphanPath, error: "column not allowed" }); continue; }
    if (typeof orphanPath !== "string" || orphanPath.includes("\0") || orphanPath.includes("..")) { errors.push({ orphanPath, error: "invalid orphanPath" }); continue; }
    const abs = vaultAbs(orphanPath);
    const resolved = path.resolve(abs);
    const root = path.resolve(VAULT_ROOT);
    if (resolved === root || !resolved.startsWith(root + path.sep)) { errors.push({ orphanPath, error: "outside vault" }); continue; }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { errors.push({ orphanPath, error: "not found" }); continue; }
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!tableExists) { errors.push({ orphanPath, error: "table not found" }); continue; }
    const row = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id) as { id: number } | undefined;
    if (!row) { errors.push({ orphanPath, error: "row not found" }); continue; }
    const rel = vaultRel(orphanPath);
    try {
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(rel, id);
      attached++;
    } catch (e) {
      errors.push({ orphanPath, error: String(e instanceof Error ? e.message : e) });
    }
  }
  auditLog(req as never, "orphan/attach-batch", { attached, total: items.length, errors: errors.length });
  res.json({ attached, total: items.length, errors });
});

// POST /api/health/seq/reset — C-P0-5: allowlist только AUTOINCREMENT таблицы
healthRouter.post("/seq/reset", (req, res) => {
  const { table } = req.body as { table?: string };
  if (!table) return res.status(400).json({ error: "table is required" });
  if (!/^[a-z_]+$/.test(table)) return res.status(400).json({ error: "invalid table name" });
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return res.status(404).json({ error: "table not found" });
  // Только таблицы с AUTOINCREMENT имеют строку в sqlite_sequence
  const hasSeq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table);
  if (!hasSeq) return res.status(400).json({ error: "table has no AUTOINCREMENT sequence" });
  const mx = (db.prepare(`SELECT max(id) as m FROM ${table}`).get() as { m: number | null }).m;
  const next = mx ?? 0;
  db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?").run(next, table);
  // если строки в sqlite_sequence нет (таблица пустая) — вставим
  const after = db.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table) as { seq: number } | undefined;
  if (!after) {
    try { db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, next); } catch {}
  }
  auditLog(req as never, "seq/reset", { table, maxId: mx, seq: next });
  res.json({ table, maxId: mx, seq: next });
});
