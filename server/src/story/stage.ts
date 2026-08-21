// Пульт сессии: что показывает переключатель сцен и что происходит при
// запуске сцены.
//
// Лежит рядом с library.ts и cast.ts, а не в routes/sessions.ts: запуск
// сцены трогает три разных хозяйства — состав сцены, панели сессии и журнал —
// и в маршруте это превратилось бы в стену.

import { db } from "../db/db";
import { CAST_ROLE_BY_SECTION, CAST_SECTIONS, linkTargetName, qtyByLink, setLinkQty } from "./cast";
import { contentSceneId, withLibraryContent } from "./library";

/**
 * Третье значение origin у связи сессии.
 *
 * 'planned' — доложено при подготовке, 'live' — брошено рукой за столом,
 * 'scene' — принесено запущенной сценой. Разделение нужно ровно для одного:
 * следующий запуск сносит только своё и не трогает то, что Мастер положил
 * сам. Без него панели к пятой сцене превращаются в свалку, где не найти
 * нужного гоблина — а искать придётся тогда, когда искать некогда.
 */
export const SCENE_ORIGIN = "scene";

/** Связь сцены с набором пульта звука. */
export const SCENE_SOUND_SECTION = "scene_sound";

/**
 * Разъём сцены → панель пульта. Соответствие один в один: разъёмы названы теми
 * же словами, что панели, и таблица нужна только потому, что у панелей ключи
 * в базе исторические («enemies» — это «Препятствия»).
 */
export const PANEL_BY_CAST_SECTION: Record<string, string> = {
  [CAST_SECTIONS.location]: "locations",
  [CAST_SECTIONS.plot_characters]: "plot_characters",
  [CAST_SECTIONS.obstacles]: "enemies",
  [CAST_SECTIONS.loot]: "loot",
};

/**
 * Что запуск сцены подменяет в панелях.
 *
 * Только место. Остальное собирается заранее объединением по всем сценам
 * отмеченных приключений (см. sessionCastUnion) и на каждом переходе не
 * перетряхивается: у самого большого приключения владельца 29 сцен и всего 10
 * разных участников, так что объединение — это два десятка строк, а не сотня,
 * и Мастеру полезнее видеть весь вечер сразу. Место у сцены одно, объединять
 * его нечего и не с чем.
 */
const SWAPPED_SECTIONS = [CAST_SECTIONS.location];

export interface StageScene {
  id: number;
  name: string;
  kind: string | null;
  arc_id: number | null;
  arc_name: string | null;
}

const SCENE_SELECT = `
  SELECT s.id, s.name, s.kind, s.arc_id, s.library_scene_id, a.name AS arc_name
  FROM story_scenes s
  LEFT JOIN story_arcs a ON a.id = s.arc_id
`;

function readScene(row: Record<string, unknown> | undefined): StageScene | null {
  if (!row) return null;
  const scene = withLibraryContent(row as never) as unknown as StageScene & {
    library_scene_id: number | null;
  };
  return {
    id: scene.id,
    name: scene.name,
    kind: scene.kind ?? null,
    arc_id: scene.arc_id ?? null,
    arc_name: scene.arc_name ?? null,
  };
}

/**
 * Заготовка вечера: сцены, которые Мастер набрал в подготовке.
 *
 * Именно сцены, а не отметки приключений: отметили главу, потом в приключение
 * добавилась сцена — при хранении отметок она молча приехала бы в
 * подготовленную сессию, которую Мастер не готовил.
 */
export function plannedSceneIds(sessionId: number): number[] {
  return (
    db
      .prepare(
        `SELECT p.scene_id FROM session_planned_scenes p
         JOIN story_scenes s ON s.id = p.scene_id AND s.archived_at IS NULL
         WHERE p.session_id = ? ORDER BY p.rowid`
      )
      .all(sessionId) as { scene_id: number }[]
  ).map((r) => r.scene_id);
}

/**
 * Заготовленные сцены, приехавшие с прошлого вечера: их уже готовили, но так и
 * не сыграли. В подготовке они помечаются, чтобы Мастер видел свой долг и не
 * пересобирал вечер с нуля, гадая, что осталось.
 */
export function carriedSceneIds(sessionId: number): number[] {
  return (
    db
      .prepare(
        `SELECT p.scene_id FROM session_planned_scenes p
         WHERE p.session_id = ?
           AND EXISTS (
             SELECT 1 FROM session_planned_scenes q
             JOIN sessions prev ON prev.id = q.session_id
             WHERE q.scene_id = p.scene_id AND q.session_id <> p.session_id
               AND prev.campaign_id = (SELECT campaign_id FROM sessions WHERE id = p.session_id)
               AND prev.date <= (SELECT date FROM sessions WHERE id = p.session_id)
               AND NOT EXISTS (
                 SELECT 1 FROM session_scenes j
                 WHERE j.session_id = q.session_id AND j.scene_id = q.scene_id
               )
           )`
      )
      .all(sessionId) as { scene_id: number }[]
  ).map((r) => r.scene_id);
}

