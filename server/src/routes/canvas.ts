import { Router } from "express";
import { db } from "../db/db";
import { withLibraryContent } from "../story/library";
import { foreignLinkCount } from "../story/foreignLinks";
import {
  CAST_ROLE_BY_SECTION,
  CAST_SECTIONS,
  CONSEQUENCE_SECTION,
  setLinkQty,
} from "../story/cast";
import { SCENE_SOUND_SECTION } from "../story/stage";
import multer from "multer";
import path from "path";
import { ensureSubfolder, toFileUrl, VAULT_ROOT, writeReplacingOldFile } from "../services/filesystem";

export const canvasRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// «Полотно» — узловой редактор. Первый вид холста: одно приключение, его
// сцены нодами и переходы между ними рёбрами.
//
// Данные холст не заводит: сцены, переходы и copy-on-write слой кампании
// живут в story_*, и правятся теми же эндпоинтами, что и список сцен. Здесь
// только раскладка (canvas_boards/canvas_nodes) и один сводный ответ, чтобы
// открытие холста не превращалось в пять запросов подряд.

type ScopeType = "arc" | "setting" | "campaign";

/** Ребро холста в том виде, в каком его ждёт клиент. */
interface EdgeOut {
  id: string;
  kind: "transition" | "outcome" | "cast" | "member" | "check";
  source: string;
  target: string;
  target_handle: string;
  label: string;
}

/** Ключ ноды сцены, или null если сцены на холсте нет. */
function sceneKey(id: number | undefined): string | null {
  return id == null ? null : `scene:${id}`;
}

interface SceneRow {
  id: number;
  setting_id: number | null;
  arc_id: number | null;
  campaign_id: number | null;
  source_scene_id: number | null;
  /** Заполнено у вставки заготовки: содержимое читается оттуда. */
  library_scene_id: number | null;
  in_library: number;
  name: string;
  kind: string;
  summary: string;
  position: number;
}

/**
 * Холст заводится в момент первого обращения, а не при создании приключения:
 * приключений много, а открывают из них единицы, и пустые строки на каждое
 * ничего не дают.
 */
function ensureBoard(scopeType: ScopeType, scopeId: number): number {
  const existing = db
    .prepare("SELECT id FROM canvas_boards WHERE scope_type = ? AND scope_id = ?")
    .get(scopeType, scopeId) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare("INSERT INTO canvas_boards (scope_type, scope_id) VALUES (?, ?)")
    .run(scopeType, scopeId);
  return Number(info.lastInsertRowid);
}

/**
 * Раскладка по умолчанию для ноды, которую ещё ни разу не двигали: колонки по
 * четыре. Нужна не красота, а предсказуемость — чтобы сцены не легли одна на
 * другую и порядок на холсте совпадал с порядком в списке.
 */
const COLS = 4;
const COL_W = 300;
const ROW_H = 200;
function defaultPosition(index: number, startY: number): { x: number; y: number } {
  return { x: (index % COLS) * COL_W, y: startY + Math.floor(index / COLS) * ROW_H };
}

/** Заголовок рамки главы: под ним начинается место для сцен. */
const FRAME_HEAD = 34;
const FRAME_PAD = 16;

/** Место номер `seat` внутри рамки главы — сеткой, как и весь холст. */
function seatInFrame(
  frame: { x: number; y: number; w: number },
  seat: number
): { x: number; y: number } {
  const cols = Math.max(1, Math.floor((frame.w - FRAME_PAD * 2) / COL_W));
  return {
    x: frame.x + FRAME_PAD + (seat % cols) * COL_W,
    y: frame.y + FRAME_HEAD + Math.floor(seat / cols) * ROW_H,
  };
}

