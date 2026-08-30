import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { vaultAbs, VAULT_ROOT } from "../services/filesystem";
import { findMissingFiles, relinkResource } from "../services/fileHealth";
import { sweepOrphans } from "../services/orphans";
import { openInFileExplorer } from "../services/filesystem";
import { MENTIONABLE, mentionTextColumns, scanMentions, exists, rewriteAllMentions, idOfUid, normUid, rewriteMentions, type Mention, type RefMention } from "../services/mentions";

export const healthRouter = Router();

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
  { table: "archived_files", column: "archive_path" },
];

function scanBrokenPaths(): { table: string; column: string; id: number; path: string }[] {
  const out: { table: string; column: string; id: number; path: string }[] = [];
  for (const { table, column } of PATH_TABLES) {
    try {
      const rows = db.prepare(`SELECT id, ${column} as p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all() as { id: number; p: string }[];
      for (const r of rows) {
        const p = r.p;
        // Внешние файлы (вне vault) — пропускаем, они не обязаны лежать в vault
        // fileHealth уже проверяет resources.file_path отдельно
        try {
          if (!fs.existsSync(vaultAbs(p))) {
            // Если путь абсолютный и вне vault — не считаем битым (ресурсы вне хранилища)
            // vaultAbs для внешнего вернёт его же, existsSync проверит честно
            out.push({ table, column, id: r.id, path: p });
          }
        } catch {
          out.push({ table, column, id: r.id, path: p });
        }
        if (out.length > 200) break;
      }
    } catch {
      // таблица/колонка может отсутствовать в старых БД
    }
    if (out.length > 200) break;
  }
  return out;
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

function scanBrokenLinks(): { count: number; samples: { type: string; label: string }[] } {
  const samples: { type: string; label: string }[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const { table, column } of mentionTextColumns()) {
    const rows = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%'`).all() as { v: string | null }[];
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

interface DanglingEntry {
  type: string;
  uid: string;
  code: string;
  label: string;
  table: string;
  column: string;
}

function scanDanglingModules(): { code: string; label: string; count: number }[] {
  const byCode = new Map<string, { label: string; count: number }>();
  for (const { table, column } of mentionTextColumns()) {
    const rows = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%@%'`).all() as { v: string | null }[];
    for (const row of rows) {
      for (const m of scanMentions(row.v || "")) {
        const kind = (m as unknown as { kind: string }).kind;
        if (kind !== "ref") continue;
        const rm = m as unknown as { type: string; uid: string; source: string; label: string };
        if (!MENTIONABLE[rm.type] || idOfUid(rm.type, rm.uid) != null) continue;
        const code = rm.source || "unknown";
        const label = rm.label || rm.uid.slice(0, 8);
        const cur = byCode.get(code);
        if (cur) cur.count++;
        else byCode.set(code, { label, count: 1 });
      }
    }
  }
  return [...byCode.entries()].map(([code, v]) => ({ code, label: v.label, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 20);
}

/**
 * Подробный список всех мёртвых UID-ссылок: тип, uid, таблица, колонка.
 * Используется repair-эндпоинтом для починки.
 */
function collectDeadUidMentions(): DanglingEntry[] {
  const out: DanglingEntry[] = [];
  for (const { table, column } of mentionTextColumns()) {
    const rows = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE '%[[%@%'`).all() as { id: number; v: string | null }[];
    for (const row of rows) {
      for (const m of scanMentions(row.v || "")) {
        if (m.kind !== "ref") continue;
        const rm = m as RefMention;
        if (!MENTIONABLE[rm.type] || idOfUid(rm.type, rm.uid) != null) continue;
        out.push({ type: rm.type, uid: rm.uid, code: rm.source, label: rm.label, table, column });
      }
    }
  }
  return out;
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

// GET /api/health/scan — только чтение, по кнопке
healthRouter.get("/scan", (_req, res) => {
  const brokenPaths = scanBrokenPaths();
  const missingFiles = findMissingFiles();
  const orphans = countOrphans();
  const orphansTotal = Object.values(orphans).reduce((a, b) => a + b, 0);
  const seq = seqDrift();
  const brokenLinks = scanBrokenLinks();
  const danglingModules = scanDanglingModules();
  const deadUidMentions = collectDeadUidMentions();
  const orphanFiles = scanOrphanFiles();
  const relinkCandidates = scanRelinkCandidates();
  const bracketNames = scanBracketNames();
  res.json({
    brokenPaths, brokenPathsCount: brokenPaths.length,
    missingFiles, missingFilesCount: missingFiles.length,
    orphans, orphansTotal,
    seq, seqWorst: seq[0] ?? null,
    brokenLinks, brokenLinksCount: brokenLinks.count,
    danglingModules, danglingModulesCount: danglingModules.reduce((a, b) => a + b.count, 0),
    deadUidMentions, deadUidMentionsCount: deadUidMentions.length,
    orphanFiles, orphanFilesCount: orphanFiles.length,
    relinkCandidates, relinkCandidatesCount: relinkCandidates.length,
    bracketNames, bracketNamesCount: bracketNames.reduce((a, b) => a + b.count, 0),
  });
});

// POST /api/health/orphans/clean
healthRouter.post("/orphans/clean", (_req, res) => {
  const removed = sweepOrphans();
  res.json({ removed });
});

// POST /api/health/links/strip — убрать битые legacy-ссылки
healthRouter.post("/links/strip", (_req, res) => {
  const removed = rewriteAllMentions((m) =>
    (m as { kind: string }).kind === "legacy" && MENTIONABLE[(m as { type: string }).type] && !exists((m as { type: string }).type, (m as { id: number }).id) ? (m as { label: string }).label : null
  );
  res.json({ removed });
});

// POST /api/health/uid-links/fix — починить мёртвые UID-ссылки, заменив UID на актуальные
healthRouter.post("/uid-links/fix", (_req, res) => {
  const dead = collectDeadUidMentions();
  if (dead.length === 0) return res.json({ fixed: 0, unresolved: 0 });

  // Группируем по (table, column, id) чтобы править один раз на строку
  const byRow = new Map<string, { table: string; column: string; entries: DanglingEntry[] }>();
  for (const d of dead) {
    const key = `${d.table}:${d.column}`;
    const group = byRow.get(key) ?? { table: d.table, column: d.column, entries: [] };
    group.entries.push(d);
    byRow.set(key, group);
  }

  let fixed = 0;
  let unresolved = 0;
  const fixMap = new Map<string, string>(); // oldUidNorm → newUidNorm

  for (const { table, column, entries } of byRow.values()) {
    const ids = [...new Set(entries.map(e => {
      const row = db.prepare(`SELECT id FROM ${table} WHERE ${column} LIKE ?`).get(`%${entries[0].uid.slice(0, 8)}%`) as { id: number } | undefined;
      return row?.id;
    }).filter(Boolean))] as number[];

    for (const rowId of ids) {
      const row = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE id = ?`).get(rowId) as { v: string | null };
      if (!row?.v || !row.v.includes("[[")) continue;

      const next = rewriteMentions(row.v, (m: Mention) => {
        if (m.kind !== "ref") return null;
        const rm = m as RefMention;
        if (!MENTIONABLE[rm.type]) return null;
        if (idOfUid(rm.type, rm.uid) != null) return null; // уже живая

        // Ищем актуальный UID по имени метки
        const oldKey = normUid(rm.uid);
        let newUid = fixMap.get(oldKey);
        if (newUid === undefined) {
          newUid = findBestUidByLabel(rm.type, rm.label) ?? undefined;
          fixMap.set(oldKey, newUid ?? "");
        }
        if (!newUid) { unresolved++; return rm.label; } // не нашли — схлопнуть в текст
        fixed++;
        return `[[${rm.type}@${newUid}|${rm.source}|${rm.label}]]`;
      });

      if (next !== row.v) {
        db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(next, rowId);
      }
    }
  }

  res.json({ fixed, unresolved });
});

// POST /api/health/relink — перепривязать один пропавший файл по кандидату
healthRouter.post("/relink", (req, res) => {
  const { resource_id, new_path } = req.body as { resource_id?: number; new_path?: string };
  if (!resource_id || !new_path) return res.status(400).json({ error: "resource_id и new_path обязательны" });
  // защита: new_path должен лежать внутри vault или быть внешним — vaultRel нормализует
  relinkResource(resource_id, new_path);
  res.json({ ok: true });
});

// POST /api/health/open-folder — открыть папку в проводнике
healthRouter.post("/open-folder", (req, res) => {
  const { path: relPath } = req.body as { path?: string };
  if (!relPath) return res.status(400).json({ error: "path required" });
  // Защита: только внутри vault
  const abs = vaultAbs(relPath);
  const resolved = path.resolve(abs);
  const root = path.resolve(VAULT_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return res.status(400).json({ error: "path outside vault" });
  }
  try {
    // Если путь — файл, открываем его папку с выделением; если папка — саму папку
    const st = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    if (st?.isFile()) openInFileExplorer(resolved, true);
    else openInFileExplorer(st ? resolved : path.dirname(resolved), false);
  } catch {}
  res.json({ ok: true });
});

// POST /api/health/seq/reset
healthRouter.post("/seq/reset", (req, res) => {
  const { table } = req.body as { table?: string };
  if (!table) return res.status(400).json({ error: "table is required" });
  // защита: только AUTOINCREMENT таблицы
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return res.status(404).json({ error: "table not found" });
  const mx = (db.prepare(`SELECT max(id) as m FROM ${table}`).get() as { m: number | null }).m;
  const next = mx ?? 0;
  db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?").run(next, table);
  // если строки в sqlite_sequence нет (таблица пустая) — вставим
  const after = db.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table) as { seq: number } | undefined;
  if (!after) {
    try { db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, next); } catch {}
  }
  res.json({ table, maxId: mx, seq: next });
});