/** Заготовленные сцены с их местом в дереве — для переключателя. */
export function plannedScenes(sessionId: number): (StageScene & { played: boolean })[] {
  const played = new Set(
    (
      db.prepare("SELECT DISTINCT scene_id FROM session_scenes WHERE session_id = ?").all(sessionId) as {
        scene_id: number;
      }[]
    ).map((r) => r.scene_id)
  );
  return plannedSceneIds(sessionId)
    .map((id) => {
      const scene = readScene(
        db.prepare(`${SCENE_SELECT} WHERE s.id = ?`).get(id) as never
      );
      return scene ? { ...scene, played: played.has(id) } : null;
    })
    .filter((s): s is StageScene & { played: boolean } => s !== null);
}

/**
 * Куда можно уйти из сцены: явные переходы плюс исходы проверок, ведущие в
 * сцену. Одна и та же цель по обоим путям показывается один раз — за столом
 * это один и тот же шаг, а два одинаковых пункта читаются как развилка.
 */
export function exitsFrom(sceneId: number): { scene: StageScene; label: string }[] {
  const contentId = contentSceneId(sceneId);
  const out: { scene: StageScene; label: string }[] = [];
  const seen = new Set<number>();

  const add = (targetId: number, label: string) => {
    if (seen.has(targetId)) return;
    const scene = readScene(
      db.prepare(`${SCENE_SELECT} WHERE s.id = ? AND s.archived_at IS NULL`).get(targetId) as never
    );
    if (!scene) return;
    seen.add(targetId);
    out.push({ scene, label });
  };

  const transitions = db
    .prepare(
      `SELECT to_scene_id, label FROM story_scene_transitions
       WHERE from_scene_id = ? ORDER BY position, id`
    )
    .all(contentId) as { to_scene_id: number; label: string }[];
  for (const t of transitions) add(t.to_scene_id, t.label || "");

  const outcomes = db
    .prepare(
      `SELECT o.label, o.target_id FROM story_check_outcomes o
       JOIN story_scene_checks c ON c.id = o.check_id
       WHERE c.scene_id = ? AND o.target_type = 'scene' AND o.target_id IS NOT NULL
       ORDER BY c.position, o.position`
    )
    .all(contentId) as { label: string; target_id: number }[];
  for (const o of outcomes) add(o.target_id, o.label || "");

  return out;
}

/** Последняя запущенная сцена сессии — «где мы сейчас». */
export function currentScene(sessionId: number): StageScene | null {
  const row = db
    .prepare(
      `${SCENE_SELECT}
       JOIN session_scenes j ON j.scene_id = s.id
       WHERE j.session_id = ? ORDER BY j.id DESC LIMIT 1`
    )
    .get(sessionId) as Record<string, unknown> | undefined;
  return readScene(row);
}

/** Лента вечера: что запускали и в каком порядке. Дубли — это возвраты. */
export function sceneJournal(sessionId: number): { id: number; scene_id: number; name: string }[] {
  return db
    .prepare(
      `SELECT j.id, j.scene_id, COALESCE(lib.name, s.name) AS name
       FROM session_scenes j
       JOIN story_scenes s ON s.id = j.scene_id
       LEFT JOIN story_scenes lib ON lib.id = s.library_scene_id
       WHERE j.session_id = ? ORDER BY j.id`
    )
    .all(sessionId) as { id: number; scene_id: number; name: string }[];
}

/** Набор пульта звука, привязанный к сцене. */
export function sceneSoundSet(sceneId: number): { id: number; name: string } | null {
  const contentId = contentSceneId(sceneId);
  const row = db
    .prepare(
      `SELECT ss.id, ss.name FROM generic_links gl
       JOIN sound_sets ss ON ss.id = gl.to_id
       WHERE gl.from_type = 'scene' AND gl.from_id = ? AND gl.section = ? AND gl.to_type = 'sound_set'
       LIMIT 1`
    )
    .get(contentId, SCENE_SOUND_SECTION) as { id: number; name: string } | undefined;
  return row ?? null;
}

export interface LaunchResult {
  scene: StageScene;
  soundSetId: number | null;
  soundSetName: string | null;
  added: number;
  removed: number;
}

/**
 * Запуск сцены: место в панели, журнал, звук.
 *
 * Место подменяется, а не досыпается: `origin='live'` и `origin='planned'`
 * при этом не трогаются — рука Мастера точнее заготовки. Всё в одной
 * транзакции: панели, наполовину пережившие запуск, за столом хуже, чем
 * панели, не пережившие его вовсе.
 */
