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
import { HINT_SCENE_COLUMNS, sceneHints } from "../story/hints";
import { firstSceneOf, rehearsalStep } from "../story/rehearsal";
import { CANVAS_PRESETS, isPresetKey } from "../story/presets";
import multer from "multer";
import path from "path";
import { ensureSubfolder, toFileUrl, VAULT_ROOT, vaultRel, writeReplacingOldFile } from "../services/filesystem";

export const canvasRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// «Полотно» — узловой редактор. Первый вид холста: одно приключение, его
// сцены нодами и переходы между ними рёбрами.
//
// Данные холст не заводит: сцены, переходы и copy-on-write слой кампании
// живут в story_*, и правятся теми же эндпоинтами, что и список сцен. Здесь
// только раскладка (canvas_boards/canvas_nodes) и один сводный ответ, чтобы
// открытие холста не превращалось в пять запросов подряд.

/** Виды доски: холст приключения, свободная доска и схема сеттинга.
 *  Схема вернулась блоком D3 — но не как обязательный средний шаг, каким её
 *  убирали в Q17, а как второй вид рядом со списком. `campaign` вернулся
 *  блоком D4 — но это НЕ прежняя «сборка сессии» из Q25, которую выбросили
 *  пустой заглушкой: это карта кампании, где лежат её приключения, покрашенные
 *  прохождением. Кампания как ПАРАМЕТР входа на холст приключения при этом
 *  осталась и означает прежнее (Q26). */
type ScopeType = "arc" | "free" | "setting" | "campaign";

/** Ребро холста в том виде, в каком его ждёт клиент. */
interface EdgeOut {
  id: string;
  /** `story` — связь между главами приключения (блок G6.2). Тем же именем,
   *  что у связи между приключениями на схеме сеттинга: это одна таблица и
   *  одно утверждение, только на другом уровне. */
  kind: "transition" | "outcome" | "cast" | "member" | "check" | "thread" | "story";
  source: string;
  target: string;
  target_handle: string;
  label: string;
  width?: number;
  color?: string;
}

/**
 * Переход, второй конец которого лежит на другом холсте (решение Q17).
 *
 * Не ребро: рисовать его стрелкой некуда — цели на этом холсте нет. Это
 * висящий разъём на ноде сцены, называющий чужую сцену и знающий адрес её
 * холста. Скрыть его нельзя (холст не должен врать), шагнуть по нему —
 * значит уехать на другой холст, и делает это Мастер щелчком, а не стрелка.
 */
interface OutsideLink {
  /** `out` — отсюда туда, `in` — оттуда сюда. Направление видно на разъёме:
   *  входящий стоит слева, исходящий справа, как и обычные переходы. */
  dir: "out" | "in";
  label: string;
  scene_id: number;
  scene_name: string;
  arc_id: number;
  arc_name: string;
  setting_id: number;
  /** Холст, на который ведёт щелчок. */
  board_arc_id: number;
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
 * Свободная доска адресуется СВОИМ `scope_id` (канон П2.4): ссылка `?free_id=`
 * и маршруты `/free-boards` ходят по нему, и в содержимое он прошит
 * построением — при создании `scope_id` приравнивается к `id` строки доски.
 * Содержимое же клиент шлёт как `board_id`, то есть числом, глядящим на
 * строку. Пока числа совпадают — это одно и то же; если они когда-нибудь
 * разойдутся, здесь совершается единственно правильный переход: входящий
 * `board_id` свободной доски трактуется как `scope_id`, и содержимое
 * оборачивается на каноническую строку.
 *
 * Для досок arc/setting/campaign `scope_id` — это id приключения/сеттинга, а
 * не строки, поэтому их `board_id` резолвится в самого себя (совпадения по
 * `scope_type='free'` нет).
 */
function resolveFreeBoardId(boardId: number): number {
  const b = db
    .prepare("SELECT id FROM canvas_boards WHERE scope_type='free' AND scope_id=?")
    .get(boardId) as { id: number } | undefined;
  return b ? b.id : boardId;
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
  // Персонаж игрока (блок G7). Единственный кампанийный вид на холсте: он и
  // есть то, вокруг чего Мастер тянет нити на доске кампании. Портрет берём
  // уменьшенный — на холсте нода опознаётся, а не рассматривается.
  character: {
    table: "characters",
    nameCol: "character_name",
    thumbCol: "thumbnail_image_path",
  },
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
  /** Слой. Раньше его писали, но не отдавали — и раскладка по слоям
   *  затиралась нулём на следующем же перетаскивании (см. «Находки»). */
  z_index?: number;
  /** Рамка, на которую ноду бросили — ключ `chapter:26` / `frame:4`.
   *  Только у тех, у кого своей главы нет: сущность, стикер, картинка, пин (Q11). */
  parent_key?: string | null;
}

/**
 * Ноды сущностей и наборов — те, что положили на холст руками. Выводить их
 * не из чего: в приключении на двадцать сцен подцеплено под сотню существ и
 * локаций, и показывать всех значит заставить Мастера расчищать схему вместо
 * того, чтобы её рисовать.
 */
/**
 * Стикеры, картинки, свободные рамки, пины и нити доски.
 *
 * Одно и то же нужно и фриформ-доске, и холсту приключения — раньше это
 * стояло двумя копиями, и копии успели разойтись: авто-расширение рамки под
 * своё содержимое было только у фриформа, а на приключении рамка так и
 * оставалась той величины, какую ей задали, сколько бы узлов в неё ни
 * положили.
 *
 * Расширение считается только в ответе. Свою величину рамке задаёт Мастер
 * через `PUT /canvas/frames/:id`; расширение выводится из тех же узлов при
 * каждом запросе и потому в хранении не нуждается.
 */
function boardDecor(boardId: number, saved: PlacedNode[]) {
  const posOfKey = new Map(saved.map((p) => [`${p.node_type}:${p.node_id}`, p]));
  const at = (type: string, id: number) => posOfKey.get(`${type}:${id}`);

  const stickers = db
    .prepare("SELECT id, text, name, note, color FROM canvas_stickers WHERE board_id=?")
    .all(boardId) as { id: number; text: string; name: string; note: string; color: string }[];
  const stickerNodes = stickers.map((s) => {
    const pos = at("sticker", s.id);
    return {
      key: `sticker:${s.id}`,
      node_type: "sticker" as const,
      node_id: s.id,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      z_index: pos?.z_index ?? 0,
      parent_key: pos?.parent_key ?? null,
      placed: !!pos,
      sticker: { id: s.id, text: s.text, name: s.name || s.text, note: s.note, color: s.color },
    };
  });

  const images = db
    .prepare("SELECT id, file_path, w, h FROM canvas_images WHERE board_id=?")
    .all(boardId) as { id: number; file_path: string; w: number; h: number }[];
  const imageNodes = images.map((im) => {
    const pos = at("image", im.id);
    return {
      key: `image:${im.id}`,
      node_type: "image" as const,
      node_id: im.id,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      z_index: pos?.z_index ?? 0,
      parent_key: pos?.parent_key ?? null,
      placed: !!pos,
      image: { id: im.id, file_url: toFileUrl(im.file_path), w: im.w, h: im.h },
    };
  });

  const frames = db
    .prepare("SELECT id, name, color, x, y, w, h, collapsed FROM canvas_frames WHERE board_id=?")
    .all(boardId) as { id: number; name: string; color: string; x: number; y: number; w: number; h: number; collapsed: number }[];
  const frameNodes = frames.map((f) => {
    const pos = at("frame", f.id);
    return {
      key: `frame:${f.id}`,
      node_type: "frame" as const,
      node_id: f.id,
      x: pos?.x ?? f.x,
      y: pos?.y ?? f.y,
      z_index: pos?.z_index ?? 0,
      placed: true,
      frame: { id: f.id, name: f.name, color: f.color, w: f.w, h: f.h, collapsed: f.collapsed === 1 },
    };
  });

  // Разрешение сущностей — ОДИН раз, а не заново на каждую рамку: раньше на
  // семи рамках база опрашивалась семь раз подряд об одном и том же.
  const entities = entityNodes(boardId, saved);
  // Размер рамки здесь не пересчитывается: по гибридной модели рамка — контейнер
  // по охвату членов, а источник правды — клиент, который знает настоящие
  // отрисованные размеры узлов (у сервера их нет, только заглушки NODE_W/H, что
  // и давало баг «слетает размер»). Клиент пишет `w/h` рамки на каждое движение
  // и удаление члена; сервер лишь отдаёт хранимое. Так и рост, и сужение рамки
  // следуют за составом с верными размерами содержимого.

  const pins = db
    .prepare("SELECT id, name, x, y, size, color, shape, z_index FROM canvas_pins WHERE board_id=?")
    .all(boardId) as { id: number; name: string; x: number; y: number; size: string; color: string; shape: string; z_index: number }[];
  const pinNodes = pins.map((p) => {
    const pos = at("pin", p.id);
    return {
      key: `pin:${p.id}`,
      node_type: "pin" as const,
      node_id: p.id,
      x: pos?.x ?? p.x,
      y: pos?.y ?? p.y,
      z_index: pos?.z_index ?? p.z_index,
      // Пин — такой же житель рамки, как стикер и картинка (Q11). Раньше
      // родство хранилось, но не отдавалось, и рамка уезжала без него.
      parent_key: pos?.parent_key ?? null,
      placed: true,
      pin: { id: p.id, name: p.name, color: p.color, shape: p.shape, size: p.size, z_index: p.z_index },
    };
  });

  const threads = db
    .prepare("SELECT id, from_pin_id, to_pin_id, width, color FROM canvas_threads WHERE board_id=?")
    .all(boardId) as { id: number; from_pin_id: number; to_pin_id: number; width: number; color: string }[];

  return { nodes: [...stickerNodes, ...imageNodes, ...frameNodes, ...pinNodes, ...entities], threads };
}

/** Строка рераута («Маршрут») из `canvas_routes` + его выходы. */
interface RouteRow {
  id: number;
  from_key: string;
  to_key: string;
  kind: string;
  role: string;
  /** Выходы хаба: каждый — сцена (to_key), куда передаётся носитель. */
  outputs?: { to_key: string; role: string }[];
}

function splitNodeKey(key: string): [string, string] {
  const i = key.indexOf(":");
  return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

/** Типы ключей, которые могут быть соседями рераута (`from_key`/`to_key`). */
const ROUTE_PEER_RE = /^(scene|being|location|artifact|community|compendium_entry|bundle|adventure|chapter|sticker|image|frame|pin|sound_set|playlist|check|setting_event|campaign_event|route|character|campaign):\d+$/;
const ROUTE_KIND_RE = /^(transition|outcome|cast|member|thread|arc-transition)$/;
const isValidRouteKey = (key: string) => key === "" || ROUTE_PEER_RE.test(key);

/**
 * Рераут-ноды доски.
 *
 * Рераут — визуальный проход-развязка, который рвёт длинное реальное ребро
 * (переход/каст/исход/нить) на два сегмента вокруг себя. Сам данных не заводит:
 * реальное ребро остаётся одно, а здесь только ПАМЯТЬ ПРОХОДА — какие два соседа
 * рераут соединяет и ребро какого вида несёт. Позиция живёт в парной строке
 * `canvas_nodes(node_type='route', node_id=id)`, как у пинов и стикеров.
 *
 * Роль/цвет гнезда рераут перенимает от ребра, которое рвёт (`kind`/`role`),
 * поэтому конфликт ролей на ноде невозможен по построению: одно ребро — одна роль.
 */
function boardRoutes(boardId: number, saved: PlacedNode[]) {
  const rows = db
    .prepare(
      "SELECT id, from_key, to_key, kind, role FROM canvas_routes WHERE board_id=? ORDER BY id"
    )
    .all(boardId) as RouteRow[];
  // Выходы каждого рераута: N сцен, куда передаётся носитель.
  const routeIds = rows.map((r) => r.id);
  const outputRows = routeIds.length
    ? (db
        .prepare(`SELECT route_id, to_key, role FROM canvas_route_outputs WHERE route_id IN (${routeIds.map(() => "?").join(",")}) ORDER BY rowid`)
        .all(...routeIds) as { route_id: number; to_key: string; role: string }[])
    : [];
  for (const r of rows) r.outputs = outputRows.filter((o) => o.route_id === r.id).map(({ to_key, role }) => ({ to_key, role }));

  // Имя узла по ключу — для тела рераута «A → B» (у cast/исхода/нити имена
  // соседей дороже, чем плейсхолдер). Посторонний ключ (чужой доски) называем
  // ключом — такой сосед на этот холст не приезжает. Таблицы имён по типу:
  // каждый вид существа лежит в своей таблице (см. MENTION_TABLES в db.ts),
  // а не в одной setting_beings.
  const NAME_TABLES: Record<string, string> = {
    scene: "story_scenes",
    being: "setting_beings",
    location: "setting_locations",
    community: "setting_communities",
    artifact: "artifacts",
    campaign: "campaigns",
  };
  // Бач строк ключей (не отдельных нод): собираем все имена разом, а не
  // по одному SELECT на соседа (на 20 рераутах были бы 40 запросов).
  const idsByType = new Map<string, number[]>();
  const collectKeys = (keys: string[]) => {
    for (const key of keys) {
      if (!key) continue;
      const [type, raw] = splitNodeKey(key);
      const id = Number(raw);
      if (id && NAME_TABLES[type]) {
        if (!idsByType.has(type)) idsByType.set(type, []);
        idsByType.get(type)!.push(id);
      }
    }
  };
  for (const r of rows) {
    collectKeys([r.from_key, r.to_key]);
    collectKeys((r.outputs ?? []).map((o) => o.to_key));
  }
  const nameByKey = new Map<string, string>();
  for (const [type, ids] of idsByType) {
    const table = NAME_TABLES[type];
    if (!table || ids.length === 0) continue;
    const ph = ids.map(() => "?").join(",");
    const rowsT = db
      .prepare(`SELECT id, name FROM ${table} WHERE id IN (${ph})`)
      .all(...(ids as number[])) as { id: number; name: string }[];
    for (const r of rowsT) nameByKey.set(`${type}:${r.id}`, r.name);
  }
  const nameOf = (key: string): string => {
    const hit = nameByKey.get(key);
    if (hit !== undefined) return hit;
    const [type] = splitNodeKey(key);
    if (type === "check") return "Проверка";
    if (type === "route") return "Маршрут";
    return key;
  };

  const posOfKey = new Map(saved.map((p) => [`${p.node_type}:${p.node_id}`, p]));
  const nodes = rows.map((r) => {
    const pos = posOfKey.get(`route:${r.id}`);
    const fromName = r.from_key ? nameOf(r.from_key) : "";
    const toName = r.to_key ? nameOf(r.to_key) : "";
    // Для перехода — реальная строка `story_scene_transitions` между соседями:
    // её id и label и есть «Условие перехода», которое правим в панели свойств.
    let transition_id: number | null = null;
    let transition_label = "";
    // У перехода ровно один сосед-выход (сцена). Наследную колонку to_key
    // могли не заполнить в новой модели (выходы в canvas_route_outputs),
    // поэтому берём выход отсюда, а не из строки.
    const toSceneKey = (r.outputs && r.outputs.length ? r.outputs[0].to_key : r.to_key) || "";
    if (r.kind === "transition" && r.from_key.startsWith("scene:") && toSceneKey.startsWith("scene:")) {
      const t = db
        .prepare(
          "SELECT id, label FROM story_scene_transitions WHERE from_scene_id=? AND to_scene_id=? ORDER BY id LIMIT 1"
        )
        .get(Number(r.from_key.slice(6)), Number(toSceneKey.slice(6))) as
        | { id: number; label: string }
        | undefined;
      if (t) {
        transition_id = t.id;
        transition_label = t.label ?? "";
      }
    }
    return {
      key: `route:${r.id}`,
      node_type: "route" as const,
      node_id: r.id,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      z_index: pos?.z_index ?? 0,
      parent_key: pos?.parent_key ?? null,
      placed: !!pos,
      route: {
        id: r.id,
        from_key: r.from_key,
        to_key: r.to_key,
        kind: r.kind,
        role: r.role,
        from_name: fromName,
        to_name: toName,
        outputs: (r.outputs ?? []).map((o) => ({
          to_key: o.to_key,
          role: o.role,
          to_name: nameOf(o.to_key),
        })),
        transition_id,
        transition_label,
      },
    };
  });
  return { nodes, rows };
}

/**
 * Разводит реальные рёбра через цепочки рераутов.
 *
 * Модель (согласовано с владельцем): рераут — узел графа, а строка
 * `canvas_routes` для рераута с id=k запоминает двух его СОСЕДЕЙ — `from_key` и
 * `to_key`, каждый из которых либо ключ настоящего узла (`scene:41`,
 * `being:12`, `pin:3`), либо ключ другого рераута (`route:7`). Из этого строится
 * неориентированный граф связности: узел `route:k` смежен с `from_key` и с
 * `to_key`.
 *
 * Реальное ребро E: X→Y (с известным `kind`) рвётся, когда X и Y связаны цепью
 * рераутов того же `kind`. Путь X=r0, route:r1, route:r2, ..., route:rn, Y=Y
 * превращается в сегменты (X→route:r1), (route:r1→route:r2), ..., (route:rn→Y),
 * сохранённые в порядке направления ребра E. Признак сам-ребро несущей реальной
 * связи кладётся в каждый сегмент, чтобы клиент знал, у какого сегмента вешается
 * подпись/условие. Обезьяний патч: исходное ребро не рвём, если пути нет.
 *
 * `routeLabelKey` используется для согласования: сегменты реального ребра
 * оставляем без подписи (label переносится выбранным рераутом на средний сегмент).
 */
function routedEdges(
  edges: (Omit<EdgeOut, "target_handle"> & { label?: string; target_handle?: string })[],
  rows: RouteRow[]
) {
  if (rows.length === 0) return edges;

  // Граф: ключ ноды → соседи (ключи) через рерауты данного kind.
  // Для учёта каждой строки: узел `route:<id>` смежен с from_key и to_key.
  // Но нам нужны только рерауты, попадающие в конкретное ребро — см. ниже.
  // Граф: ключ ноды → соседи (ключи). Узел `route:k` смежен со своими from_key и
  // to_key. Это неориентированные связи пути, а порядок задаёт направление
  // реального ребра, которое разрезаем.
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  for (const r of rows) {
    // Пустой рераут (только что брошен из палитры, вход и выходы ещё не
    // подведены) не участвует в графе: подключать его некуда. Реальный путь
    // рвётся только когда есть и вход (from_key), и хотя бы один выход.
    const outs = (r.outputs ?? []).filter((o) => o.to_key).map((o) => o.to_key);
    if (!r.from_key || outs.length === 0) continue;
    // Рераут-хаб смежен со своим входом и со ВСЕМИ выходами: каждое реальное
    // ребро «носитель → сцена» для каждого выхода рвётся через этот же рераут.
    link(r.from_key, `route:${r.id}`);
    for (const toKey of outs) link(`route:${r.id}`, toKey);
  }
  // Какие рерауты какого вида несут (для фильтрации сегментов).
  const kindOfRoute = new Map<string, string>();
  for (const r of rows) kindOfRoute.set(`route:${r.id}`, r.kind);

  // Стандартный BFS: путь (типа вершин) от `from` до `to` по рёбрам графа,
  // но проходить можно только через рерауты нужного kind. Возвращает полную
  // цепочку вершин [from, ..., to] или null, если пути нет.
  const findVertices = (from: string, to: string, kind: string): string[] | null => {
    if (from === to) return null;
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const nb of adj.get(node) ?? []) {
        // Шаг во внешний мир допускаем только к самой цели — рераут не должен
        // тянуться сквозь посторонние узлы, это рвало бы не наше ребро.
        if (nb.startsWith("route:")) {
          if (kindOfRoute.get(nb) !== kind) continue;
        } else if (nb !== to) {
          continue;
        }
        if (prev.has(nb)) continue;
        prev.set(nb, node);
        if (nb === to) {
          const path = [to];
          let cur: string | null = to;
          while ((cur = prev.get(cur) ?? null) !== null) path.unshift(cur);
          return path;
        }
        queue.push(nb);
      }
    }
    return null;
  };

