import { Router } from "express";
import { db } from "../db/db";
import { sweepOrphans } from "../services/orphans";
import { deleteVaultFolder } from "../services/filesystem";

export const archiveRouter = Router();

// Types whose folder on disk is entity-exclusive and should be removed on
// permanent delete. Excludes `mastering` (no folder) and `resource` (a single
// file living in a shared Resources folder — removed with its parent's folder).
const FOLDER_OWNED_TYPES = new Set([
  "campaign",
  "system",
  "setting",
  "player",
  "character",
  "session",
  "location",
  "being",
  "community",
  "artifact",
]);

interface ArchiveItem {
  type: string;
  id: number;
  title: string;
  subtitle?: string;
  archived_at: string;
}

archiveRouter.get("/", (_req, res) => {
  const items: ArchiveItem[] = [];

  const campaigns = db
    .prepare(
      `SELECT c.id, c.name, c.archived_at, sy.name as system_name, se.name as setting_name
         FROM campaigns c
         LEFT JOIN systems sy ON sy.id = c.system_id
         LEFT JOIN settings se ON se.id = c.setting_id
        WHERE c.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; archived_at: string; system_name: string | null; setting_name: string | null }[];
  items.push(
    ...campaigns.map((r) => ({
      type: "campaign",
      id: r.id,
      title: r.name,
      subtitle: [r.system_name, r.setting_name].filter(Boolean).join(" · ") || undefined,
      archived_at: r.archived_at,
    }))
  );

  const systems = db
    .prepare("SELECT id, name, archived_at FROM systems WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...systems.map((r) => ({ type: "system", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const settings = db
    .prepare("SELECT id, name, archived_at FROM settings WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...settings.map((r) => ({ type: "setting", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const players = db
    .prepare("SELECT id, name, archived_at FROM players WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...players.map((r) => ({ type: "player", id: r.id, title: r.name, archived_at: r.archived_at }))
  );

  const characters = db
    .prepare(
      `SELECT ch.id, ch.character_name, ch.archived_at, p.name as player_name, ca.name as campaign_name
         FROM characters ch
         JOIN players p ON p.id = ch.player_id
         LEFT JOIN campaigns ca ON ca.id = ch.campaign_id
        WHERE ch.archived_at IS NOT NULL`
    )
    .all() as { id: number; character_name: string; archived_at: string; player_name: string; campaign_name: string | null }[];
  items.push(
    ...characters.map((r) => ({
      type: "character",
      id: r.id,
      title: r.character_name,
      subtitle: [r.player_name, r.campaign_name].filter(Boolean).join(" · ") || undefined,
      archived_at: r.archived_at,
    }))
  );

  const sessions = db
    .prepare(
      `SELECT s.id, s.date, s.title as session_title, c.name as campaign_name, s.archived_at FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.archived_at IS NOT NULL`
    )
    .all() as { id: number; date: string; session_title: string | null; campaign_name: string; archived_at: string }[];
  items.push(
    ...sessions.map((r) => ({
      type: "session",
      id: r.id,
      title: r.session_title ? `${r.campaign_name} — ${r.date} — ${r.session_title}` : `${r.campaign_name} — ${r.date}`,
      subtitle: r.session_title || undefined,
      archived_at: r.archived_at,
    }))
  );

  const resources = db
    .prepare(
      `SELECT r.id, r.name, r.scope, r.archived_at,
              sy.name as system_name, se.name as setting_name, ca.name as campaign_name
         FROM resources r
         LEFT JOIN systems sy ON sy.id = r.system_id
         LEFT JOIN settings se ON se.id = r.setting_id
         LEFT JOIN campaigns ca ON ca.id = r.campaign_id
        WHERE r.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; scope: string; archived_at: string; system_name: string | null; setting_name: string | null; campaign_name: string | null }[];
  items.push(
    ...resources.map((r) => {
      const owner = r.system_name || r.setting_name || r.campaign_name || null;
      const sub = [r.scope, owner].filter(Boolean).join(" · ");
      return { type: "resource", id: r.id, title: r.name, subtitle: sub || undefined, archived_at: r.archived_at };
    })
  );

  const mastering = db
    .prepare(
      `SELECT m.id, m.title, m.category, m.archived_at, sy.name as system_name
         FROM mastering_notes m LEFT JOIN systems sy ON sy.id = m.system_id
        WHERE m.archived_at IS NOT NULL`
    )
    .all() as { id: number; title: string; category: string; archived_at: string; system_name: string | null }[];
  items.push(
    ...mastering.map((r) => ({
      type: "mastering",
      id: r.id,
      title: r.title,
      subtitle: [r.category, r.system_name].filter(Boolean).join(" · ") || undefined,
      archived_at: r.archived_at,
    }))
  );

  const locations = db
    .prepare(
      `SELECT l.id, l.name, l.kind, l.archived_at, s.name as setting_name
         FROM setting_locations l JOIN settings s ON s.id = l.setting_id
        WHERE l.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; kind: string; archived_at: string; setting_name: string }[];
  items.push(
    ...locations.map((r) => ({
      type: "location",
      id: r.id,
      title: r.name,
      subtitle: [r.kind, r.setting_name].filter(Boolean).join(" · ") || undefined,
      archived_at: r.archived_at,
    }))
  );

  const beings = db
    .prepare(
      `SELECT b.id, b.name, b.category, b.archived_at, s.name as setting_name
         FROM setting_beings b JOIN settings s ON s.id = b.setting_id
        WHERE b.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; category: string; archived_at: string; setting_name: string }[];
  items.push(
    ...beings.map((r) => ({
      type: "being",
      id: r.id,
      title: r.name,
      subtitle: [r.category, r.setting_name].filter(Boolean).join(" · ") || undefined,
      archived_at: r.archived_at,
    }))
  );

  const artifacts = db
    .prepare(
      `SELECT a.id, a.name, a.archived_at, s.name as setting_name
         FROM artifacts a JOIN settings s ON s.id = a.setting_id
        WHERE a.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; archived_at: string; setting_name: string }[];
  items.push(
    ...artifacts.map((r) => ({
      type: "artifact",
      id: r.id,
      title: r.name,
      subtitle: r.setting_name || undefined,
      archived_at: r.archived_at,
    }))
  );

  const communities = db
    .prepare(
      `SELECT c.id, c.name, c.archived_at, s.name as setting_name
         FROM setting_communities c JOIN settings s ON s.id = c.setting_id
        WHERE c.archived_at IS NOT NULL`
    )
    .all() as { id: number; name: string; archived_at: string; setting_name: string }[];
  items.push(
    ...communities.map((r) => ({
      type: "community",
      id: r.id,
      title: r.name,
      subtitle: r.setting_name || undefined,
      archived_at: r.archived_at,
    }))
  );

  // Свободные доски Полотна (блок D1). `id` — это `scope_id`, а не `id` строки:
  // все маршруты свободных досок ключуются по нему, и архив не должен вводить
  // второй способ адресовать ту же доску. Подпись — что на доске лежит, иначе
  // «Новая доска» в архиве неотличима от второй «Новой доски».
  const boards = db
    .prepare(
      `SELECT scope_id, name, archived_at,
              (SELECT count(*) FROM canvas_stickers WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_images WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_frames WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_pins WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_nodes WHERE board_id = canvas_boards.id
                 AND node_type NOT IN ('sticker','image','frame','pin')) AS nodes
         FROM canvas_boards
        WHERE scope_type = 'free' AND archived_at IS NOT NULL`
    )
    .all() as { scope_id: number; name: string; archived_at: string; nodes: number }[];
  items.push(
    ...boards.map((r) => ({
      type: "canvas_board",
      id: r.scope_id,
      title: r.name || "Без имени",
      subtitle: `${r.nodes} об.`,
      archived_at: r.archived_at,
    }))
  );

  items.sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1));
  res.json(items);
});

// Что необратимо оборвётся вместе с сущностью — считается ДО удаления и
// показывается Мастеру списком имён. Кампания системы не держит её удаление
// (FK у `campaigns.system_id` — NO ACTION, и до этой сводки удаление системы
// с живыми кампаниями просто падало пятисоткой): кампания отвязывается, а
// Мастер заранее видит, какие именно останутся без системы.
//
// Пока считается только для системы — у остальных типов каскад ничего
// ценного за собой не рвёт. Ответ намеренно пустой, а не отсутствующий:
// клиенту не приходится знать, для каких типов сводка бывает.
interface PurgeImpact {
  detachedCampaigns: string[];
  compendiumLinks: number;
  baseMonsters: number;
  resources: number;
  characters: number;
  masteringNotes: number;
  modules: number;
}

function systemPurgeImpact(systemId: string | number): PurgeImpact {
  const count = (sql: string): number =>
    (db.prepare(sql).get(systemId) as { c: number }).c;
  return {
    detachedCampaigns: (
      db
        .prepare("SELECT name FROM campaigns WHERE system_id = ? AND archived_at IS NULL ORDER BY name")
        .all(systemId) as { name: string }[]
    ).map((r) => r.name),
    compendiumLinks:
      count(
        `SELECT COUNT(*) AS c FROM being_compendium_links l
           JOIN compendium_entries e ON e.id = l.compendium_entry_id
          WHERE e.system_id = ?`
      ) +
      count(
        `SELECT COUNT(*) AS c FROM artifact_compendium_links l
           JOIN compendium_entries e ON e.id = l.compendium_entry_id
          WHERE e.system_id = ?`
      ),
    baseMonsters: count(
      `SELECT COUNT(*) AS c FROM setting_beings b
         JOIN compendium_entries e ON e.id = b.base_monster_id
        WHERE e.system_id = ? AND b.archived_at IS NULL`
    ),
    resources: count("SELECT COUNT(*) AS c FROM resources WHERE system_id = ? AND archived_at IS NULL"),
    characters: count("SELECT COUNT(*) AS c FROM characters WHERE system_id = ? AND archived_at IS NULL"),
    masteringNotes: count("SELECT COUNT(*) AS c FROM mastering_notes WHERE system_id = ? AND archived_at IS NULL"),
    modules: count("SELECT COUNT(*) AS c FROM modules WHERE system_id = ?"),
  };
}

const EMPTY_IMPACT: PurgeImpact = {
  detachedCampaigns: [],
  compendiumLinks: 0,
  baseMonsters: 0,
  resources: 0,
  characters: 0,
  masteringNotes: 0,
  modules: 0,
};

archiveRouter.get("/:type/:id/impact", (req, res) => {
  if (!ARCHIVE_TABLES[req.params.type]) return res.status(400).json({ error: "unknown type" });
  res.json(req.params.type === "system" ? systemPurgeImpact(req.params.id) : EMPTY_IMPACT);
});

// The one place permanent, irreversible deletion lives — uniform across every
// archivable type. Only rows that are *already archived* can be hard-deleted,
// so nothing active is ever destroyed by a stray call. Table names come from a
// fixed whitelist (never from the request), so `${table}` is injection-safe.
// FK cascades (schema.sql) drop child rows; polymorphic satellites
// (statblocks/gallery_images/important_dates) are cleaned up separately.
const ARCHIVE_TABLES: Record<string, string> = {
  campaign: "campaigns",
  system: "systems",
  setting: "settings",
  player: "players",
  character: "characters",
  session: "sessions",
  resource: "resources",
  mastering: "mastering_notes",
  location: "setting_locations",
  being: "setting_beings",
  artifact: "artifacts",
  community: "setting_communities",
  canvas_board: "canvas_boards",
};

// Столбец, по которому тип адресуется, когда это не `id`. Свободная доска
// везде — и в маршрутах Полотна, и в ссылке `?free_id=` — адресуется своим
// `scope_id`; заводить в архиве второй способ назвать ту же доску значит
// гарантировать путаницу. Как и имена таблиц, берётся из белого списка.
const ARCHIVE_KEYS: Record<string, string> = { canvas_board: "scope_id" };

archiveRouter.delete("/:type/:id", (req, res) => {
  const table = ARCHIVE_TABLES[req.params.type];
  if (!table) return res.status(400).json({ error: "unknown type" });
  const key = ARCHIVE_KEYS[req.params.type] ?? "id";
  // id из параметра — строка; для canvas_board это scope_id (число). Валидируем
  // как число, чтобы не пропустить NaN/Infinity в SQLite (placeholder защитит
  // от инъекции, но тип должен быть осмысленным).
  const rawId = req.params.id;
  const numericId = Number(rawId);
  if (!Number.isFinite(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: "некорректный id" });
  }

  const row = db
    .prepare(`SELECT archived_at FROM ${table} WHERE ${key} = ?`)
    .get(numericId) as { archived_at: string | null } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.archived_at == null) {
    return res.status(400).json({ error: "можно удалить навсегда только из архива" });
  }

  // Grab the folder path before the row (and its nested children) are gone; the
  // recursive delete on disk happens last, after the DB is consistent.
  let folderPath: string | null = null;
  if (FOLDER_OWNED_TYPES.has(req.params.type)) {
    const withFolder = db
      .prepare(`SELECT folder_path FROM ${table} WHERE ${key} = ?`)
      .get(numericId) as { folder_path: string | null } | undefined;
    folderPath = withFolder?.folder_path ?? null;
  }

  // Все мутации БД — в одной транзакции: либо всё прошло (отвязки + DELETE
  // + sweepOrphans), либо ничего не изменилось. ФС-удаление — вне транзакции,
  // последним шагом после коммита.
  const runDeleteTx = db.transaction(() => {
    if (req.params.type === "system") {
      db.prepare("DELETE FROM modules WHERE system_id = ?").run(numericId);
      db.prepare("UPDATE campaigns SET system_id = NULL WHERE system_id = ?").run(numericId);
    } else if (req.params.type === "setting") {
      db.prepare("DELETE FROM modules WHERE setting_id = ?").run(numericId);
      db.prepare(
        `UPDATE story_scenes SET setting_id = NULL, arc_id = NULL
         WHERE setting_id = ? AND in_library = 1 AND archived_at IS NULL`
      ).run(numericId);
    }
    db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(numericId);
    sweepOrphans();
  });

  try {
    runDeleteTx();
  } catch (e) {
    console.error(`DELETE /archive/${req.params.type}/${rawId} transaction failed:`, e);
    return res.status(500).json({ error: "не удалось удалить — попробуйте ещё раз" });
  }
  deleteVaultFolder(folderPath);
  res.json({ ok: true });
});
