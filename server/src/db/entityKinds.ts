/**
 * Реестр видов сущностей — одна запись на вид, все производные карты
 * вычисляются отсюда.
 *
 * Зачем он существует. В схеме двадцать одна таблица со связкой
 * `<что-то>_type` + `<что-то>_id` и ни одного внешнего ключа на этой паре:
 * SQLite не умеет ссылаться на «одну из нескольких таблиц». Поэтому каждый,
 * кому нужно от вида узнать таблицу, до сих пор заводил свою карту — их
 * набралось около двадцати пяти, и они разошлись:
 *
 *   - уборка сирот подметала картинки только у персонажей и существ, хотя в
 *     базе живут девять картинок локаций и роут галереи принимает ещё общины,
 *     артефакты и секции игрока: осиротевшие картинки не убирались никогда;
 *   - копия правила уборки в сборке сида не знала про сцены и приключения, и
 *     в сид уезжали чужие связи (а до того — 17 статблоков и 4 изображения
 *     персонажей, из-за чего личные данные попали в сборочный артефакт);
 *   - `important_dates` бывают у сеттинга, но этого вида не было ни в одной
 *     карте, а сборка сида удаляет по `owner_type NOT IN (...)` — то есть
 *     незнание вида здесь равно уничтожению данных.
 *
 * Отсюда два правила этого файла:
 *
 * 1. Реестр полон по факту базы. Служебные виды (стикер, преподготовка,
 *    событие кампании) тоже здесь, просто почти все фасеты у них `false`.
 *    Вид, которого нет в реестре, — это ошибка, а не молчаливое удаление.
 * 2. Обратные карты никто не пишет руками. «Кто владеет `gallery_images`»,
 *    «что архивируется», «что можно упомянуть» — всё вычисляется из фасетов
 *    ниже. Нельзя дописать виду `owns: ["gallery_images"]` и забыть внести
 *    его в список владельцев для уборки: список один и он производный.
 *
 * Три вещи фасетами не выражаются и остаются на местах: правила сопоставления
 * при импорте (`import/crossLinks.ts`), текстовые поля для скана упоминаний
 * там же и колонки превью узлового редактора (`routes/canvas.ts`). Они не про
 * «вид → таблица», а про свою задачу.
 */

/** Полиморфный спутник: живёт, пока жив владелец, каскадом не уходит. */
export type Satellite = "statblocks" | "gallery_images" | "important_dates";

export const SATELLITE_TABLES: readonly Satellite[] = [
  "statblocks",
  "gallery_images",
  "important_dates",
];

/**
 * Кому вид принадлежит по смыслу. Отсюда выводится, например, что уезжает в
 * модуль сеттинга (`world`), а что бессмысленно выпускать наружу.
 */
export type BelongsTo = "world" | "system" | "campaign" | "app";

export interface EntityKind {
  /** Значение, которое лежит в колонке `*_type`. */
  kind: string;
  /** Таблица, где живут записи этого вида. */
  table: string;
  /** Колонка с человеческим именем; `null` — имени нет (преподготовка). */
  nameCol: string | null;
  /**
   * У таблицы есть колонка `short_name` — короткое имя, которым Мастер
   * подписывает метки на карте и в составе сцены. Где она есть, она главнее
   * полного имени.
   */
  hasShortName: boolean;
  /**
   * У таблицы есть колонка `aliases` — «Другие названия». Импорт дописывает
   * синоним только сущностям мира: у записи компендиума колонка тоже есть, но
   * синонимы ей ставит система, а не приключение.
   */
  hasAliases: boolean;
  belongsTo: BelongsTo;

  /** У таблицы есть колонка `archived_at` (мягкое удаление возможно). */
  hasArchivedAt: boolean;
  /** Вид показывается в разделе «Архив» (`routes/archive.ts`). */
  archivable: boolean;
  /** Чем вид адресуется, когда это не `id`. */
  archiveKey: string;