// Копии сцен, сделанные кампанией, по оригиналу, который они заменяют.
// Повторяет overrideMap из story.ts: там она приватная, а тащить её наружу
// ради одного вызова значило бы расширять публичную поверхность story.ts.
function overrideMap(campaignId: number, settingId: number): Map<number, SceneRow> {
  const rows = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE campaign_id = ? AND setting_id = ? AND source_scene_id IS NOT NULL
         AND archived_at IS NULL`
    )
    .all(campaignId, settingId) as SceneRow[];
  return new Map(rows.map((r) => [r.source_scene_id as number, r]));
}

// ------------------------------------------- ноды сущностей и наборов

// Где искать имя и портрет каждого вида ноды. Тот же список, что у графа
// связей (routes/links.ts), плюс наборы, которых в графе нет: набор — часть
// схемы, а не сущность мира.
const ENTITY_NODES: Record<string, { table: string; nameCol: string; thumbCol?: string; kindCol?: string }> = {
  being: {
    table: "setting_beings",
    nameCol: "name",
    thumbCol: "thumbnail_image_path",
    kindCol: "category",
  },
  location: { table: "setting_locations", nameCol: "name", thumbCol: "thumbnail_image_path" },
  artifact: { table: "artifacts", nameCol: "name", thumbCol: "avatar_image_path" },
  community: { table: "setting_communities", nameCol: "name", thumbCol: "thumbnail_image_path" },
  compendium_entry: { table: "compendium_entries", nameCol: "name", kindCol: "kind" },
  // События хроники мира и расписания кампании — тоже ноды: связь «эта сцена
  // сдвигает это событие» рисуется стрелкой, а не отдельным полем, и потому
  // переживает переименование.
  setting_event: { table: "setting_calendar_events", nameCol: "title" },
  campaign_event: { table: "campaign_calendar_events", nameCol: "title" },
  sound_set: { table: "sound_sets", nameCol: "name" },
  playlist: { table: "playlists", nameCol: "name" },
};

interface PlacedNode {
  id: number;
  node_type: string;
  node_id: number;
  x: number;
  y: number;
}

/**
 * Ноды сущностей и наборов — те, что положили на холст руками. Выводить их
 * не из чего: в приключении на двадцать сцен подцеплено под сотню существ и
 * локаций, и показывать всех значит заставить Мастера расчищать схему вместо
 * того, чтобы её рисовать.
 */
function entityNodes(boardId: number, placed: PlacedNode[]) {
  return placed
    .filter((p) => p.node_type !== "scene")
    .map((p) => {
      if (p.node_type === "bundle") {
        const bundle = db
          .prepare("SELECT id, name, content_type, library_bundle_id, in_library FROM canvas_bundles WHERE id = ?")
          .get(p.node_id) as
          | {
              id: number;
              name: string;
              content_type: string | null;
              library_bundle_id: number | null;
              in_library: number;
            }
          | undefined;
        if (!bundle) return null;
        // Нетронутая вставка имени и вида не хранит — читает с оригинала.
        const source =
          bundle.library_bundle_id == null
            ? bundle
            : ((db
                .prepare("SELECT name, content_type FROM canvas_bundles WHERE id = ?")
                .get(bundle.library_bundle_id) ?? bundle) as {
                name: string;
                content_type: string | null;
              });
        const members = db
          .prepare(
            `SELECT l.id AS link_id, l.to_type, l.to_id, IFNULL(c.qty, '') AS qty
             FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
             WHERE l.from_type = 'bundle' AND l.from_id = ?`
          )
          .all(bundleContentId(bundle.id)) as {
          link_id: number;
          to_type: string;
          to_id: number;
          qty: string;
        }[];
        return {
          key: `bundle:${p.node_id}`,
          node_type: "bundle" as const,
          node_id: p.node_id,
          x: p.x,
          y: p.y,
          placed: true,
          bundle: {
            id: bundle.id,
            name: source.name,
            content_type: source.content_type,
            in_library: bundle.in_library === 1,
            library_bundle_id: bundle.library_bundle_id,
            members: members.map((m) => ({
              ...m,
              name: entityName(m.to_type, m.to_id),
            })),
          },
        };
      }

      if (p.node_type === "setting_event" || p.node_type === "campaign_event") {
        const table =
          p.node_type === "setting_event" ? "setting_calendar_events" : "campaign_calendar_events";
        const row = db
          .prepare(
            `SELECT title, inworld_year, inworld_month, inworld_day, date_precision, status, important
             FROM ${table} WHERE id = ?`
          )
          .get(p.node_id) as
          | {
              title: string;
              inworld_year: number;
              inworld_month: number;
              inworld_day: number;
              date_precision: string;
              status: string;
              important: number;
            }
          | undefined;
        if (!row) return null;
        return {
          key: `${p.node_type}:${p.node_id}`,
          node_type: p.node_type,
          node_id: p.node_id,
          x: p.x,
          y: p.y,
          placed: true,
          // Дата отдаётся полями, а не строкой: собрать её по-человечески
          // может только клиент — месяцы и эра живут в календаре сеттинга.
          event: {
            id: p.node_id,
            title: row.title,
            year: row.inworld_year,
            month: row.inworld_month,
            day: row.inworld_day,
            precision: row.date_precision,
            status: row.status,
            important: row.important === 1,
          },
        };
      }

      if (p.node_type === "sound_set") {
        const row = db.prepare("SELECT name, battle_playlist_id FROM sound_sets WHERE id = ?").get(p.node_id) as { name: string; battle_playlist_id: number | null } | undefined;
        if (!row) return null;
        return {
          key: `sound_set:${p.node_id}`,
          node_type: "sound_set",
          node_id: p.node_id,
          x: p.x,
          y: p.y,
          placed: true,
          sound_set: { id: p.node_id, name: row.name, battle_playlist_id: row.battle_playlist_id },
        };
      }
      if (p.node_type === "playlist") {
        const row = db.prepare("SELECT name FROM playlists WHERE id = ?").get(p.node_id) as { name: string } | undefined;
        if (!row) return null;
        return {
          key: `playlist:${p.node_id}`,
          node_type: "playlist",
          node_id: p.node_id,
          x: p.x,
          y: p.y,
          placed: true,
          playlist: { id: p.node_id, name: row.name },
        };
      }
      const spec = ENTITY_NODES[p.node_type];
      if (!spec) return null;
      const row = db
        .prepare(
          `SELECT ${spec.nameCol} AS name${spec.kindCol ? `, ${spec.kindCol} AS kind` : ""}${
            spec.thumbCol ? `, ${spec.thumbCol} AS thumb` : ""
          } FROM ${spec.table} WHERE id = ?`
        )
        .get(p.node_id) as { name: string; kind?: string; thumb?: string | null } | undefined;
      if (!row) return null;
      return {
        key: `${p.node_type}:${p.node_id}`,
        node_type: p.node_type,
        node_id: p.node_id,
        x: p.x,
        y: p.y,
        placed: true,
        entity: {
          id: p.node_id,
          name: row.name,
          kind: row.kind ?? null,
          // Готовый URL, а не путь: <img> его и ждёт, а собирать ссылку на
          // клиенте — это второе место, где живёт устройство хранилища.
          thumbnail_image_url: row.thumb ? toFileUrl(row.thumb) : null,
          // Упоминания рёбрами не рисуются — их 487 против 396 связей, схема
          // утонула бы. Но «упомянут и не подцеплен» — сигнал, который стоит
          // подать: он значит, что в текстах существо есть, а в составе нет.
          mentioned_in: mentionedInScenes(p.node_type, p.node_id),
        },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);
}

/** Имя сущности любого поддержанного вида — для показа члена набора. */
function entityName(type: string, id: number): string {
  const spec = ENTITY_NODES[type];
  if (!spec) return `#${id}`;
  const row = db.prepare(`SELECT ${spec.nameCol} AS name FROM ${spec.table} WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? `#${id}`;
}

/** Сколько сцен упоминает сущность в текстах, не подцепляя её. */
function mentionedInScenes(type: string, id: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT from_id) AS c FROM generic_links
       WHERE from_type = 'scene' AND to_type = ? AND to_id = ? AND section = 'mention'`
    )
    .get(type, id) as { c: number };
  return row.c;
}

/** Набор, откуда читается состав: сам набор или тот, за которым он следует. */
function bundleContentId(bundleId: number): number {
  const row = db
    .prepare("SELECT library_bundle_id FROM canvas_bundles WHERE id = ?")
    .get(bundleId) as { library_bundle_id: number | null } | undefined;
  return row?.library_bundle_id ?? bundleId;
}

/**
 * Отвязка набора от полочного оригинала — то же правило, что у заготовки
 * сцены: тронул, значит стал своим. Содержимое переносится внутрь целиком,
 * иначе отвязанный набор оказался бы пустым.
 *
 * Возвращает id набора, в который теперь можно писать.
 */
function detachBundle(bundleId: number): number {
  const bundle = db.prepare("SELECT * FROM canvas_bundles WHERE id = ?").get(bundleId) as
    | { id: number; library_bundle_id: number | null }
    | undefined;
  if (!bundle?.library_bundle_id) return bundleId;
  const sourceId = bundle.library_bundle_id;

  db.transaction(() => {
    const source = db.prepare("SELECT name, content_type FROM canvas_bundles WHERE id = ?").get(sourceId) as
      | { name: string; content_type: string | null }
      | undefined;
    if (source) {
      db.prepare("UPDATE canvas_bundles SET name = ?, content_type = ? WHERE id = ?").run(
        source.name,
        source.content_type,
        bundleId
      );
    }
    const members = db
      .prepare(
        `SELECT l.to_type, l.to_id, IFNULL(c.qty, '') AS qty
         FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
         WHERE l.from_type = 'bundle' AND l.from_id = ?`
      )
      .all(sourceId) as { to_type: string; to_id: number; qty: string }[];
    const addMember = db.prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
       VALUES ('bundle', ?, ?, ?, 'bundle_member')`
    );
    members.forEach((m) => {
      const info = addMember.run(bundleId, m.to_type, m.to_id);
      if (info.changes > 0 && m.qty) setLinkQty(Number(info.lastInsertRowid), m.qty);
    });
    db.prepare("UPDATE canvas_bundles SET library_bundle_id = NULL WHERE id = ?").run(bundleId);
  })();
  return bundleId;
}

