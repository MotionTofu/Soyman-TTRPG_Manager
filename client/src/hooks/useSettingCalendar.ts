import { useResource } from "../data/hooks";
import type { SettingCalendar } from "../types";

// Календарь сеттинга — из кэша слоя данных (docs/adr/0001): профиль сессии и
// полоса времени пульта берут его одним запросом на двоих.
export function useSettingCalendar(settingId: number | null | undefined) {
  return useResource<SettingCalendar>(settingId ? `/settings/${settingId}/calendar` : null).data ?? null;
}
