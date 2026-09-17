import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Реестр видов сущностей клиента и правило «что задевает правка»
 * (docs/adr/0001).
 *
 * Страница просит данные по виду и id или по пути ресурса, а слой держит кэш по
 * ключам ниже. После правки нужно обновить ровно то, что она задела: карточку
 * сущности, списки её вида и её подресурсы — и больше ничего. Раньше каждая
 * страница перечитывала всё, что показывала: смена статуса сессии тянула шесть
 * запросов.
 */

/** Одиночный маршрут вида: `${base}/${id}`. Раньше жил в api/resolveEntity.ts. */
export const ENTITY_ENDPOINTS = {
  campaign: "/campaigns",
  setting: "/settings",
  player: "/players",
  resource: "/resources",
  mastering: "/mastering",
  session: "/sessions",
  character: "/characters",
  location: "/setting-locations",
  being: "/setting-beings",
  artifact: "/artifacts",
  community: "/setting-communities",
  compendium_entry: "/systems/entries",
  // Сама система. Её подресурсы (`/systems/:id/sections`, записи раздела)
  // задевает `{ kind: "system", id }`; без id вид задел бы и все записи
  // компендиума (`/systems/entries/...`), поэтому целиком его не трогают.
  system: "/systems",
  scene: "/story/scenes",
  adventure: "/story/arcs",
  // У события своей коллекции нет — оно живёт внутри сеттинга, но одиночный
  // маршрут у него такой же, и связи с ним разрешаются в название.
  setting_event: "/settings/calendar-events",
} as const;

export type EntityKind = keyof typeof ENTITY_ENDPOINTS;

export function isEntityKind(value: string): value is EntityKind {
  return Object.prototype.hasOwnProperty.call(ENTITY_ENDPOINTS, value);
}

/**
 * Вид по базовому маршруту (`/setting-beings` → `being`). Нужен общим
 * компонентам, которым страница передаёт маршрут, а не вид: правка задевает
 * карточку по виду, иначе карточка, прочитанная `useEntity`, её не увидит.
 */
export function entityKindByEndpoint(base: string): EntityKind | null {
  for (const [kind, endpoint] of Object.entries(ENTITY_ENDPOINTS)) {
    if (endpoint === base) return kind as EntityKind;
  }
  return null;
}

export function entityPath(kind: EntityKind, id: number): string {
  return `${ENTITY_ENDPOINTS[kind]}/${id}`;
}

export type ListScope = Record<string, string | number | boolean | null | undefined>;

