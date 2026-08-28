/**
 * Режим репетиции (блок G3 плана ревизии Полотна).
 *
 * Тихий прогон приключения глазами: Мастер идёт по сценам, видит состав,
 * проверки, звук и «куда дальше». Это не пульт — сюда не переезжает ни запуск
 * сцены, ни журнал: прогон НИЧЕГО не пишет в базу и живёт только в памяти
 * вкладки.
 *
 * Своей выборки сцены здесь нет намеренно: карточку целиком отдаёт
 * `scenePreview()` из `stage.ts` — та же функция, которой живёт переключатель
 * сцен на пульте. Двух правд об одной сцене не бывает; когда в предпросмотр
 * добавят поле, оно приедет сюда само.
 *
 * Своего здесь ровно два вычисления, которых у пульта нет:
 *
 * 1. «Следующая по порядку». Порядок сцен приключения держится на `position`,
 *    а не на стрелках: линейная глава законно живёт без единого перехода, и
 *    прогон, упирающийся в тупик на второй сцене, бесполезен. Порядок берётся
 *    ровно тот же, что показывает профиль приключения (`GET /story/arcs/:id`):
 *    сквозной по `position, id` через все главы разом.
 *
 * 2. Цель выхода за пределы приключения. Исход проверки может вести в сцену
 *    другого приключения. Скрывать такую связь нельзя — холст не должен врать;
 *    шагать туда тоже нельзя — прогон незаметно уехал бы в другое приключение.
 *    Поэтому такой выход помечен `outside` и подписан именем приключения.
 */
import { db } from "../db/db";
import { withLibraryContent } from "./library";
import { scenePreview, exitsFrom, type ScenePreview, type StageScene } from "./stage";

interface OrderRow {
  id: number;
  arc_id: number | null;
  position: number;
  campaign_id: number | null;
  source_scene_id: number | null;
}

export interface RehearsalExit {
  scene: StageScene;
  label: string;
  /** Цель лежит в другом приключении: показывается, но шагом не является. */
  outside: boolean;
  /** Имя приключения цели — заполнено только у `outside`. */
  adventure_name: string;
}

export interface RehearsalStep {
  preview: ScenePreview;
  exits: RehearsalExit[];
  /** Куда идти, когда стрелок нет вовсе. */
  next_in_order: StageScene | null;
  /** Приключение, по которому идёт прогон, — чтобы клиент не гадал. */
  adventure_id: number | null;
}

/** Приключение сцены: сама глава, если она вложена, иначе её же приключение. */
function adventureOf(arcId: number | null): number | null {
  if (arcId == null) return null;
  const arc = db.prepare("SELECT id, parent_id FROM story_arcs WHERE id = ?").get(arcId) as
    | { id: number; parent_id: number | null }
    | undefined;
  if (!arc) return null;
  return arc.parent_id ?? arc.id;
}

/**
 * Сцены приключения в том порядке, в каком их показывает его профиль.
 *
 * Слой кампании собирается тем же способом, что и в `GET /story/arcs/:id`:
 * правка кампании заменяет оригинал на своём месте, собственные сцены кампании
 * встают по своему `position`. Иначе прогон в кампании шёл бы по базовым
 * сценам, а Мастер смотрел бы на кампанийные.
 */
function orderedScenes(adventureId: number, campaignId: number | null): OrderRow[] {
  const chapters = db
    .prepare(
      `SELECT id FROM story_arcs
       WHERE parent_id = ? AND archived_at IS NULL AND campaign_id IS NULL`
    )
    .all(adventureId) as { id: number }[];
  const arcIds = [adventureId, ...chapters.map((c) => c.id)];
  const holes = arcIds.map(() => "?").join(",");

  const originals = db
    .prepare(
      `SELECT id, arc_id, position, campaign_id, source_scene_id FROM story_scenes
       WHERE arc_id IN (${holes}) AND campaign_id IS NULL AND archived_at IS NULL
       ORDER BY position, id`
    )
    .all(...arcIds) as OrderRow[];
  if (campaignId == null) return originals;

  const overrides = new Map<number, OrderRow>(
    (
      db
        .prepare(
          `SELECT id, arc_id, position, campaign_id, source_scene_id FROM story_scenes
           WHERE campaign_id = ? AND source_scene_id IS NOT NULL AND archived_at IS NULL`
        )
        .all(campaignId) as OrderRow[]
    ).map((r) => [r.source_scene_id as number, r])
  );
  const own = db
    .prepare(
      `SELECT id, arc_id, position, campaign_id, source_scene_id FROM story_scenes
       WHERE campaign_id = ? AND arc_id IN (${holes})
         AND source_scene_id IS NULL AND archived_at IS NULL`
    )
    .all(campaignId, ...arcIds) as OrderRow[];

  return [...originals.map((s) => overrides.get(s.id) ?? s), ...own].sort(
    (a, b) => a.position - b.position || a.id - b.id
  );
}