  /** На вид можно сослаться из текста; у таблицы есть колонка `uid`. */
  mentionable: boolean;
  /** Ссылка на вид переживает переезд между устройствами. */
  transferable: boolean;
  /** Вид участвует в общем поиске. */
  searchable: boolean;

  /** Вид бывает концом `generic_links`. */
  linkEndpoint: boolean;
  /** Вид бывает концом `entity_relations`. */
  relationEndpoint: boolean;

  /**
   * Вид рисуется узлом в графе связей. Тринадцать видов; сессии и события
   * хроники исключены согласованно с клиентом (`client/src/graphTypes.ts`,
   * `TYPE_LABELS` — тот же набор строка в строку).
   */
  graphNode: boolean;

  /** Вид может быть целью связи из состава сцены (`story/cast.ts`). */
  sceneLinkTarget: boolean;

  /**
   * Вид попадает в сводку состава по сценам (`routes/story.ts`).
   *
   * Набор НЕ совпадает с `sceneLinkTarget`, и это зафиксированное расхождение,
   * а не описка: сводка знает персонажа и ресурс, но не знает набор узлового
   * редактора, набор звука, плейлист и события — хотя в состав сцены они
   * втыкаются наравне с существом (см. комментарий в `story/cast.ts`). Похоже
   * на тот же дрейф, что мы чиним, но это решение об экране, который Мастер
   * открывает за столом, поэтому поведение сохранено как было.
   */
  sceneCastKind: boolean;

  /**
   * Из этого вида Мастер вправе СОЗДАТЬ отношение (`routes/entityRelations.ts`).
   * Уже, чем `relationEndpoint`: тот говорит «вид встречается концом в базе» и
   * нужен уборке, а этот — «вид предлагается в интерфейсе». Смешивать нельзя:
   * в `entity_relations` живут строки семнадцати видов, а создавать
   * разрешается четырнадцать.
   */
  relationCreatable: boolean;

  /**
   * Таблица, против которой разрешается конец связи, если это не `table`.
   *
   * Так устроена преподготовка: `LinkDropZone entityType="preproduction"
   * entityId={campaignId}` кладёт в связь id КАМПАНИИ, а не id строки
   * `preproduction`. Уборка, наведённая на «свою» таблицу, снесла бы живые
   * связи — это поймал сухой прогон, а не рассуждение.
   */
  endpointTable?: string;

  /** Спутники, которыми вид владеет. */
  owns: readonly Satellite[];

  /** Префикс маршрута детальной страницы, если она есть. */
  detailPrefix: string | null;

  /**
   * Уборка сирот для этого вида выключена намеренно. Ключ — что именно
   * пропускается, значение — почему. Пустое поле означает «убирается».
   */
  sweepSkip?: {
    satellites?: string;
    links?: string;
    relations?: string;
  };
}

/** Запись реестра без вычисляемых фасетов. */
type EntityKindBase = Omit<EntityKind, "graphNode" | "sceneLinkTarget" | "relationCreatable" | "hasShortName" | "sceneCastKind" | "hasAliases">;

const K = (k: EntityKindBase): EntityKindBase => k;

/**
 * Наборы, которые не выводятся из остальных фасетов и потому перечислены явно.
 * Это списки КЛЮЧЕЙ, а не карты «вид → таблица»: таблица по-прежнему живёт
 * ровно в одном месте, и разойтись этим спискам не с чем — тест проверяет,
 * что каждый ключ здесь известен реестру.
 */
/** Таблицы с колонкой `aliases` — проверяется тестом против базы. */
const ALIAS_KINDS = new Set([
  "location", "being", "community", "artifact", "compendium_entry",
]);

/** Таблицы с колонкой `short_name` — проверяется тестом против базы. */
const SHORT_NAME_KINDS = new Set([
  "character", "location", "being", "artifact", "compendium_entry",
]);

const GRAPH_NODES = new Set([
  "campaign", "setting", "player", "character", "location", "being", "artifact",
  "community", "resource", "mastering", "scene", "adventure", "compendium_entry",
]);

