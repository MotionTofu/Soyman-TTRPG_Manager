// Полка заготовок: копирование сцены целиком, чтение вставки сквозь
// заготовку и отвязка.
//
// Лежит отдельным модулем, а не внутри routes/story.ts, потому что этим
// пользуются двое: список сцен (story.ts) и холст (canvas.ts). Третьей копии
// той же логики репозиторий уже не выдержит — overrideMap продублирована в
// canvas.ts, и это ровно тот случай, который не хочется повторять.

import { db } from "../db/db";

/** Минимум полей, который нужен здешним функциям. */
export interface LibraryAwareScene {
  id: number;
  library_scene_id: number | null;
}

// Поля, которые вставка НЕ хранит у себя, а читает с заготовки, пока её не
// тронули. Всё остальное (место в приключении, порядок, признак полки) —
// собственность самой вставки: она стоит в этом приключении, а не в том, где
// написана заготовка.
export const INHERITED_SCENE_FIELDS = [
  "name",
  "kind",
  "summary",
  "read_aloud",
  "whats_happening",
  "entry_condition",
  "outcomes",
  "hidden_from_players",
] as const;

/**
 * Строка, где лежит содержимое сцены: сама сцена или заготовка, если это ещё
 * не тронутая вставка. Через неё же ищутся проверки, награды, переходы и
 * связи — у вставки своих нет.
 */
export function contentSceneId(sceneId: number): number {
  const row = db.prepare("SELECT library_scene_id FROM story_scenes WHERE id = ?").get(sceneId) as
    | { library_scene_id: number | null }
    | undefined;
  return row?.library_scene_id ?? sceneId;
}

export type WithLibrary<T> = T & {
  library_name: string | null;
  library_setting_id: number | null;
};

/**
 * Показать вставку так, как её увидит Мастер: тексты заготовки поверх
 * собственных полей строки, плюс имя заготовки для пометки «по заготовке».
 */
export function withLibraryContent<T extends LibraryAwareScene>(scene: T): WithLibrary<T> {
  if (scene.library_scene_id == null) {
    return { ...scene, library_name: null, library_setting_id: null };
  }
  const blank = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(scene.library_scene_id) as
    | Record<string, unknown>
    | undefined;
  // Заготовки нет — вставка осталась без источника. Показываем как есть, а не
  // прячем строку: пустая сцена в приключении честнее исчезнувшей.
  if (!blank) return { ...scene, library_name: null, library_setting_id: null };
  const inherited: Record<string, unknown> = {};
  for (const field of INHERITED_SCENE_FIELDS) inherited[field] = blank[field];
  return {
    ...scene,
    ...inherited,
    library_name: blank.name as string,
    library_setting_id: blank.setting_id as number | null,
  };
}

/**
 * Всё, что висит на сцене, — из одной строки в другую: проверки с исходами,
 * награды, переходы, связи с сущностями.
 *
 * Одна routine на три случая (копия для кампании, отвязка вставки от
 * заготовки, материализация вставок при удалении заготовки) — потому что
 * забытая здесь таблица теряется во всех трёх сразу, и лучше пусть теряется
 * в одном месте, где это видно.
 */
export function copySceneChildren(fromId: number, toId: number): void {
  // Проверки копируются по одной, а не одним INSERT ... SELECT: у каждой
  // висят исходы, и без соответствия «старый id → новый» их не перенести.
  // Копия с проверками, но без исходов — это проверка, у которой нечему
  // случиться, и пропавшее ветвление на холсте.
  const copyCheck = db.prepare(
    `INSERT INTO story_scene_checks (scene_id, what, difficulty, on_success, on_failure, position)
     SELECT ?, what, difficulty, on_success, on_failure, position
     FROM story_scene_checks WHERE id = ?`
  );
  // target_id исхода остаётся указывать на оригинал сеттинга — тот же уговор,
  // что у переходов ниже: подмену на копию кампании делают эндпоинты показа.
  const copyOutcomes = db.prepare(
    `INSERT INTO story_check_outcomes (check_id, label, consequence, target_type, target_id, position)
     SELECT ?, label, consequence, target_type, target_id, position
     FROM story_check_outcomes WHERE check_id = ? ORDER BY position, id`
  );
  const sourceChecks = db
    .prepare("SELECT id FROM story_scene_checks WHERE scene_id = ? ORDER BY position, id")
    .all(fromId) as { id: number }[];
  sourceChecks.forEach((c) => {
    const cloned = Number(copyCheck.run(toId, c.id).lastInsertRowid);
    copyOutcomes.run(cloned, c.id);
  });

  db.prepare(
    `INSERT INTO story_scene_rewards (scene_id, what, where_found, notes, artifact_id, position)
     SELECT ?, what, where_found, notes, artifact_id, position
     FROM story_scene_rewards WHERE scene_id = ?`
  ).run(toId, fromId);
  // to_scene_id keeps pointing at the setting's originals; the list endpoints
  // map those through the override table when displaying.
  db.prepare(
    `INSERT OR IGNORE INTO story_scene_transitions (from_scene_id, to_scene_id, label, position)
     SELECT ?, to_scene_id, label, position
     FROM story_scene_transitions WHERE from_scene_id = ?`
  ).run(toId, fromId);
  db.prepare(
    `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
     SELECT 'scene', ?, to_type, to_id, section, origin
     FROM generic_links WHERE from_type = 'scene' AND from_id = ?`
  ).run(toId, fromId);
}

/**
 * Отвязка: вставка перестаёт читать заготовку и становится обычной сценой.
 *
 * Содержимое переносится внутрь целиком — тексты, проверки с исходами,
 * награды, переходы и связи. Отвязать, ничего не перенеся, значило бы
 * оставить Мастеру пустую сцену там, где секунду назад стояла засада
 * гоблинов.
 *
 * Вызывается и автоматически (первая правка), и кнопкой «Отвязать».
 */
export function detachFromLibrary(sceneId: number): void {
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as
    | { id: number; library_scene_id: number | null }
    | undefined;
  if (!scene?.library_scene_id) return;
  const blankId = scene.library_scene_id;

  db.transaction(() => {
    const blank = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(blankId) as
      | Record<string, unknown>
      | undefined;
    if (blank) {
      const sets = INHERITED_SCENE_FIELDS.map((f) => `${f} = ?`).join(", ");
      db.prepare(`UPDATE story_scenes SET ${sets} WHERE id = ?`).run(
        ...INHERITED_SCENE_FIELDS.map((f) => blank[f]),
        sceneId
      );
    }
    copySceneChildren(blankId, sceneId);
    db.prepare("UPDATE story_scenes SET library_scene_id = NULL WHERE id = ?").run(sceneId);
  })();
}