export function launchScene(sessionId: number, sceneId: number): LaunchResult {
  const scene = readScene(
    db.prepare(`${SCENE_SELECT} WHERE s.id = ? AND s.archived_at IS NULL`).get(sceneId) as never
  );
  if (!scene) throw new Error("сцена не найдена");

  const contentId = contentSceneId(sceneId);
  const castSections = SWAPPED_SECTIONS;
  const cast = db
    .prepare(
      `SELECT id, to_type, to_id, section FROM generic_links
       WHERE from_type = 'scene' AND from_id = ?
         AND section IN (${castSections.map(() => "?").join(",")})
       ORDER BY id`
    )
    .all(contentId, ...castSections) as {
    id: number;
    to_type: string;
    to_id: number;
    section: string;
  }[];

  const qty = qtyByLink(cast.map((c) => c.id));

  const run = db.transaction(() => {
    const gone = db
      .prepare("DELETE FROM generic_links WHERE from_type = 'session' AND from_id = ? AND origin = ?")
      .run(sessionId, SCENE_ORIGIN);

    const insert = db.prepare(
      `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
       VALUES ('session', ?, ?, ?, ?, ?)`
    );
    let added = 0;
    for (const row of cast) {
      const panel = PANEL_BY_CAST_SECTION[row.section];
      const info = insert.run(sessionId, row.to_type, row.to_id, panel, SCENE_ORIGIN);
      // Ноль строк — такая связь в панели уже лежит: Мастер положил её рукой,
      // и его количество точнее заготовки. Двух одинаковых карточек не будет:
      // за столом они читаются как «их двое», а это прямая ошибка в бою.
      if (info.changes === 0) continue;
      added += 1;
      const amount = qty.get(row.id);
      // Количество едет вместе с участником: напоминание нужно там, куда
      // Мастер смотрит в бою, а не на карточке, которую он уже свернул.
      if (amount) setLinkQty(Number(info.lastInsertRowid), amount);
    }

    db.prepare("INSERT INTO session_scenes (session_id, scene_id) VALUES (?, ?)").run(sessionId, sceneId);
    return { added, removed: gone.changes };
  });

  const { added, removed } = run();
  const sound = sceneSoundSet(sceneId);
  return {
    scene,
    soundSetId: sound?.id ?? null,
    soundSetName: sound?.name ?? null,
    added,
    removed,
  };
}

/**
 * Состав всех сцен сессии, объединением: кого Мастер увидит в панелях ещё до
 * первого запуска.
 *
 * Берётся по сценам ОТМЕЧЕННЫХ приключений (а если не отмечено ничего — по
 * всем приключениям кампании, тот же уговор, что у переключателя). Это не
 * свалка: у самого большого приключения владельца 29 сцен и 10 разных
 * участников, у остальных по три-восемь, так что вечер с двумя-тремя
 * приключениями даёт пару десятков строк.
 *
 * Не записывается в generic_links, а считается на чтении. Иначе объединение
 * пришлось бы пересобирать при каждой правке сцены и при каждой смене отметок,
 * и рано или поздно оно разошлось бы с содержимым сцен — а разошедшийся
 * список за столом хуже отсутствующего.
 *
 * `inScene` помечает тех, кто в запущенной сейчас сцене: среди двадцати имён
 * глаз иначе не найдёт нужного.
 */
export interface UnionRow {
  panel: string;
  to_type: string;
  to_id: number;
  qty: string;
  inScene: boolean;
  scenes: string[];
}