const RELATION_CREATABLE = new Set([
  "being", "character", "community", "compendium_entry", "location", "artifact",
  "setting", "campaign", "setting_event", "resource", "mastering", "scene",
  "adventure", "player",
]);

const SCENE_CAST_KINDS = new Set([
  "location", "being", "community", "character", "artifact", "resource",
  "compendium_entry",
]);

const SCENE_LINK_TARGETS = new Set([
  "being", "location", "artifact", "community", "compendium_entry",
  "bundle", "sound_set", "playlist", "setting_event", "campaign_event",
]);

const RAW_KINDS: EntityKindBase[] = [
  K({
    kind: "campaign", table: "campaigns", nameCol: "name", belongsTo: "campaign",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/campaigns",
  }),
  K({
    kind: "setting", table: "settings", nameCol: "name", belongsTo: "world",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    // Сеттинг владеет важными датами («праздники всего мира»). До 2026-09-10
    // они писались с `owner_id = 0` — и клиентом, и роутом, — из-за чего
    // праздники одного мира показывались в календаре всех остальных, а уборка
    // сирот снесла бы их как принадлежащие несуществующему сеттингу №0.
    // Починено в routes/settings.ts и ImportantDatesSection.tsx.
    owns: ["important_dates"],
    detailPrefix: "/settings",
  }),
  K({
    kind: "player", table: "players", nameCol: "name", belongsTo: "app",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/players",
  }),
  K({
    kind: "character", table: "characters", nameCol: "character_name", belongsTo: "campaign",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    owns: ["statblocks", "gallery_images", "important_dates"], detailPrefix: "/characters",
  }),
  K({
    kind: "location", table: "setting_locations", nameCol: "name", belongsTo: "world",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    owns: ["gallery_images", "important_dates"], detailPrefix: "/locations",
  }),
  K({
    kind: "being", table: "setting_beings", nameCol: "name", belongsTo: "world",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    owns: ["statblocks", "gallery_images", "important_dates"], detailPrefix: "/beings",
  }),
  K({
    kind: "community", table: "setting_communities", nameCol: "name", belongsTo: "world",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    owns: ["gallery_images", "important_dates"], detailPrefix: "/communities",
  }),
  K({
    kind: "artifact", table: "artifacts", nameCol: "name", belongsTo: "world",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    // Артефакт владеет важными датами (routes/artifacts.ts:440) и картинками
    // галереи (routes/gallery.ts:44) — ни того, ни другого не было ни в одной
    // карте уборки.
    owns: ["gallery_images", "important_dates"], detailPrefix: "/artifacts",
  }),
  K({
    kind: "resource", table: "resources", nameCol: "name", belongsTo: "app",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "mastering", table: "mastering_notes", nameCol: "title", belongsTo: "app",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false,
    // Сервер по-прежнему отвечает на `types=mastering`, а клиент убрал
    // «Мастерение» из панели поиска решением владельца от 2026-08-21.
    searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "session", table: "sessions", nameCol: "title", belongsTo: "campaign",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: true, transferable: false, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/sessions",
  }),
  K({
    kind: "compendium_entry", table: "compendium_entries", nameCol: "name", belongsTo: "system",
    // У таблицы нет `archived_at`: записи компендиума удаляются насовсем.
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true,
    owns: ["statblocks"], detailPrefix: "/compendium",
  }),
  K({
    kind: "setting_event", table: "setting_calendar_events", nameCol: "title", belongsTo: "world",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/events",
  }),
  K({
    kind: "adventure", table: "story_arcs", nameCol: "name", belongsTo: "campaign",
    hasArchivedAt: true, archivable: false, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/adventures",
  }),
  K({
    kind: "scene", table: "story_scenes", nameCol: "name", belongsTo: "campaign",
    hasArchivedAt: true, archivable: false, archiveKey: "id",
    mentionable: true, transferable: true, searchable: true,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: "/scenes",
  }),
  K({
    kind: "playlist", table: "playlists", nameCol: "name", belongsTo: "app",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "sound_set", table: "sound_sets", nameCol: "name", belongsTo: "app",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "bundle", table: "canvas_bundles", nameCol: "name", belongsTo: "app",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "sticker", table: "canvas_stickers", nameCol: "name", belongsTo: "app",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "campaign_event", table: "campaign_calendar_events", nameCol: "title", belongsTo: "campaign",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "campaign_entry", table: "campaign_entries", nameCol: "title", belongsTo: "campaign",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true, owns: [], detailPrefix: null,
  }),
  K({
    kind: "preproduction", table: "preproduction", nameCol: null, belongsTo: "campaign",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: true, relationEndpoint: true,
    // Раздел преподготовки у кампании один, и адресуется он кампанией.
    endpointTable: "campaigns",
    owns: [], detailPrefix: null,
  }),
  K({
    kind: "campaign_player_section", table: "campaign_player_sections", nameCol: "name", belongsTo: "campaign",
    hasArchivedAt: false, archivable: false, archiveKey: "id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: false, relationEndpoint: false,
    owns: ["gallery_images"], detailPrefix: null,
  }),
  K({
    kind: "system", table: "systems", nameCol: "name", belongsTo: "system",
    hasArchivedAt: true, archivable: true, archiveKey: "id",
    mentionable: false, transferable: false,
    // Системы ищутся своим блоком в routes/search.ts, не через общий список.
    searchable: false,
    linkEndpoint: false, relationEndpoint: false, owns: [], detailPrefix: "/systems",
  }),
  K({
    kind: "canvas_board", table: "canvas_boards", nameCol: "name", belongsTo: "app",
    hasArchivedAt: true, archivable: true,
    // Свободная доска везде — и в маршрутах Полотна, и в ссылке `?free_id=` —
    // адресуется своим `scope_id`.
    archiveKey: "scope_id",
    mentionable: false, transferable: false, searchable: false,
    linkEndpoint: false, relationEndpoint: false, owns: [], detailPrefix: null,
  }),
];

