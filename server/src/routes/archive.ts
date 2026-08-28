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
    .prepare("SELECT id, name, archived_at FROM campaigns WHERE archived_at IS NOT NULL")
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...campaigns.map((r) => ({ type: "campaign", id: r.id, title: r.name, archived_at: r.archived_at }))
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
      "SELECT id, character_name, archived_at FROM characters WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; character_name: string; archived_at: string }[];
  items.push(
    ...characters.map((r) => ({
      type: "character",
      id: r.id,
      title: r.character_name,
      archived_at: r.archived_at,
    }))
  );

  const sessions = db
    .prepare(
      `SELECT s.id, s.date, c.name as campaign_name, s.archived_at FROM sessions s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.archived_at IS NOT NULL`
    )
    .all() as { id: number; date: string; campaign_name: string; archived_at: string }[];
  items.push(
    ...sessions.map((r) => ({
      type: "session",
      id: r.id,
      title: `${r.campaign_name} — ${r.date}`,
      archived_at: r.archived_at,
    }))
  );

  const resources = db
    .prepare(
      "SELECT id, name, scope, archived_at FROM resources WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; scope: string; archived_at: string }[];
  items.push(
    ...resources.map((r) => ({
      type: "resource",
      id: r.id,
      title: r.name,
      subtitle: r.scope,
      archived_at: r.archived_at,
    }))
  );

  const mastering = db
    .prepare(
      "SELECT id, title, category, archived_at FROM mastering_notes WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; title: string; category: string; archived_at: string }[];
  items.push(
    ...mastering.map((r) => ({
      type: "mastering",
      id: r.id,
      title: r.title,
      subtitle: r.category,
      archived_at: r.archived_at,
    }))
  );

  const locations = db
    .prepare(
      "SELECT id, name, kind, archived_at FROM setting_locations WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; kind: string; archived_at: string }[];
  items.push(
    ...locations.map((r) => ({
      type: "location",
      id: r.id,
      title: r.name,
      subtitle: r.kind,
      archived_at: r.archived_at,
    }))
  );

  const beings = db
    .prepare(
      "SELECT id, name, category, archived_at FROM setting_beings WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; category: string; archived_at: string }[];
  items.push(
    ...beings.map((r) => ({
      type: "being",
      id: r.id,
      title: r.name,
      subtitle: r.category,
      archived_at: r.archived_at,
    }))
  );

  const artifacts = db
    .prepare(
      "SELECT id, name, archived_at FROM artifacts WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...artifacts.map((r) => ({
      type: "artifact",
      id: r.id,
      title: r.name,
      archived_at: r.archived_at,
    }))
  );

  const communities = db
    .prepare(
      "SELECT id, name, archived_at FROM setting_communities WHERE archived_at IS NOT NULL"
    )
    .all() as { id: number; name: string; archived_at: string }[];
  items.push(
    ...communities.map((r) => ({
      type: "community",
      id: r.id,
      title: r.name,
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
        .prepare("SELECT name FROM campaigns WHERE system_id = ? ORDER BY name")
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
        WHERE e.system_id = ?`
    ),
    resources: count("SELECT COUNT(*) AS c FROM resources WHERE system_id = ?"),
    characters: count("SELECT COUNT(*) AS c FROM characters WHERE system_id = ?"),
    masteringNotes: count("SELECT COUNT(*) AS c FROM mastering_notes WHERE system_id = ?"),
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

  const row = db
    .prepare(`SELECT archived_at FROM ${table} WHERE ${key} = ?`)
    .get(req.params.id) as { archived_at: string | null } | undefined;
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
      .get(req.params.id) as { folder_path: string | null } | undefined;
    folderPath = withFolder?.folder_path ?? null;
  }

  // Drop any module wrapper pointing at a system/setting we're deleting, so it
  // doesn't linger as a dangling row (its FK is ON DELETE SET NULL, not cascade).
  if (req.params.type === "system") {
    db.prepare("DELETE FROM modules WHERE system_id = ?").run(req.params.id);
    // Кампании — единственная ссылка на систему без каскада (NO ACTION), так
    // что без этого удаление упало бы на FK. Отвязываем: кампания без системы
    // хуже кампании с системой, но лучше удалённой кампании, а Мастер уже
    // видел в предупреждении, каких именно кампаний это коснётся.
    db.prepare("UPDATE campaigns SET system_id = NULL WHERE system_id = ?").run(req.params.id);
  } else if (req.params.type === "setting") {
    db.prepare("DELETE FROM modules WHERE setting_id = ?").run(req.params.id);
    // Заготовки полки переживают свой сеттинг: у них он метка «где написана»,
    // а не владелец. Без этого каскад унёс бы не только саму заготовку, но и
    // все ещё не отвязанные вставки в ЧУЖИХ приключениях (source-каскад по
    // library_scene_id) — Мастер удалил старый мир и обнаружил дыры в
    // приключениях, которые к нему отношения не имели.
    //
    // Снимается и arc_id: приключение уйдёт каскадом вместе с сеттингом, и
    // строка, оставшаяся в нём, ушла бы следом. Заготовка становится
    // бездомной — тем, чем она по смыслу и была.
    // archived_at IS NULL — иначе уже удалённая заготовка пережила бы свой
    // сеттинг и осталась висеть в базе бездомной строкой, которую больше
    // ниоткуда не видно.
    db.prepare(
      `UPDATE story_scenes SET setting_id = NULL, arc_id = NULL
       WHERE setting_id = ? AND in_library = 1 AND archived_at IS NULL`
    ).run(req.params.id);
  }
  db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(req.params.id);
  // The delete above (and any FK cascade it triggered) may have removed owners
  // of polymorphic statblocks/gallery/dates — reconcile those away too.
  sweepOrphans();
  // Ссылки в текстах трогать не нужно: в них лежит глобальный ключ, а не
  // локальный id, и ссылка на исчезнувшую строку зачёркивается сама — просто
  // потому, что ключ больше ни во что не резолвится.
  // Finally, remove the entity's folder tree on disk (nested children's folders
  // live inside it, so this one recursive delete matches the DB cascade).
  deleteVaultFolder(folderPath);
  res.json({ ok: true });
});
