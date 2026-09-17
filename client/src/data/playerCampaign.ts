import type { Affect } from "./entities";

/**
 * Кампания глазами игрока в слое данных (docs/adr/0001, группа «кампании»,
 * часть 3). Всё под `/player/campaigns/:id` — сервер сам фильтрует выданное,
 * поэтому сигнал «кампания изменилась» (data/syncAffects.ts) перечитывает
 * этот префикс целиком: что именно изменилось, игроку знать не нужно.
 */
export const playerCampaignPaths = {
  visible: (campaignId: number) => `/player/campaigns/${campaignId}/visible`,
  sections: (campaignId: number) => `/player/campaigns/${campaignId}/player-sections`,
  setting: (campaignId: number) => `/player/campaigns/${campaignId}/setting-player-content`,
  party: (campaignId: number) => `/player/campaigns/${campaignId}/party`,
  myCharacters: (campaignId: number) => `/player/campaigns/${campaignId}/my-characters`,
  worldEntries: (campaignId: number) => `/player/campaigns/${campaignId}/world-entries`,
};

/**
 * Запись в дневник кампании: сам дневник игрока и путевые заметки у Мастера
 * (в соседнем окне этой машины; до другой машины их доносит сигнал сервера).
 */
export function journalAffects(campaignId: number): Affect[] {
  return [{ path: playerCampaignPaths.worldEntries(campaignId) }, { path: `/campaigns/${campaignId}/player-journals` }];
}