  const out: (EdgeOut & { label?: string })[] = [];
  // Preview для частично подключённых рераутов: один конец виден сразу
  for (const r of rows) {
    const from = (r as any).from_key || "";
    const outs: any[] = (r as any).outputs ?? [];
    const hasFrom = !!from;
    const hasTo = outs.length > 0;
    if (hasFrom && !hasTo) {
      out.push({ id: `route-preview:${r.id}:in`, kind: r.kind as any, source: from, target: `route:${r.id}`, target_handle: "route-in", label: "", width: 1.5, color: "#1a1a1a" } as any);
    } else if (!hasFrom && hasTo) {
      for (const o of outs) {
        out.push({ id: `route-preview:${r.id}:${o.to_key}`, kind: r.kind as any, source: `route:${r.id}`, target: o.to_key, label: "", width: 1.5, color: "#1a1a1a" } as any);
      }
    }
  }
  for (const e of edges) {
    const kind = e.kind === "story" ? (e.source.startsWith("adventure:") && e.target.startsWith("adventure:") ? "arc-transition" : "transition") : e.kind;
    const verts = findVertices(e.source, e.target, kind);
    if (!verts || verts.length < 3) {
      out.push(e as EdgeOut);
      continue;
    }
    // Сегменты: X → route:r1 → route:r2 → … → Y. Подпись реального ребра вешаем
    // только на последний сегмент (у цели), средние сегменты идут чистыми.
    for (let i = 0; i < verts.length - 1; i++) {
      const isLast = i === verts.length - 2;
      const targetIsRoute = verts[i + 1].startsWith("route:");
      out.push({
        id: `${e.id}::r${i}`,
        kind: e.kind,
        source: verts[i],
        target: verts[i + 1],
        // Когда цель — рераут-нода, её единственный входной разъём безымянный:
        // наследованный id исходного ребра («story» и т.п.) React Flow найти не
        // сможет (ошибка #008), поэтому сбрасываем его.
        target_handle: targetIsRoute ? "" : (e.target_handle ?? "in"),
        label: isLast ? e.label ?? "" : "",
        width: e.width,
        color: e.color,
      });
    }
  }
  return out;
}

/**
 * Подметает осиротевшие рерауты после удаления реального ребра/узла.
 *
 * `canvas_routes.from_key`/`to_key` — голый TEXT без FK: если удалить само
 * ребро (переход между сценами, generic_link каста/состава и т.п.) или один из
 * крайних узлов, строка рераута остаётся висячей — BFS путь потеряет, и рераут
 * начнёт пустовать / терять имя соседа. Здесь удаляем строки, ссылающиеся на
 * пропавшие ключи, и каскадно те рерауты, что вели на эти рерауты (цепочка).
 */
