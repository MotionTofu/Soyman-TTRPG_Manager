import { useEffect, useState } from "react";
import { api } from "../api/client";
import { InworldCalendar, type InworldDatedItem } from "./InworldCalendar";
import type { ImportantDate, SettingCalendar } from "../types";

interface Props {
  settingId: number;
  items?: InworldDatedItem[];
  pinned?: { year: number; month: number } | null;
  onPin?: (pinned: { year: number; month: number } | null) => void;
  onDayContextMenu?: (year: number, month: number, day: number, x: number, y: number) => void;
  onItemContextMenu?: (item: InworldDatedItem, x: number, y: number) => void;
}

export function SettingCalendarEditor({
  settingId,
  items,
  pinned,
  onPin,
  onDayContextMenu,
  onItemContextMenu,
}: Props) {
  const [calendar, setCalendar] = useState<SettingCalendar | null>(null);
  const [importantDates, setImportantDates] = useState<ImportantDate[]>([]);

  useEffect(() => {
    api.get<SettingCalendar>(`/settings/${settingId}/calendar`).then(setCalendar);
    api.get<ImportantDate[]>(`/settings/${settingId}/important-dates`).then(setImportantDates);
  }, [settingId]);

  if (!calendar) return <p className="muted">Загрузка…</p>;

  return (
    <div className="card stack">
      <h3>Предпросмотр</h3>
      <InworldCalendar
        months={calendar.months}
        weekdays={calendar.weekdays}
        items={items ?? []}
        importantDates={importantDates}
        pinned={pinned}
        onPin={onPin}
        onDayContextMenu={onDayContextMenu}
        onItemContextMenu={onItemContextMenu}
      />
    </div>
  );
}