canvasRouter.get("/board", (req, res) => {
  const { arc_id, setting_id, campaign_id, free_id } = req.query as { arc_id?: string; setting_id?: string; campaign_id?: string; free_id?: string };

  // Фриформ-доска вне сеттингов (Q1 а, §5 Полотно)
  if (free_id) {
    const freeId = Number(free_id);
    const board = db.prepare("SELECT id, name FROM canvas_boards WHERE scope_type='free' AND scope_id=?").get(freeId) as { id: number; name: string } | undefined;
    if (!board) return res.status(404).json({ error: "not found" });
    const saved = db.prepare("SELECT node_type, node_id, x, y, z_index FROM canvas_nodes WHERE board_id=?").all(board.id) as { node_type: string; node_id: number; x: number; y: number; z_index: number }[];
    // стикеры и картинки — отдельные таблицы, но на клиенте как ноды
    const stickers = db.prepare("SELECT id, text, name, note, color FROM canvas_stickers WHERE board_id=?").all(board.id) as { id: number; text: string; name: string; note: string; color: string }[];
    const images = db.prepare("SELECT id, file_path, w, h FROM canvas_images WHERE board_id=?").all(board.id) as { id: number; file_path: string; w: number; h: number }[];
    const frames = db.prepare("SELECT id, name, color, x, y, w, h FROM canvas_frames WHERE board_id=?").all(board.id) as { id: number; name: string; color: string; x: number; y: number; w: number; h: number }[];
    const stickerNodes = stickers.map((s) => {
      const pos = saved.find((p) => p.node_type === "sticker" && p.node_id === s.id) ?? { x: 0, y: 0, z_index: 0 };
      return { key: `sticker:${s.id}`, node_type: "sticker" as const, node_id: s.id, x: pos.x, y: pos.y, z_index: pos.z_index, placed: !!saved.find((p) => p.node_type === "sticker" && p.node_id === s.id), sticker: { id: s.id, text: s.text, name: s.name || s.text, note: s.note, color: s.color } };
    });
    const imageNodes = images.map((im) => {
      const pos = saved.find((p) => p.node_type === "image" && p.node_id === im.id) ?? { x: 0, y: 0, z_index: 0 };
      return { key: `image:${im.id}`, node_type: "image" as const, node_id: im.id, x: pos.x, y: pos.y, z_index: pos.z_index, placed: !!saved.find((p) => p.node_type === "image" && p.node_id === im.id), image: { id: im.id, file_url: toFileUrl(im.file_path), w: im.w, h: im.h } };
    });
    const frameNodes = frames.map((f) => {
      const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y, z_index: 0 };
      return { key: `frame:${f.id}`, node_type: "frame" as const, node_id: f.id, x: pos.x ?? f.x, y: pos.y ?? f.y, z_index: pos.z_index, placed: true, frame: { id: f.id, name: f.name, color: f.color, w: f.w, h: f.h } };
    });
    // авто-расширение фриформ рамок: если внутри есть узлы, выходящие за границу — растягиваем
    for (const f of frames) {
      const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y };
      const fx = pos.x ?? f.x;
      const fy = pos.y ?? f.y;
      const allNodesForFrame = [...stickerNodes, ...imageNodes, ...entityNodes(board.id, saved as never)];
      // находим узлы, чей левый-верхний угол внутри рамки (как в клиенте)
      const inside = allNodesForFrame.filter((nn) => {
        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { x: number; y: number };
        const x = (p as unknown as { x: number }).x ?? (nn as unknown as { x: number }).x;
        const y = (p as unknown as { y: number }).y ?? (nn as unknown as { y: number }).y;
        return x >= fx && y >= fy && x <= fx + f.w && y <= fy + f.h;
      });
      if (inside.length === 0) continue;
      // размеры узлов для расчёта правой/нижней границы
      const getW = (nn: unknown) => {
        const t = (nn as { node_type?: string }).node_type;
        if (t === "sticker") return 320;
        if (t === "image") return 320;
        return 200;
      };
      const getH = (nn: unknown) => {
        const t = (nn as { node_type?: string }).node_type;
        if (t === "sticker") return 120;
        if (t === "image") return 240;
        return 124;
      };
      const maxX = Math.max(...inside.map((nn) => {
        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { x: number };
        const x = (p as unknown as { x: number }).x ?? (nn as unknown as { x: number }).x;
        return x + getW(nn);
      }));
      const maxY = Math.max(...inside.map((nn) => {
        const p = saved.find((s) => s.node_type === (nn as unknown as { node_type: string }).node_type && s.node_id === (nn as unknown as { node_id: number }).node_id) ?? nn as unknown as { y: number };
        const y = (p as unknown as { y: number }).y ?? (nn as unknown as { y: number }).y;
        return y + getH(nn);
      }));
      const needW = Math.max(f.w, maxX - fx + 16);
      const needH = Math.max(f.h, maxY - fy + 16);
      if (needW !== f.w || needH !== f.h) {
        db.prepare("UPDATE canvas_frames SET w = ?, h = ? WHERE id = ?").run(needW, needH, f.id);
        f.w = needW;
        f.h = needH;
        // также обновляем frameNodes для ответа
        const fn = frameNodes.find((n) => n.node_id === f.id);
        if (fn) fn.frame.w = needW, fn.frame.h = needH;
      }
    }
    return res.json({ board_id: board.id, free: { id: freeId, name: board.name }, campaign_id: null, nodes: [...stickerNodes, ...imageNodes, ...frameNodes, ...entityNodes(board.id, saved as never)], groups: [], edges: [] });
  }

  // Сеттинг-холст: приключения как ноды (Q2, Q5 б, Q6)
  if (setting_id && !arc_id && !campaign_id) {
    const settingId = Number(setting_id);
    const setting = db.prepare("SELECT id, name FROM settings WHERE id = ?").get(settingId) as { id: number; name: string } | undefined;
    if (!setting) return res.status(404).json({ error: "not found" });
    const boardId = ensureBoard("setting", settingId);
    const saved = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(boardId) as { node_type: string; node_id: number; x: number; y: number }[];
    const savedByKey = new Map(saved.map((n) => [`${n.node_type}:${n.node_id}`, n]));
    const adventures = db.prepare(`SELECT id, name, setting_id, position FROM story_arcs WHERE setting_id = ? AND parent_id IS NULL AND archived_at IS NULL AND is_default = 0 ORDER BY position, id`).all(settingId) as { id: number; name: string; setting_id: number; position: number }[];
    const nodes = adventures.map((a, i) => {
      const placed = savedByKey.get(`adventure:${a.id}`);
      const pos = placed ?? defaultPosition(i, 0);
      return { key: `adventure:${a.id}`, node_type: "adventure" as const, node_id: a.id, x: pos.x, y: pos.y, placed: !!placed, adventure: { id: a.id, name: a.name } };
    });
    const arcIds = adventures.map((a) => a.id);
    const arcTransitions = arcIds.length
      ? (db
          .prepare(`SELECT id, from_arc_id, to_arc_id, label FROM story_arc_transitions WHERE from_arc_id IN (${arcIds.map(() => "?").join(",")}) AND to_arc_id IN (${arcIds.map(() => "?").join(",")})`)
          .all(...arcIds, ...arcIds) as { id: number; from_arc_id: number; to_arc_id: number; label: string }[])
      : [];
    const edges: EdgeOut[] = arcTransitions.map((t) => ({
      id: `arc_transition:${t.id}`,
      kind: "transition" as const,
      source: `adventure:${t.from_arc_id}`,
      target: `adventure:${t.to_arc_id}`,
      target_handle: "story",
      label: t.label,
    }));
    return res.json({ board_id: boardId, setting: { id: setting.id, name: setting.name }, campaign_id: null, nodes: [...nodes, ...entityNodes(boardId, saved as never)], groups: [], edges });
  }

  // Сборка кампании: сцены всех приключений кампании (Q3) — пока заглушка, живёт в том же скопе
  if (campaign_id && !arc_id) {
    const campId = Number(campaign_id);
    const camp = db.prepare("SELECT id, setting_id, name FROM campaigns WHERE id = ?").get(campId) as { id: number; setting_id: number | null; name: string } | undefined;
    if (!camp) return res.status(404).json({ error: "not found" });
    const boardId = ensureBoard("campaign", campId);
    const saved = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(boardId) as { node_type: string; node_id: number; x: number; y: number }[];
    // пока пустой — сборка заполнится сценами через палитру, как и арк-холст, но без arc-рамок
    return res.json({ board_id: boardId, campaign: { id: camp.id, name: camp.name, setting_id: camp.setting_id }, campaign_id: campId, nodes: [...entityNodes(boardId, saved as never)], groups: [], edges: [] });
  }

  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });

  const arcId = Number(arc_id);
  const campaignId = campaign_id ? Number(campaign_id) : null;

  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(arcId) as
    | { id: number; setting_id: number; name: string; campaign_id: number | null }
    | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });

  // Приключение показывает сцены ВСЕХ своих глав, а не только свои.
  //
  // 183 сцены из 194 на живой базе лежат в главах, так что вид «по одной
  // главе» показывал бы обрезки. Главное — 13 переходов ходят через границу
  // главы внутри одного приключения: разрежь граф по главам, и разрежешь
  // ровно те рёбра, ради которых полотно открывают.
  const arcIds = [
    arcId,
    ...(
      db
        .prepare("SELECT id FROM story_arcs WHERE parent_id = ? AND archived_at IS NULL ORDER BY position, id")
        .all(arcId) as { id: number }[]
    ).map((r) => r.id),
  ];
  const arcPlaceholders = arcIds.map(() => "?").join(",");

  // Сцены приключения ровно так же, как их отдаёт список: оригиналы сеттинга,
  // с подменой на копию кампании там, где копия есть, плюс собственные сцены
  // кампании, которых в сеттинге нет.
  const originals = db
    .prepare(
      `SELECT * FROM story_scenes
       WHERE arc_id IN (${arcPlaceholders}) AND campaign_id IS NULL AND archived_at IS NULL
       ORDER BY position, id`
    )
    .all(...arcIds) as SceneRow[];

  let scenes: SceneRow[];
  if (campaignId == null) {
    scenes = originals;
  } else {
    const overrides = overrideMap(campaignId, arc.setting_id);
    const own = db
      .prepare(
        `SELECT * FROM story_scenes
         WHERE arc_id IN (${arcPlaceholders}) AND campaign_id = ? AND source_scene_id IS NULL AND archived_at IS NULL
         ORDER BY position, id`
      )
      .all(...arcIds, campaignId) as SceneRow[];
    scenes = [...originals.map((s) => overrides.get(s.id) ?? s), ...own];
    scenes.sort((a, b) => a.position - b.position || a.id - b.id);
  }

  const boardId = ensureBoard("arc", arcId);
  const saved = db
    .prepare("SELECT id, node_type, node_id, x, y, z_index FROM canvas_nodes WHERE board_id = ?")
    .all(boardId) as { id: number; node_type: string; node_id: number; x: number; y: number; z_index: number }[];
  const savedByKey = new Map(saved.map((n) => [`${n.node_type}:${n.node_id}`, n]));

  // Позиция ноды ищется и по показанной сцене, и по её оригиналу: копия
  // кампании — это другая строка, но на холсте то же самое место, и
  // переключение кампании не должно раскидывать раскладку заново.
  const placedFor = scenes.map((s) => {
    const own = savedByKey.get(`scene:${s.id}`);
    const inherited = s.source_scene_id ? savedByKey.get(`scene:${s.source_scene_id}`) : undefined;
    return own ?? inherited;
  });

  // Рамки глав считаются ДО раскладки: неразложенная сцена ложится внутрь
  // рамки своей главы, а не в общую кучу под холстом. Иначе Мастер открывает
  // приключение и видит восемь пустых рамок, а все их сцены — отдельной
  // грудой сбоку.
  const chapters = db
    .prepare(
      "SELECT id, name FROM story_arcs WHERE parent_id = ? AND archived_at IS NULL ORDER BY position, id"
    )
    .all(arcId) as { id: number; name: string }[];
  const savedGroups = new Map(
    (
      db
        .prepare("SELECT arc_id, color, x, y, w, h FROM canvas_groups WHERE board_id = ?")
        .all(boardId) as { arc_id: number; color: string; x: number; y: number; w: number; h: number }[]
    ).map((g) => [g.arc_id, g])
  );
  const newGroup = db.prepare(
    "INSERT OR IGNORE INTO canvas_groups (board_id, arc_id, color, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const fitGroup = db.prepare(
    "UPDATE canvas_groups SET x = ?, y = ?, w = ?, h = ? WHERE board_id = ? AND arc_id = ?"
  );

  // Нижняя кромка всего, что уже занято: новая рамка встаёт под этим, а не
  // поверх соседки.
  const GAP = 40;
  let frontier = placedFor.reduce((acc, p) => (p ? Math.max(acc, p.y + ROW_H) : acc), 0);
  for (const g of savedGroups.values()) frontier = Math.max(frontier, g.y + g.h + GAP);

  // Свежая рамка сразу заводится по размеру своей главы. Ставить её
  // «стандартной» и растить потом нельзя: соседка успела бы встать вплотную
  // под стандартную высоту, и после роста главы наехали бы друг на друга.
  const unplacedByArc = new Map<number, number>();
  scenes.forEach((s, i) => {
    if (placedFor[i] || s.arc_id == null) return;
    unplacedByArc.set(s.arc_id, (unplacedByArc.get(s.arc_id) ?? 0) + 1);
  });

  const groups = chapters.map((ch) => {
    const kept = savedGroups.get(ch.id);
    if (kept) return { arc_id: ch.id, name: ch.name, color: kept.color, x: kept.x, y: kept.y, w: kept.w, h: kept.h };
    const rows = Math.max(1, Math.ceil((unplacedByArc.get(ch.id) ?? 0) / COLS));
    const fresh = {
      x: 0,
      y: frontier,
      w: COL_W * COLS + FRAME_PAD * 2,
      h: FRAME_HEAD + rows * ROW_H + FRAME_PAD,
    };
    frontier += fresh.h + GAP;
    newGroup.run(boardId, ch.id, "#2C3E50", fresh.x, fresh.y, fresh.w, fresh.h);
    return { arc_id: ch.id, name: ch.name, color: "#2C3E50", ...fresh };
  });
  const groupByArc = new Map(groups.map((g) => [g.arc_id, g]));

  // Сцены, добавленные после того, как Мастер разложил холст, кладутся внутрь
  // рамки своей главы, а собственные сцены приключения — ПОД разложенным:
  // индекс в общем списке уже занят закреплённой нодой, и новая сцена легла бы
  // ровно поверх неё — выглядит как пропавшая сцена, а не как новая.
  const lowest = placedFor.reduce((acc, p) => (p ? Math.max(acc, p.y) : acc), Number.NEGATIVE_INFINITY);
  const freshStartY = lowest === Number.NEGATIVE_INFINITY ? 0 : lowest + ROW_H;
  let freshIndex = 0;
  const freshInGroup = new Map<number, number>();

  const nodes = scenes.map((s, i) => {
    const placed = placedFor[i];
    const frame = s.arc_id == null ? undefined : groupByArc.get(s.arc_id);
    let pos: { x: number; y: number };
    if (placed) {
      pos = placed;
    } else if (frame) {
      const seat = freshInGroup.get(frame.arc_id) ?? 0;
      freshInGroup.set(frame.arc_id, seat + 1);
      pos = seatInFrame(frame, seat);
    } else {
      pos = defaultPosition(lowest === Number.NEGATIVE_INFINITY ? i : freshIndex++, freshStartY);
    }
    // Нетронутая вставка своих имени и вида не хранит — читает с заготовки.
    const shown = withLibraryContent(s);
    return {
      // Ключ ноды — «вид:номер». Голого номера мало с тех пор, как на холсте
      // рядом со сценами стоят существа: сцена 41 и существо 41 получили бы
      // один и тот же ключ, и React Flow оставил бы одну из них.
      key: `scene:${s.id}`,
      node_type: "scene" as const,
      node_id: s.id,
      x: pos.x,
      y: pos.y,
      placed: !!placed,
      scene: {
        id: s.id,
        name: shown.name,
        kind: shown.kind,
        summary: shown.summary ?? s.summary ?? "",
        arc_id: s.arc_id,
        is_override: s.campaign_id != null && s.source_scene_id != null,
        campaign_only: s.campaign_id != null && s.source_scene_id == null,
        in_library: s.in_library === 1,
        library_scene_id: s.library_scene_id,
        library_name: shown.library_name,
        // Чужие ссылки считаются здесь, а не по щелчку: вставленная заготовка
        // из другого мира работает и молчит, и узнать о ней надо, глядя на
        // схему, а не открыв наугад нужную ноду.
        foreign_links: foreignLinkCount(s.id),
      },
    };
  });

  // Рёбра — переходы между показанными сценами. Переход записан на оригинале,
  // а показана может быть копия кампании, поэтому оба конца переводятся в те
  // id, которые реально лежат на холсте; иначе у кампании с копиями холст
  // выглядел бы как россыпь несвязанных нод.
  const shownBySource = new Map<number, number>();
  scenes.forEach((s) => {
    shownBySource.set(s.id, s.id);
    if (s.source_scene_id) shownBySource.set(s.source_scene_id, s.id);
  });

  // Начало стрелки ищется иначе, чем конец. Одно и то же содержимое может
  // показываться НЕСКОЛЬКИМИ нодами сразу: одна заготовка вставлена в
  // приключение дважды — значит и её ветвление рисуется от обеих вставок.
  // Поэтому список, а не одно значение.
  const shownByContent = new Map<number, number[]>();
  const addContent = (key: number, shownId: number) =>
    shownByContent.set(key, [...(shownByContent.get(key) ?? []), shownId]);
  scenes.forEach((s) => {
    addContent(s.id, s.id);
    if (s.source_scene_id) addContent(s.source_scene_id, s.id);
    // У нетронутой вставки своих проверок и переходов нет — они у заготовки.
    if (s.library_scene_id) addContent(s.library_scene_id, s.id);
  });

  const lookup = [...shownByContent.keys()];

  // Проверки сцен — отдельные ноды справа от сцены (решение Q1 а, Q5 а).
  // Позиция справа +240, стопкой +90, если не двигали — default, иначе из canvas_nodes.
  const checkRows = lookup.length
    ? (db
        .prepare(
          `SELECT c.id, c.scene_id, c.what, c.difficulty FROM story_scene_checks c
           WHERE c.scene_id IN (${lookup.map(() => "?").join(",")})
           ORDER BY c.position, c.id`
        )
        .all(...lookup) as { id: number; scene_id: number; what: string; difficulty: string }[])
    : [];
  const savedCheckPos = new Map(
    saved.filter((p) => p.node_type === "check").map((p) => [p.node_id, p] as const)
  );
  // карта позиций сцен для дефолта проверки
  const scenePosById = new Map<number, { x: number; y: number }>();
  nodes.forEach((n) => scenePosById.set(n.node_id, { x: n.x, y: n.y }));
  const checkIndexByScene = new Map<number, number>();
  const checkNodes = checkRows.map((ch) => {
    const savedPos = savedCheckPos.get(ch.id);
    let pos: { x: number; y: number };
    let placed = false;
    if (savedPos) {
      pos = { x: savedPos.x, y: savedPos.y };
      placed = true;
    } else {
      const base = scenePosById.get(ch.scene_id) ?? { x: 0, y: 0 };
      const idx = checkIndexByScene.get(ch.scene_id) ?? 0;
      checkIndexByScene.set(ch.scene_id, idx + 1);
      pos = { x: base.x + 240, y: base.y + idx * 90 };
    }
    // исходы для этой проверки — хендлы на ноде
    const outs = db
      .prepare(
        `SELECT id, label, consequence, target_type, target_id FROM story_check_outcomes WHERE check_id = ? ORDER BY position, id`
      )
      .all(ch.id) as { id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[];
    return {
      key: `check:${ch.id}`,
      node_type: "check" as const,
      node_id: ch.id,
      x: pos.x,
      y: pos.y,
      placed,
      check: {
        id: ch.id,
        scene_id: ch.scene_id,
        what: ch.what,
        difficulty: ch.difficulty,
        outcomes: outs,
      },
    };
  });

  const transitions = lookup.length
    ? (db
        .prepare(
          `SELECT * FROM story_scene_transitions
           WHERE from_scene_id IN (${lookup.map(() => "?").join(",")})
           ORDER BY position, id`
        )
        .all(...lookup) as {
        id: number;
        from_scene_id: number;
        to_scene_id: number;
        label: string;
      }[])
    : [];

  // Исходы — теперь от check-ноды к scene, подпись в чип-рамке (Q2, Q7 а).
  // Для обратной совместимости сцены-исходы без check-ноды не рисуем — check-нода уже есть.
  const outcomes = lookup.length
    ? (db
        .prepare(
          `SELECT o.id, o.label, o.target_id, c.id AS check_id, c.scene_id AS from_scene_id, c.what
           FROM story_check_outcomes o
           JOIN story_scene_checks c ON c.id = o.check_id
           WHERE o.target_type = 'scene' AND o.target_id IS NOT NULL
             AND c.scene_id IN (${lookup.map(() => "?").join(",")})
           ORDER BY o.position, o.id`
        )
        .all(...lookup) as {
        id: number;
        label: string;
        target_id: number;
        check_id: number;
        from_scene_id: number;
        what: string;
      }[])
    : [];

  // id ребра — строка `вид:строка:нода-начало`.
  //
  // Вид нужен клиенту, чтобы знать, что удалять: переход исчезает совсем, а у
  // исхода снимается только связь — сам разъём остаётся вместе с подписью.
  // Номер строки сам по себе не годится ключом: переходы и исходы нумеруются
  // каждый от своей единицы. А нода-начало нужна потому, что одна заготовка
  // может стоять в приключении дважды: её переход даёт тогда два ребра, и без
  // третьей части ключ у них был бы общим — React Flow оставил бы одно.
  const sceneCheckEdges = checkRows.flatMap((ch) =>
    (shownByContent.get(ch.scene_id) ?? []).map((shownId) => ({
      id: `scene_check:${ch.id}:${shownId}`,
      kind: "check" as const,
      source: `scene:${shownId}`,
      target: `check:${ch.id}`,
      target_handle: "story",
      label: "",
    }))
  );

  const storyEdges = [
    ...sceneCheckEdges,
    ...transitions.flatMap((t) =>
      (shownByContent.get(t.from_scene_id) ?? []).map((fromId) => ({
        id: `transition:${t.id}:${fromId}`,
        kind: "transition" as const,
        source: `scene:${fromId}`,
        target: sceneKey(shownBySource.get(t.to_scene_id)),
        target_handle: "story",
        label: t.label,
      }))
    ),
    ...outcomes.map((o) => ({
      id: `outcome:${o.id}:check:${o.check_id}`,
      kind: "outcome" as const,
      source: `check:${o.check_id}`,
      target: sceneKey(shownBySource.get(o.target_id)),
      target_handle: "story",
      label: o.what ? `${o.what} — ${o.label}` : o.label,
    })),
  ].flatMap((e): EdgeOut[] => (e.target == null ? [] : [{ ...e, target: e.target }]));

  // Рёбра состава: сущность ВТЕКАЕТ в сцену, а не наоборот. Сцена собирается
  // из того, что в неё воткнули; обратное направление читалось бы как «сцена
  // порождает гоблина». Разъём-цель называет роль, поэтому одна и та же
  // локация может быть местом одной сцены и предметом разговора в другой.
  //
  // Рисуются только те связи, чья сущность лежит на этом холсте: у сцены их
  // бывает десяток, а холст — не отчёт, а схема, и ноду сюда кладут руками.
  const placedEntityKeys = new Set(
    saved.filter((p) => p.node_type !== "scene").map((p) => `${p.node_type}:${p.node_id}`)
  );

  const castRows = lookup.length
    ? (db
        .prepare(
          `SELECT l.id, l.from_id AS scene_id, l.to_type, l.to_id, l.section,
                  IFNULL(c.qty, '') AS qty
           FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
           WHERE l.from_type = 'scene' AND l.section IN (${[...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, SCENE_SOUND_SECTION]
             .map(() => "?")
             .join(",")})
             AND l.from_id IN (${lookup.map(() => "?").join(",")})`
        )
        .all(...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, SCENE_SOUND_SECTION, ...lookup) as {
        id: number;
        scene_id: number;
        to_type: string;
        to_id: number;
        section: string;
        qty: string;
      }[])
    : [];

  const castEdges = castRows.flatMap((row) => {
    const entityKey = `${row.to_type}:${row.to_id}`;
    if (!placedEntityKeys.has(entityKey)) return [];
    // Последствие идёт В ДРУГУЮ СТОРОНУ: состав втекает в сцену слева, а
    // последствие вытекает из неё справа. Это единственная связь сцены с
    // таким направлением, и рисовать её как остальные значило бы сказать, что
    // сцена собрана из падения крепости.
    const isConsequence = row.section === CONSEQUENCE_SECTION;
    const isSound = row.section === SCENE_SOUND_SECTION;
    const isBattle = row.section === "scene_battle";
    // Та же оговорка, что у переходов: одна заготовка может стоять в
    // приключении дважды, и её состав рисуется от обеих вставок.
    return (shownByContent.get(row.scene_id) ?? []).map((sceneId) => ({
      id: `cast:${row.id}:${sceneId}`,
      kind: "cast" as const,
      source: isConsequence ? `scene:${sceneId}` : entityKey,
      target: isConsequence ? entityKey : `scene:${sceneId}`,
      target_handle: isConsequence ? "in" : isSound ? "audio" : isBattle ? "battle" : CAST_ROLE_BY_SECTION[row.section] ?? "participants",
      label: row.qty,
    }));
  });

  // Членство в наборе — те же связи, только владелец набор. Рисуется тоже
  // лишь для тех членов, что лежат на холсте: набор на схеме обычно нужен
  // целиком, а не раскрытым.
  const bundleIds = saved.filter((p) => p.node_type === "bundle").map((p) => p.node_id);
  const memberRows = bundleIds.length
    ? (db
        .prepare(
          `SELECT l.id, l.from_id AS bundle_id, l.to_type, l.to_id, IFNULL(c.qty, '') AS qty
           FROM generic_links l LEFT JOIN link_cast c ON c.link_id = l.id
           WHERE l.from_type = 'bundle' AND l.from_id IN (${bundleIds.map(() => "?").join(",")})`
        )
        .all(...bundleIds) as {
        id: number;
        bundle_id: number;
        to_type: string;
        to_id: number;
        qty: string;
      }[])
    : [];

  const memberEdges = memberRows.flatMap((row) => {
    const entityKey = `${row.to_type}:${row.to_id}`;
    if (!placedEntityKeys.has(entityKey)) return [];
    return [
      {
        id: `member:${row.id}`,
        kind: "member" as const,
        source: entityKey,
        target: `bundle:${row.bundle_id}`,
        target_handle: "members",
        label: row.qty,
      },
    ];
  });

  const edges = [...storyEdges, ...castEdges, ...memberEdges];

  const scenesById = new Map(scenes.map((s) => [s.id, s]));

  // Рамка непустой главы ОБНИМАЕТ свои сцены — каждый раз заново, а не
  // подтягивается по мере надобности. Отсюда у неё нет ручек растягивания:
  // границы главы это то, где лежат её сцены, и вручную их не назначают.
  // Мастер двигает рамку (сцены едут с ней) и двигает сцены — размер
  // получается сам, и разъехаться им негде.
  for (const g of groups) {
    const mine = nodes.filter((n) => scenesById.get(n.node_id)?.arc_id === g.arc_id);
    if (mine.length === 0) continue;
    const x = Math.min(...mine.map((n) => n.x)) - FRAME_PAD;
    const y = Math.min(...mine.map((n) => n.y)) - FRAME_HEAD;
    const w = Math.max(...mine.map((n) => n.x)) + COL_W + FRAME_PAD - x;
    const h = Math.max(...mine.map((n) => n.y)) + ROW_H + FRAME_PAD - y;
    if (x !== g.x || y !== g.y || w !== g.w || h !== g.h) {
      fitGroup.run(x, y, w, h, boardId, g.arc_id);
      g.x = x;
      g.y = y;
      g.w = w;
      g.h = h;
    }
  }

  // стикеры/картинки и на приключенческом холсте (Q5, Q6)
  const stickersArc = db.prepare("SELECT id, text, name, note, color FROM canvas_stickers WHERE board_id=?").all(boardId) as { id: number; text: string; name: string; note: string; color: string }[];
  const imagesArc = db.prepare("SELECT id, file_path, w, h FROM canvas_images WHERE board_id=?").all(boardId) as { id: number; file_path: string; w: number; h: number }[];
  const stickerNodesArc = stickersArc.map((s) => {
    const pos = saved.find((p) => p.node_type === "sticker" && p.node_id === s.id) ?? { x: 0, y: 0 };
    return { key: `sticker:${s.id}`, node_type: "sticker" as const, node_id: s.id, x: pos.x, y: pos.y, placed: !!saved.find((p) => p.node_type === "sticker" && p.node_id === s.id), sticker: { id: s.id, text: s.text, name: s.name || s.text, note: s.note, color: s.color } };
  });
  const imageNodesArc = imagesArc.map((im) => {
    const pos = saved.find((p) => p.node_type === "image" && p.node_id === im.id) ?? { x: 0, y: 0 };
    return { key: `image:${im.id}`, node_type: "image" as const, node_id: im.id, x: pos.x, y: pos.y, placed: !!saved.find((p) => p.node_type === "image" && p.node_id === im.id), image: { id: im.id, file_url: toFileUrl(im.file_path), w: im.w, h: im.h } };
  });
  const framesArc = db.prepare("SELECT id, name, color, x, y, w, h FROM canvas_frames WHERE board_id=?").all(boardId) as { id: number; name: string; color: string; x: number; y: number; w: number; h: number }[];
  const frameNodesArc = framesArc.map((f) => {
    const pos = saved.find((p) => p.node_type === "frame" && p.node_id === f.id) ?? { x: f.x, y: f.y };
    return { key: `frame:${f.id}`, node_type: "frame" as const, node_id: f.id, x: pos.x ?? f.x, y: pos.y ?? f.y, placed: true, frame: { id: f.id, name: f.name, color: f.color, w: f.w, h: f.h } };
  });

  res.json({
    board_id: boardId,
    arc: { id: arc.id, name: arc.name, setting_id: arc.setting_id },
    campaign_id: campaignId,
    nodes: [...nodes, ...checkNodes, ...stickerNodesArc, ...imageNodesArc, ...frameNodesArc, ...entityNodes(boardId, saved)],
    groups,
    edges,
  });
});