export function pruneRoutesForKeys(gone: string[]) {
  if (gone.length === 0) return;
  const goneSet = new Set(gone);
  let removed = true;
  // Каскад: сначала ключи, потом рерауты, ссылавшиеся на удалённые рерауты,
  // и так пока стабилизируется. (Удалённый реальный узел тянет за собой и свой
  // рераут-«сироту», и соседей по цепочке.)
  while (removed) {
    removed = false;
    // Осиротевшие выходы: сцена-цель удалена, значит передавать в неё больше
    // нечего. Сама строка рераута остаётся (вход цел); выход просто снимаем.
    for (const goneKey of goneSet) {
      db.prepare("DELETE FROM canvas_route_outputs WHERE to_key=?").run(goneKey);
    }
    const rows = db
      .prepare("SELECT id, from_key, to_key FROM canvas_routes")
      .all() as { id: number; from_key: string; to_key: string }[];
    const doomed = rows.filter(
      (r) => goneSet.has(r.from_key) || goneSet.has(r.to_key) || goneSet.has(`route:${r.id}`)
    );
    for (const r of doomed) {
      db.prepare("DELETE FROM canvas_nodes WHERE node_type='route' AND node_id=?").run(r.id);
      db.prepare("DELETE FROM canvas_routes WHERE id=?").run(r.id);
      goneSet.add(`route:${r.id}`);
      removed = true;
    }
  }
}

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
          z_index: p.z_index ?? 0,
          parent_key: p.parent_key ?? null,
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

      /**
       * Приключение — ярлык на доске (Q20, Q22).
       *
       * Ни имени, ни счётчиков нода не хранит: она указывает на `story_arcs`,
       * и переименованное приключение обязано переименоваться на всех досках,
       * куда его положили. Разъёмов у ярлыка нет — связи между приключениями
       * на свободной доске рисуются нитями, в `story_arcs` при этом ничего не
       * пишется.
       */
      if (p.node_type === "adventure") {
        const arc = db
          .prepare(
            `SELECT a.id, a.name, a.setting_id,
                    (SELECT COUNT(*) FROM story_arcs c
                      WHERE c.parent_id = a.id AND c.archived_at IS NULL AND c.campaign_id IS NULL) AS chapter_count,
                    (SELECT COUNT(*) FROM story_scenes s
                       JOIN story_arcs sc ON sc.id = s.arc_id
                      WHERE (sc.id = a.id OR sc.parent_id = a.id)
                        AND sc.archived_at IS NULL AND sc.campaign_id IS NULL
                        AND s.campaign_id IS NULL AND s.archived_at IS NULL) AS scene_count
               FROM story_arcs a WHERE a.id = ? AND a.archived_at IS NULL`
          )
          .get(p.node_id) as
          | { id: number; name: string; setting_id: number; chapter_count: number; scene_count: number }
          | undefined;
        if (!arc) return null;
        return {
          key: `adventure:${p.node_id}`,
          node_type: "adventure" as const,
          node_id: p.node_id,
          x: p.x,
          y: p.y,
          z_index: p.z_index ?? 0,
          parent_key: p.parent_key ?? null,
          placed: true,
          adventure: arc,
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
          z_index: p.z_index ?? 0,
          parent_key: p.parent_key ?? null,
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
          z_index: p.z_index ?? 0,
          parent_key: p.parent_key ?? null,
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
          z_index: p.z_index ?? 0,
          parent_key: p.parent_key ?? null,
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
        z_index: p.z_index ?? 0,
        parent_key: p.parent_key ?? null,
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
    const saved = db.prepare("SELECT id, node_type, node_id, x, y, z_index, parent_key FROM canvas_nodes WHERE board_id=?").all(board.id) as { id: number; node_type: string; node_id: number; x: number; y: number; z_index: number; parent_key: string | null }[];
    const decor = boardDecor(board.id, saved);
    const { nodes: routeNodes, rows: routeRows } = boardRoutes(board.id, saved);
    return res.json({
      board_id: board.id,
      free: { id: freeId, name: board.name },
      campaign_id: null,
      nodes: [...decor.nodes, ...routeNodes],
      groups: [],
      edges: [],
      threads: decor.threads,
      routes: routeRows,
    });
  }

  /**
   * Схема сеттинга (блок D3, решение D0 §5).
   *
   * Циклом 6 холст сеттинга убирали не за то, что он холст, а за то, что он
   * был ОБЯЗАТЕЛЬНЫМ средним шагом на пути к сценам. Здесь он — второй вид
   * рядом со списком, и список остаётся дорогой по умолчанию.
   *
   * Читает и только читает: строки доски может не быть вовсе, и заводится она
   * при первом сохранении раскладки (`PUT /board/nodes` с `setting_id`).
   * Приключение, у которого сохранённого места ещё нет, получает вычисленное
   * и помечается `placed: false` — клиент закрепляет такую раскладку одним
   * сохранением, но решает это он, а не чтение.
   *
   * Сборка кампании (`scope_type='campaign'`) остаётся убранной (Q25): она
   * была пустой заглушкой, а кампания приходит на холст приключения путём
   * входа — параметром `campaign_id`. Своя доска у кампании появится блоком
   * D4 и будет означать другое.
   */
  if (setting_id) {
    const settingId = Number(setting_id);
    const setting = db
      .prepare("SELECT id, name FROM settings WHERE id = ? AND archived_at IS NULL")
      .get(settingId) as { id: number; name: string } | undefined;
    if (!setting) return res.status(404).json({ error: "not found" });

    const board = db
      .prepare("SELECT id FROM canvas_boards WHERE scope_type='setting' AND scope_id=?")
      .get(settingId) as { id: number } | undefined;
    const saved = board
      ? (db
          .prepare(
            "SELECT id, node_type, node_id, x, y, z_index, parent_key FROM canvas_nodes WHERE board_id=?"
          )
          .all(board.id) as PlacedNode[])
      : [];

    // Приключения сеттинга — верхнего уровня, без глав (у них parent_id) и без
    // кампанийных копий: схема показывает заготовку, а не прохождение.
    const allArcs = db
      .prepare(
        `SELECT a.id, a.name, a.position, a.is_default,
                (SELECT COUNT(*) FROM story_arcs c
                  WHERE c.parent_id = a.id AND c.archived_at IS NULL AND c.campaign_id IS NULL) AS chapter_count,
                (SELECT COUNT(*) FROM story_scenes s
                   JOIN story_arcs sc ON sc.id = s.arc_id
                  WHERE (sc.id = a.id OR sc.parent_id = a.id)
                    AND sc.archived_at IS NULL AND sc.campaign_id IS NULL
                    AND s.campaign_id IS NULL AND s.archived_at IS NULL) AS scene_count
           FROM story_arcs a
          WHERE a.setting_id = ? AND a.parent_id IS NULL
            AND a.archived_at IS NULL AND a.campaign_id IS NULL
          ORDER BY a.position, a.id`
      )
      .all(settingId) as {
      id: number;
      name: string;
      position: number;
      is_default: number;
      chapter_count: number;
      scene_count: number;
    }[];

    // Пустое «Сцены вне приключений» на схеме не показываем — ровно то же
    // правило, что и в списке (`GET /canvas/index`): иначе у каждого сеттинга
    // появляется узел, за которым ничего нет. Непустое показываем: иначе его
    // не открыть ничем, кроме прямой ссылки.
    const arcs = allArcs.filter((a) => !(a.is_default === 1 && a.scene_count === 0));

    const shownIds = new Set(arcs.map((a) => a.id));
    // Только связи заготовки: `campaign_id IS NULL`. Схема сеттинга и есть
    // заготовка, и своим набором кампании (блок D4) ей делать нечего — без
    // этого условия связи всех кампаний по сеттингу валились на его схему
    // вперемешку с его собственными.
    const links = (
      db
        .prepare("SELECT from_arc_id, to_arc_id FROM story_arc_transitions WHERE campaign_id IS NULL")
        .all() as { from_arc_id: number; to_arc_id: number }[]
    ).filter((t) => shownIds.has(t.from_arc_id) && shownIds.has(t.to_arc_id));

    /**
     * Автораскладка: колонка — длина цепочки переходов до приключения.
     *
     * Первым правилом были колонки по `position` (решение D0 §7). На живой
     * базе оно дало картину шириной 2240 px: восемь приключений Вотердипа
     * стоят на восьми разных позициях, и в окно такая лента не влезает даже
     * при наименьшем масштабе React Flow. Позиция к тому же говорит о порядке
     * внутри своего импортированного модуля, а не о том, что за чем идёт в
     * мире, — то есть колонка по ней выражала не то, ради чего схему открыли.
     *
     * Здесь колонка — глубина по связям: цепочка Вотердипа
     * «Карта без названий → Под Городом Мертвых → Портовый Район → Складка в
     * Плетении» ложится слева направо, а всё, что ни с чем не связано,
     * собирается в первой колонке столбиком. `position` остаётся порядком
     * внутри колонки, поэтому картина по-прежнему одна и та же при каждом
     * открытии, пока Мастер не подвинул сам.
     */
    const depth = new Map<number, number>(arcs.map((a) => [a.id, 0]));
    // Проходов не больше, чем приключений: этого хватает для любой цепочки, а
    // на кольце (A → B → A, завести такое ничто не мешает) расчёт
    // останавливается вместо того, чтобы крутиться вечно.
    for (let pass = 0; pass < arcs.length; pass++) {
      let moved = false;
      for (const l of links) {
        const next = (depth.get(l.from_arc_id) ?? 0) + 1;
        if (next > (depth.get(l.to_arc_id) ?? 0)) {
          depth.set(l.to_arc_id, next);
          moved = true;
        }
      }
      if (!moved) break;
    }

    const savedArc = new Map(
      saved.filter((p) => p.node_type === "adventure").map((p) => [p.node_id, p])
    );
    const column = new Map<number, number>();
    const arcNodes = arcs.map((a) => {
      const placed = savedArc.get(a.id);
      const col = depth.get(a.id) ?? 0;
      const row = column.get(col) ?? 0;
      column.set(col, row + 1);
      return {
        key: `adventure:${a.id}`,
        node_type: "adventure" as const,
        node_id: a.id,
        x: placed ? placed.x : col * 280,
        y: placed ? placed.y : row * 140,
        z_index: placed?.z_index ?? 0,
        parent_key: placed?.parent_key ?? null,
        placed: !!placed,
        adventure: {
          id: a.id,
          name: a.name,
          setting_id: settingId,
          chapter_count: a.chapter_count,
          scene_count: a.scene_count,
        },
      };
    });

    // «Что за чем идёт» — рёбрами, а не селектом на плитке. Ради этого места
    // связи и сохранили (решение D0 §4).
    const edges = (
      db
        .prepare(
          "SELECT id, from_arc_id, to_arc_id, label FROM story_arc_transitions WHERE campaign_id IS NULL"
        )
        .all() as { id: number; from_arc_id: number; to_arc_id: number; label: string }[]
    )
      .filter((t) => shownIds.has(t.from_arc_id) && shownIds.has(t.to_arc_id))
      .map((t) => ({
        id: `arc-transition:${t.id}`,
        kind: "story" as const,
        source: `adventure:${t.from_arc_id}`,
        target: `adventure:${t.to_arc_id}`,
        label: t.label ?? "",
      }));

    // Приключения из `saved` сюда НЕ отдаём: их уже собрал `arcNodes` выше,
    // вместе со счётчиками и автораскладкой. Общий сборщик тоже умеет ярлык
    // приключения (он нужен на свободной доске), и без этого фильтра каждое
    // приключение приезжало на схему дважды — сразу после первого сохранения
    // раскладки, когда у него появляется строка в `canvas_nodes`.
    const decor = board
      ? boardDecor(
          board.id,
          saved.filter((p) => p.node_type !== "adventure")
        )
      : { nodes: [], threads: [] };
    const routeRows = board
      ? boardRoutes(board.id, saved.filter((p) => p.node_type !== "adventure"))
      : { nodes: [], rows: [] };
    const routed = routedEdges(edges, routeRows.rows);
    return res.json({
      board_id: board?.id ?? null,
      setting: { id: setting.id, name: setting.name },
      campaign_id: null,
      nodes: [...arcNodes, ...decor.nodes, ...routeRows.nodes],
      groups: [],
      edges: routed,
      threads: decor.threads,
      routes: routeRows.rows,
    });
  }

  /**
   * Карта кампании (блок D4).
   *
   * Тот же холст, что схема сеттинга, но отвечает на другой вопрос — «где мы
   * сейчас», а не «как устроена история, которую я написал». Отсюда три
   * отличия: узлы покрашены прохождением, у переписанных под кампанию стоят
   * метки расхождения, а состав — приключения КАМПАНИИ (`campaign_adventures`),
   * а не всего сеттинга.
   *
   * Состав важен: на живой базе кампания «Вотердип» играет 6 приключений из 8
   * своего сеттинга. Показывать ей остальные — значит наполнять карту тем, к
   * чему кампания отношения не имеет, и делать это на каждое новое приключение
   * сеттинга. Решение владельца от 2026-08-27; на разборе D0 таблицы
   * `campaign_adventures` не нашли, и там было записано обратное.
   *
   * Читает и только читает, как и схема сеттинга: доска заводится первым
   * сохранением раскладки.
   */
  if (campaign_id && !arc_id) {
    const campaignId = Number(campaign_id);
    const campaign = db
      .prepare(
        "SELECT id, name, setting_id, own_arc_transitions FROM campaigns WHERE id = ? AND archived_at IS NULL"
      )
      .get(campaignId) as
      | { id: number; name: string; setting_id: number | null; own_arc_transitions: number }
      | undefined;
    if (!campaign) return res.status(404).json({ error: "not found" });

    const board = db
      .prepare("SELECT id FROM canvas_boards WHERE scope_type='campaign' AND scope_id=?")
      .get(campaignId) as { id: number } | undefined;
    const saved = board
      ? (db
          .prepare(
            "SELECT id, node_type, node_id, x, y, z_index, parent_key FROM canvas_nodes WHERE board_id=?"
          )
          .all(board.id) as PlacedNode[])
      : [];

    // Приключения кампании. Узлом остаётся ОРИГИНАЛ сеттинга: кампанийная
    // копия — это его версия текстов, а не другое приключение. Имя при этом
    // берётся у копии, если она есть.
    const arcs = db
      .prepare(
        `SELECT a.id, a.name, a.position, a.updated_at,
                (SELECT COUNT(*) FROM story_arcs c
                  WHERE c.parent_id = a.id AND c.archived_at IS NULL AND c.campaign_id IS NULL) AS chapter_count,
                (SELECT COUNT(*) FROM story_scenes s
                   JOIN story_arcs sc ON sc.id = s.arc_id
                  WHERE (sc.id = a.id OR sc.parent_id = a.id)
                    AND sc.archived_at IS NULL AND sc.campaign_id IS NULL
                    AND s.campaign_id IS NULL AND s.archived_at IS NULL) AS scene_count
           FROM campaign_adventures ca
           JOIN story_arcs a ON a.id = ca.arc_id
          WHERE ca.campaign_id = ? AND a.archived_at IS NULL AND a.campaign_id IS NULL
          ORDER BY ca.position, a.id`
      )
      .all(campaignId) as {
      id: number;
      name: string;
      position: number;
      updated_at: string | null;
      chapter_count: number;
      scene_count: number;
    }[];

    // Приключения, заведённые прямо в кампании: `campaign_id` есть, а
    // `source_arc_id` нет — это не версия чужого текста, а своя вещь, и в
    // `campaign_adventures` она не значится.
    const ownArcs = db
      .prepare(
        `SELECT a.id, a.name, a.position, a.updated_at,
                0 AS chapter_count,
                (SELECT COUNT(*) FROM story_scenes s
                  WHERE s.arc_id = a.id AND s.archived_at IS NULL) AS scene_count
           FROM story_arcs a
          WHERE a.campaign_id = ? AND a.source_arc_id IS NULL AND a.archived_at IS NULL
          ORDER BY a.position, a.id`
      )
      .all(campaignId) as typeof arcs;
    const allArcs = [...arcs, ...ownArcs];

    // Кампанийные копии: имя, метка «изменено в кампании» и то, разошёлся ли с
    // копией оригинал в сеттинге.
    const overrides = new Map(
      (
        db
          .prepare(
            "SELECT source_arc_id, name, created_at FROM story_arcs WHERE campaign_id = ? AND source_arc_id IS NOT NULL AND archived_at IS NULL"
          )
          .all(campaignId) as { source_arc_id: number; name: string; created_at: string }[]
      ).map((o) => [o.source_arc_id, o] as const)
    );

    // Прохождение: приключение «сыграно», когда сыграны все его сцены, «идёт» —
    // когда тронута хоть одна, иначе «не дошли». Считается по
    // `campaign_scene_state` — тем самым отметкам, что Мастер уже ставит.
    // Сцены глав засчитываются приключению: глава — его часть, а не сосед.
    const progressRows = db
      .prepare(
        `SELECT IFNULL(sc.parent_id, sc.id) AS root,
                COUNT(*) AS total,
                SUM(CASE WHEN st.status = 'done' THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN st.status IS NOT NULL THEN 1 ELSE 0 END) AS touched
           FROM story_scenes s
           JOIN story_arcs sc ON sc.id = s.arc_id
           LEFT JOIN campaign_scene_state st ON st.scene_id = s.id AND st.campaign_id = ?
          WHERE s.archived_at IS NULL AND s.campaign_id IS NULL AND sc.archived_at IS NULL
          GROUP BY root`
      )
      .all(campaignId) as { root: number; total: number; done: number; touched: number }[];
    const progressByArc = new Map(progressRows.map((r) => [r.root, r] as const));

    const shownIds = new Set(allArcs.map((a) => a.id));
    const ownTransitions = campaign.own_arc_transitions === 1;
    const transitionRows = (
      db
        .prepare(
          "SELECT id, from_arc_id, to_arc_id, label FROM story_arc_transitions WHERE campaign_id IS ?"
        )
        .all(ownTransitions ? campaignId : null) as {
        id: number;
        from_arc_id: number;
        to_arc_id: number;
        label: string;
      }[]
    ).filter((t) => shownIds.has(t.from_arc_id) && shownIds.has(t.to_arc_id));

    // Место наследуется со схемы сеттинга: если приключение там разложено
    // руками, на карте кампании оно встаёт туда же. Рамки и стикеры кампания
    // рисует свои — копировать чужие, часть которых обнимает приключения не из
    // кампании, владелец отменил 2026-08-27 (D0 §15 в этой части снят).
    const settingBoard = campaign.setting_id
      ? (db
          .prepare("SELECT id FROM canvas_boards WHERE scope_type='setting' AND scope_id=?")
          .get(campaign.setting_id) as { id: number } | undefined)
      : undefined;
    const fromSetting = new Map<number, { x: number; y: number }>(
      settingBoard
        ? (
            db
              .prepare(
                "SELECT node_id, x, y FROM canvas_nodes WHERE board_id = ? AND node_type = 'adventure'"
              )
              .all(settingBoard.id) as { node_id: number; x: number; y: number }[]
          ).map((n) => [n.node_id, { x: n.x, y: n.y }] as const)
        : []
    );

    // Автораскладка — то же правило, что у схемы сеттинга: колонка есть длина
    // цепочки переходов.
    const depth = new Map<number, number>(allArcs.map((a) => [a.id, 0]));
    for (let pass = 0; pass < allArcs.length; pass++) {
      let moved = false;
      for (const l of transitionRows) {
        const next = (depth.get(l.from_arc_id) ?? 0) + 1;
        if (next > (depth.get(l.to_arc_id) ?? 0)) {
          depth.set(l.to_arc_id, next);
          moved = true;
        }
      }
      if (!moved) break;
    }

    const savedArc = new Map(
      saved.filter((p) => p.node_type === "adventure").map((p) => [p.node_id, p] as const)
    );
    const column = new Map<number, number>();
    const arcNodes = allArcs.map((a) => {
      const placed = savedArc.get(a.id);
      const seeded = fromSetting.get(a.id);
      const col = depth.get(a.id) ?? 0;
      const row = column.get(col) ?? 0;
      column.set(col, row + 1);
      const at = placed ?? seeded ?? { x: col * 280, y: row * 140 };
      const ov = overrides.get(a.id);
      const st = progressByArc.get(a.id);
      return {
        key: `adventure:${a.id}`,
        node_type: "adventure" as const,
        node_id: a.id,
        x: at.x,
        y: at.y,
        z_index: placed?.z_index ?? 0,
        parent_key: placed?.parent_key ?? null,
        placed: !!placed,
        adventure: {
          id: a.id,
          name: ov?.name ?? a.name,
          setting_id: campaign.setting_id ?? 0,
          chapter_count: a.chapter_count,
          scene_count: a.scene_count,
          /** done | active | untouched — раскраска узла по прохождению. */
          progress:
            st && st.total > 0 && st.done >= st.total
              ? "done"
              : st && st.touched > 0
                ? "active"
                : "untouched",
          is_override: !!ov,
          /** Оригинал в сеттинге правили после того, как кампания сняла копию. */
          setting_changed_at:
            ov && a.updated_at && a.updated_at > ov.created_at ? a.updated_at : null,
          /** Добавлено в кампанию ПОСЛЕ того, как карту разложили: у карты
           *  есть своя доска, а у этого узла на ней места нет. До первого
           *  сохранения новых нет вовсе — новых относительно чего? */
          is_new: !!board && !placed && !seeded,
        },
      };
    });

    const edges = transitionRows.map((t) => ({
      id: `arc-transition:${t.id}`,
      kind: "story" as const,
      source: `adventure:${t.from_arc_id}`,
      target: `adventure:${t.to_arc_id}`,
      label: t.label ?? "",
    }));

    const decor = board
      ? boardDecor(
          board.id,
          saved.filter((p) => p.node_type !== "adventure")
        )
      : { nodes: [], threads: [] };
    const routeRows = board
      ? boardRoutes(board.id, saved.filter((p) => p.node_type !== "adventure"))
      : { nodes: [], rows: [] };
    const routed = routedEdges(edges, routeRows.rows);

    return res.json({
      board_id: board?.id ?? null,
      campaign_map: {
        id: campaign.id,
        name: campaign.name,
        setting_id: campaign.setting_id,
        own_transitions: ownTransitions,
      },
      campaign_id: campaignId,
      nodes: [...arcNodes, ...decor.nodes, ...routeRows.nodes],
      groups: [],
      edges: routed,
      threads: decor.threads,
      routes: routeRows.rows,
    });
  }

  if (!arc_id) return res.status(400).json({ error: "arc_id is required" });

  const arcId = Number(arc_id);
  const campaignId = campaign_id ? Number(campaign_id) : null;

  const arc = db.prepare("SELECT * FROM story_arcs WHERE id = ?").get(arcId) as
    | { id: number; setting_id: number; name: string; campaign_id: number | null; parent_id: number | null }
    | undefined;
  if (!arc) return res.status(404).json({ error: "not found" });

  // Холст главы отличается от холста приключения только тем, что у главы есть
  // родитель. Отдельного вида доски у неё нет: глава — такой же `arc`, и пара
  // `(scope_type='arc', scope_id)` покрывает оба уровня (блок G6.2).
  const parentArc = arc.parent_id
    ? ((db.prepare("SELECT id, name FROM story_arcs WHERE id = ?").get(arc.parent_id) as
        | { id: number; name: string }
        | undefined) ?? null)
    : null;

  /**
   * Доска показывает сцены СВОЕГО арка и только их (блок G6.2).
   *
   * До этого блока холст приключения тащил сцены всех своих глав — 184 из 201
   * на живой базе, — и держались они видимыми только свёрткой. Теперь глава —
   * узел, в который входят, и её сцены лежат на её собственной доске.
   *
   * Цена решения названа отдельно и закрыта ниже: 13 переходов из 81 ходят
   * через границу главы, и оба их конца больше не лежат на одном холсте. Они
   * не пропадают, а показываются висящим разъёмом со ссылкой — тем же
   * приёмом, каким прогон показывает цель в другом приключении.
   */
  const arcIds = [arcId];
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
    .prepare("SELECT id, node_type, node_id, x, y, z_index, parent_key FROM canvas_nodes WHERE board_id = ?")
    .all(boardId) as { id: number; node_type: string; node_id: number; x: number; y: number; z_index: number; parent_key: string | null }[];
  const savedByKey = new Map(saved.map((n) => [`${n.node_type}:${n.node_id}`, n]));

  // Позиция ноды ищется и по показанной сцене, и по её оригиналу: копия
  // кампании — это другая строка, но на холсте то же самое место, и
  // переключение кампании не должно раскидывать раскладку заново.
  const placedFor = scenes.map((s) => {
    const own = savedByKey.get(`scene:${s.id}`);
    const inherited = s.source_scene_id ? savedByKey.get(`scene:${s.source_scene_id}`) : undefined;
    return own ?? inherited;
  });

  /**
   * Главы — узлы-контейнеры, а не рамки (блок G6.2).
   *
   * Глава уже есть строка `story_arcs` с `kind='chapter'`, поэтому нового вида
   * доски ей не нужно, а место узла лежит там же, где у ярлыка приключения, —
   * в `canvas_nodes`. Прежняя `canvas_groups` больше не читается: рамки нет.
   *
   * На холсте главы глав не бывает — третьего уровня вложенности в модели нет
   * (замер: таких строк 0).
   */
  const chapters = arc.parent_id
    ? []
    : (db
        .prepare(
          `SELECT c.id, c.name,
                  (SELECT COUNT(*) FROM story_scenes s
                    WHERE s.arc_id = c.id AND s.archived_at IS NULL AND s.campaign_id IS NULL) AS scene_count
             FROM story_arcs c
            WHERE c.parent_id = ? AND c.archived_at IS NULL AND c.campaign_id IS NULL
            ORDER BY c.position, c.id`
        )
        .all(arcId) as { id: number; name: string; scene_count: number }[]);
  const shownChapterIds = new Set(chapters.map((c) => c.id));

  /**
   * Связи между главами — та же `story_arc_transitions`, что у приключений
   * (решение Q18). Уровень выводится из `kind` концов и отдельно не хранится:
   * этот холст показывает связи только своих глав, схема сеттинга — только
   * приключений, и смешаться им негде.
   *
   * Чей набор — решается тем же правилом, что на карте кампании: кампания
   * либо смотрит на заготовку сеттинга, либо ведёт свой набор целиком.
   */
  const entryCampaignRow =
    campaignId == null
      ? null
      : ((db
          .prepare("SELECT id, name, own_arc_transitions FROM campaigns WHERE id = ?")
          .get(campaignId) as { id: number; name: string; own_arc_transitions: number } | undefined) ?? null);
  const ownChapterLinks = entryCampaignRow?.own_arc_transitions === 1;
  const chapterLinks = chapters.length
    ? (
        db
          .prepare(
            "SELECT id, from_arc_id, to_arc_id, label FROM story_arc_transitions WHERE campaign_id IS ?"
          )
          .all(ownChapterLinks ? campaignId : null) as {
          id: number;
          from_arc_id: number;
          to_arc_id: number;
          label: string;
        }[]
      ).filter((t) => shownChapterIds.has(t.from_arc_id) && shownChapterIds.has(t.to_arc_id))
    : [];

  // Автораскладка глав — то же правило, что у приключений на схеме сеттинга:
  // колонка есть длина цепочки связей. Считается только для тех, кого ещё не
  // двигали рукой: раскладка руками выше любой автоматической.
  const chapterDepth = new Map<number, number>(chapters.map((c) => [c.id, 0]));
  for (let pass = 0; pass < chapters.length; pass++) {
    let moved = false;
    for (const l of chapterLinks) {
      const next = (chapterDepth.get(l.from_arc_id) ?? 0) + 1;
      if (next > (chapterDepth.get(l.to_arc_id) ?? 0)) {
        chapterDepth.set(l.to_arc_id, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const chapterColumn = new Map<number, number>();
  const chapterNodes = chapters.map((ch) => {
    const placed = savedByKey.get(`chapter:${ch.id}`);
    const col = chapterDepth.get(ch.id) ?? 0;
    const row = chapterColumn.get(col) ?? 0;
    chapterColumn.set(col, row + 1);
    return {
      key: `chapter:${ch.id}`,
      node_type: "chapter" as const,
      node_id: ch.id,
      x: placed ? placed.x : col * 280,
      y: placed ? placed.y : row * 140,
      z_index: placed?.z_index ?? 0,
      parent_key: placed?.parent_key ?? null,
      placed: !!placed,
      chapter: {
        id: ch.id,
        name: ch.name,
        arc_id: arcId,
        setting_id: arc.setting_id,
        scene_count: ch.scene_count,
      },
    };
  });

  // Сцены, добавленные после того, как Мастер разложил холст, кладутся ПОД
  // разложенным: индекс в общем списке уже занят закреплённой нодой, и новая
  // сцена легла бы ровно поверх неё — выглядит как пропавшая сцена, а не как
  // новая. Рамок здесь больше нет, и сажать сцену внутрь рамки своей главы
  // не нужно: на этом холсте лежат только сцены своего арка.
  const lowest = placedFor.reduce((acc, p) => (p ? Math.max(acc, p.y) : acc), Number.NEGATIVE_INFINITY);
  const freshStartY = lowest === Number.NEGATIVE_INFINITY ? 0 : lowest + ROW_H;
  let freshIndex = 0;

  const nodes = scenes.map((s, i) => {
    const placed = placedFor[i];
    const pos = placed
      ? placed
      : defaultPosition(lowest === Number.NEGATIVE_INFINITY ? i : freshIndex++, freshStartY);
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
      z_index: placed?.z_index ?? 0,
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
        // Заполняется ниже, когда посчитаны переходы: сквозные связи знать
        // раньше нельзя, а заводить второй проход по сценам ради одного поля
        // дороже, чем объявить его пустым.
        outside: [] as OutsideLink[],
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
      z_index: savedPos?.z_index ?? 0,
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

  // «Что за чем идёт» между главами — рёбрами между узлами глав (Q18).
  const chapterEdges: EdgeOut[] = chapterLinks.map((t) => ({
    id: `arc-transition:${t.id}`,
    kind: "story" as const,
    source: `chapter:${t.from_arc_id}`,
    target: `chapter:${t.to_arc_id}`,
    target_handle: "story",
    label: t.label ?? "",
  }));

  const edges = [...storyEdges, ...castEdges, ...memberEdges, ...chapterEdges];

  /**
   * Переходы, второй конец которых лежит на ДРУГОМ холсте (решение Q17).
   *
   * Замер: из 81 перехода между сценами 13 пересекают границу главы. Пока
   * приключение тащило сцены всех глав, оба конца лежали рядом; теперь один
   * из них уехал на холст своей главы, и стрелке некуда прийти.
   *
   * Скрывать их нельзя — холст не должен врать; рисовать стрелку между узлами
   * глав тоже нельзя — это другое утверждение. Поэтому у сцены остаётся
   * висящий разъём с именем чужой сцены и адресом её холста: видно, что
   * переход есть, и одним щелчком видно куда. Тот же приём, каким режим
   * репетиции показывает цель в другом приключении.
   */
  const outsideOut = transitions.filter((t) => !shownBySource.has(t.to_scene_id));
  const incoming = lookup.length
    ? (db
        .prepare(
          `SELECT id, from_scene_id, to_scene_id, label FROM story_scene_transitions
            WHERE to_scene_id IN (${lookup.map(() => "?").join(",")})
            ORDER BY position, id`
        )
        .all(...lookup) as { id: number; from_scene_id: number; to_scene_id: number; label: string }[])
    : [];
  const outsideIn = incoming.filter((t) => !shownByContent.has(t.from_scene_id));

  const outsideIds = [
    ...new Set([...outsideOut.map((t) => t.to_scene_id), ...outsideIn.map((t) => t.from_scene_id)]),
  ];
  const outsideScenes = new Map(
    (outsideIds.length
      ? (db
          .prepare(
            `SELECT s.id, s.name, s.arc_id, a.name AS arc_name, a.parent_id, a.setting_id
               FROM story_scenes s JOIN story_arcs a ON a.id = s.arc_id
              WHERE s.id IN (${outsideIds.map(() => "?").join(",")}) AND s.archived_at IS NULL`
          )
          .all(...outsideIds) as {
          id: number;
          name: string;
          arc_id: number;
          arc_name: string;
          parent_id: number | null;
          setting_id: number;
        }[])
      : []
    ).map((r) => [r.id, r] as const)
  );

  const outsideByScene = new Map<number, OutsideLink[]>();
  const addOutside = (sceneId: number, link: OutsideLink) =>
    outsideByScene.set(sceneId, [...(outsideByScene.get(sceneId) ?? []), link]);
  for (const t of outsideOut) {
    const far = outsideScenes.get(t.to_scene_id);
    if (!far) continue;
    for (const fromId of shownByContent.get(t.from_scene_id) ?? [])
      addOutside(fromId, {
        dir: "out",
        label: t.label ?? "",
        scene_id: far.id,
        scene_name: far.name,
        arc_id: far.arc_id,
        arc_name: far.arc_name,
        setting_id: far.setting_id,
        // Адрес холста, на котором эта сцена лежит: у сцены главы это доска
        // главы, у сцены приключения — доска приключения.
        board_arc_id: far.arc_id,
      });
  }
  for (const t of outsideIn) {
    const far = outsideScenes.get(t.from_scene_id);
    const here = shownBySource.get(t.to_scene_id);
    if (!far || here == null) continue;
    addOutside(here, {
      dir: "in",
      label: t.label ?? "",
      scene_id: far.id,
      scene_name: far.name,
      arc_id: far.arc_id,
      arc_name: far.arc_name,
      setting_id: far.setting_id,
      board_arc_id: far.arc_id,
    });
  }
  for (const n of nodes) {
    const links = outsideByScene.get(n.node_id);
    if (links) n.scene.outside = links;
  }

  const scenesById = new Map(scenes.map((s) => [s.id, s]));

  // Подгонка рамки главы под её сцены ушла вместе с рамкой (блок G6.2): у
  // узла главы размера нет, его задаёт содержимое карточки.

  // Стикеры, картинки, рамки, пины и нити — тем же расчётом, что и на
  // фриформ-доске (Q5, Q6).
  const decorArc = boardDecor(boardId, saved);
  const threadEdgesArc: EdgeOut[] = decorArc.threads.map((t) => ({ id: `thread:${t.id}`, kind: "thread" as const, source: `pin:${t.from_pin_id}`, target: `pin:${t.to_pin_id}`, target_handle: "pin", label: "", width: t.width, color: t.color }));
  const { nodes: routeNodesArc, rows: routeRowsArc } = boardRoutes(boardId, saved);
  const routedEdgesArc = routedEdges(edges, routeRowsArc);

  // Имя кампании входа — ради крошек (Q26, блок E1). Читается там же, где
  // берётся её правило на связи глав: отдельным запросом с клиента это стоило
  // бы второго круга на каждое открытие холста.
  const entryCampaign = entryCampaignRow ? { id: entryCampaignRow.id, name: entryCampaignRow.name } : null;

  res.json({
    board_id: boardId,
    // `parent` — ступень крошек и адрес выхода наверх: у холста главы это её
    // приключение, у холста приключения — ничего (блок G6.2).
    arc: { id: arc.id, name: arc.name, setting_id: arc.setting_id, parent: parentArc },
    campaign_id: campaignId,
    campaign: entryCampaign,
    nodes: [...nodes, ...chapterNodes, ...checkNodes, ...decorArc.nodes, ...routeNodesArc],
    // Рамок глав больше нет. Поле остаётся ради формы ответа, общей со
    // схемой сеттинга и свободной доской, и всегда пусто.
    groups: [],
    edges: routedEdgesArc,
    threads: decorArc.threads,
    routes: routeRowsArc,
  });
});

// Фриформ-доски вне сеттингов (Q1 а, §5)
/**
 * Всё, что нужно экрану выбора полотна, — одним запросом.
 *
 * Экран показывает свои доски и приключения, сгруппированные по сеттингу
 * (Q21). Читать это девятью запросами `/story/arcs?setting_id=` — по одному
 * на сеттинг — значит платить девять кругов за экран, который открывают
 * первым.
 *
 * Сеттинги без приключений не показываются вовсе: открывать в них нечего, а
 * промежуточный экран из девяти плиток, семь из которых пустые, — ровно то,
 * от чего избавлялись.
 */
canvasRouter.get("/index", (_req, res) => {
  const free = db
    .prepare(
      // Стикер, картинка, рамка и пин живут в своих таблицах и ЗАОДНО имеют
      // строку в canvas_nodes с местом на доске — считать по обеим значит
      // удвоить счётчик.
      `SELECT id, scope_id, name, created_at, owner_type, owner_id,
              (SELECT count(*) FROM canvas_stickers WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_images WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_frames WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_pins WHERE board_id = canvas_boards.id) +
              (SELECT count(*) FROM canvas_nodes WHERE board_id = canvas_boards.id
                 AND node_type NOT IN ('sticker','image','frame','pin')) AS nodes
         FROM canvas_boards
        WHERE scope_type='free' AND archived_at IS NULL
        ORDER BY created_at DESC`
    )
    .all() as {
      id: number;
      scope_id: number;
      name: string;
      created_at: string;
      owner_type: string | null;
      owner_id: number | null;
      nodes: number;
    }[];

  // Пустое приключение по умолчанию («Сцены без приключения») показываем
  // только когда в нём что-то лежит: иначе это девять пустых строк, зато
  // непустое иначе не открыть ничем, кроме прямой ссылки.
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.setting_id, a.is_default, st.name AS setting_name,
              (SELECT COUNT(*) FROM story_arcs c
                WHERE c.parent_id = a.id AND c.archived_at IS NULL AND c.campaign_id IS NULL) AS chapter_count,
              (SELECT COUNT(*) FROM story_scenes s
                 JOIN story_arcs sc ON sc.id = s.arc_id
                WHERE (sc.id = a.id OR sc.parent_id = a.id)
                  AND sc.archived_at IS NULL AND sc.campaign_id IS NULL
                  AND s.campaign_id IS NULL AND s.archived_at IS NULL) AS scene_count
         FROM story_arcs a
         JOIN settings st ON st.id = a.setting_id
        WHERE a.parent_id IS NULL AND a.archived_at IS NULL AND a.campaign_id IS NULL
        ORDER BY st.name, a.position, a.id`
    )
    .all() as {
    id: number;
    name: string;
    setting_id: number;
    is_default: number;
    setting_name: string;
    chapter_count: number;
    scene_count: number;
  }[];

  // «Что за чем идёт» между приключениями. Раньше это рисовалось разъёмами на
  // холсте сеттинга; теперь оно снова там (блок D3), а список о связях больше
  // не рассказывает — поле `next` осталось ради совместимости ответа.
  // `campaign_id IS NULL`: список — про заготовку сеттинга, свой набор
  // кампании (блок D4) сюда не относится.
  const links = db
    .prepare(
      `SELECT t.id, t.from_arc_id, t.to_arc_id, t.label, a.name AS to_name
         FROM story_arc_transitions t
         JOIN story_arcs a ON a.id = t.to_arc_id
        WHERE a.archived_at IS NULL AND t.campaign_id IS NULL`
    )
    .all() as { id: number; from_arc_id: number; to_arc_id: number; label: string; to_name: string }[];
  const nextByArc = new Map<number, { id: number; to_arc_id: number; to_name: string; label: string }[]>();
  for (const l of links) {
    const list = nextByArc.get(l.from_arc_id) ?? [];
    list.push({ id: l.id, to_arc_id: l.to_arc_id, to_name: l.to_name, label: l.label });
    nextByArc.set(l.from_arc_id, list);
  }

  const bySetting = new Map<number, { id: number; name: string; adventures: typeof rows }>();
  for (const r of rows) {
    if (r.is_default === 1 && r.scene_count === 0) continue;
    let group = bySetting.get(r.setting_id);
    if (!group) {
      group = { id: r.setting_id, name: r.setting_name, adventures: [] };
      bySetting.set(r.setting_id, group);
    }
    group.adventures.push({ ...r, next: nextByArc.get(r.id) ?? [] } as (typeof rows)[number]);
  }

  // Сеттинг, у которого приключений нет, но есть своя доска, обязан показаться:
  // иначе доска, только что привязанная к нему, пропадает с экрана целиком.
  // Группы строятся по приключениям, поэтому такие сеттинги добираются здесь.
  const settingNames = db
    .prepare("SELECT id, name FROM settings WHERE archived_at IS NULL ORDER BY name")
    .all() as { id: number; name: string }[];
  for (const b of free) {
    if (b.owner_type !== "setting" || b.owner_id == null || bySetting.has(b.owner_id)) continue;
    const st = settingNames.find((s) => s.id === b.owner_id);
    if (st) bySetting.set(st.id, { id: st.id, name: st.name, adventures: [] });
  }

  // Куда доску можно переместить. Списки полные, а не только то, что уже
  // показано на экране: привязать доску можно и к сеттингу, в котором ещё нет
  // ни одного приключения, — иначе «Переместить» умеет меньше, чем модель.
  // Кампании идут списком целиком: с блока D4 у каждой есть своя карта, и
  // плитка кампании ведёт туда даже тогда, когда досок у неё нет.
  // `setting_id` нужен экрану выбора: «+ Приключение» у кампании заводит
  // приключение в её сеттинге (блок D5), и спрашивать сеттинг отдельным
  // запросом ради одного числа незачем.
  const campaigns = db
    .prepare("SELECT id, name, setting_id FROM campaigns WHERE archived_at IS NULL ORDER BY name")
    .all() as { id: number; name: string; setting_id: number | null }[];

  res.json({
    free,
    settings: [...bySetting.values()],
    campaigns,
    all_settings: settingNames,
  });
});

canvasRouter.get("/free-boards", (_req, res) => {
  // Список для мастера «Открыть холст…». Раньше он на каждом чтении удалял
  // осиротевшие строки `canvas_nodes` — то есть чтение, которое пишет. Битая
  // строка теперь просто не попадает в счётчик: считаем по живым записям, а
  // не по ссылкам на них.
  const rows = db.prepare(
    `SELECT id, scope_id, name, created_at, owner_type, owner_id,
      (
        (SELECT count(*) FROM canvas_stickers WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_images WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_frames WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_pins WHERE board_id=canvas_boards.id) +
        (SELECT count(*) FROM canvas_nodes WHERE board_id=canvas_boards.id
           AND node_type NOT IN ('sticker','image','frame','pin'))
      ) as nodes
     FROM canvas_boards
    WHERE scope_type='free' AND archived_at IS NULL
    ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});

// Владелец свободной доски (блок D1). Тип проверяется по белому списку, а не
// берётся из тела как есть: строка отсюда попадает в запросы и в интерфейс.
// Пустой владелец (`null`) — доска ничья, это законное состояние, а не ошибка.
const BOARD_OWNERS: Record<string, string> = { setting: "settings", campaign: "campaigns" };

function readOwner(body: unknown): { type: string | null; id: number | null } | "bad" {
  const b = (body ?? {}) as { owner_type?: unknown; owner_id?: unknown };
  if (b.owner_type == null || b.owner_type === "") return { type: null, id: null };
  const type = String(b.owner_type);
  const table = BOARD_OWNERS[type];
  if (!table) return "bad";
  const id = Number(b.owner_id);
  if (!Number.isInteger(id) || id <= 0) return "bad";
  // Владельца проверяем на существование: доска, привязанная к удалённому
  // сеттингу, не покажется нигде и найдётся только в базе.
  const owner = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!owner) return "bad";
  return { type, id };
}

canvasRouter.post("/free-boards", (req, res) => {
  const name = String(req.body?.name ?? "Доска").trim() || "Доска";
  const owner = readOwner(req.body);
  if (owner === "bad") return res.status(400).json({ error: "unknown owner" });
  // Канон П2.4: у свободной доски `scope_id === id`. Пара запросов атомарна,
  // чтобы между вставкой (scope_id=0) и приравниванием никто не увидел доску,
  // которую нельзя достать через `?free_id=`. Единственный создатель свободных
  // досок — этот маршрут, и после него инвариант каноничности стоит всегда.
  const create = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO canvas_boards (scope_type, scope_id, name, owner_type, owner_id) VALUES ('free', 0, ?, ?, ?)"
      )
      .run(name, owner.type, owner.id);
    const id = Number(info.lastInsertRowid);
    db.prepare("UPDATE canvas_boards SET scope_id=? WHERE id=?").run(id, id);
    return id;
  });
  const id = create();
  res.status(201).json({ id, scope_id: id, name, owner_type: owner.type, owner_id: owner.id });
});

canvasRouter.put("/free-boards/:id", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  db.prepare("UPDATE canvas_boards SET name=? WHERE scope_type='free' AND scope_id=?").run(name, Number(req.params.id));
  res.json({ ok: true });
});