export const ENTITY_KINDS: readonly EntityKind[] = RAW_KINDS.map((k) => ({
  ...k,
  graphNode: GRAPH_NODES.has(k.kind),
  sceneLinkTarget: SCENE_LINK_TARGETS.has(k.kind),
  relationCreatable: RELATION_CREATABLE.has(k.kind),
  hasShortName: SHORT_NAME_KINDS.has(k.kind),
  sceneCastKind: SCENE_CAST_KINDS.has(k.kind),
  hasAliases: ALIAS_KINDS.has(k.kind),
}));

/** Ключи из явных наборов — для проверки, что там нет опечаток. */
export const EXPLICIT_SETS: Record<string, ReadonlySet<string>> = {
  GRAPH_NODES,
  SCENE_LINK_TARGETS,
  RELATION_CREATABLE,
  SHORT_NAME_KINDS,
  SCENE_CAST_KINDS,
  ALIAS_KINDS,
};

const BY_KIND: ReadonlyMap<string, EntityKind> = new Map(
  ENTITY_KINDS.map((k) => [k.kind, k])
);

/** Вид по ключу, либо `undefined`, если такого вида нет. */
export function kindOf(kind: string): EntityKind | undefined {
  return BY_KIND.get(kind);
}

/**
 * Вид по ключу или исключение. Звать оттуда, где неизвестный вид означает
 * порчу данных: сборка сида, уборка сирот, откат импорта. Молчаливое
 * «не знаю такого» в этих местах и было исходным дефектом.
 */
export function requireKind(kind: string): EntityKind {
  const found = BY_KIND.get(kind);
  if (!found) {
    throw new Error(
      `Неизвестный вид сущности «${kind}». Внеси его в server/src/db/entityKinds.ts — ` +
        `молчаливый пропуск здесь удаляет данные.`
    );
  }
  return found;
}