// Фриформ-доски вне сеттингов (Q1 а, §5)
canvasRouter.get("/free-boards", (_req, res) => {
  // чистим битые ноды (стикер/картинку удалили, а canvas_nodes остался) — иначе счётчик врёт
  db.prepare("DELETE FROM canvas_nodes WHERE node_type='sticker' AND node_id NOT IN (SELECT id FROM canvas_stickers)").run();
  db.prepare("DELETE FROM canvas_nodes WHERE node_type='image' AND node_id NOT IN (SELECT id FROM canvas_images)").run();
  db.prepare("DELETE FROM canvas_nodes WHERE node_type='frame' AND node_id NOT IN (SELECT id FROM canvas_frames)").run();
  const rows = db.prepare(
    `SELECT id, scope_id, name, created_at,
      (
        (SELECT count(*) FROM canvas_stickers WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_images WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_frames WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_nodes WHERE board_id=canvas_boards.id AND node_type NOT IN ('sticker','image','frame'))
      ) as nodes
     FROM canvas_boards WHERE scope_type='free' ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});
canvasRouter.post("/free-boards", (req, res) => {
  const name = String(req.body?.name ?? "Доска").trim() || "Доска";
  const info = db.prepare("INSERT INTO canvas_boards (scope_type, scope_id, name) VALUES ('free', 0, ?)").run(name);
  const id = Number(info.lastInsertRowid);
  db.prepare("UPDATE canvas_boards SET scope_id=? WHERE id=?").run(id, id);
  res.status(201).json({ id, scope_id: id, name });
});
canvasRouter.put("/free-boards/:id", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  db.prepare("UPDATE canvas_boards SET name=? WHERE scope_type='free' AND scope_id=?").run(name, Number(req.params.id));
  res.json({ ok: true });
});
canvasRouter.delete("/free-boards/:id", (req, res) => {
  db.prepare("DELETE FROM canvas_boards WHERE scope_type='free' AND scope_id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

// Стикеры (Q5) — name + note с MentionTextarea
canvasRouter.post("/stickers", (req, res) => {
  const { board_id, text, name, note, color, x, y } = req.body as { board_id?: number; text?: string; name?: string; note?: string; color?: string; x?: number; y?: number };
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  const n = name ?? text ?? "";
  const nt = note ?? "";
  const info = db.prepare("INSERT INTO canvas_stickers (board_id, text, name, note, color) VALUES (?,?,?,?,?)").run(board_id, text ?? n, n, nt, color ?? "paper");
  const sid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "sticker", sid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: sid });
});
canvasRouter.put("/stickers/:id", (req, res) => {
  const { text, name, note, color } = req.body as { text?: string; name?: string; note?: string; color?: string };
  if (text !== undefined) db.prepare("UPDATE canvas_stickers SET text=?, name=? WHERE id=?").run(text, text, Number(req.params.id));
  if (name !== undefined) db.prepare("UPDATE canvas_stickers SET name=? WHERE id=?").run(name, Number(req.params.id));
  if (note !== undefined) db.prepare("UPDATE canvas_stickers SET note=? WHERE id=?").run(note, Number(req.params.id));
  if (color !== undefined) db.prepare("UPDATE canvas_stickers SET color=? WHERE id=?").run(color, Number(req.params.id));
  res.json({ ok: true });
});
canvasRouter.get("/stickers", (req, res) => {
  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
  const rows = board_id ? db.prepare("SELECT * FROM canvas_stickers WHERE board_id=?").all(board_id) : db.prepare("SELECT * FROM canvas_stickers").all();
  res.json(rows);
});
canvasRouter.get("/stickers/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM canvas_stickers WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});
// Рамки-группы фриформ (Q4)
canvasRouter.post("/frames", (req, res) => {
  const { board_id, name, color, x, y, w, h } = req.body as { board_id?: number; name?: string; color?: string; x?: number; y?: number; w?: number; h?: number };
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  const c = color ?? "#2C3E50";
  const info = db.prepare("INSERT INTO canvas_frames (board_id, name, color, x, y, w, h) VALUES (?,?,?,?,?,?,?)").run(board_id, name ?? "Группа", c, Number(x) || 0, Number(y) || 0, Number(w) || 320, Number(h) || 240);
  const fid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "frame", fid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: fid });
});
canvasRouter.put("/frames/:id", (req, res) => {
  const { name, color, x, y, w, h } = req.body as { name?: string; color?: string; x?: number; y?: number; w?: number; h?: number };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) { sets.push("name = ?"); vals.push(String(name).trim() || "Группа"); }
  if (color !== undefined) { sets.push("color = ?"); vals.push(String(color)); }
  if (x !== undefined) { sets.push("x = ?"); vals.push(Number(x)); }
  if (y !== undefined) { sets.push("y = ?"); vals.push(Number(y)); }
  if (w !== undefined) { sets.push("w = ?"); vals.push(Number(w)); }
  if (h !== undefined) { sets.push("h = ?"); vals.push(Number(h)); }
  if (sets.length) {
    vals.push(Number(req.params.id));
    db.prepare(`UPDATE canvas_frames SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  // также двигаем ноду если x/y менялись
  if (x !== undefined || y !== undefined) {
    const row = db.prepare("SELECT board_id FROM canvas_frames WHERE id = ?").get(Number(req.params.id)) as { board_id: number } | undefined;
    if (row && (x !== undefined || y !== undefined)) {
      const cur = db.prepare("SELECT x, y FROM canvas_nodes WHERE node_type='frame' AND node_id=?").get(Number(req.params.id)) as { x: number; y: number } | undefined;
      const nx = x !== undefined ? Number(x) : cur?.x ?? 0;
      const ny = y !== undefined ? Number(y) : cur?.y ?? 0;
      db.prepare("UPDATE canvas_nodes SET x = ?, y = ? WHERE node_type='frame' AND node_id = ?").run(nx, ny, Number(req.params.id));
    }
  }
  res.json(db.prepare("SELECT * FROM canvas_frames WHERE id = ?").get(Number(req.params.id)));
});
canvasRouter.get("/frames", (req, res) => {
  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  res.json(db.prepare("SELECT * FROM canvas_frames WHERE board_id=?").all(board_id));
});

// Изображения (Q6) — загрузка файла уже через /filesystem, здесь только привязка
canvasRouter.post("/images", (req, res) => {
  const { board_id, file_path, x, y, w, h } = req.body as { board_id?: number; file_path?: string; x?: number; y?: number; w?: number; h?: number };
  if (!board_id || !file_path) return res.status(400).json({ error: "board_id and file_path required" });
  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id, file_path, w ?? 320, h ?? 240);
  const iid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id, "image", iid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: iid, file_url: toFileUrl(file_path) });
});
canvasRouter.post("/images/upload", upload.single("file"), async (req, res) => {
  const board_id = Number(req.body?.board_id);
  const x = Number(req.body?.x) || 0;
  const y = Number(req.body?.y) || 0;
  if (!board_id || !req.file) return res.status(400).json({ error: "board_id and file required" });
  const ext = path.extname(req.file.originalname) || ".png";
  const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  if (!allowed.includes(ext.toLowerCase())) return res.status(400).json({ error: "allowed png/jpg/webp/gif" });
  const sub = `canvas/${board_id}`;
  await ensureSubfolder(VAULT_ROOT, sub);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const target = path.join(VAULT_ROOT, sub, fileName);
  // write file directly (no old file to replace)
  const fs = await import("fs/promises");
  await fs.writeFile(target, req.file.buffer);
  const file_path = target;
  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id, file_path, 320, 240);
  const iid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?,?,?)").run(board_id, "image", iid, x, y);
  res.status(201).json({ id: iid, file_url: toFileUrl(file_path) });
});

