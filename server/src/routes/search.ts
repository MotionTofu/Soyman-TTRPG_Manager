import { Router, type Response } from "express";
import {
  normalizeSearchText, SCENE_SEARCH_LABELS, searchTextPattern,
  type BookFormat, type SceneSearchField, type SearchFragment, type SearchFragments,
} from "@soyman/shared";
import { db } from "../db/db";
import { ENTITY_KINDS } from "../db/entityKinds";
import type { AuthedRequest } from "../services/auth";
import { appendTextMatches, libraryFileFormat, markdownSearchBlocks, searchLibraryFile, type LibrarySearchFile } from "../services/librarySearch";
import { readSearchScope, searchId } from "../services/searchScope";

export const searchRouter = Router();

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle?: string;
  system_id?: number;
  section_id?: number;
  kind?: string;
  level?: number | null;
  ability?: string;
  // Human-readable owning setting/campaign/system, e.g. "Сеттинг: Асгард" —
  // shown next to the type chip in search results so same-named entities
  // across different settings/campaigns are distinguishable at a glance.
  context?: string;
  // Только у локаций, найденных через точку (план «Зоны», этап 7): совпавшая
  // точка. Строка ведёт на родителя, клиент подсвечивает строку точки.
  spot_id?: number;
  spot_name?: string;
  book_format?: BookFormat;
  campaign_id?: number;
  version?: string;
  fragments?: SearchFragment[];
  match_count?: number;
}

const BOOK_CONTEXT = `LEFT JOIN library_books b ON b.source_type = 'resource' AND b.source_id = r.id
  LEFT JOIN library_departments dpt ON dpt.id = b.department_id
  LEFT JOIN library_shelves sh ON sh.id = b.shelf_id`;

function libraryContext(file: LibrarySearchFile) {
  return [file.library_department, file.library_section].filter(Boolean).join(" · ") || "Книжная библиотека";
}

async function searchBookText(req: AuthedRequest, res: Response, q: string, scope: ReturnType<typeof readSearchScope>) {
  const format = req.query.format;
  const match = searchTextPattern(normalizeSearchText(q));
  const files = db.prepare(`SELECT r.id, r.name, r.type, r.category, r.file_path,
      dpt.name AS library_department, sh.name AS library_section
    FROM resources r ${BOOK_CONTEXT}
    WHERE b.id IS NOT NULL AND r.archived_at IS NULL AND r.file_path IS NOT NULL AND r.type <> 'pdf_notes'
    ORDER BY r.id`).all() as LibrarySearchFile[];
  const results: SearchResult[] = [];
  for (const file of files) {
    if (res.destroyed) return;
    const bookFormat = libraryFileFormat(file);
    if (!bookFormat || (format && format !== bookFormat) || !file.file_path) continue;
    if (scope && !scope.includes("resource", file.id)) continue;
    const matches = await searchLibraryFile(file.file_path, bookFormat, match, () => res.destroyed);
    if (matches.match_count) results.push({
      type: "resource", id: file.id, title: file.name, book_format: bookFormat, context: libraryContext(file), ...matches,
    });
  }
  if (!res.destroyed) res.json(results);
}

// Cut a readable fragment around the first match so the user sees the context.
function snippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 50);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end).replace(/\s+/g, " ").trim() +
    (end < text.length ? "…" : "")
  );
}

searchRouter.get("/", (req: AuthedRequest, res, next) => {
  void runSearch(req, res).catch(next);
});

searchRouter.get("/sections", (req, res) => {
  const system = searchId(req.query.system_id);
  const sections = db.prepare(`SELECT section.id, section.name, section.system_id
    FROM system_sections section JOIN systems system ON system.id = section.system_id
    WHERE system.archived_at IS NULL AND (? IS NULL OR section.system_id = ?)
    ORDER BY system.name, section.position, section.id`).all(system, system);
  res.json(sections);
});

