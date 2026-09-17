import type { Affect } from "./entities";
import { sessionPaths } from "./sessions";

/**
 * Кампания в слое данных (docs/adr/0001, группа «кампании», часть 1: профиль
 * кампании у Мастера и список кампаний).
 *
 * Пути собраны здесь, чтобы профиль, пульт и страница сессии держали одно под
 * одним ключом: отметка тайны в профиле видна на пульте в соседнем окне без
 * перечитывания всего пульта. Раньше любая правка профиля шла мимо слоя, и
 * пульт в соседнем окне перечитывал всё — 17 запросов на одну галочку.
 */

export type EntryCategory = "notes" | "quotes" | "gm_notes" | "post_production" | "tasks";

export const campaignPaths = {
  list: () => "/campaigns",
  detail: (campaignId: number) => `/campaigns/${campaignId}`,
  sessions: sessionPaths.campaignSessions,
  debts: (campaignId: number) => `/campaigns/${campaignId}/debts`,
  calendarEvents: (campaignId: number) => `/campaigns/${campaignId}/calendar-events`,
  preproduction: (campaignId: number) => `/campaigns/${campaignId}/preproduction`,
  entries: (campaignId: number, category: EntryCategory) =>
    `/campaign-entries?campaign_id=${campaignId}&category=${category}`,
  tree: (campaignId: number) => `/story/campaign-tree?campaign_id=${campaignId}`,
  milestones: (campaignId: number) => `/story/campaign-milestones?campaign_id=${campaignId}`,
  secrets: sessionPaths.campaignSecrets,
  adventures: (campaignId: number) => `/story/campaign-adventures?campaign_id=${campaignId}`,
  availableAdventures: (campaignId: number) => `/story/campaign-adventures/available?campaign_id=${campaignId}`,
  groups: () => "/campaign-groups",
  groupsOf: (campaignId: number) => `/campaign-groups/by-campaign/${campaignId}`,
  groupMembers: (groupId: number) => `/campaign-groups/${groupId}/members`,
  players: () => "/players",
  systems: () => "/systems",
  settings: () => "/settings",
};

/**
 * Поля кампании («Основное», изображения, закреплённый месяц): карточка и
 * списки кампаний, без сессий и хроники. Долги зависят от ставки и оплаты.
 */
export function campaignFieldsAffects(campaignId: number): Affect[] {
  return [{ kind: "campaign", id: campaignId, card: true }, { path: campaignPaths.debts(campaignId) }];
}

/** Событие хроники мира кампании: список событий и сама карточка события. */
export function campaignEventAffects(campaignId: number, eventId?: number): Affect[] {
  const affects: Affect[] = [{ path: campaignPaths.calendarEvents(campaignId) }];
  if (eventId != null) affects.push({ path: `/campaigns/calendar-events/${eventId}` });
  return affects;
}

/** Записи кампании (заметки, цитаты, задачи, пост-продакшен) — все категории. */
export function campaignEntryAffects(campaignId: number): Affect[] {
  return [{ path: `/campaign-entries?campaign_id=${campaignId}` }];
}

/**
 * Отметка «сыграна» у сцены: дерево кампании, страницы сцены и приключения,
 * дерево и план вечера на пульте (зависимость вида в entities.ts) и холст.
 */
export function sceneStatusAffects(campaignId: number, sceneId: number): Affect[] {
  return [{ path: campaignPaths.tree(campaignId) }, { kind: "scene", id: sceneId }, { kind: "adventure" }];
}

/** Вехи кампании: отметка, своя веха, удаление. Их показывают и страницы приключения и сцены. */
export function milestoneAffects(campaignId: number): Affect[] {
  return [{ path: campaignPaths.milestones(campaignId) }, { kind: "adventure" }, { kind: "scene" }];
}

/**
 * Тайны кампании: отметка «раскрыто», своя запись, удаление. Список тайн
 * читает и пульт — под тем же ключом, поэтому перечитывается только он.
 */
export function secretAffects(campaignId: number): Affect[] {
  return [{ path: campaignPaths.secrets(campaignId) }, { kind: "adventure" }, { kind: "scene" }];
}

/**
 * Приключение привязали к кампании или убрали: меняется весь её сюжет — дерево,
 * вехи, тайны, приключения и доступные к привязке — и карточка кампании (холст
 * держит её приключения через зависимость вида).
 */
export function campaignAdventureAffects(campaignId: number): Affect[] {
  return [
    { path: campaignPaths.tree(campaignId) },
    { path: campaignPaths.milestones(campaignId) },
    { path: campaignPaths.secrets(campaignId) },
    { path: campaignPaths.adventures(campaignId) },
    { path: campaignPaths.availableAdventures(campaignId) },
    { kind: "adventure" },
    { kind: "campaign", id: campaignId, card: true },
    { path: "/canvas" },
  ];
}

/** Тексты приключения в кампании (версия кампании или возврат к сеттингу). */
export function campaignArcAffects(campaignId: number, arcId: number): Affect[] {
  return [{ path: campaignPaths.adventures(campaignId) }, { kind: "adventure", id: arcId }, { path: "/canvas" }];
}

/** Членство кампании в группах: её отметки, составы групп и счётчики списка. */
export function campaignGroupAffects(): Affect[] {
  return [{ path: campaignPaths.groups() }];
}