// Переместить доску к другому владельцу или отвязать (тело без `owner_type`).
canvasRouter.put("/free-boards/:id/owner", (req, res) => {
  const owner = readOwner(req.body);
  if (owner === "bad") return res.status(400).json({ error: "unknown owner" });
  const info = db
    .prepare("UPDATE canvas_boards SET owner_type=?, owner_id=? WHERE scope_type='free' AND scope_id=?")
    .run(owner.type, owner.id, Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true, owner_type: owner.type, owner_id: owner.id });
});

// «Удалить» доску означает «в архив» — как у приключений и сцен. Содержимое
// остаётся на месте; добивание насовсем живёт в общем Архиве приложения
// (`DELETE /archive/canvas_board/:id`), и только для уже архивированной доски.
canvasRouter.delete("/free-boards/:id", (req, res) => {
  const info = db
    .prepare(
      "UPDATE canvas_boards SET archived_at = datetime('now') WHERE scope_type='free' AND scope_id=? AND archived_at IS NULL"
    )
    .run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// Возврат из архива. Имя маршрута — общее для всех архивируемых сущностей
// (`PUT /<раздел>/:id/restore`), чтобы страница Архива не знала про Полотно
// ничего особенного.
canvasRouter.put("/free-boards/:id/restore", (req, res) => {
  const info = db
    .prepare("UPDATE canvas_boards SET archived_at = NULL WHERE scope_type='free' AND scope_id=?")
    .run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// Список стартовых наборов — ключ и подпись на кнопке.
//
// Отдельным запросом, а не константой на клиенте: подпись и содержимое набора
// обязаны лежать в одном месте. Список из семи цветов, разошедшийся по трём
// местам, — это уже пройденный блок B1, и повторять его на трёх наборах
// незачем. Запрос уходит только с пустой доски, где и показываются кнопки.
canvasRouter.get("/presets", (_req, res) => {
  res.json(Object.entries(CANVAS_PRESETS).map(([key, p]) => ({ key, label: p.label })));
});

/**
 * Стартовый набор на пустую свободную доску (блок G5).
 *
 * Заводится ОДНОЙ транзакцией: нить ссылается на пины, и набор, доехавший до
 * половины, оставил бы Мастеру три кружка без связей и без объяснения, почему
 * их три.
 *
 * Ставится только на ПУСТУЮ доску, и это не придирка: набор кладётся в
 * фиксированные координаты, и на доске с работой Мастера три пина легли бы
 * поверх неё. Отказ здесь дешевле уборки за нами.
 */
canvasRouter.post("/free-boards/:id/preset", (req, res) => {
  const preset = (req.body ?? {}).preset;
  if (!isPresetKey(preset)) return res.status(400).json({ error: "unknown preset" });
  const board = db
    .prepare(
      "SELECT id FROM canvas_boards WHERE scope_type='free' AND scope_id=? AND archived_at IS NULL"
    )
    .get(Number(req.params.id)) as { id: number } | undefined;
  if (!board) return res.status(404).json({ error: "not found" });

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE board_id=?`).get(board.id) as { n: number })
      .n;
  if (count("canvas_nodes") + count("canvas_frames") + count("canvas_pins") > 0) {
    return res.status(409).json({ error: "board is not empty" });
  }

  const spec = CANVAS_PRESETS[preset];
  const seed = db.transaction(() => {
    const ids = spec.pins.map((p, i) => {
      const z = 1000 + i;
      // Пин заводится теми же дефолтами, что и поставленный рукой: цвет и
      // форма живут в палитре клиента (блок B1), второго места им не заводим.
      const info = db
        .prepare("INSERT INTO canvas_pins (board_id, name, x, y, z_index) VALUES (?,?,?,?,?)")
        .run(board.id, p.name, p.x, p.y, z);
      const pid = Number(info.lastInsertRowid);
      db.prepare(
        "INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, z_index) VALUES (?,?,?,?,?,?)"
      ).run(board.id, "pin", pid, p.x, p.y, z);
      return pid;
    });
    for (const [a, b] of spec.threads) {
      db.prepare(
        "INSERT INTO canvas_threads (board_id, from_pin_id, to_pin_id) VALUES (?,?,?)"
      ).run(board.id, Math.min(ids[a], ids[b]), Math.max(ids[a], ids[b]));
    }
    return ids.length;
  });
  res.status(201).json({ ok: true, pins: seed(), threads: spec.threads.length });
});

// Стикеры (Q5) — name + note с MentionTextarea
canvasRouter.post("/stickers", (req, res) => {
  const { board_id, text, name, note, color, x, y } = req.body as { board_id?: number; text?: string; name?: string; note?: string; color?: string; x?: number; y?: number };
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  const board_id_r = resolveFreeBoardId(board_id);
  const n = name ?? text ?? "";
  const nt = note ?? "";
  const info = db.prepare("INSERT INTO canvas_stickers (board_id, text, name, note, color) VALUES (?,?,?,?,?)").run(board_id_r, text ?? n, n, nt, color ?? "paper");
  const sid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id_r, "sticker", sid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: sid });
});
canvasRouter.put("/stickers/:id", (req, res) => {
  const { text, name, note, color } = req.body as { text?: string; name?: string; note?: string; color?: string };
  // `text` и `name` развязаны (Ш2): тело и подпись стикера независимы, и запись
  // одного не должна затирать другое. Раньше `text` тянул за собой `name`,
  // поэтому кастомная подпись стикера (поле «Имя», имя вместо заготовки)
  // стиралась при любом обновлении текста тела.
  if (text !== undefined) db.prepare("UPDATE canvas_stickers SET text=? WHERE id=?").run(text, Number(req.params.id));
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
  const board_id_r = resolveFreeBoardId(board_id);
  const c = color ?? "#2C3E50";
  const info = db.prepare("INSERT INTO canvas_frames (board_id, name, color, x, y, w, h) VALUES (?,?,?,?,?,?,?)").run(board_id_r, name ?? "Группа", c, Number(x) || 0, Number(y) || 0, Number(w) || 320, Number(h) || 240);
  const fid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id_r, "frame", fid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: fid });
});
canvasRouter.put("/frames/:id", (req, res) => {
  const { name, color, x, y, w, h, collapsed } = req.body as { name?: string; color?: string; x?: number; y?: number; w?: number; h?: number; collapsed?: boolean };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) { sets.push("name = ?"); vals.push(String(name).trim() || "Группа"); }
  if (color !== undefined) { sets.push("color = ?"); vals.push(String(color)); }
  if (x !== undefined) { sets.push("x = ?"); vals.push(Number(x)); }
  if (y !== undefined) { sets.push("y = ?"); vals.push(Number(y)); }
  // w/h пишутся только когда их прислали: свёртка их не трогает вовсе, они
  // относятся к развёрнутому виду и должны пережить её нетронутыми (G6.3).
  if (w !== undefined) { sets.push("w = ?"); vals.push(Number(w)); }
  if (h !== undefined) { sets.push("h = ?"); vals.push(Number(h)); }
  if (collapsed !== undefined) { sets.push("collapsed = ?"); vals.push(collapsed ? 1 : 0); }
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

// Пины — векторные точки, верхний слой (Pin)
canvasRouter.post("/pins", (req, res) => {
  const { board_id, name, x, y, size, color, shape } = req.body as { board_id?: number; name?: string; x?: number; y?: number; size?: string; color?: string; shape?: string };
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  const board_id_r = resolveFreeBoardId(board_id);
  const maxZ = (db.prepare("SELECT MAX(z_index) as m FROM canvas_pins WHERE board_id=?").get(board_id_r) as { m: number | null }).m ?? 1000;
  const info = db.prepare("INSERT INTO canvas_pins (board_id, name, x, y, size, color, shape, z_index) VALUES (?,?,?,?,?,?,?,?)").run(board_id_r, name ?? "Пин", Number(x) || 0, Number(y) || 0, size ?? "M", color ?? "#2C3E50", shape ?? "circle", maxZ + 1);
  const pid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, z_index) VALUES (?,?,?,?,?,?)").run(board_id_r, "pin", pid, Number(x) || 0, Number(y) || 0, maxZ + 1);
  res.status(201).json(db.prepare("SELECT * FROM canvas_pins WHERE id=?").get(pid));
});
canvasRouter.put("/pins/:id", (req, res) => {
  const { name, x, y, size, color, shape, z_index, parent_key } = req.body as { name?: string; x?: number; y?: number; size?: string; color?: string; shape?: string; z_index?: number; parent_key?: string | null };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) { sets.push("name = ?"); vals.push(String(name).trim() || "Пин"); }
  if (x !== undefined) { sets.push("x = ?"); vals.push(Number(x)); }
  if (y !== undefined) { sets.push("y = ?"); vals.push(Number(y)); }
  if (size !== undefined) { sets.push("size = ?"); vals.push(String(size)); }
  if (color !== undefined) { sets.push("color = ?"); vals.push(String(color)); }
  if (shape !== undefined) { sets.push("shape = ?"); vals.push(String(shape)); }
  if (z_index !== undefined) { sets.push("z_index = ?"); vals.push(Number(z_index)); }
  if (sets.length) {
    vals.push(Number(req.params.id));
    db.prepare(`UPDATE canvas_pins SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  if (x !== undefined || y !== undefined) {
    const row = db.prepare("SELECT board_id FROM canvas_pins WHERE id=?").get(Number(req.params.id)) as { board_id: number } | undefined;
    if (row) {
      const cur = db.prepare("SELECT x, y FROM canvas_nodes WHERE node_type='pin' AND node_id=?").get(Number(req.params.id)) as { x: number; y: number } | undefined;
      const nx = x !== undefined ? Number(x) : cur?.x ?? 0;
      const ny = y !== undefined ? Number(y) : cur?.y ?? 0;
      db.prepare("UPDATE canvas_nodes SET x = ?, y = ? WHERE node_type='pin' AND node_id=?").run(nx, ny, Number(req.params.id));
      if (x !== undefined || y !== undefined) db.prepare("UPDATE canvas_pins SET x = ?, y = ? WHERE id=?").run(nx, ny, Number(req.params.id));
    }
  }
  // Рамка, в которой пин лежит. Пишется только когда клиент прислал поле:
  // правка имени или цвета родство трогать не должна — как и в
  // `PUT /board/nodes`.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "parent_key")) {
    db.prepare("UPDATE canvas_nodes SET parent_key = ? WHERE node_type='pin' AND node_id=?").run(parent_key ?? null, Number(req.params.id));
  }
  res.json(db.prepare("SELECT * FROM canvas_pins WHERE id=?").get(Number(req.params.id)));
});
canvasRouter.delete("/pins/:id", (req, res) => {
  const row = db.prepare("SELECT board_id FROM canvas_pins WHERE id=?").get(Number(req.params.id)) as { board_id: number } | undefined;
  db.prepare("DELETE FROM canvas_pins WHERE id=?").run(Number(req.params.id));
  db.prepare("DELETE FROM canvas_nodes WHERE node_type='pin' AND node_id=?").run(Number(req.params.id));
  res.json({ ok: true, board_id: row?.board_id });
});
canvasRouter.get("/pins", (req, res) => {
  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  res.json(db.prepare("SELECT * FROM canvas_pins WHERE board_id=?").all(board_id));
});
// Нити — прямые линии между пинами
canvasRouter.post("/threads", (req, res) => {
  const { board_id, from_pin_id, to_pin_id, width, color } = req.body as { board_id?: number; from_pin_id?: number; to_pin_id?: number; width?: number; color?: string };
  if (!board_id || !from_pin_id || !to_pin_id) return res.status(400).json({ error: "board_id, from_pin_id, to_pin_id required" });
  const board_id_r = resolveFreeBoardId(board_id);
  if (from_pin_id === to_pin_id) return res.status(400).json({ error: "self link not allowed" });
  const a = Math.min(Number(from_pin_id), Number(to_pin_id));
  const b = Math.max(Number(from_pin_id), Number(to_pin_id));
  // проверка что оба пина на той же доске
  const fromRow = db.prepare("SELECT board_id FROM canvas_pins WHERE id=?").get(a) as { board_id: number } | undefined;
  const toRow = db.prepare("SELECT board_id FROM canvas_pins WHERE id=?").get(b) as { board_id: number } | undefined;
  if (!fromRow || !toRow || fromRow.board_id !== board_id_r || toRow.board_id !== board_id_r) return res.status(400).json({ error: "pins not on board" });
  try {
    const info = db.prepare("INSERT INTO canvas_threads (board_id, from_pin_id, to_pin_id, width, color) VALUES (?,?,?,?,?)").run(board_id_r, a, b, Number(width) || 2, color ?? "#2C3E50");
    res.status(201).json(db.prepare("SELECT * FROM canvas_threads WHERE id=?").get(info.lastInsertRowid));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return res.status(409).json({ error: "thread already exists" });
    throw e;
  }
});
canvasRouter.put("/threads/:id", (req, res) => {
  const { width, color } = req.body as { width?: number; color?: string };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (width !== undefined) { sets.push("width = ?"); vals.push(Number(width)); }
  if (color !== undefined) { sets.push("color = ?"); vals.push(String(color)); }
  if (sets.length) {
    vals.push(Number(req.params.id));
    db.prepare(`UPDATE canvas_threads SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  res.json(db.prepare("SELECT * FROM canvas_threads WHERE id=?").get(Number(req.params.id)));
});
canvasRouter.delete("/threads/:id", (req, res) => {
  db.prepare("DELETE FROM canvas_threads WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});
canvasRouter.get("/threads", (req, res) => {
  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  res.json(db.prepare("SELECT * FROM canvas_threads WHERE board_id=?").all(board_id));
});

// ── Рераут-ноды («Маршрут») ────────────────────────────────────────────────
// Память прохода живёт в `canvas_routes`, место — в парной строке `canvas_nodes`
// с `node_type='route'`, ровно по паттерну пинов и стикеров. Рераут сам данных
// не заводит: реальное ребро (переход/каст/исход/нить) остаётся одно, а строка
// здесь лишь говорит, каких двух соседей рераут разводит и ребро какого вида
// несёт. `from_key`/`to_key` могут ссылаться и на другой рераут (`route:N`) —
// так строится цепочка разрывов одного ребра.
canvasRouter.get("/routes", (req, res) => {
  const board_id = req.query.board_id ? Number(req.query.board_id) : null;
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  res.json(
    db
      .prepare("SELECT id, from_key, to_key, kind, role FROM canvas_routes WHERE board_id=? ORDER BY id")
      .all(board_id)
  );
});
canvasRouter.post("/routes", (req, res) => {
  const { board_id, x, y } = req.body as { board_id?: number; x?: number; y?: number };
  if (!board_id) return res.status(400).json({ error: "board_id required" });
  const board_id_r = resolveFreeBoardId(board_id);
  // Пустой рераут: с обоими пустыми рёбрами-holes. from/to заполняются, когда
  // Мастер подводит концы реального ребра. Висящий одноконцовый допустим.
  const info = db
    .prepare("INSERT INTO canvas_routes (board_id, from_key, to_key, kind, role) VALUES (?,?,?,?,?)")
    .run(board_id_r, "", "", "transition", "");
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?,?,?)").run(
    board_id_r,
    "route",
    id,
    Number(x) || 0,
    Number(y) || 0
  );
  res.status(201).json(
    db
      .prepare("SELECT id, from_key, to_key, kind, role FROM canvas_routes WHERE id=?")
      .get(id)
  );
});
canvasRouter.put("/routes/:id", (req, res) => {
  const id = Number(req.params.id);
  // Вход и характеристики. `to_key` больше не используется: выходы рераута-хаба
  // живут в `canvas_route_outputs` и заводятся своим эндпоинтом.
  const { from_key, kind, role } = req.body as {
    from_key?: string;
    kind?: string;
    role?: string;
  };
  const row = db.prepare("SELECT * FROM canvas_routes WHERE id=?").get(id) as RouteRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (from_key !== undefined && (!isValidRouteKey(from_key) || from_key === `route:${id}`))
    return res.status(400).json({ error: "invalid from_key" });
  if (kind !== undefined && !ROUTE_KIND_RE.test(kind))
    return res.status(400).json({ error: "invalid kind" });
  db.prepare(
    "UPDATE canvas_routes SET from_key=COALESCE(?,from_key), kind=COALESCE(?,kind), role=COALESCE(?,role) WHERE id=?"
  ).run(
    from_key !== undefined ? from_key : null,
    kind !== undefined ? kind : null,
    role !== undefined ? role : null,
    id
  );
  res.json(
    db
      .prepare("SELECT id, from_key, to_key, kind, role FROM canvas_routes WHERE id=?")
      .get(id)
  );
});
canvasRouter.delete("/routes/:id", (req, res) => {
  const id = Number(req.params.id);
  // Каскадная уборка: сам рераут + любые рерауты-соседи по цепочке, ссылающиеся
  // на `route:<id>` (их сегменты без удалённого рераута бессмысленны). Сначала
  // удаляем ноду и строку, потом подметаем осиротевшие цепочки. Выходы рераута
  // (canvas_route_outputs) стираются каскадом по FK.
  db.prepare("DELETE FROM canvas_nodes WHERE node_type='route' AND node_id=?").run(id);
  db.prepare("DELETE FROM canvas_routes WHERE id=?").run(id);
  pruneRoutesForKeys([`route:${id}`]);
  res.json({ ok: true });
});

// Выходы рераута-хаба: сцены, куда передаётся носитель. Подключение выхода
// одновременно заводит строку в `canvas_route_outputs` и — если у рераута уже
// есть вход (from_key) — создаёт реальную cast-связь «сцена содержит носителя»,
// чтобы `routedEdges` развёл её через рераут. Так рераут ведёт себя как носитель,
// а не только как визуальная петля.
function ensureRealCast(sceneKey: string, sourceKey: string, role: string) {
  const [sourceType, sourceId] = splitNodeKey(sourceKey);
  const sceneId = Number(splitNodeKey(sceneKey)[1]);
  // Последствия идут отдельным разъёмом (как в story.ts), прочие — по роли.
  const section = role === "consequences" ? CONSEQUENCE_SECTION : CAST_SECTIONS[role ?? ""];
  if (!section || !sourceId) return null;
  const existing = db
    .prepare(
      `SELECT id FROM generic_links WHERE from_type='scene' AND from_id=? AND to_type=? AND to_id=? AND section=?`
    )
    .get(sceneId, sourceType, Number(sourceId), section) as { id: number } | undefined;
  return (
    existing?.id ??
    Number(
      db
        .prepare(
          `INSERT INTO generic_links (from_type, from_id, to_type, to_id, section) VALUES ('scene', ?, ?, ?, ?)`
        )
        .run(sceneId, sourceType, Number(sourceId), section).lastInsertRowid
    )
  );
}

function ensureRemoveRealCast(sceneKey: string, sourceKey: string) {
  const [sourceType, sourceId] = splitNodeKey(sourceKey);
  const sceneId = Number(splitNodeKey(sceneKey)[1]);
  if (!sourceId) return;
  db.prepare(
    `DELETE FROM generic_links WHERE from_type='scene' AND from_id=? AND to_type=? AND to_id=?`
  ).run(sceneId, sourceType, Number(sourceId));
}

canvasRouter.post("/routes/:id/outputs", (req, res) => {
  const id = Number(req.params.id);
  const { to_key, role } = req.body as { to_key?: string; role?: string };
  const row = db.prepare("SELECT * FROM canvas_routes WHERE id=?").get(id) as RouteRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (!to_key || !isValidRouteKey(to_key) || to_key === `route:${id}`)
    return res.status(400).json({ error: "invalid to_key" });
  if (role !== undefined && role !== "" && !CAST_SECTIONS[role] && role !== "consequences")
    return res.status(400).json({ error: "invalid role" });
  db.prepare(
    "INSERT INTO canvas_route_outputs (route_id, to_key, role) VALUES (?,?,?) ON CONFLICT(route_id,to_key) DO UPDATE SET role=excluded.role"
  ).run(id, to_key, role ?? "");
  // Если носитель уже подведён — реальная связь «сцена содержит носителя».
  if (row.from_key) ensureRealCast(to_key, row.from_key, role ?? "");
  res.status(201).json({ ok: true });
});

canvasRouter.delete("/routes/:id/outputs", (req, res) => {
  const id = Number(req.params.id);
  const to_key = String(req.query.to_key ?? "");
  const row = db.prepare("SELECT * FROM canvas_routes WHERE id=?").get(id) as RouteRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM canvas_route_outputs WHERE route_id=? AND to_key=?").run(id, to_key);
  // Снятие cast-связи «сцена содержит носителя» (обратная к ensureRealCast).
  if (row.from_key && to_key) ensureRemoveRealCast(to_key, row.from_key);
  res.json({ ok: true });
});

// Изображения (Q6) — загрузка файла уже через /filesystem, здесь только привязка
canvasRouter.post("/images", (req, res) => {
  const { board_id, file_path, x, y, w, h } = req.body as { board_id?: number; file_path?: string; x?: number; y?: number; w?: number; h?: number };
  if (!board_id || !file_path) return res.status(400).json({ error: "board_id and file_path required" });
  const board_id_r = resolveFreeBoardId(board_id);
  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id_r, vaultRel(file_path), w ?? 320, h ?? 240);
  const iid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?, ?,?)").run(board_id_r, "image", iid, Number(x) || 0, Number(y) || 0);
  res.status(201).json({ id: iid, file_url: toFileUrl(file_path) });
});
canvasRouter.post("/images/upload", upload.single("file"), async (req, res) => {
  const board_id = Number(req.body?.board_id);
  const x = Number(req.body?.x) || 0;
  const y = Number(req.body?.y) || 0;
  if (!board_id || !req.file) return res.status(400).json({ error: "board_id and file required" });
  const board_id_r = resolveFreeBoardId(board_id);
  const ext = path.extname(req.file.originalname) || ".png";
  const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  if (!allowed.includes(ext.toLowerCase())) return res.status(400).json({ error: "allowed png/jpg/webp/gif" });
  const sub = `canvas/${board_id_r}`;
  await ensureSubfolder(VAULT_ROOT, sub);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const target = path.join(VAULT_ROOT, sub, fileName);
  // write file directly (no old file to replace)
  const fs = await import("fs/promises");
  await fs.writeFile(target, req.file.buffer);
  const file_path = vaultRel(target);
  const info = db.prepare("INSERT INTO canvas_images (board_id, file_path, w, h) VALUES (?,?,?,?)").run(board_id_r, file_path, 320, 240);
  const iid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y) VALUES (?,?,?,?,?)").run(board_id_r, "image", iid, x, y);
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
    const nodes = db.prepare("SELECT id, node_type, node_id, x, y, z_index, parent_key FROM canvas_nodes WHERE board_id = ?").all(board.id);
    const bundleIds = (nodes as { node_type: string; node_id: number }[]).filter((n) => n.node_type === "bundle").map((n) => n.node_id);
    const bundles = bundleIds.length ? db.prepare(`SELECT * FROM canvas_bundles WHERE id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
    const bundleLinks = bundleIds.length ? db.prepare(`SELECT l.*, IFNULL(c.qty,'') as qty FROM generic_links l LEFT JOIN link_cast c ON c.link_id=l.id WHERE l.from_type='bundle' AND l.from_id IN (${bundleIds.map(() => "?").join(",")})`).all(...bundleIds) : [];
    canvas = { board_id: board.id, nodes, bundles, bundleLinks };
  }
  res.json({ arc, scenes, transitions, checks, outcomes, canvas });
});

/**
 * Переименование главы.
 *
 * Единственное оставшееся применение: правка `story_arcs.name`. Раньше сюда же
 * писался прямоугольник главы в `canvas_groups`, но главы стали узлами и
 * отказались от глав-рамок — путь к legacy-геометрии выпилен, `canvas_groups`
 * больше не пишется.
 */
canvasRouter.put("/groups/:arcId", (req, res) => {
  const { name } = req.body as { name?: string };
  if (name !== undefined) {
    db.prepare("UPDATE story_arcs SET name = ? WHERE id = ?").run(String(name).trim() || "Глава", Number(req.params.arcId));
  }
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
    setting_id?: number;
    campaign_id?: number;
    board_id?: number;
    nodes?: { node_type?: string; node_id?: number; x?: number; y?: number; z_index?: number; parent_key?: string | null }[];
  };
  if (!Array.isArray(body.nodes)) return res.status(400).json({ error: "nodes must be an array" });
  let boardId: number;
  if (body.board_id) boardId = resolveFreeBoardId(Number(body.board_id));
  else if (body.arc_id) boardId = ensureBoard("arc", Number(body.arc_id));
  // Доска схемы сеттинга заводится здесь, при первом сохранении раскладки, а
  // не на чтении: `GET /canvas/board` в базу не пишет (блок D3).
  else if (body.setting_id) boardId = ensureBoard("setting", Number(body.setting_id));
  // Доска карты кампании — тем же путём (блок D4).
  else if (body.campaign_id) boardId = ensureBoard("campaign", Number(body.campaign_id));
  else return res.status(400).json({ error: "arc_id, setting_id, campaign_id or board_id required" });
  // parent_key пишется только когда клиент его прислал: раскладка шлётся
  // пачкой на каждое перетаскивание, и подставлять там NULL значило бы
  // срывать ноду с рамки при любом сдвиге соседа.
  const upsert = db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, z_index, parent_key, updated_at)
     VALUES (@board, @type, @id, @x, @y, @z, @parent, datetime('now'))
     ON CONFLICT(board_id, node_type, node_id)
     DO UPDATE SET x = @x, y = @y, z_index = @z,
       parent_key = CASE WHEN @parentGiven = 1 THEN @parent ELSE canvas_nodes.parent_key END,
       updated_at = datetime('now')`
  );

  // Место пина хранится дважды: в раскладке и в своей таблице. Второе —
  // запасной вариант на случай, когда строки раскладки нет; расходиться им
  // нельзя, иначе пин, уехавший вместе с рамкой, помнит в `canvas_pins`
  // старое место.
  const syncPin = db.prepare("UPDATE canvas_pins SET x = ?, y = ? WHERE id = ? AND board_id = ?");

  const write = db.transaction((rows: typeof body.nodes) => {
    (rows ?? []).forEach((n) => {
      if (!n.node_type || !n.node_id) return;
      const parentGiven = Object.prototype.hasOwnProperty.call(n, "parent_key");
      const x = Number(n.x) || 0;
      const y = Number(n.y) || 0;
      upsert.run({
        board: boardId,
        type: n.node_type,
        id: Number(n.node_id),
        x,
        y,
        z: Number(n.z_index) || 0,
        parent: parentGiven ? (n.parent_key ?? null) : null,
        parentGiven: parentGiven ? 1 : 0,
      });
      if (n.node_type === "pin") syncPin.run(x, y, Number(n.node_id), boardId);
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
  const { arc_id, setting_id, campaign_id, board_id, node_type, node_id, x, y, parent_key } = req.body as {
    arc_id?: number;
    setting_id?: number;
    campaign_id?: number;
    board_id?: number;
    node_type?: string;
    node_id?: number;
    x?: number;
    y?: number;
    parent_key?: string | null;
  };
  if ((!arc_id && !setting_id && !campaign_id && !board_id) || !node_type || !node_id) {
    return res
      .status(400)
      .json({ error: "arc_id, setting_id, campaign_id or board_id, node_type and node_id are required" });
  }
  if (node_type === "scene") {
    return res.status(400).json({ error: "сцены выводятся из приключения, класть их не нужно" });
  }
  // Тот же набор владельцев, что у `PUT /board/nodes`. Схема сеттинга и карта
  // кампании доски на чтении не заводят (блоки D3, D4), и до первого
  // сохранения раскладки `board_id` у них null — а класть узел рукой Мастер
  // может и на нетронутую карту. Без этой ветки палитра там молчала: 400 на
  // щелчок и мёртвый бросок (найдено в блоке G7).
  const boardId = board_id
    ? resolveFreeBoardId(Number(board_id))
    : arc_id
      ? ensureBoard("arc", Number(arc_id))
      : setting_id
        ? ensureBoard("setting", Number(setting_id))
        : ensureBoard("campaign", Number(campaign_id));
  // Членство в группе-рамке: `parent_key` формата `frame:<id>`. Палитра-дроп
  // на рамку может захотеть сразу вступить в группу (В5). Проверяем формат и
  // что рамка живёт на той же доске — иначе нельзя доверять координатам узла.
  const pk = parent_key ?? null;
  if (pk !== null) {
    const m = /^frame:(\d+)$/.exec(pk);
    if (!m) return res.status(400).json({ error: "parent_key must be 'frame:<id>' or null" });
    const frame = db.prepare("SELECT id FROM canvas_frames WHERE id = ? AND board_id = ?").get(Number(m[1]), boardId);
    if (!frame) return res.status(400).json({ error: "frame not found on this board" });
  }
  db.prepare(
    `INSERT INTO canvas_nodes (board_id, node_type, node_id, x, y, parent_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(board_id, node_type, node_id)
     DO UPDATE SET x = excluded.x, y = excluded.y, parent_key = excluded.parent_key, updated_at = excluded.updated_at`
  ).run(boardId, node_type, Number(node_id), Number(x) || 0, Number(y) || 0, pk);
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
  if (board_id) boardId = resolveFreeBoardId(Number(board_id));
  else if (arc_id) boardId = ensureBoard("arc", Number(arc_id));
  else return res.status(400).json({ error: "arc_id or board_id required" });
  db.prepare("DELETE FROM canvas_nodes WHERE board_id = ? AND node_type = ? AND node_id = ?").run(boardId, node_type, Number(node_id));
  if (node_type === "sticker") db.prepare("DELETE FROM canvas_stickers WHERE id = ?").run(Number(node_id));
  if (node_type === "image") {
    const row = db.prepare("SELECT file_path FROM canvas_images WHERE id = ?").get(Number(node_id)) as { file_path: string } | undefined;
    db.prepare("DELETE FROM canvas_images WHERE id = ?").run(Number(node_id));
    void row;
  }
  if (node_type === "frame") {
    // Вместе с рамкой убираем и её членство: дети остаются на холсте, но
    // перестают «принадлежать» удалённой группе. Раньше `parent_key` не чистился,
    // и узлы осиротевали со ссылкой на несуществующую рамку (В2).
    db.prepare("UPDATE canvas_nodes SET parent_key = NULL WHERE parent_key = ?").run(`frame:${Number(node_id)}`);
    db.prepare("DELETE FROM canvas_frames WHERE id = ?").run(Number(node_id));
  }
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
  if (board_id) boardId = resolveFreeBoardId(Number(board_id));
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
  const boardId = board_id ? resolveFreeBoardId(Number(board_id)) : ensureBoard("arc", Number(arc_id));
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

/**
 * Тихие подсказки на нодах (блок G1).
 *
 * ОТДЕЛЬНЫМ запросом, а не внутри `GET /board`. Замер на сеттинге владельца
 * (388 сущностей, 190 сцен): поиск упоминаний — 142 мс проходом по словам
 * (1616 мс, если регуляркой на каждое имя). Весь `GET /board` на тяжёлой доске
 * — 54–91 мс, то есть подсказки втрое тяжелее всей загрузки. Холст приходит и
 * рисуется как раньше, чипы проявляются долей секунды позже: для ТИХОЙ
 * подсказки задержка не порок.
 *
 * Список сцен приходит от клиента, а не выводится из доски: ноды сцен бывают и
 * на свободной доске, а разрешение copy-on-write слоя кампании уже сделано в
 * `GET /board` — повторять его здесь значило бы держать две правды об одном.
 *
 * Ничего не пишет в базу.
 */
canvasRouter.get("/hints", (req, res) => {
  const q = req.query as { ids?: string; chapters_of?: string };
  const raw = String(q.ids ?? "");
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  /**
   * Счётчик подсказок на узле главы (решение Q22, блок G6.2).
   *
   * Сцены главы на холст приключения больше не приезжают, а «что я забыл» с
   * ними уезжать не должно: спрятав сцены, нельзя спрятать вместе с ними
   * повод открыть холст утром. Считается здесь, а не в `GET /board`, по той же
   * причине, по какой сюда вынесены и сами подсказки: поиск упоминаний стоит
   * дороже всей загрузки доски, а задержка тихой подсказке не порок.
   */
  const chaptersOf = Number(q.chapters_of ?? 0);
  const chapters: { arc_id: number; count: number }[] = [];
  if (Number.isInteger(chaptersOf) && chaptersOf > 0) {
    const rows = db
      .prepare(
        // Без JOIN: `HINT_SCENE_COLUMNS` перечисляет колонки без префикса
        // таблицы, а у `story_arcs` есть свои `id` и `name` — соединение
        // сделало бы их неоднозначными.
        `SELECT ${HINT_SCENE_COLUMNS}, setting_id, arc_id FROM story_scenes
          WHERE arc_id IN (SELECT id FROM story_arcs
                            WHERE parent_id = ? AND archived_at IS NULL AND campaign_id IS NULL)
            AND archived_at IS NULL AND campaign_id IS NULL`
      )
      .all(chaptersOf) as (Parameters<typeof sceneHints>[0][number] & {
      setting_id: number | null;
      arc_id: number;
    })[];
    const arcOfScene = new Map(rows.map((r) => [r.id, r.arc_id] as const));
    const bySetting = new Map<number | null, typeof rows>();
    rows.forEach((r) => {
      const list = bySetting.get(r.setting_id);
      if (list) list.push(r);
      else bySetting.set(r.setting_id, [r]);
    });
    const counts = new Map<number, number>();
    for (const [settingId, list] of bySetting)
      for (const sc of sceneHints(list, settingId)) {
        const arc = arcOfScene.get(sc.scene_id);
        if (arc == null) continue;
        counts.set(arc, (counts.get(arc) ?? 0) + sc.hints.length);
      }
    for (const [arc_id, count] of counts) chapters.push({ arc_id, count });
  }

  if (ids.length === 0) return res.json({ scenes: [], chapters });

  const rows = db
    .prepare(
      `SELECT ${HINT_SCENE_COLUMNS}, setting_id FROM story_scenes
       WHERE id IN (${ids.map(() => "?").join(",")}) AND archived_at IS NULL`
    )
    .all(...ids) as (Parameters<typeof sceneHints>[0][number] & { setting_id: number | null })[];

  // Словарь имён строится на сеттинг, поэтому сцены разных сеттингов считаются
  // отдельно: на холсте приключения он один, на свободной доске может быть
  // несколько.
  const bySetting = new Map<number | null, typeof rows>();
  rows.forEach((r) => {
    const list = bySetting.get(r.setting_id);
    if (list) list.push(r);
    else bySetting.set(r.setting_id, [r]);
  });

  const scenes = [...bySetting.entries()].flatMap(([settingId, list]) => sceneHints(list, settingId));
  res.json({ scenes, chapters });
});

/**
 * Заглушка подсказки об упоминании. Два охвата:
 *
 * - `scope: "scene"` — «это не оно» здесь. Ставится на ОРИГИНАЛ сеттинга: см.
 *   комментарий у таблицы в schema.sql.
 * - `scope: "setting"` — не подсказывать про эту сущность нигде в сеттинге
 *   (находка Н13). Нужен потому, что 47 из 143 упоминаний на одной доске — имя
 *   города, в котором идёт всё приключение; точечно его пришлось бы гасить
 *   47 раз.
 */
canvasRouter.post("/hints/dismiss", (req, res) => {
  const { scene_id, setting_id, entity_type, entity_id, scope } = req.body as {
    scene_id?: number;
    setting_id?: number;
    entity_type?: string;
    entity_id?: number;
    scope?: "scene" | "setting";
  };
  if (!entity_type || !entity_id) return res.status(400).json({ error: "entity_type, entity_id are required" });

  if (scope === "setting") {
    if (!setting_id) return res.status(400).json({ error: "setting_id is required for scope=setting" });
    db.prepare(
      `INSERT INTO setting_hint_mutes (setting_id, entity_type, entity_id) VALUES (?, ?, ?)
       ON CONFLICT(setting_id, entity_type, entity_id) DO NOTHING`
    ).run(setting_id, entity_type, entity_id);
    return res.json({ ok: true });
  }

  if (!scene_id) return res.status(400).json({ error: "scene_id is required" });
  const scene = db.prepare("SELECT id, source_scene_id FROM story_scenes WHERE id = ?").get(scene_id) as
    | { id: number; source_scene_id: number | null }
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  db.prepare(
    `INSERT INTO scene_hint_dismissals (scene_id, entity_type, entity_id) VALUES (?, ?, ?)
     ON CONFLICT(scene_id, entity_type, entity_id) DO NOTHING`
  ).run(scene.source_scene_id ?? scene.id, entity_type, entity_id);
  res.json({ ok: true });
});

/**
 * Снять заглушку (находка Н14).
 *
 * Заводится вместе с самой заглушкой, а не «когда-нибудь»: ошибочное нажатие
 * «Это не оно» иначе необратимо — подсказка пропадает и из чипа, и из
 * счётчика, и вернуть её из интерфейса нечем. У заглушки на весь сеттинг цена
 * ошибки ещё выше: одно нажатие гасит имя разом во всех приключениях.
 */
canvasRouter.delete("/hints/dismiss", (req, res) => {
  // Параметры в строке запроса, а не в теле: `api.del` на клиенте тела не
  // шлёт, и ради одного маршрута менять общий слой API незачем. Личных данных
  // здесь нет — только номера сущностей.
  const q = req.query as { scene_id?: string; setting_id?: string; entity_type?: string; entity_id?: string; scope?: string };
  const scene_id = q.scene_id ? Number(q.scene_id) : undefined;
  const setting_id = q.setting_id ? Number(q.setting_id) : undefined;
  const entity_type = q.entity_type;
  const entity_id = q.entity_id ? Number(q.entity_id) : undefined;
  const scope = q.scope;
  if (!entity_type || !entity_id) return res.status(400).json({ error: "entity_type, entity_id are required" });
  if (scope === "setting") {
    if (!setting_id) return res.status(400).json({ error: "setting_id is required for scope=setting" });
    db.prepare("DELETE FROM setting_hint_mutes WHERE setting_id = ? AND entity_type = ? AND entity_id = ?").run(
      setting_id,
      entity_type,
      entity_id
    );
    return res.json({ ok: true });
  }
  if (!scene_id) return res.status(400).json({ error: "scene_id is required" });
  const scene = db.prepare("SELECT id, source_scene_id FROM story_scenes WHERE id = ?").get(scene_id) as
    | { id: number; source_scene_id: number | null }
    | undefined;
  if (!scene) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM scene_hint_dismissals WHERE scene_id = ? AND entity_type = ? AND entity_id = ?").run(
    scene.source_scene_id ?? scene.id,
    entity_type,
    entity_id
  );
  res.json({ ok: true });
});

/**
 * Что заглушено — с именами, чтобы отмена была осмысленной.
 *
 * Отдаётся по сеттингу целиком (заглушки на сеттинг) плюс по сценам этой доски
 * (точечные): список нужен ровно для одного меню и должен быть коротким.
 * Пустой ответ означает, что пункт меню не показывается вовсе — правило
 * «блок, которому нечего показать, не показывается».
 */
canvasRouter.get("/hints/dismissed", (req, res) => {
  const { setting_id, ids } = req.query as { setting_id?: string; ids?: string };
  const settingId = setting_id ? Number(setting_id) : null;
  const sceneIds = String(ids ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  const named = (type: string, id: number): string => {
    const spec = ENTITY_NODES[type];
    if (!spec) return `${type} ${id}`;
    const row = db.prepare(`SELECT ${spec.nameCol} AS name FROM ${spec.table} WHERE id = ?`).get(id) as
      | { name: string }
      | undefined;
    return row?.name ?? `${type} ${id}`;
  };

  const setting =
    settingId == null
      ? []
      : (
          db
            .prepare("SELECT entity_type, entity_id FROM setting_hint_mutes WHERE setting_id = ? ORDER BY created_at")
            .all(settingId) as { entity_type: string; entity_id: number }[]
        ).map((r) => ({ ...r, name: named(r.entity_type, r.entity_id) }));

  // Точечные ищутся и по показанной сцене, и по её оригиналу: копия кампании —
  // другая строка, а заглушка лежит на оригинале.
  const scenes =
    sceneIds.length === 0
      ? []
      : (() => {
          const rows = db
            .prepare(
              `SELECT id, source_scene_id, name FROM story_scenes WHERE id IN (${sceneIds.map(() => "?").join(",")})`
            )
            .all(...sceneIds) as { id: number; source_scene_id: number | null; name: string }[];
          const keys = [...new Set(rows.map((r) => r.source_scene_id ?? r.id))];
          if (keys.length === 0) return [];
          const nameByKey = new Map(rows.map((r) => [r.source_scene_id ?? r.id, r.name]));
          const shownByKey = new Map(rows.map((r) => [r.source_scene_id ?? r.id, r.id]));
          return (
            db
              .prepare(
                `SELECT scene_id, entity_type, entity_id FROM scene_hint_dismissals
                 WHERE scene_id IN (${keys.map(() => "?").join(",")}) ORDER BY created_at`
              )
              .all(...keys) as { scene_id: number; entity_type: string; entity_id: number }[]
          ).map((r) => ({
            ...r,
            scene_id: shownByKey.get(r.scene_id) ?? r.scene_id,
            scene_name: nameByKey.get(r.scene_id) ?? "",
            name: named(r.entity_type, r.entity_id),
          }));
        })();

  res.json({ setting, scenes });
});

/**
 * Шаг режима репетиции (блок G3). Ничего не пишет в базу — как и `GET /board`.
 *
 * Без `scene_id` отвечает первой сценой приключения по порядку: с чего начать
 * прогон, знает сервер, потому что `position` на холст не приезжает вовсе.
 * `campaign_id` означает то же, что и у холста: показать слой кампании.
 */
canvasRouter.get("/rehearsal", (req, res) => {
  const q = req.query as { scene_id?: string; arc_id?: string; campaign_id?: string };
  const campaignId = q.campaign_id ? Number(q.campaign_id) : null;
  const arcId = q.arc_id ? Number(q.arc_id) : null;

  let sceneId = q.scene_id ? Number(q.scene_id) : null;
  if (!sceneId) {
    if (!arcId) return res.status(400).json({ error: "scene_id or arc_id is required" });
    sceneId = firstSceneOf(arcId, campaignId);
    // Приключение без единой сцены — не ошибка: кнопки прогона на таком
    // холсте нет вовсе, но запрос мог прийти от вкладки, открытой раньше.
    if (!sceneId) return res.json(null);
  }

  const step = rehearsalStep(sceneId, campaignId);
  if (!step) return res.status(404).json({ error: "not found" });
  res.json(step);
});
