import { db } from "../db/db";

// Отметка сцены в кампании (пройдена/пропущена) ставится на показанную строку.
// Правка сцены в кампании заводит копию, а отметка остаётся на исходной —
// поэтому копия без своей отметки читает отметку исходной. Писать не нужно:
// первый же щелчок по копии заводит ей собственную.

// Запрос готовится при вызове: на загрузке модуля база ещё не открыта.
export function sceneStateOf(campaignId: number, sceneId: number) {
  const row = db
    .prepare(
      `SELECT status, note FROM campaign_scene_state
        WHERE campaign_id = @c
          AND scene_id IN (@id, (SELECT source_scene_id FROM story_scenes WHERE id = @id))
        ORDER BY scene_id = @id DESC
        LIMIT 1`
    )
    .get({ c: campaignId, id: sceneId }) as { status: string; note: string } | undefined;
  return row ?? null;
}

/** Пройденные сцены кампании — свои отметки и унаследованные копиями. */
export const DONE_SCENES_SQL = `
  SELECT scene_id FROM campaign_scene_state WHERE campaign_id = @c AND status = 'done'
  UNION
  SELECT c.id FROM story_scenes c
    JOIN campaign_scene_state st ON st.campaign_id = @c AND st.scene_id = c.source_scene_id
   WHERE c.campaign_id = @c AND st.status = 'done'
     AND NOT EXISTS (SELECT 1 FROM campaign_scene_state o WHERE o.campaign_id = @c AND o.scene_id = c.id)`;
