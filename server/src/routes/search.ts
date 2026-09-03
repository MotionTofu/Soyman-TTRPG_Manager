import { Router } from "express";
import { db } from "../db/db";

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

searchRouter.get("/", (req, res) => {
  const q = ((req.query.q as string) || "").trim();
  const qLower = q.toLowerCase();
  const typesParam = (req.query.types as string) || "";
  const requested = typesParam ? typesParam.split(",") : null;
  const systemIdParam = req.query.system_id as string | undefined;
  const systemId = systemIdParam ? Number(systemIdParam) : null;
  // Bound against lower_u(column) — a custom Unicode-aware lower() (see
  // db.ts) — since SQLite's own LIKE/LOWER only case-fold ASCII and would
  // otherwise silently miss "Москва" when the user types "москва".
  const like = `%${qLower}%`;
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const push = (r: SearchResult) => {
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
        "SELECT id, name, scope, notes, tags FROM resources WHERE (lower_u(name) LIKE ? OR lower_u(notes) LIKE ? OR lower_u(tags) LIKE ?) AND archived_at IS NULL"
      )
      .all(like, like, like) as {
      id: number;
      name: string;
      scope: string;
      notes: string;
      tags: string;
    }[];
    rows.forEach((r) =>
      push({
        type: "resource",
        id: r.id,
        title: r.name,
        subtitle:
          r.notes && r.notes.toLowerCase().includes(qLower)
            ? snippet(r.notes, q)
            : r.scope,
      })
    );
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
  if (wantsType("location")) {
    const rows = db
      .prepare(
        `SELECT sl.id, sl.name, sl.kind, sl.description, s.name as setting_name
         FROM setting_locations sl JOIN settings s ON s.id = sl.setting_id
         WHERE (lower_u(sl.name || ' ' || sl.aliases || ' ' || sl.name_original) LIKE ?
                OR lower_u(sl.description) LIKE ?) AND sl.archived_at IS NULL`
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

    const locationChapters = db
      .prepare(
        `SELECT sl.id, sl.name, (lc.title || ' ' || lc.content) as blob
         FROM location_chapters lc JOIN setting_locations sl ON sl.id = lc.location_id
         WHERE lower_u(blob) LIKE ? AND sl.archived_at IS NULL`
      )
      .all(like) as { id: number; name: string; blob: string }[];
    locationChapters.forEach((r) =>
      push({ type: "location", id: r.id, title: r.name, subtitle: snippet(r.blob, q) })
    );
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

  // Only the setting's own scenes are searchable — a campaign's copy-on-write
  // overrides would otherwise show up as near-duplicate hits of their originals.
  if (wantsType("scene")) {
    const rows = db
      .prepare(
        `SELECT sc.id, sc.name, st.name as setting_name, a.name as arc_name,
                (sc.summary || ' ' || sc.read_aloud || ' ' || sc.whats_happening || ' ' ||
                 sc.entry_condition || ' ' || sc.outcomes) as blob
         FROM story_scenes sc
         JOIN settings st ON st.id = sc.setting_id
         LEFT JOIN story_arcs a ON a.id = sc.arc_id
         WHERE (lower_u(sc.name) LIKE ? OR lower_u(blob) LIKE ?)
           AND sc.campaign_id IS NULL AND sc.archived_at IS NULL`
      )
      .all(like, like) as {
      id: number;
      name: string;
      setting_name: string;
      arc_name: string | null;
      blob: string;
    }[];
    rows.forEach((r) =>
      push({
        type: "scene",
        id: r.id,
        title: r.name,
        subtitle: r.blob && r.blob.toLowerCase().includes(qLower) ? snippet(r.blob, q) : undefined,
        context: r.arc_name ? `Приключение: ${r.arc_name}` : `Сеттинг: ${r.setting_name}`,
      })
    );
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
                (COALESCE(s.title,'') || ' ' || s.idea_notes || ' ' || s.main_events) as blob
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
  const SATELLITE_OWNERS: { type: string; table: string; nameCol: string }[] = [
    { type: "being", table: "setting_beings", nameCol: "name" },
    { type: "community", table: "setting_communities", nameCol: "name" },
    { type: "location", table: "setting_locations", nameCol: "name" },
    { type: "character", table: "characters", nameCol: "character_name" },
    { type: "artifact", table: "artifacts", nameCol: "name" },
  ];

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
});