// Экспорт приключения со схемой — секция canvas опциональна, сущности uid-ссылками (Q4, Q7)
canvasRouter.get("/export", (req, res) => {
  const { arc_id } = req.query as { arc_id?: string };
  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
  const arcId = Number(arc_id);
  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(arcId) as { id: number; setting_id: number; name: string } | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });
  const arcIds = [arcId, ...((db.prepare("SELECT id FROM story_arcs WHERE parent_id = ? AND archived_at IS NULL ORDER BY position, id").all(arcId) as { id: number }[]).map((r) => r.id))];
  const ph = arcIds.map(() => "?").join(",");
  const scenes = db.prepare(`SELECT * FROM story_scenes WHERE arc_id IN (${ph}) AND archived_at IS NULL ORDER BY position, id`).all(...arcIds);
  const transitions = db.prepare(`SELECT * FROM story_scene_transitions WHERE from_scene_id IN (SELECT id FROM story_scenes WHERE arc_id IN (${ph})) ORDER BY position, id`).all(...arcIds);
  const checks = db.prepare(`SELECT * FROM story_scene_checks WHERE scene_id IN (SELECT id FROM story_scenes WHERE arc_id IN (${ph})) ORDER BY position, id`).all(...arcIds);
  const outcomes = checks.length ? db.prepare(`SELECT * FROM story_check_outcomes WHERE check_id IN (${checks.map(() => "?").join(",")}) ORDER BY position, id`).all(...(checks as { id: number }[]).map((c) => c.id)) : [];
  const board = db.prepare("SELECT id FROM canvas_boards WHERE scope_type = 'arc' AND scope_id = ?").get(arcId) as { id: number } | undefined;
  let canvas: unknown = null;
  if (board) {
    const nodes = db.prepare("SELECT node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?").all(board.id);
    const groups = db.prepare("SELECT arc_id, x, y, w, h FROM canvas_groups WHERE board_id = ?").all(board.id);
    const bundleIds = (nodes as { node_type: string; node_id: number }[]).filter((n) => n.node_type === "bundle").map((n) => n.node_id);
    const bundles = bundleIds.length ? db.prepare(`SELECT * FROM canvas_bundles WHERE id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
    const bundleLinks = bundleIds.length ? db.prepare(`SELECT l.*, IFNULL(c.qty,'') as qty FROM generic_links l LEFT JOIN link_cast c ON c.link_id=l.id WHERE l.from_type='bundle' AND l.from_id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
    canvas = { board_id: board.id, nodes, groups, bundles, bundleLinks };
  }
  res.json({ arc, scenes, transitions, checks, outcomes, canvas });
});