export function sessionCastUnion(sessionId: number): UnionRow[] {
  const sceneIds = plannedSceneIds(sessionId);
  if (sceneIds.length === 0) return [];

  // Место сюда не входит: его подменяет запуск сцены, и в объединении оно
  // означало бы «партия одновременно в шести местах».
  const sections = [
    CAST_SECTIONS.plot_characters,
    CAST_SECTIONS.obstacles,
    CAST_SECTIONS.loot,
  ];

  const rows = db
    .prepare(
      `SELECT gl.id, gl.to_type, gl.to_id, gl.section,
              COALESCE(lib.name, s.name) AS scene_name,
              s.id AS scene_id
       FROM story_scenes s
       LEFT JOIN story_scenes lib ON lib.id = s.library_scene_id
       JOIN generic_links gl
         ON gl.from_type = 'scene' AND gl.from_id = COALESCE(s.library_scene_id, s.id)
       WHERE s.id IN (${sceneIds.map(() => "?").join(",")})
         AND gl.section IN (${sections.map(() => "?").join(",")})
       ORDER BY s.position, s.id, gl.id`
    )
    .all(...sceneIds, ...sections) as {
    id: number;
    to_type: string;
    to_id: number;
    section: string;
    scene_name: string;
    scene_id: number;
  }[];

  const qty = qtyByLink(rows.map((r) => r.id));
  const currentId = currentScene(sessionId)?.id ?? null;

  // Один и тот же гоблин в четырёх сценах — одна строка: две одинаковых
  // карточки за столом читаются как «их двое», а это прямая ошибка в бою.
  const byKey = new Map<string, UnionRow>();
  for (const row of rows) {
    const panel = PANEL_BY_CAST_SECTION[row.section];
    if (!panel) continue;
    const key = `${panel}:${row.to_type}:${row.to_id}`;
    const existing = byKey.get(key);
    const here = row.scene_id === currentId;
    if (existing) {
      if (!existing.scenes.includes(row.scene_name)) existing.scenes.push(row.scene_name);
      if (here) {
        existing.inScene = true;
        // Количество берётся у текущей сцены: в подвале гоблинов 1к6, а в
        // засаде трое, и показывать надо то, что происходит сейчас.
        existing.qty = qty.get(row.id) ?? existing.qty;
      }
      continue;
    }
    byKey.set(key, {
      panel,
      to_type: row.to_type,
      to_id: row.to_id,
      qty: qty.get(row.id) ?? "",
      inScene: here,
      scenes: [row.scene_name],
    });
  }
  return [...byKey.values()];
}

/**
 * Карточка предпросмотра: всё, что Мастер должен увидеть, прежде чем нажать
 * «Запустить сцену».
 *
 * Одним запросом, а не тремя. Предпросмотр открывается щелчком по варианту
 * «куда дальше» — в тот момент, когда за столом ждут ответа, — и три
 * последовательных ответа сервера дали бы карточку, доезжающую по частям.
 */
export interface ScenePreview {
  scene: StageScene;
  readAloud: string;
  summary: string;
  entryCondition: string;
  cast: { role: string; name: string; qty: string }[];
  checks: { what: string; dc: string; outcomes: string[] }[];
  sound: { id: number; name: string } | null;
  exits: { scene: StageScene; label: string }[];
}

export function scenePreview(sceneId: number): ScenePreview | null {
  const row = db
    .prepare(`${SCENE_SELECT} WHERE s.id = ? AND s.archived_at IS NULL`)
    .get(sceneId) as Record<string, unknown> | undefined;
  const scene = readScene(row);
  if (!scene) return null;

  // Тексты берутся ПОЛНОЙ строкой, а не той, что отдаёт SCENE_SELECT: там
  // выбраны только поля для переключателя, и зачитки в ней нет. Через
  // withLibraryContent — у нетронутой вставки заготовки своих текстов нет, и
  // читать их надо сквозь неё, тем же способом, что и везде.
  const full = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as
    | Record<string, unknown>
    | undefined;
  if (!full) return null;
  const shown = withLibraryContent(full as never) as unknown as {
    read_aloud: string | null;
    summary: string | null;
    entry_condition: string | null;
  };
  const contentId = contentSceneId(sceneId);

  const castRows = db
    .prepare(
      `SELECT id, section, to_type, to_id FROM generic_links
       WHERE from_type = 'scene' AND from_id = ?
         AND section IN (${Object.values(CAST_SECTIONS).map(() => "?").join(",")})
       ORDER BY id`
    )
    .all(contentId, ...Object.values(CAST_SECTIONS)) as {
    id: number;
    section: string;
    to_type: string;
    to_id: number;
  }[];
  const qty = qtyByLink(castRows.map((r) => r.id));

  const checkRows = db
    .prepare("SELECT id, what, difficulty FROM story_scene_checks WHERE scene_id = ? ORDER BY position, id")
    .all(contentId) as { id: number; what: string; difficulty: string }[];
  const outcomes = db.prepare(
    "SELECT label FROM story_check_outcomes WHERE check_id = ? ORDER BY position, id"
  );

  return {
    scene,
    readAloud: shown.read_aloud ?? "",
    summary: shown.summary ?? "",
    entryCondition: shown.entry_condition ?? "",
    cast: castRows.map((r) => ({
      role: CAST_ROLE_BY_SECTION[r.section] ?? "",
      name: linkTargetName(r.to_type, r.to_id),
      qty: qty.get(r.id) ?? "",
    })),
    checks: checkRows.map((c) => ({
      what: c.what,
      dc: c.difficulty,
      outcomes: (outcomes.all(c.id) as { label: string }[]).map((o) => o.label).filter(Boolean),
    })),
    sound: sceneSoundSet(sceneId),
    exits: exitsFrom(sceneId),
  };
}