async function runSearch(req: AuthedRequest, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json([]);
  const qLower = q.toLowerCase();
  const typesParam = (req.query.types as string) || "";
  const requested = typesParam ? typesParam.split(",") : null;
  const systemIdParam = req.query.system_id as string | undefined;
  const systemId = systemIdParam ? Number(systemIdParam) : null;
  const panel = req.query.panel === "1";
  const campaign = searchId(req.query.campaign_id);
  const setting = searchId(req.query.setting_id);
  const scoped = req.query.campaign_id !== undefined || req.query.setting_id !== undefined;
  const scope = scoped && (campaign || setting) ? readSearchScope(campaign, setting) : null;
  if (scoped && !scope) return res.json([]);
  if (req.query.book_text === "1") return searchBookText(req, res, q, scope);
  // Bound against lower_u(column) — a custom Unicode-aware lower() (see
  // db.ts) — since SQLite's own LIKE/LOWER only case-fold ASCII and would
  // otherwise silently miss "Москва" when the user types "москва".
  const like = `%${qLower}%`;
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const push = (r: SearchResult) => {
    if (scope && !scope.includes(r.type, r.id, r.system_id)) return;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(r);
  };

  const wantsType = (t: string) => !requested || requested.includes(t);

  if (wantsType("campaign")) {
    const rows = db
      .prepare("SELECT id, name FROM campaigns WHERE lower_u(name) LIKE ? AND archived_at IS NULL")
      .all(like) as { id: number; name: string }[];
    rows.forEach((r) => push({ type: "campaign", id: r.id, title: r.name }));

    // preproduction text fields
    const pre = db
      .prepare(
        `SELECT p.campaign_id as id, c.name,
                (p.adventure_challenge || ' ' || p.gameplay_styles || ' ' || p.background || ' ' ||
                 p.adventure_stakes_hooks || ' ' || p.threads_clues_lore) as blob
         FROM preproduction p JOIN campaigns c ON c.id = p.campaign_id
         WHERE lower_u(blob) LIKE ? AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    pre.forEach((r) =>
      push({ type: "campaign", id: r.id, title: r.name, subtitle: snippet(r.blob, q) })
    );

    // notes / quotes / tasks of player campaigns
    const entries = db
      .prepare(
        `SELECT e.campaign_id as id, c.name, (e.title || ' ' || e.content) as blob
         FROM campaign_entries e JOIN campaigns c ON c.id = e.campaign_id
         WHERE lower_u(blob) LIKE ? AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    entries.forEach((r) =>
      push({ type: "campaign", id: r.id, title: r.name, subtitle: snippet(r.blob, q) })
    );
  }

  if (wantsType("setting")) {
    const rows = db
      .prepare(
        "SELECT id, name, description FROM settings WHERE (lower_u(name) LIKE ? OR lower_u(description) LIKE ?) AND archived_at IS NULL"
      )
      .all(like, like) as { id: number; name: string; description: string }[];
    rows.forEach((r) =>
      push({
        type: "setting",
        id: r.id,
        title: r.name,
        subtitle:
          r.description && r.description.toLowerCase().includes(qLower)
            ? snippet(r.description, q)
            : undefined,
      })
    );

    // notes / internet-ideas entries of settings
    const settingEntries = db
      .prepare(
        `SELECT e.setting_id as id, s.name, (e.title || ' ' || e.content) as blob
         FROM setting_entries e JOIN settings s ON s.id = e.setting_id
         WHERE lower_u(blob) LIKE ? AND s.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    settingEntries.forEach((r) =>
      push({ type: "setting", id: r.id, title: r.name, subtitle: snippet(r.blob, q) })
    );
  }

  if (wantsType("player")) {
    const rows = db
      .prepare(
        "SELECT id, name, notes FROM players WHERE (lower_u(name) LIKE ? OR lower_u(notes) LIKE ?) AND archived_at IS NULL"
      )
      .all(like, like) as { id: number; name: string; notes: string }[];
    rows.forEach((r) =>
      push({
        type: "player",
        id: r.id,
        title: r.name,
        subtitle:
          r.notes && r.notes.toLowerCase().includes(qLower)
            ? snippet(r.notes, q)
            : undefined,
      })
    );
  }

  if (wantsType("character")) {
    const rows = db
      .prepare(
        `SELECT ch.id, ch.character_name, c.name as campaign_name
         FROM characters ch LEFT JOIN campaigns c ON c.id = ch.campaign_id
         WHERE lower_u(ch.character_name) LIKE ? AND ch.archived_at IS NULL`
      )
      .all(like) as { id: number; character_name: string; campaign_name: string | null }[];
    rows.forEach((r) =>
      push({
        type: "character",
        id: r.id,
        title: r.character_name,
        context: r.campaign_name ? `Кампания: ${r.campaign_name}` : "Вне кампании",
      })
    );

    // chapter texts (backstory, arcs, inventory, etc.) + connections notes
    const chapters = db
      .prepare(
        `SELECT ch.character_id as id, c.character_name, (ch.title || ' ' || ch.content) as blob
         FROM character_chapters ch JOIN characters c ON c.id = ch.character_id
         WHERE lower_u(blob) LIKE ? AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; character_name: string; blob: string }[];
    chapters.forEach((r) =>
      push({ type: "character", id: r.id, title: r.character_name, subtitle: snippet(r.blob, q) })
    );

    const conn = db
      .prepare(
        `SELECT id, character_name, connections_notes FROM characters
         WHERE lower_u(connections_notes) LIKE ? AND archived_at IS NULL`
      )
      .all(like) as { id: number; character_name: string; connections_notes: string }[];
    conn.forEach((r) =>
      push({
        type: "character",
        id: r.id,
        title: r.character_name,
        subtitle: snippet(r.connections_notes, q),
      })
    );
  }

  if (wantsType("resource")) {
    const rows = db
      .prepare(
        `SELECT r.*, b.id AS library_book_id, dpt.name AS library_department, sh.name AS library_section FROM resources r
         ${BOOK_CONTEXT}
         LEFT JOIN pdf_note_documents d ON d.markdown_resource_id = r.id
         WHERE (lower_u(r.name) LIKE ? OR lower_u(r.notes) LIKE ? OR lower_u(r.tags) LIKE ?)
           AND r.archived_at IS NULL AND (r.type <> 'pdf_notes' OR d.author_user_id = ?)`
      )
      .all(like, like, like, req.user!.id) as (LibrarySearchFile & {
      scope: string;
      notes: string;
      library_book_id: number | null;
    })[];
    rows.forEach((r) => {
      const bookFormat = panel && r.library_book_id != null ? libraryFileFormat(r) : undefined;
      push({
        type: "resource",
        id: r.id,
        title: r.name,
        book_format: bookFormat,
        context: bookFormat ? libraryContext(r) : undefined,
        subtitle:
          r.notes && r.notes.toLowerCase().includes(qLower)
            ? snippet(r.notes, q)
            : r.scope,
      });
    });
  }

  if (wantsType("mastering")) {
    const rows = db
      .prepare(
        "SELECT id, title, category, content FROM mastering_notes WHERE (lower_u(title) LIKE ? OR lower_u(content) LIKE ?) AND archived_at IS NULL"
      )
      .all(like, like) as { id: number; title: string; category: string; content: string }[];
    rows.forEach((r) =>
      push({
        type: "mastering",
        id: r.id,
        title: r.title,
        subtitle:
          r.content && r.content.toLowerCase().includes(qLower)
            ? snippet(r.content, q)
            : r.category,
      })
    );
  }

  // Имя ищется вместе с синонимами и оригиналом: «Sea Ward» и «Морской округ»
  // должны находить тот же район, что и «Приморский район».
  // Точки (`role=spot`) в прямую выдачу не идут: 25 комнат дали бы 25 строк.
  // Они находятся следующим запросом — одной строкой родителя с бейджем
  // (план «Зоны локаций», этап 7).
  if (wantsType("location")) {
    const rows = db
      .prepare(
        `SELECT sl.id, sl.name, sl.kind, sl.description, s.name as setting_name
         FROM setting_locations sl JOIN settings s ON s.id = sl.setting_id
         WHERE (lower_u(sl.name || ' ' || sl.aliases || ' ' || sl.name_original) LIKE ?
                OR lower_u(sl.description) LIKE ?) AND sl.archived_at IS NULL AND sl.role != 'spot'`
      )
      .all(like, like) as { id: number; name: string; kind: string; description: string; setting_name: string }[];
    rows.forEach((r) =>
      push({
        type: "location",
        id: r.id,
        title: r.name,
        subtitle:
          r.description && r.description.toLowerCase().includes(qLower)
            ? snippet(r.description, q)
            : r.kind || "location",
        context: `Сеттинг: ${r.setting_name}`,
      })
    );

    // Совпадение с точкой ведёт на родителя: дедуп push оставляет прямое
    // попадание родителя, если он совпал сам; ранг у родителя через точку
    // ниже (заголовок не содержит запрос) — прямые попадания выше.
    const spotRows = db
      .prepare(
        `SELECT p.id as parent_id, p.name as parent_name,
                sl.id as spot_id, sl.name as spot_name, sl.description as spot_desc,
                s.name as setting_name
         FROM setting_locations sl
         JOIN setting_locations p ON p.id = sl.parent_id
         JOIN settings s ON s.id = sl.setting_id
         WHERE sl.role = 'spot'
           AND (lower_u(sl.name || ' ' || sl.aliases || ' ' || sl.name_original) LIKE ?
                OR lower_u(sl.description) LIKE ?)
           AND sl.archived_at IS NULL AND p.archived_at IS NULL`
      )
      .all(like, like) as {
      parent_id: number;
      parent_name: string;
      spot_id: number;
      spot_name: string;
      spot_desc: string;
      setting_name: string;
    }[];
    spotRows.forEach((r) =>
      push({
        type: "location",
        id: r.parent_id,
        title: r.parent_name,
        subtitle:
          `Точка: ${r.spot_name}` +
          (r.spot_desc && r.spot_desc.toLowerCase().includes(qLower)
            ? ` · ${snippet(r.spot_desc, q)}`
            : ""),
        context: `Сеттинг: ${r.setting_name}`,
        spot_id: r.spot_id,
        spot_name: r.spot_name,
      })
    );

    const locationChapters = db
      .prepare(
        `SELECT sl.id, sl.name, sl.role, p.id as parent_id, p.name as parent_name,
                (lc.title || ' ' || lc.content) as blob
         FROM location_chapters lc JOIN setting_locations sl ON sl.id = lc.location_id
         LEFT JOIN setting_locations p ON p.id = sl.parent_id AND p.archived_at IS NULL
         WHERE lower_u(blob) LIKE ? AND sl.archived_at IS NULL`
      )
      .all(like) as {
      id: number;
      name: string;
      role: string;
      parent_id: number | null;
      parent_name: string | null;
      blob: string;
    }[];
    locationChapters.forEach((r) => {
      // Глава точки — тоже находка родителя (той же строкой с бейджем).
      if (r.role === "spot" && r.parent_id != null) {
        push({
          type: "location",
          id: r.parent_id,
          title: r.parent_name ?? r.name,
          subtitle: `Точка: ${r.name} · ${snippet(r.blob, q)}`,
          spot_id: r.id,
          spot_name: r.name,
        });
        return;
      }
      push({ type: "location", id: r.id, title: r.name, subtitle: snippet(r.blob, q) });
    });
  }

  if (wantsType("being")) {
    const rows = db
      .prepare(
        `SELECT sb.id, sb.name, sb.category, s.name as setting_name,
                (sb.history || ' ' || sb.behavior || ' ' || sb.statblock_short || ' ' || sb.statblock_full) as blob
         FROM setting_beings sb JOIN settings s ON s.id = sb.setting_id
         WHERE (lower_u(sb.name || ' ' || sb.aliases || ' ' || sb.name_original) LIKE ?
                OR lower_u(blob) LIKE ?) AND sb.archived_at IS NULL`
      )
      .all(like, like) as { id: number; name: string; category: string; setting_name: string; blob: string }[];
    rows.forEach((r) =>
      push({
        type: "being",
        id: r.id,
        title: r.name,
        subtitle:
          r.blob && r.blob.toLowerCase().includes(qLower)
            ? snippet(r.blob, q)
            : r.category,
        context: `Сеттинг: ${r.setting_name}`,
      })
    );

    // Главы досье НПЦ ищутся так же, как главы локации, сообщества и
    // персонажа: колонки history/behavior выше покрывают только те поля,
    // что завёл шаблон, а всё дописанное мастером живёт здесь.
    const beingChapters = db
      .prepare(
        `SELECT sb.id, sb.name, s.name as setting_name, (bc.title || ' ' || bc.content) as blob
         FROM being_chapters bc
         JOIN setting_beings sb ON sb.id = bc.being_id
         JOIN settings s ON s.id = sb.setting_id
         WHERE lower_u(blob) LIKE ? AND sb.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; setting_name: string; blob: string }[];
    beingChapters.forEach((r) =>
      push({
        type: "being",
        id: r.id,
        title: r.name,
        subtitle: snippet(r.blob, q),
        context: `Сеттинг: ${r.setting_name}`,
      })
    );
  }

  if (wantsType("artifact")) {
    const rows = db
      .prepare(
        `SELECT a.id, a.name, s.name as setting_name, (a.owner || ' ' || a.power || ' ' || a.history || ' ' || a.notes) as blob
         FROM artifacts a JOIN settings s ON s.id = a.setting_id
         WHERE (lower_u(a.name || ' ' || a.aliases || ' ' || a.name_original) LIKE ?
                OR lower_u(blob) LIKE ?) AND a.archived_at IS NULL`
      )
      .all(like, like) as { id: number; name: string; setting_name: string; blob: string }[];
    rows.forEach((r) =>
      push({
        type: "artifact",
        id: r.id,
        title: r.name,
        subtitle:
          r.blob && r.blob.toLowerCase().includes(qLower)
            ? snippet(r.blob, q)
            : undefined,
        context: `Сеттинг: ${r.setting_name}`,
      })
    );
  }

  if (wantsType("adventure")) {
    const rows = db.prepare(`SELECT a.id, a.name,
          coalesce(o.name, a.name) title, coalesce(o.description, a.description) description,
          coalesce(o.hook, a.hook) hook, st.name setting_name, c.name campaign_name
        FROM story_arcs a JOIN settings st ON st.id = a.setting_id
        LEFT JOIN campaigns c ON c.id = @campaign
        LEFT JOIN story_arcs o ON o.source_arc_id = a.id AND o.campaign_id = @campaign AND o.archived_at IS NULL
        WHERE a.archived_at IS NULL AND st.archived_at IS NULL AND a.campaign_id IS NULL AND NOT a.is_default
          AND (@scoped = 0 OR a.setting_id = @setting)
          AND (@campaign IS NULL OR coalesce(a.parent_id, a.id) IN
            (SELECT arc_id FROM campaign_adventures WHERE campaign_id = @campaign))
          AND (lower_u(coalesce(o.name, a.name)) LIKE @like OR lower_u(coalesce(o.description, a.description)) LIKE @like
               OR lower_u(coalesce(o.hook, a.hook)) LIKE @like)`).all({
      campaign, scoped: Number(scoped), setting: scope?.params.setting ?? null, like,
    }) as { id: number; title: string; description: string; hook: string; setting_name: string; campaign_name: string | null }[];
    rows.forEach(row => {
      const text = [row.description, row.hook].find(value => value.toLowerCase().includes(qLower));
      push({
        type: "adventure", id: row.id, title: row.title, subtitle: text ? snippet(text, q) : undefined,
        context: row.campaign_name ? `Кампания: ${row.campaign_name}` : `Сеттинг: ${row.setting_name}`,
        campaign_id: campaign ?? undefined,
      });
    });
  }

  if (wantsType("scene")) {
    const fields = Object.entries(SCENE_SEARCH_LABELS) as [SceneSearchField, string][];
    const rows = db.prepare(`SELECT sc.id, coalesce(library.name, sc.name) AS name, sc.campaign_id, st.name AS setting_name,
        coalesce(c.name, context.name) AS campaign_name, a.name AS arc_name,
        ${fields.map(([field]) => `coalesce(library.${field}, sc.${field}) AS ${field}`).join(", ")}
      FROM story_scenes sc LEFT JOIN settings st ON st.id = sc.setting_id
      LEFT JOIN story_scenes library ON library.id = sc.library_scene_id
      LEFT JOIN story_arcs a ON a.id = sc.arc_id
      LEFT JOIN campaigns c ON c.id = sc.campaign_id
      LEFT JOIN campaigns context ON context.id = @campaign
      WHERE sc.archived_at IS NULL AND a.archived_at IS NULL AND st.archived_at IS NULL AND c.archived_at IS NULL
        AND (
          (@campaign IS NOT NULL AND sc.setting_id = @setting
            AND (a.id IS NULL OR a.is_default OR coalesce(a.parent_id, a.id) IN
              (SELECT arc_id FROM campaign_adventures WHERE campaign_id = @campaign))
            AND (sc.campaign_id = @campaign OR (sc.campaign_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM story_scenes o WHERE o.source_scene_id = sc.id
                AND o.campaign_id = @campaign AND o.archived_at IS NULL))))
          OR (@campaign IS NULL AND ((@scoped = 1 AND sc.setting_id = @setting AND sc.campaign_id IS NULL)
            OR (@scoped = 0 AND (@panel = 1 OR sc.campaign_id IS NULL))))
        )`).all({ campaign, setting: scope?.params.setting ?? null, scoped: Number(scoped), panel: Number(panel) }) as
      (Record<SceneSearchField, string> & { id: number; name: string; campaign_id: number | null; setting_name: string | null;
        campaign_name: string | null; arc_name: string | null })[];
    const query = searchTextPattern(normalizeSearchText(q));
    for (const row of rows) {
      const matches: SearchFragments = { fragments: [], match_count: 0 };
      for (const [field, label] of fields) {
        const value = row[field]?.trim();
        if (!value) continue;
        const previousFields = matches.match_count;
        for (const block of await markdownSearchBlocks(value)) {
          appendTextMatches(matches, block.text, query, label, occurrence => ({ field, occurrence }), matches.match_count - previousFields);
        }
      }
      if (!matches.match_count && !row.name.toLowerCase().includes(qLower)) continue;
      const version = row.campaign_id != null ? "Версия кампании" : row.setting_name ? "Оригинал сеттинга" : undefined;
      const context = row.campaign_name ? `Кампания: ${row.campaign_name}`
        : row.arc_name ? `Приключение: ${row.arc_name}` : row.setting_name ? `Сеттинг: ${row.setting_name}` : undefined;
      push({
        type: "scene", id: row.id, title: row.name, context, version, ...matches,
        campaign_id: row.campaign_id ?? campaign ?? undefined,
        subtitle: matches.fragments[0] ? matches.fragments[0].before + matches.fragments[0].match + matches.fragments[0].after : undefined,
      });
    }
  }

  if (wantsType("community")) {
    const rows = db
      .prepare(
        `SELECT sc.id, sc.name, s.name as setting_name,
                (sc.description || ' ' || sc.history || ' ' || sc.current_situation || ' ' || sc.features || ' ' || sc.goals) as blob
         FROM setting_communities sc JOIN settings s ON s.id = sc.setting_id
         WHERE (lower_u(sc.name || ' ' || sc.aliases || ' ' || sc.name_original) LIKE ?
                OR lower_u(blob) LIKE ?) AND sc.archived_at IS NULL`
      )
      .all(like, like) as { id: number; name: string; setting_name: string; blob: string }[];
    rows.forEach((r) =>
      push({
        type: "community",
        id: r.id,
        title: r.name,
        subtitle:
          r.blob && r.blob.toLowerCase().includes(qLower)
            ? snippet(r.blob, q)
            : undefined,
        context: `Сеттинг: ${r.setting_name}`,
      })
    );

    const communityChapters = db
      .prepare(
        `SELECT sc.id, sc.name, (cc.title || ' ' || cc.content) as blob
         FROM community_chapters cc JOIN setting_communities sc ON sc.id = cc.community_id
         WHERE lower_u(blob) LIKE ? AND sc.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    communityChapters.forEach((r) =>
      push({ type: "community", id: r.id, title: r.name, subtitle: snippet(r.blob, q) })
    );
  }

  if (wantsType("session")) {
    const rows = db
      .prepare(
        `SELECT s.id, s.date, c.name as campaign_name,
                (COALESCE(s.title,'') || ' ' || COALESCE(s.idea_notes,'') || ' ' ||
                 COALESCE((SELECT group_concat(n.text, ' ') FROM session_notes n WHERE n.session_id = s.id), '')) as blob
         FROM sessions s
         JOIN campaigns c ON c.id = s.campaign_id
         WHERE (lower_u(c.name) LIKE ? OR lower_u(s.date) LIKE ? OR lower_u(blob) LIKE ?) AND s.archived_at IS NULL`
      )
      .all(like, like, like) as {
      id: number;
      date: string;
      campaign_name: string;
      blob: string;
    }[];
    rows.forEach((r) =>
      push({
        type: "session",
        id: r.id,
        title: `${r.campaign_name} — ${r.date}`,
        subtitle:
          r.blob && r.blob.trim() && r.blob.toLowerCase().includes(qLower)
            ? snippet(r.blob, q)
            : "session",
      })
    );
  }

  if (wantsType("compendium_entry")) {
    const kindParam = req.query.kind as string | undefined;
    // Синонимы и оригинальное название ищутся наравне с именем — как у
    // сущностей сеттинга: «Goblin Boss» должен находить «Гоблина-вожака».
    const clauses = ["lower_u(e.name || ' ' || e.aliases || ' ' || e.name_original) LIKE ?"];
    const args: (string | number)[] = [like];
    if (systemId != null) {
      clauses.push("e.system_id = ?");
      args.push(systemId);
    }
    const sectionId = searchId(req.query.section_id);
    if (sectionId != null) {
      clauses.push("e.section_id = ?");
      args.push(sectionId);
    }
    if (kindParam) {
      // Список через запятую: палитра холста ищет предметы сразу двумя
      // видами (magic_item и equipment), и два запроса ради одного поля —
      // это два запроса на каждую букву в поисковой строке.
      const kinds = kindParam.split(",").map((k) => k.trim()).filter(Boolean);
      clauses.push(`e.kind IN (${kinds.map(() => "?").join(",")})`);
      args.push(...kinds);
    }
    const rows = db
      .prepare(
        `SELECT e.id, e.name, e.kind, e.level, e.data, e.system_id, e.section_id, s.name as system_name,
                p.name as parent_name
         FROM compendium_entries e
         JOIN systems s ON s.id = e.system_id
         LEFT JOIN compendium_entries p ON p.id = e.parent_id
         WHERE ${clauses.join(" AND ")}`
      )
      .all(...args) as {
      id: number;
      name: string;
      kind: string;
      level: number | null;
      data: string;
      system_id: number;
      section_id: number;
      system_name: string;
      parent_name: string | null;
    }[];
    rows.forEach((r) => {
      // Only mechanic_item entries carry a governing ability (tool
      // proficiencies), and only when the compendium editor set one — see
      // client/src/components/CompendiumSection.tsx's TOOL_ABILITY_FIELD.
      let ability: string | undefined;
      if (r.kind === "mechanic_item") {
        try {
          const data = JSON.parse(r.data) as { ability?: string };
          ability = data.ability || undefined;
        } catch {
          // ignore malformed data
        }
      }
      const groupHint = r.parent_name ? ` · ${r.parent_name}` : "";
      push({
        type: "compendium_entry",
        id: r.id,
        title: r.name,
        subtitle: `${r.kind}${groupHint} · ${r.system_name}`,
        system_id: r.system_id,
        section_id: r.section_id,
        kind: r.kind,
        level: r.level,
        ability,
        context: `Система: ${r.system_name}${groupHint ? ` — ${r.parent_name}` : ""}`,
      });
    });
  }

  // --- Спутники сущностей ---------------------------------------------
  //
  // Важные даты, подписи картинок, статблоки и заметки на связях лежат в
  // своих таблицах, но своей страницы не имеют: находиться они должны как та
  // сущность, на которой написаны. Поэтому результат идёт с типом владельца,
  // а `wantsType` проверяется по нему же — фильтры в панели поиска остаются
  // честными.
  //
  // `push` оставляет первое попадание на пару «тип+id»: если существо уже
  // нашлось по имени, его подпись не затрётся обрывком подписи к картинке.
  //
  // Имена таблиц берутся из этого списка, а не из запроса, — как в
  // `ARCHIVE_TABLES`, чтобы подстановка в `${}` оставалась безопасной.
  // Владельцы спутников, которых имеет смысл искать: те, кто владеет
  // статблоками или картинками галереи И участвует в общем поиске. Раньше
  // список был набран руками и разошёлся с уборкой — в нём был артефакт,
  // которого уборка не знала.
  const SATELLITE_OWNERS: { type: string; table: string; nameCol: string }[] = ENTITY_KINDS
    // `belongsTo !== "system"` отсекает записи компендиума: у них свой блок
    // поиска выше (см. wantsType("compendium_entry")), который уже читает и
    // статблок, — общий проход дал бы вторую выдачу той же записи.
    .filter(
      (k) =>
        k.searchable &&
        k.nameCol &&
        k.belongsTo !== "system" &&
        (k.owns.includes("statblocks") || k.owns.includes("gallery_images"))
    )
    .map((k) => ({ type: k.kind, table: k.table, nameCol: k.nameCol as string }));

  const pushOwnerHits = (
    owner: { type: string; table: string; nameCol: string },
    label: string,
    sql: string,
    params: unknown[]
  ) => {
    const rows = db.prepare(sql).all(...(params as [])) as { id: number; name: string; blob: string }[];
    rows.forEach((r) =>
      push({ type: owner.type, id: r.id, title: r.name, subtitle: `${label} · ${snippet(r.blob, q)}` })
    );
  };

  for (const owner of SATELLITE_OWNERS) {
    if (!wantsType(owner.type)) continue;

    // Важные даты: заводятся у существа, сообщества, локации и персонажа.
    if (owner.type !== "artifact") {
      pushOwnerHits(
        owner,
        "Важная дата",
        `SELECT o.id, o.${owner.nameCol} as name, (d.title || ' ' || d.description) as blob
           FROM important_dates d JOIN ${owner.table} o ON o.id = d.owner_id
          WHERE d.owner_type = ? AND lower_u(d.title || ' ' || d.description) LIKE ?
            AND o.archived_at IS NULL`,
        [owner.type, like]
      );
    }

    // Подписи к картинкам галереи. Подпись — единственное место, где Мастер
    // пишет словами, что на изображении; без неё картинка не находится ничем.
    pushOwnerHits(
      owner,
      "Подпись к изображению",
      `SELECT o.id, o.${owner.nameCol} as name, g.caption as blob
         FROM gallery_images g JOIN ${owner.table} o ON o.id = g.owner_id
        WHERE g.owner_type = ? AND lower_u(g.caption) LIKE ? AND o.archived_at IS NULL`,
      [owner.type, like]
    );

    // Заметки на связях: пишутся на исходном конце связи, там и ищутся.
    pushOwnerHits(
      owner,
      "Заметка на связи",
      `SELECT o.id, o.${owner.nameCol} as name, (n.title || ' ' || n.content) as blob
         FROM link_notes n
         JOIN generic_links l ON l.id = n.link_id
         JOIN ${owner.table} o ON o.id = l.from_id
        WHERE l.from_type = ? AND lower_u(n.title || ' ' || n.content) LIKE ?
          AND o.archived_at IS NULL`,
      [owner.type, like]
    );

    // Статблоки есть только у существа и персонажа.
    if (owner.type === "being" || owner.type === "character") {
      // Поле `content` у нетекстовых форматов — это JSON целиком, и обрывок
      // из него в подписи читается как мусор. Поэтому для них показывается
      // только пометка, а фрагмент берётся из заметки Мастера.
      const rows = db
        .prepare(
          `SELECT o.id, o.${owner.nameCol} as name, sb.format, sb.kind, sb.note, sb.content
             FROM statblocks sb JOIN ${owner.table} o ON o.id = sb.owner_id
            WHERE sb.owner_type = ? AND (lower_u(sb.note) LIKE ? OR lower_u(sb.content) LIKE ?)
              AND o.archived_at IS NULL`
        )
        .all(owner.type, like, like) as {
        id: number;
        name: string;
        format: string;
        kind: string;
        note: string;
        content: string;
      }[];
      rows.forEach((r) => {
        const inNote = r.note && r.note.toLowerCase().includes(qLower);
        const readable = r.format === "text" || inNote;
        push({
          type: owner.type,
          id: r.id,
          title: r.name,
          subtitle: readable
            ? `Статблок · ${snippet(inNote ? r.note : r.content, q)}`
            : "Статблок",
        });
      });
    }
  }

  // Картинки раздела «Для игроков» принадлежат кампании: своей страницы у
  // раздела нет, открывается он вкладкой кампании.
  if (wantsType("campaign")) {
    const sectionImages = db
      .prepare(
        `SELECT c.id, c.name, g.caption as blob
           FROM gallery_images g
           JOIN campaign_player_sections ps ON ps.id = g.owner_id
           JOIN campaigns c ON c.id = ps.campaign_id
          WHERE g.owner_type = 'campaign_player_section' AND lower_u(g.caption) LIKE ?
            AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    sectionImages.forEach((r) =>
      push({ type: "campaign", id: r.id, title: r.name, subtitle: `Подпись к изображению · ${snippet(r.blob, q)}` })
    );

    // Напоминания Мастера самому себе — «спросить у Лёши про долг гильдии».
    const reminders = db
      .prepare(
        `SELECT c.id, c.name, r.message as blob
           FROM gm_reminders r JOIN campaigns c ON c.id = r.target_id
          WHERE r.target_type = 'campaign' AND lower_u(r.message) LIKE ? AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    reminders.forEach((r) =>
      push({ type: "campaign", id: r.id, title: r.name, subtitle: `Напоминание · ${snippet(r.blob, q)}` })
    );

    // Хроника кампании. Своей страницы у события кампании нет (в отличие от
    // события сеттинга), поэтому ведём на кампанию — там вкладка хроники.
    const events = db
      .prepare(
        `SELECT c.id, c.name,
                (e.title || ' ' || e.description || ' ' || e.full_description || ' ' || e.consequences) as blob
           FROM campaign_calendar_events e JOIN campaigns c ON c.id = e.campaign_id
          WHERE lower_u(e.title || ' ' || e.description || ' ' || e.full_description || ' ' || e.consequences) LIKE ?
            AND c.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    events.forEach((r) =>
      push({ type: "campaign", id: r.id, title: r.name, subtitle: `Событие хроники · ${snippet(r.blob, q)}` })
    );
  }

  if (wantsType("player")) {
    const reminders = db
      .prepare(
        `SELECT p.id, p.name, r.message as blob
           FROM gm_reminders r JOIN players p ON p.id = r.target_id
          WHERE r.target_type = 'player' AND lower_u(r.message) LIKE ? AND p.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    reminders.forEach((r) =>
      push({ type: "player", id: r.id, title: r.name, subtitle: `Напоминание · ${snippet(r.blob, q)}` })
    );
  }

  // Событие хроники сеттинга — единственный из спутников со своей страницей
  // (`/events/:id`), поэтому оно и результат отдельного типа, а не запись
  // сеттинга: иначе «Битва при Красном броде» вела бы на сеттинг, и искать
  // её пришлось бы второй раз уже глазами.
  if (wantsType("setting_event")) {
    const rows = db
      .prepare(
        `SELECT e.id, e.title, s.name as setting_name,
                (e.description || ' ' || e.full_description || ' ' || e.consequences) as blob
           FROM setting_calendar_events e JOIN settings s ON s.id = e.setting_id
          WHERE (lower_u(e.title) LIKE ?
                 OR lower_u(e.description || ' ' || e.full_description || ' ' || e.consequences) LIKE ?)
            AND s.archived_at IS NULL`
      )
      .all(like, like) as { id: number; title: string; setting_name: string; blob: string }[];
    rows.forEach((r) =>
      push({
        type: "setting_event",
        id: r.id,
        title: r.title,
        subtitle: r.blob && r.blob.toLowerCase().includes(qLower) ? snippet(r.blob, q) : undefined,
        context: `Сеттинг: ${r.setting_name}`,
      })
    );
  }

  // Rank results so exact/prefix name matches surface above matches that
  // only hit deep in a description/notes blob — previously results were in
  // whatever order each type's query happened to run, so a long note
  // mentioning the query could outrank the entity actually named for it.
  const rank = (r: SearchResult): number => {
    const title = r.title.toLowerCase();
    if (title === qLower) return 0;
    if (title.startsWith(qLower)) return 1;
    if (title.includes(qLower)) return 2;
    return 3; // matched only in subtitle/blob
  };
  results.sort((a, b) => rank(a) - rank(b));

  res.json(results);
}
