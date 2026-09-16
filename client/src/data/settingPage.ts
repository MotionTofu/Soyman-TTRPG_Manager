import type { Affect } from "./entities";

/**
 * Страница Сеттинга в слое данных (docs/adr/0001, группа «сущности сеттинга»,
 * часть 2).
 *
 * Хроника читается и осью на вкладке, и вкладками «Повторяющиеся», «Циклы»,
 * «Календарь» — одними путями. Раньше ось брала циклы, эпохи и даты один раз
 * при открытии страницы, и добавленный во вкладке цикл на оси не появлялся до
 * перезагрузки.
 */

export const chroniclePaths = {
  events: (settingId: number) => `/settings/${settingId}/calendar-events`,
  cycles: (settingId: number) => `/settings/${settingId}/cycles`,
  importantDates: (settingId: number) => `/settings/${settingId}/important-dates`,
  eras: (settingId: number) => `/settings/${settingId}/calendar-eras`,
  timelines: (settingId: number) => `/settings/${settingId}/calendar-timelines`,
  calendar: (settingId: number) => `/settings/${settingId}/calendar`,
  dateTypes: (settingId: number) => `/settings/${settingId}/date-types`,
  owners: (settingId: number) => `/settings/${settingId}/entities`,
};

export const settingPagePaths = {
  resources: (settingId: number) => `/resources?scope=setting&setting_id=${settingId}`,
  characters: (settingId: number) => `/characters?setting_id=${settingId}`,
  campaigns: (settingId: number) => `/campaigns?setting_id=${settingId}`,
  groups: () => "/setting-groups",
  groupsOf: (settingId: number) => `/setting-groups/by-setting/${settingId}`,
  graph: (query: string) => `/links/graph?${query}`,
};

/**
 * Правка события хроники: список событий сеттинга и сама карточка события —
 * она может быть открыта в соседнем окне. Отдельный маршрут у события вне
 * сеттинга (`/settings/calendar-events/…`), поэтому задевается и он.
 */
export function chronicleEventAffects(settingId: number, eventId?: number): Affect[] {
  return [
    { path: chroniclePaths.events(settingId) },
    eventId != null ? { kind: "setting_event", id: eventId } : { kind: "setting_event" },
  ];
}

/** Таймлайны и эпохи: удаление таймлайна отвязывает от него эпохи. */
export function timelineAffects(settingId: number): Affect[] {
  return [{ path: chroniclePaths.timelines(settingId) }, { path: chroniclePaths.eras(settingId) }];
}

/** Членство сеттинга в группах: его отметки и составы самих групп. */
export function settingGroupAffects(): Affect[] {
  return [{ path: "/setting-groups" }];
}

/**
 * Что задевает мастер создания: сама сущность любого из шести видов, её связи,
 * отношения и участники события. Какие именно — зависит от заполненных шагов,
 * а перечитываются из задетого только видимые запросы, поэтому перечислено
 * всё, что мастер умеет трогать.
 */
export function wizardAffects(settingId: number): Affect[] {
  return [
    { kind: "location" },
    { kind: "being" },
    { kind: "community" },
    { kind: "artifact" },
    ...chronicleEventAffects(settingId),
    { path: "/links" },
    { path: "/entity-relations" },
  ];
}

export interface PopulationFilters {
  category?: string;
  locationId?: string;
  communityId?: string;
  query?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

/**
 * Списки «Населения». Без фильтров путь совпадает с тем, по которому вкладки
 * считают свои числа, — это один запрос на двоих. Сервер сортирует только по
 * имени и давности, остальные сортировки клиентские и в путь не попадают.
 */
export const populationPaths = {
  beings: (settingId: number, f: PopulationFilters = {}) => {
    const params = new URLSearchParams({ setting_id: String(settingId) });
    if (f.category && f.category !== "all") params.set("category", f.category);
    else params.set("exclude_category", "bestiary");
    if (f.locationId) params.set("location_id", f.locationId);
    if (f.communityId) params.set("community_id", f.communityId);
    if (f.query?.trim()) params.set("q", f.query.trim());
    if (f.sort && f.sort !== "name" && f.sort !== "community") params.set("sort", f.sort);
    if (f.dir === "desc") params.set("dir", "desc");
    return `/setting-beings?${params.toString()}`;
  },
  bestiary: (settingId: number, f: PopulationFilters = {}) => {
    const params = new URLSearchParams({ setting_id: String(settingId), category: "bestiary" });
    if (f.query?.trim()) params.set("q", f.query.trim());
    if (f.locationId) params.set("location_id", f.locationId);
    if (f.sort && f.sort !== "name" && f.sort !== "creature_type") params.set("sort", f.sort);
    if (f.dir === "desc") params.set("dir", "desc");
    return `/setting-beings?${params.toString()}`;
  },
  communities: (settingId: number, f: PopulationFilters = {}) => {
    const params = new URLSearchParams({ setting_id: String(settingId) });
    // Без фильтра список остаётся витриной верхнего уровня (вложенные живут на
    // странице родителя). С фильтром это бессмысленно: вложенное сообщество
    // без локации иначе просто не покажется — поэтому ищем по всем уровням.
    if (f.locationId) params.set("location_id", f.locationId);
    else if (!f.query?.trim()) params.set("parent_id", "null");
    if (f.query?.trim()) params.set("q", f.query.trim());
    if (f.sort && f.sort !== "name") params.set("sort", f.sort);
    if (f.dir === "desc") params.set("dir", "desc");
    return `/setting-communities?${params.toString()}`;
  },
};
