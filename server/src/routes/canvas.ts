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
import { toFileUrl } from "../services/filesystem";

export const canvasRouter = Router();

// «Полотно» — узловой редактор. Первый вид холста: одно приключение, его
// сцены нодами и переходы между ними рёбрами.
//
// Данные холст не заводит: сцены, переходы и copy-on-write слой кампании
// живут в story_*, и правятся теми же эндпоинтами, что и список сцен. Здесь
// только раскладка (canvas_boards/canvas_nodes) и один сводный ответ, чтобы
// открытие холста не превращалось в пять запросов подряд.

type ScopeType = "arc";

/** Ребро холста в том виде, в каком его ждёт клиент. */
interface EdgeOut {
  id: string;
  kind: "transition" | "outcome" | "cast" | "member";
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
  artifact: { table: "artifacts", nameCol: "name", thumbCol: "thumbnail_image_path" },
  community: { table: "setting_communities", nameCol: "name", thumbCol: "thumbnail_image_path" },
  compendium_entry: { table: "compendium_entries", nameCol: "name", kindCol: "kind" },
  // События хроники мира и расписания кампании — тоже ноды: связь «эта сцена
  // сдвигает это событие» рисуется стрелкой, а не отдельным полем, и потому
  // переживает переименование.
  setting_event: { table: "setting_calendar_events", nameCol: "title" },
  campaign_event: { table: "campaign_calendar_events", nameCol: "title" },
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
  const { arc_id, campaign_id } = req.query as { arc_id?: string; campaign_id?: string };
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
    .prepare("SELECT id, node_type, node_id, x, y FROM canvas_nodes WHERE board_id = ?")
    .all(boardId) as { id: number; node_type: string; node_id: number; x: number; y: number }[];
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
        .prepare("SELECT arc_id, x, y, w, h FROM canvas_groups WHERE board_id = ?")
        .all(boardId) as { arc_id: number; x: number; y: number; w: number; h: number }[]
    ).map((g) => [g.arc_id, g])
  );
  const newGroup = db.prepare(
    "INSERT OR IGNORE INTO canvas_groups (board_id, arc_id, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?)"
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
    if (kept) return { arc_id: ch.id, name: ch.name, x: kept.x, y: kept.y, w: kept.w, h: kept.h };
    const rows = Math.max(1, Math.ceil((unplacedByArc.get(ch.id) ?? 0) / COLS));
    const fresh = {
      x: 0,
      y: frontier,
      w: COL_W * COLS + FRAME_PAD * 2,
      h: FRAME_HEAD + rows * ROW_H + FRAME_PAD,
    };
    frontier += fresh.h + GAP;
    newGroup.run(boardId, ch.id, fresh.x, fresh.y, fresh.w, fresh.h);
    return { arc_id: ch.id, name: ch.name, ...fresh };
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

  // Исходы проверок, которые ведут в другую сцену. Ради них холст и рисуется:
  // ветвление подземелья задаётся в основном проверками, а не переходами, и
  // без этих рёбер схема показывала бы половину истории.
  const outcomes = lookup.length
    ? (db
        .prepare(
          `SELECT o.id, o.label, o.target_id, c.scene_id AS from_scene_id, c.what
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
  const storyEdges = [
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
    ...outcomes.flatMap((o) =>
      (shownByContent.get(o.from_scene_id) ?? []).map((fromId) => ({
        id: `outcome:${o.id}:${fromId}`,
        kind: "outcome" as const,
        source: `scene:${fromId}`,
        target: sceneKey(shownBySource.get(o.target_id)),
        target_handle: "story",
        label: o.what ? `${o.what} — ${o.label}` : o.label,
      }))
    ),
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
           WHERE l.from_type = 'scene' AND l.section IN (${[...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION]
             .map(() => "?")
             .join(",")})
             AND l.from_id IN (${lookup.map(() => "?").join(",")})`
        )
        .all(...Object.values(CAST_SECTIONS), CONSEQUENCE_SECTION, ...lookup) as {
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
    // Та же оговорка, что у переходов: одна заготовка может стоять в
    // приключении дважды, и её состав рисуется от обеих вставок.
    return (shownByContent.get(row.scene_id) ?? []).map((sceneId) => ({
      id: `cast:${row.id}:${sceneId}`,
      kind: "cast" as const,
      source: isConsequence ? `scene:${sceneId}` : entityKey,
      target: isConsequence ? entityKey : `scene:${sceneId}`,
      target_handle: isConsequence ? "in" : CAST_ROLE_BY_SECTION[row.section] ?? "participants",
      // Количество подписью на ребре: на ноде оно соврало бы — гоблин один, а
      // сцен у него три, и в каждой их разное число. Пустое не подписываем:
      // «один» это умолчание.
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

  res.json({
    board_id: boardId,
    arc: { id: arc.id, name: arc.name, setting_id: arc.setting_id },
    campaign_id: campaignId,
    nodes: [...nodes, ...entityNodes(boardId, saved)],
    groups,
    edges,
  });
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
  const { board_id, x, y, w, h } = req.body as {
    board_id?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  if (!board_id) return res.status(400).json({ error: "board_id is required" });
  db.prepare(
    `UPDATE canvas_groups SET
       x = COALESCE(?, x), y = COALESCE(?, y),
       w = COALESCE(?, w), h = COALESCE(?, h),
       updated_at = datetime('now')
     WHERE board_id = ? AND arc_id = ?`
  ).run(x ?? null, y ?? null, w ?? null, h ?? null, board_id, req.params.arcId);
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
    nodes?: { node_type?: string; node_id?: number; x?: number; y?: number }[];
  };
  if (!body.arc_id) return res.status(400).json({ error: "arc_id is required" });
  if (!Array.isArray(body.nodes)) return res.status(400).json({ error: "nodes must be an array" });

  const boardId = ensureBoard("arc", Number(body.arc_id));
  const upsert = db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(board_id, node_type, node_id)
     DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`
  );

  const write = db.transaction((rows: typeof body.nodes) => {
    (rows ?? []).forEach((n) => {
      if (!n.node_type || !n.node_id) return;
      upsert.run(boardId, n.node_type, Number(n.node_id), Number(n.x) || 0, Number(n.y) || 0);
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
  const { arc_id, node_type, node_id, x, y } = req.body as {
    arc_id?: number;
    node_type?: string;
    node_id?: number;
    x?: number;
    y?: number;
  };
  if (!arc_id || !node_type || !node_id) {
    return res.status(400).json({ error: "arc_id, node_type and node_id are required" });
  }
  if (node_type === "scene") {
    return res.status(400).json({ error: "сцены выводятся из приключения, класть их не нужно" });
  }
  const boardId = ensureBoard("arc", Number(arc_id));
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
  const { arc_id, node_type, node_id } = req.query as {
    arc_id?: string;
    node_type?: string;
    node_id?: string;
  };
  if (!arc_id || !node_type || !node_id) {
    return res.status(400).json({ error: "arc_id, node_type and node_id are required" });
  }
  const boardId = ensureBoard("arc", Number(arc_id));
  db.prepare("DELETE FROM canvas_nodes WHERE board_id = ? AND node_type = ? AND node_id = ?").run(
    boardId,
    node_type,
    Number(node_id)
  );
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
  const { arc_id, name, setting_id, x, y } = req.body as {
    arc_id?: number;
    name?: string;
    setting_id?: number | null;
    x?: number;
    y?: number;
  };
  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
  const info = db
    .prepare("INSERT INTO canvas_bundles (name, setting_id) VALUES (?, ?)")
    .run(String(name ?? "Набор").trim() || "Набор", setting_id ?? null);
  const bundleId = Number(info.lastInsertRowid);
  const boardId = ensureBoard("arc", Number(arc_id));
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
  const { arc_id, x, y } = req.body as { arc_id?: number; x?: number; y?: number };
  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });
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
  const boardId = ensureBoard("arc", Number(arc_id));
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
