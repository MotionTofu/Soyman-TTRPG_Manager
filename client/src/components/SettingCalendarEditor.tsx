import { useResource } from "../data/hooks";
import { chroniclePaths } from "../data/settingPage";
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

const NO_DATES: ImportantDate[] = [];

export function SettingCalendarEditor({
  settingId,
  items,
  pinned,
  onPin,
  onDayContextMenu,
  onItemContextMenu,
}: Props) {
  // Те же пути, что у оси и вкладок хроники: правка месяцев или дат видна
  // в предпросмотре сразу.
  const calendar = useResource<SettingCalendar>(chroniclePaths.calendar(settingId)).data;
  const importantDates = useResource<ImportantDate[]>(chroniclePaths.importantDates(settingId)).data ?? NO_DATES;

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