export function allKinds(): readonly string[] {
  return ENTITY_KINDS.map((k) => k.kind);
}

function kindsWhere(pred: (k: EntityKind) => boolean): readonly string[] {
  return ENTITY_KINDS.filter(pred).map((k) => k.kind);
}

function tableMap(pred: (k: EntityKind) => boolean): Record<string, string> {
  return Object.fromEntries(ENTITY_KINDS.filter(pred).map((k) => [k.kind, k.table]));
}

// ─── Производные карты. Никто из них не набирается руками. ───────────────────

/** Спутник → виды, которые им владеют. Обратная сторона фасета `owns`. */
export const SATELLITE_OWNERS: Readonly<Record<Satellite, readonly string[]>> =
  Object.fromEntries(
    SATELLITE_TABLES.map((sat) => [sat, kindsWhere((k) => k.owns.includes(sat))])
  ) as Record<Satellite, readonly string[]>;

/** Вид-владелец спутников → его таблица. */
export const OWNER_TABLE: Record<string, string> = tableMap((k) => k.owns.length > 0);

export const LINK_ENDPOINT_TABLE: Record<string, string> = Object.fromEntries(
  ENTITY_KINDS.filter((k) => k.linkEndpoint).map((k) => [k.kind, k.endpointTable ?? k.table])
);

export const RELATION_ENDPOINT_TABLE: Record<string, string> = Object.fromEntries(
  ENTITY_KINDS.filter((k) => k.relationEndpoint).map((k) => [k.kind, k.endpointTable ?? k.table])
);

export const MENTIONABLE_TABLE: Record<string, string> = tableMap((k) => k.mentionable);

export const TRANSFERABLE_KINDS: ReadonlySet<string> = new Set(
  kindsWhere((k) => k.transferable)
);

export const SEARCHABLE_TABLE: Record<string, string> = tableMap((k) => k.searchable);

export const ARCHIVE_TABLES: Record<string, string> = tableMap((k) => k.archivable);

export const ARCHIVE_KEYS: Record<string, string> = Object.fromEntries(
  ENTITY_KINDS.filter((k) => k.archivable && k.archiveKey !== "id").map((k) => [
    k.kind,
    k.archiveKey,
  ])
);

/** Префикс детальной страницы владельца — для ссылок в разделе «Здоровье». */
export const DETAIL_PREFIX: Record<string, string> = Object.fromEntries(
  ENTITY_KINDS.filter((k) => k.detailPrefix).map((k) => [k.kind, k.detailPrefix as string])
);

/**
 * Пары «спутник, вид владельца», которые подметает уборка сирот, — с учётом
 * явных исключений `sweepSkip`.
 */
export function sweepableSatellitePairs(): { table: Satellite; ownerKind: string; ownerTable: string }[] {
  const out: { table: Satellite; ownerKind: string; ownerTable: string }[] = [];
  for (const sat of SATELLITE_TABLES) {
    for (const k of ENTITY_KINDS) {
      if (!k.owns.includes(sat)) continue;
      if (k.sweepSkip?.satellites) continue;
      out.push({ table: sat, ownerKind: k.kind, ownerTable: k.table });
    }
  }
  return out;
}

/** Таблица, против которой разрешается конец связи для этого вида. */
export function endpointTableOf(k: EntityKind): string {
  return k.endpointTable ?? k.table;
}

export function sweepableLinkEndpoints(): { kind: string; table: string }[] {
  return ENTITY_KINDS.filter((k) => k.linkEndpoint && !k.sweepSkip?.links).map((k) => ({
    kind: k.kind,
    table: endpointTableOf(k),
  }));
}

export function sweepableRelationEndpoints(): { kind: string; table: string }[] {
  return ENTITY_KINDS.filter((k) => k.relationEndpoint && !k.sweepSkip?.relations).map((k) => ({
    kind: k.kind,
    table: endpointTableOf(k),
  }));
}
