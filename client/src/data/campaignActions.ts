import { groupThemeAffects } from "./campaigns";
import { write } from "./hooks";
import { afterWriteAnywhere } from "./imperative";
import { attemptWithNotice } from "./notices";

/**
 * Записи кампании вне компонента. Отдельно от data/campaigns.ts: там только
 * пути и правила «что задето», которые проверяются тестами без браузера, а
 * запись тянет транспорт с его `localStorage`.
 */

/** Применить Тему Содружества к кампании: плашка при отказе, задетое — после успеха. */
export function applyGroupThemeToCampaign(campaignId: number, theme: unknown): Promise<boolean> {
  return attemptWithNotice("Тема Содружества не применилась", async () => {
    await write.post(`/campaigns/${campaignId}/group-theme/apply`, { theme });
    afterWriteAnywhere(groupThemeAffects(campaignId));
  });
}