/**
 * Подвинули или растянули рамку главы.
 *
 * Сцены внутри при этом НЕ пересчитываются: они держат свои координаты в
 * системе холста. Двигать их вместе с рамкой — работа клиента, который знает,
 * кто в рамке лежал в момент захвата; на сервере это означало бы решать за
 * Мастера, попала ли в рамку сцена соседней главы.
 */
canvasRouter.put("/groups/:arcId", (req, res) => {
  const { board_id, x, y, w, h, color, name } = req.body as {
    board_id?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    color?: string;
    name?: string;
  };
  if (!board_id) return res.status(400).json({ error: "board_id is required" });
  if (name !== undefined) {
    db.prepare("UPDATE story_arcs SET name = ? WHERE id = ?").run(String(name).trim() || "Глава", req.params.arcId);
  }
  db.prepare(
    `UPDATE canvas_groups SET
       x = COALESCE(?, x), y = COALESCE(?, y),
       w = COALESCE(?, w), h = COALESCE(?, h),
       color = COALESCE(?, color),
       updated_at = datetime('now')
     WHERE board_id = ? AND arc_id = ?`
  ).run(x ?? null, y ?? null, w ?? null, h ?? null, color ?? null, board_id, req.params.arcId);
  res.json({ ok: true });
});

/**
 * Сохранение раскладки пачкой: перетаскивание отпускают сразу над несколькими
 * нодами (рамкой выделили — подвинули), и класть по запросу на ноду значит
 * получить очередь из десятка запросов на один жест.
 */
