// Дерево «приключение → глава → сцена».
//
// Уровень глав лежал в базе с самого начала (`story_arcs.parent_id` плюс
// `kind`), но интерфейс его не показывал — и главы выглядели приключениями. На
// живой базе владельца в главах лежат 183 сцены из 194, так что «приключение
// без сцен» было не пустым приключением, а нечитаемым деревом.
//
// Сцена может стоять и прямо в приключении: одноактный ваншот главы не
// заслуживает, а автоматическая «Без главы» — это пустой уровень у всех
// коротких приключений ради ровности.

import { db } from "../db/db";
import { withLibraryContent } from "./library";

export interface TreeScene {
  id: number;
  name: string;
  kind: string | null;
  /** Сколько сущностей в составе — видно, размечена ли сцена вообще. */
  cast: number;
}

export interface TreeChapter {
  id: number | null;
  name: string;
  scenes: TreeScene[];
}

export interface TreeAdventure {
  id: number;
  name: string;
  chapters: TreeChapter[];
}

function scenesOf(arcId: number): TreeScene[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.library_scene_id,
              (SELECT COUNT(*) FROM generic_links gl
               WHERE gl.from_type = 'scene'
                 AND gl.from_id = COALESCE(s.library_scene_id, s.id)
                 AND gl.section LIKE 'scene_%') AS cast_count
       FROM story_scenes s
       WHERE s.arc_id = ? AND s.archived_at IS NULL AND s.campaign_id IS NULL
       ORDER BY s.position, s.id`
    )
    .all(arcId) as Record<string, unknown>[];
  return rows.map((row) => {
    const s = withLibraryContent(row as never) as unknown as {
      id: number;
      name: string;
      kind: string | null;
      cast_count: number;
    };
    return { id: s.id, name: s.name, kind: s.kind ?? null, cast: s.cast_count ?? 0 };
  });
}

/**
 * Дерево одного сеттинга.
 *
 * `arcIds` ограничивает верхний уровень приключениями кампании: у владельца в
 * сеттинге 19 приключений и 50 глав, и показывать их все — это дерево, в
 * котором ничего не найти. Пустой список означает «весь сеттинг» — так
 * работает переключатель «показать весь сеттинг» в подготовке.
 */
export function storyTree(settingId: number, arcIds: number[] = []): TreeAdventure[] {
  const filter = arcIds.length > 0 ? ` AND a.id IN (${arcIds.map(() => "?").join(",")})` : "";
  const adventures = db
    .prepare(
      `SELECT a.id, a.name FROM story_arcs a
       WHERE a.setting_id = ? AND a.parent_id IS NULL AND a.archived_at IS NULL
         AND a.campaign_id IS NULL${filter}
       ORDER BY a.is_default, a.position, a.id`
    )
    .all(settingId, ...arcIds) as { id: number; name: string }[];

  const chapterRows = db.prepare(
    `SELECT id, name FROM story_arcs
     WHERE parent_id = ? AND archived_at IS NULL AND campaign_id IS NULL
     ORDER BY position, id`
  );

  return adventures.map((a) => {
    const chapters: TreeChapter[] = [];
    // Свои сцены приключения идут первыми и без заголовка главы: у ваншота
    // главы нет, и придумывать ему «Без главы» значит заводить пустой уровень.
    const own = scenesOf(a.id);
    if (own.length > 0) chapters.push({ id: null, name: "", scenes: own });
    for (const ch of chapterRows.all(a.id) as { id: number; name: string }[]) {
      chapters.push({ id: ch.id, name: ch.name, scenes: scenesOf(ch.id) });
    }
    return { id: a.id, name: a.name, chapters };
  });
}

/**
 * Сцены, которые приносит галочка главы. Отдельной функцией, потому что тем же
 * пользуется и галочка приключения: она берёт сцены всех своих глав и свои
 * собственные.
 */
export function scenesUnder(arcId: number): number[] {
  return (
    db
      .prepare(
        `SELECT s.id FROM story_scenes s
         WHERE s.archived_at IS NULL AND s.campaign_id IS NULL
           AND (s.arc_id = ? OR s.arc_id IN (SELECT id FROM story_arcs WHERE parent_id = ?))
         ORDER BY s.position, s.id`
      )
      .all(arcId, arcId) as { id: number }[]
  ).map((r) => r.id);
}

/**
 * Поиск сцен для пульта: по сеттингу и по полке заготовок.
 *
 * Полка ищется независимо от того, в каком сеттинге заготовка написана: у неё
 * сеттинг — метка «где написана», а не владелец. «Армрестлинг в таверне» лежит
 * именно там, и тянутся за ним ровно тогда, когда партия ушла не туда.
 */
export function searchScenes(settingId: number, query: string, limit = 12) {
  const like = `%${query.trim()}%`;
  return db
    .prepare(
      `SELECT s.id, s.name, s.in_library,
              COALESCE(par.name, arc.name, '') AS arc_name,
              CASE WHEN arc.parent_id IS NULL THEN '' ELSE arc.name END AS chapter_name
       FROM story_scenes s
       LEFT JOIN story_arcs arc ON arc.id = s.arc_id
       LEFT JOIN story_arcs par ON par.id = arc.parent_id
       WHERE s.archived_at IS NULL AND s.campaign_id IS NULL AND s.name LIKE ?
         AND (s.setting_id = ? OR s.in_library = 1)
       ORDER BY s.in_library DESC, s.name
       LIMIT ?`
    )
    .all(like, settingId, limit) as {
    id: number;
    name: string;
    in_library: number;
    arc_name: string;
    chapter_name: string;
  }[];
}
