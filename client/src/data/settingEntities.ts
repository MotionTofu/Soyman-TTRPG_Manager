import { listPath, type Affect, type EntityKind } from "./entities";

/**
 * Сущности сеттинга в слое данных (docs/adr/0001, группа «сущности сеттинга»).
 *
 * Карточки Локации, Существа, Артефакта, Общины, События, Монстра, Транспорта,
 * Сцены и Приключения и общие вкладки, которые они делят («Связи», «Галерея»,
 * «Главы», «Изображения»), читают по путям отсюда. Один путь — один ключ кэша:
 * список существ сеттинга, открытый в «Связях», и тот же список для соседей
 * «← →» в шапке Существа — один запрос на двоих.
 */

export const settingPaths = {
  /** Отношения сущности: исходящие и входящие. */
  relations: (entityType: string, entityId: number) => `/entity-relations?entity_type=${entityType}&entity_id=${entityId}`,
  /** Список вида в сеттинге — тем же путём, что строит `listPath`. */
  inSetting: (kind: EntityKind, settingId: number) => listPath(kind, { setting_id: settingId }),
  gallery: (ownerType: string, ownerId: number) => `/gallery?owner_type=${ownerType}&owner_id=${ownerId}`,
  campaigns: () => "/campaigns",
};

export const locationPaths = {
  /** Карточка локации вместе с обитателями вложенных зон и точек. */
  detail: (locationId: number) => `/setting-locations/${locationId}?nested=1`,
  /** Точки плана с наполнением и счётчиками — одним запросом. */
  plan: (locationId: number) => `/setting-locations/${locationId}/plan`,
  /** Все локации сеттинга вместе с архивными. */
  allInSetting: (settingId: number) => `/setting-locations?setting_id=${settingId}&archived=include`,
};

/**
 * Связь добавили, поправили или убрали. Она видна с обеих сторон, а у второй
 * стороны может быть открыта своя вкладка «Связи» — поэтому задеты отношения
 * всех сущностей, а не только этой. Перечитываются из них только видимые.
 */
export function relationAffects(): Affect[] {
  return [{ path: "/entity-relations" }];
}

/** Правка существа: его карточка, подресурсы и списки существ. */
export function beingAffects(beingId: number): Affect[] {
  return [{ kind: "being", id: beingId }];
}

/** Галерея владельца: сами изображения и карточка владельца (обложка). */
export function galleryAffects(ownerType: string, ownerId: number): Affect[] {
  return [{ path: `/gallery?owner_type=${ownerType}&owner_id=${ownerId}` }];
}
