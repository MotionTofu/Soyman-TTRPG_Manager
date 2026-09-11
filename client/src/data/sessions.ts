import type { AttendanceRow } from "../types";
import type { Affect } from "./entities";

/**
 * Сессия и пульт в слое данных (docs/adr/0001, группа «пульт и сессии»).
 *
 * Пути чтения собраны здесь, чтобы страница сессии, пульт, вынесенная панель и
 * шпаргалки держали одно и то же под одним ключом кэша: связь, добавленная в
 * панель пульта, видна в шпаргалке без второго запроса.
 *
 * Раньше пульт тянул через полстраницы счётчик запусков сцен, чтобы панели
 * знали «перечитайтесь». Теперь запуск говорит, что он задел, и перечитывается
 * ровно это — в этом окне и во вынесенных.
 */

export const sessionPaths = {
  castUnion: (sessionId: number) => `/sessions/${sessionId}/cast-union`,
  summary: (sessionId: number) => `/sessions/${sessionId}/summary`,
  journal: (sessionId: number) => `/sessions/${sessionId}/journal`,
  stage: (sessionId: number) => `/sessions/${sessionId}/stage`,
  showState: (sessionId: number) => `/sessions/${sessionId}/show-state`,
  planned: (sessionId: number) => `/sessions/${sessionId}/planned`,
  preview: (sessionId: number, sceneId: number) => `/sessions/${sessionId}/preview/${sceneId}`,
  storyTree: (sessionId: number, wide: boolean) => `/sessions/${sessionId}/story-tree${wide ? "?scope=setting" : ""}`,
  campaignSessions: (campaignId: number) => `/campaigns/${campaignId}/sessions`,
  campaignSecrets: (campaignId: number) => `/story/campaign-secrets?campaign_id=${campaignId}`,
  campaignCharacters: (campaignId: number) => `/characters?campaign_id=${campaignId}`,
  campaignCover: (campaignId: number) => `/campaigns/${campaignId}/cover`,
  playlists: () => "/playlists",
};

/** Связи одной секции сущности (`/links`): панели пульта и сессии, шпаргалки, сцена. */
export function linksPath(entityType: string, entityId: number, section: string): string {
  return `${linksPrefix(entityType, entityId)}&section=${section}`;
}

function linksPrefix(entityType: string, entityId: number): string {
  return `/links?type=${entityType}&id=${entityId}`;
}

/** Напоминания цели: игрока, кампании или персонажа. */
export function remindersPath(targetType: "player" | "campaign" | "character", targetId: number): string {
  const base = targetType === "player" ? "/players" : targetType === "campaign" ? "/campaigns" : "/characters";
  return `${base}/${targetId}/reminders`;
}

/**
 * Тело `PUT /sessions/:id/attendance`. Прощённое уходит всегда: сервер пишет
 * строку игрока целиком, и поле, которого нет в теле, у него становится нулём.
 */
export function attendanceBody(rows: readonly AttendanceRow[]) {
  return rows.map((a) => ({
    player_id: a.player_id,
    attended: !!a.attended,
    amount_paid: a.amount_paid,
    amount_forgiven: a.amount_forgiven,
  }));
}

/**
 * Правка полей сессии: её карточка и всё под `/sessions/:id` (сцена, состав
 * вечера, лента, итог), плюс список сессий кампании — из него страница сессии
 * берёт соседей и номер, а полоса времени — прошлую дату.
 */
export function sessionAffects(sessionId: number, campaignId: number): Affect[] {
  return [{ kind: "session", id: sessionId }, { path: sessionPaths.campaignSessions(campaignId) }];
}

/**
 * Правка, от которой меняются деньги или статус: сверх полей сессии — карточка
 * кампании со всем, что под ней (заработанное, список сессий), и список
 * кампаний.
 */
export function sessionMoneyAffects(sessionId: number, campaignId: number): Affect[] {
  return [{ kind: "session", id: sessionId }, { kind: "campaign", id: campaignId }];
}

/**
 * Запуск сцены или правка набора вечера: сервер меняет сцену и экран сессии и
 * подменяет состав панелей, то есть связи сессии, — все секции разом.
 */
export function launchAffects(sessionId: number): Affect[] {
  return [{ kind: "session", id: sessionId }, { path: linksPrefix("session", sessionId) }];
}

/** Добавили или убрали связь в секции сущности: перечитываются все её секции. */
export function linkAffects(entityType: string, entityId: number): Affect[] {
  return [{ path: linksPrefix(entityType, entityId) }];
}

/**
 * Отметка тайны (раскрыта, важна): тайны кампании, а если отметка пишется в
 * сессию — ещё и её итог «Раскрылось в этот вечер».
 */
export function secretStateAffects(campaignId: number, sessionId?: number): Affect[] {
  const affects: Affect[] = [{ path: sessionPaths.campaignSecrets(campaignId) }];
  if (sessionId != null) affects.push({ path: sessionPaths.summary(sessionId) });
  return affects;
}
