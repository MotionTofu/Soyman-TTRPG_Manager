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
 * - `{ kind }` — весь вид;
 * - `{ path }` — произвольный ресурс: все запросы, чей путь начинается так
 *   (с границей сегмента или параметра).
 */
export type Affect = { kind: EntityKind; id?: number } | { path: string };

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

export function matchesAffect(queryKey: QueryKey, affect: Affect): boolean {
  const [scope, a, b] = queryKey as readonly unknown[];
  if ("path" in affect) {
    return scope === "resource" && typeof a === "string" && pathHasPrefix(a, affect.path);
  }
  const base = ENTITY_ENDPOINTS[affect.kind];
  if (scope === "entity") return a === affect.kind && (affect.id == null || b === affect.id);
  if (scope === "list") return a === affect.kind;
  if (scope === "resource" && typeof a === "string") {
    if (affect.id == null) return pathHasPrefix(a, base);
    // Своя карточка и подресурсы — да; списки вида — да; чужие карточки — нет.
    return pathHasPrefix(a, `${base}/${affect.id}`) || a === base || a.startsWith(`${base}?`);
  }
  return false;
}

/** Помечает задетое устаревшим; видимое на экране перечитывается сразу. Пусто — всё. */
export function invalidateAffects(client: QueryClient, affects: readonly Affect[]): Promise<void> {
  if (affects.length === 0) return client.invalidateQueries();
  return client.invalidateQueries({
    predicate: (query) => affects.some((affect) => matchesAffect(query.queryKey, affect)),
  });
}