canvasRouter.put("/board/nodes", (req, res) => {
  const body = req.body as {
    arc_id?: number;
    board_id?: number;
    nodes?: { node_type?: string; node_id?: number; x?: number; y?: number; z_index?: number }[];
  };
  if (!Array.isArray(body.nodes)) return res.status(400).json({ error: "nodes must be an array" });
  let boardId: number;
  if (body.board_id) boardId = Number(body.board_id);
  else if (body.arc_id) boardId = ensureBoard("arc", Number(body.arc_id));
  else return res.status(400).json({ error: "arc_id or board_id required" });
  const upsert = db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, z_index, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(board_id, node_type, node_id)
     DO UPDATE SET x = excluded.x, y = excluded.y, z_index = excluded.z_index, updated_at = excluded.updated_at`
  );

  const write = db.transaction((rows: typeof body.nodes) => {
    (rows ?? []).forEach((n) => {
      if (!n.node_type || !n.node_id) return;
      upsert.run(boardId, n.node_type, Number(n.node_id), Number(n.x) || 0, Number(n.y) || 0, Number((n as { z_index?: number }).z_index) || 0);
    });
  });
  write(body.nodes);

  res.json({ ok: true, board_id: boardId });
});

/**
 * Положить ноду сущности или набора на холст.
 *
 * У сцен такого эндпоинта нет и не нужно: они выводятся из приключения.
 * Существо же оказывается на схеме только потому, что его сюда положили.
 */
canvasRouter.post("/board/node", (req, res) => {
  const { arc_id, board_id, node_type, node_id, x, y } = req.body as {
    arc_id?: number;
    board_id?: number;
    node_type?: string;
    node_id?: number;
    x?: number;
    y?: number;
  };
  if ((!arc_id && !board_id) || !node_type || !node_id) {
    return res.status(400).json({ error: "arc_id or board_id, node_type and node_id are required" });
  }
  if (node_type === "scene") {
    return res.status(400).json({ error: "сцены выводятся из приключения, класть их не нужно" });
  }
  const boardId = board_id ? Number(board_id) : ensureBoard("arc", Number(arc_id));
  db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(board_id, node_type, node_id)
     DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`
  ).run(boardId, node_type, Number(node_id), Number(x) || 0, Number(y) || 0);
  res.status(201).json({ ok: true, key: `${node_type}:${node_id}` });
});

/**
 * Убрать ноду с холста — и ТОЛЬКО с холста. Связи «участник сцены» остаются:
 * их правят и на странице сцены, и расчистка схемы не должна молча
 * выпотрошить сцены. Связь снимается отсоединением стрелки.
 */
canvasRouter.delete("/board/node", (req, res) => {
  const { arc_id, board_id, node_type, node_id } = req.query as {
    arc_id?: string;
    board_id?: string;
    node_type?: string;
    node_id?: string;
  };
  if (!node_type || !node_id) return res.status(400).json({ error: "node_type and node_id are required" });
  let boardId: number;
  if (board_id) boardId = Number(board_id);
  else if (arc_id) boardId = ensureBoard("arc", Number(arc_id));
  else return res.status(400).json({ error: "arc_id or board_id required" });
  db.prepare("DELETE FROM canvas_nodes WHERE board_id = ? AND node_type = ? AND node_id = ?").run(boardId, node_type, Number(node_id));
  if (node_type === "sticker") db.prepare("DELETE FROM canvas_stickers WHERE id = ?").run(Number(node_id));
  if (node_type === "image") {
    const row = db.prepare("SELECT file_path FROM canvas_images WHERE id = ?").get(Number(node_id)) as { file_path: string } | undefined;
    db.prepare("DELETE FROM canvas_images WHERE id = ?").run(Number(node_id));
    void row;
  }
  if (node_type === "frame") db.prepare("DELETE FROM canvas_frames WHERE id = ?").run(Number(node_id));
  res.json({ ok: true });
});

// ------------------------------------------------------------- наборы

/**
 * Полка наборов. Рядом с полкой заготовок и по тем же правилам: глобальная,
 * сеттинг — метка, а не владелец.
 */