/** Путь списка вида с параметрами; пустые параметры не попадают в строку. */
export function listPath(kind: EntityKind, scope: ListScope = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(scope)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${ENTITY_ENDPOINTS[kind]}?${qs}` : ENTITY_ENDPOINTS[kind];
}

/** Ключи кэша. Любой запрос слоя лежит ровно под одним из них. */
export const dataKeys = {
  entity: (kind: EntityKind, id: number) => ["entity", kind, id] as const,
  list: (kind: EntityKind, scope: ListScope = {}) => ["list", kind, scope] as const,
  resource: (path: string) => ["resource", path] as const,
};

/**
 * Что задела правка.
 * - `{ kind, id }` — сущность: её карточка, её подресурсы и все списки вида;
 * - `{ kind, id, card: true }` — только поля сущности: карточка, списки вида и
 *   ресурсы, которые её показывают, без её подресурсов. Смена валюты кампании
 *   не должна перечитывать её сессии, хронику мира и препродакшен;
 * - `{ kind }` — весь вид;
 * - `{ kind, card: true }` — поля всех сущностей вида: карточки и списки, без подресурсов;
 * - `{ path }` — произвольный ресурс: все запросы, чей путь начинается так
 *   (с границей сегмента или параметра).
 */
export type Affect = { kind: EntityKind; id?: number; card?: boolean } | { path: string };

/**
 * Начинается ли путь с префикса по границе: сразу за префиксом конец строки,
 * «/», «?» или «&». Без границы `/setting-beings/40` задевал бы
 * `/setting-beings/408`, а `owner_id=20` — `owner_id=200`.
 */
export function pathHasPrefix(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === "" || next === "/" || next === "?" || next === "&";
}

/**
 * Ресурсы, которые показывают сущности чужих видов и потому задеваются их
 * правкой, хотя путь у них свой.
 *
 * Доска холста несёт на нодах имена сцен, приключений, существ и прочего: сцену
 * переименовали на её странице — открытый в соседнем окне холст должен
 * перечитаться, а не показывать старое (разбор группы «холст», Q9). Экран
 * выбора досок показывает приключения и сеттинги с числом сцен.
 *
 * Перечитывается только открытая доска: закрытая лишь помечается устаревшей.
 */
const RESOURCE_DEPENDENCIES: readonly { prefix: string | RegExp; kinds: readonly EntityKind[] }[] = [
  {
    prefix: "/canvas/board",
    kinds: ["scene", "adventure", "being", "location", "artifact", "community", "setting_event", "character", "setting", "campaign"],
  },
  { prefix: "/canvas/index", kinds: ["scene", "adventure", "setting", "campaign"] },
  // Дерево сцен, план вечера и предпросмотр на пульте показывают статусы и тексты
  // сцен: отметка «сыграна» в профиле кампании должна дойти до открытого пульта,
  // не перечитывая остальные его 13 панелей (группа «кампании», часть 1).
  { prefix: /^\/sessions\/\d+\/(story-tree|planned|preview)(\/|\?|$)/, kinds: ["scene", "adventure"] },
];

function dependsOn(path: string, prefix: string | RegExp): boolean {
  return typeof prefix === "string" ? pathHasPrefix(path, prefix) : prefix.test(path);
}

export function matchesAffect(queryKey: QueryKey, affect: Affect): boolean {
  const [scope, a, b] = queryKey as readonly unknown[];
  if ("path" in affect) {
    return scope === "resource" && typeof a === "string" && pathHasPrefix(a, affect.path);
  }
  if (
    scope === "resource" &&
    typeof a === "string" &&
    RESOURCE_DEPENDENCIES.some((dep) => dep.kinds.includes(affect.kind) && dependsOn(a, dep.prefix))
  ) {
    return true;
  }
  const base = ENTITY_ENDPOINTS[affect.kind];
  if (scope === "entity") return a === affect.kind && (affect.id == null || b === affect.id);
  if (scope === "list") return a === affect.kind;
  if (scope === "resource" && typeof a === "string") {
    if (affect.id == null) {
      if (!affect.card) return pathHasPrefix(a, base);
      // Все карточки вида и его списки, без подресурсов: переименование
      // системы меняет подпись в каждой кампании, но не их сессии и хронику.
      const rest = a.slice(base.length);
      return a.startsWith(base) && /^(\/\d+)?(\?.*)?$/.test(rest);
    }
    // Своя карточка и подресурсы — да; списки вида — да; чужие карточки — нет.
    const own = affect.card ? a === `${base}/${affect.id}` : pathHasPrefix(a, `${base}/${affect.id}`);
    return own || a === base || a.startsWith(`${base}?`);
  }
  return false;
}

/**
 * Помечает задетое устаревшим; видимое на экране перечитывается сразу. Пусто — всё.
 * `refetch: false` — только пометить: перечитается при следующем обращении.
 */
export function invalidateAffects(
  client: QueryClient,
  affects: readonly Affect[],
  options?: { refetch?: boolean }
): Promise<void> {
  const refetchType = options?.refetch === false ? "none" : "active";
  if (affects.length === 0) return client.invalidateQueries({ refetchType });
  return client.invalidateQueries({
    predicate: (query) => affects.some((affect) => matchesAffect(query.queryKey, affect)),
    refetchType,
  });
}
