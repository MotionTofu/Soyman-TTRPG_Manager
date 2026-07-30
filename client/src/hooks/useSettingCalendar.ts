import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { SettingCalendar } from "../types";

export function useSettingCalendar(settingId: number | null | undefined) {
  const [calendar, setCalendar] = useState<SettingCalendar | null>(null);
  useEffect(() => {
    if (!settingId) {
      setCalendar(null);
      return;
    }
    api.get<SettingCalendar>(`/settings/${settingId}/calendar`).then(setCalendar);
  }, [settingId]);
  return calendar;
}