canvasRouter.get("/bundles", (req, res) => {
  const settingId = req.query.setting_id ? Number(req.query.setting_id) : null;
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.content_type, b.setting_id, t.name AS setting_name,
              (SELECT COUNT(*) FROM generic_links l WHERE l.from_type = 'bundle' AND l.from_id = b.id) AS members
       FROM canvas_bundles b LEFT JOIN settings t ON t.id = b.setting_id
       WHERE b.in_library = 1
       ORDER BY b.name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[];
  const shelf = rows.map((r) => ({ ...r, foreign: settingId != null && r.setting_id !== settingId }));
  shelf.sort((a, b) => Number(a.foreign) - Number(b.foreign));
  res.json(shelf);
});

/**
 * Завести набор и сразу положить его на холст. Пустым: набор ещё ничем не
 * стал, и content_type у него пустой, пока в него не втащили первого члена.
 */
canvasRouter.post("/bundles", (req, res) => {
  const { arc_id, board_id, name, setting_id, x, y } = req.body as {
    arc_id?: number;
    board_id?: number;
    name?: string;
    setting_id?: number | null;
    x?: number;
    y?: number;
  };
  // free-доска: board_id напрямую (Q1 а), иначе arc_id
  let boardId: number;
  if (board_id) boardId = Number(board_id);
  else if (arc_id) boardId = ensureBoard("arc", Number(arc_id));
  else return res.status(400).json({ error: "arc_id or board_id required" });
  const info = db
    .prepare("INSERT INTO canvas_bundles (name, setting_id) VALUES (?, ?)")
    .run(String(name ?? "Набор").trim() || "Набор", setting_id ?? null);
  const bundleId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?, 'bundle', ?, ?, ?)`
  ).run(boardId, bundleId, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: bundleId, key: `bundle:${bundleId}` });
});

/**
 * Правка набора. Как у заготовки: тронул вставку — отвязалась. Иначе
 * переименование одного отряда переименовало бы его во всех приключениях, где
 * он стоит.
 */
canvasRouter.put("/bundles/:id", (req, res) => {
  const id = detachBundle(Number(req.params.id));
  const { name, in_library } = req.body as { name?: string; in_library?: boolean };
  if (name !== undefined) {
    db.prepare("UPDATE canvas_bundles SET name = ? WHERE id = ?").run(String(name).trim(), id);
  }
  if (in_library !== undefined) {
    db.prepare("UPDATE canvas_bundles SET in_library = ? WHERE id = ?").run(in_library ? 1 : 0, id);
  }
  res.json(db.prepare("SELECT * FROM canvas_bundles WHERE id = ?").get(id));
});

/**
 * Втащить сущность в набор. Первый член задаёт вид набора: набор существ
 * втыкается только в «участников», набор предметов — только в «предметы».
 * Разнородный набор не заводится — именно из-за него универсальный
 * объединитель ломал бы типизацию разъёмов.
 */
canvasRouter.post("/bundles/:id/members", (req, res) => {
  const { to_type, to_id, qty } = req.body as { to_type?: string; to_id?: number; qty?: string };
  if (!to_type || !to_id) return res.status(400).json({ error: "to_type and to_id are required" });
  const id = detachBundle(Number(req.params.id));
  const bundle = db.prepare("SELECT content_type FROM canvas_bundles WHERE id = ?").get(id) as
    | { content_type: string | null }
    | undefined;
  if (!bundle) return res.status(404).json({ error: "not found" });
  if (bundle.content_type && bundle.content_type !== to_type) {
    return res.status(400).json({
      error: `в наборе уже лежит другое (${bundle.content_type}); набор держит что-то одно`,
    });
  }
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
       VALUES ('bundle', ?, ?, ?, 'bundle_member')`
    )
    .run(id, to_type, Number(to_id));
  const linkId =
    info.changes > 0
      ? Number(info.lastInsertRowid)
      : (
          db
            .prepare(
              `SELECT id FROM generic_links WHERE from_type = 'bundle' AND from_id = ?
                 AND to_type = ? AND to_id = ? AND section = 'bundle_member'`
            )
            .get(id, to_type, Number(to_id)) as { id: number }
        ).id;
  if (!bundle.content_type) {
    db.prepare("UPDATE canvas_bundles SET content_type = ? WHERE id = ?").run(to_type, id);
  }
  if (qty != null && String(qty).trim()) setLinkQty(linkId, String(qty));
  res.status(201).json({ link_id: linkId, bundle_id: id });
});

/**
 * Убрать набор с холста. Сам набор при этом остаётся, если лежит на полке, —
 * ровно как заготовка: убрал со схемы, не выкинул с полки.
 */
canvasRouter.delete("/bundles/:id", (req, res) => {
  const id = Number(req.params.id);
  const bundle = db.prepare("SELECT in_library FROM canvas_bundles WHERE id = ?").get(id) as
    | { in_library: number }
    | undefined;
  if (!bundle) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM canvas_nodes WHERE node_type = 'bundle' AND node_id = ?").run(id);
  // Вставку удаляем совсем: без холста она нигде не видна и ничем не полезна.
  // Полочный оригинал остаётся — за него ещё держатся другие вставки.
  if (bundle.in_library === 0) {
    db.prepare("DELETE FROM generic_links WHERE from_type = 'bundle' AND from_id = ?").run(id);
    db.prepare("DELETE FROM canvas_bundles WHERE id = ?").run(id);
  }
  res.json({ ok: true });
});

/**
 * Вставить набор с полки: рождается строка-ссылка, которая следует за
 * оригиналом, пока её не тронули. То же правило, что у заготовок сцен, —
 * два разных правила переиспользования в одном редакторе гарантировали бы
 * вопрос «почему тут правка разошлась, а тут разъехалась».
 */
canvasRouter.post("/bundles/:id/insert", (req, res) => {
  const { arc_id, board_id, x, y } = req.body as { arc_id?: number; board_id?: number; x?: number; y?: number };
  if (!arc_id && !board_id) return res.status(400).json({ error: "arc_id or board_id is required" });
  const source = db.prepare("SELECT * FROM canvas_bundles WHERE id = ?").get(req.params.id) as
    | { id: number; name: string; content_type: string | null; setting_id: number | null }
    | undefined;
  if (!source) return res.status(404).json({ error: "not found" });

  const info = db
    .prepare(
      `INSERT INTO canvas_bundles (name, content_type, library_bundle_id, setting_id)
       VALUES ('', NULL, ?, ?)`
    )
    .run(source.id, source.setting_id);
  const bundleId = Number(info.lastInsertRowid);
  const boardId = board_id ? Number(board_id) : ensureBoard("arc", Number(arc_id));
  db.prepare(
    "INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?, 'bundle', ?, ?, ?)"
  ).run(boardId, bundleId, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: bundleId, key: `bundle:${bundleId}` });
});

/**
 * «Вытащить состав»: показать на холсте тех, кто к сцене уже подцеплен.
 *
 * Показывать их всегда нельзя — в приключении на двадцать сцен это под сотню
 * нод сразу, и схему пришлось бы расчищать вместо того, чтобы рисовать. Но и
 * заставлять Мастера искать в списке то, что программа про сцену знает, —
 * глупо. Поэтому по кнопке и ровно для одной сцены.
 */
canvasRouter.post("/board/pull-cast", (req, res) => {
  const { arc_id, scene_id, x, y } = req.body as {
    arc_id?: number;
    scene_id?: number;
    x?: number;
    y?: number;
  };
  if (!arc_id || !scene_id) return res.status(400).json({ error: "arc_id and scene_id are required" });

  // У нетронутой вставки состав лежит на заготовке.
  const sceneId = (() => {
    const row = db.prepare("SELECT library_scene_id FROM story_scenes WHERE id = ?").get(scene_id) as
      | { library_scene_id: number | null }
      | undefined;
    return row?.library_scene_id ?? Number(scene_id);
  })();

  const targets = db
    .prepare(
      `SELECT DISTINCT to_type, to_id FROM generic_links
       WHERE from_type = 'scene' AND from_id = ? AND section IN (${Object.values(CAST_SECTIONS)
         .map(() => "?")
         .join(",")})`
    )
    .all(sceneId, ...Object.values(CAST_SECTIONS)) as { to_type: string; to_id: number }[];

  const boardId = ensureBoard("arc", Number(arc_id));
  const place = db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(board_id, node_type, node_id) DO NOTHING`
  );
  // Слева от сцены столбиком: данные текут слева направо, и состав, вставший
  // справа, читался бы как следствие сцены, а не как её содержимое.
  const baseX = (Number(x) || 0) - 260;
  const baseY = Number(y) || 0;
  let added = 0;
  db.transaction(() => {
    targets.forEach((t, i) => {
      added += place.run(boardId, t.to_type, t.to_id, baseX, baseY + i * 90).changes;
    });
  })();

  res.json({ ok: true, added, total: targets.length });
});