// Имя читается сквозь заготовку тем же `withLibraryContent`, что и везде: у
// нетронутой вставки своего имени нет, и в списке «дальше» она иначе оказалась
// бы безымянной.
function stageScene(sceneId: number): StageScene | null {
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.kind, s.arc_id, s.library_scene_id, a.name AS arc_name
       FROM story_scenes s LEFT JOIN story_arcs a ON a.id = s.arc_id
       WHERE s.id = ? AND s.archived_at IS NULL`
    )
    .get(sceneId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const shown = withLibraryContent(row as never) as unknown as StageScene;
  return {
    id: shown.id,
    name: shown.name,
    kind: shown.kind ?? null,
    arc_id: shown.arc_id ?? null,
    arc_name: (row.arc_name as string) ?? null,
  };
}

/** Первая сцена приключения по порядку — с неё начинается прогон без выделения. */
export function firstSceneOf(adventureId: number, campaignId: number | null): number | null {
  return orderedScenes(adventureId, campaignId)[0]?.id ?? null;
}

/** Следующая сцена по порядку после этой, или null — дальше по порядку ничего нет. */
export function nextInOrder(sceneId: number, campaignId: number | null): StageScene | null {
  const scene = db.prepare("SELECT arc_id FROM story_scenes WHERE id = ?").get(sceneId) as
    | { arc_id: number | null }
    | undefined;
  const adventureId = adventureOf(scene?.arc_id ?? null);
  if (adventureId == null) return null;
  const list = orderedScenes(adventureId, campaignId);
  const at = list.findIndex((s) => s.id === sceneId);
  if (at < 0 || at + 1 >= list.length) return null;
  return stageScene(list[at + 1].id);
}

/** Шаг прогона: карточка сцены, её выходы и запасной ход по порядку. */
export function rehearsalStep(sceneId: number, campaignId: number | null): RehearsalStep | null {
  const preview = scenePreview(sceneId);
  if (!preview) return null;

  const adventureId = adventureOf(preview.scene.arc_id);
  const names = new Map<number, string>();
  const adventureName = (arcId: number | null): string => {
    const root = adventureOf(arcId);
    if (root == null) return "";
    const cached = names.get(root);
    if (cached != null) return cached;
    const row = db.prepare("SELECT name FROM story_arcs WHERE id = ?").get(root) as
      | { name: string }
      | undefined;
    const name = row?.name ?? "";
    names.set(root, name);
    return name;
  };

  const exits: RehearsalExit[] = exitsFrom(sceneId).map((e) => {
    const outside = adventureId != null && adventureOf(e.scene.arc_id) !== adventureId;
    return {
      scene: e.scene,
      label: e.label,
      outside,
      adventure_name: outside ? adventureName(e.scene.arc_id) : "",
    };
  });

  // «Следующая по порядку» считается только когда шагать больше некуда:
  // при живых стрелках она была бы вторым, спорящим ответом на один вопрос.
  //
  // У концовки её нет вовсе, даже если по `position` за ней что-то лежит:
  // `kind='ending'` — это конец истории, а не сцена, у которой забыли стрелку.
  // Без этой оговорки прогон уводил бы с развязки на соседнюю сцену главы.
  const steppable = exits.some((e) => !e.outside);
  const ending = preview.scene.kind === "ending";
  return {
    preview,
    exits,
    next_in_order: steppable || ending ? null : nextInOrder(sceneId, campaignId),
    adventure_id: adventureId,
  };
}
