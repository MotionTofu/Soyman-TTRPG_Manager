import { addDays, parseDateKey, toLocalDateKey } from "./utils/date";

// Shared by any "nearest planned session" list (PlayersListPage, LibraryPage,
// ...) that highlights an upcoming date — same today/tomorrow/date-in-words
// formatting everywhere instead of each page re-deriving it.
export function formatNearestDate(dateStr: string): string {
  const d = parseDateKey(dateStr);
  const todayStr = toLocalDateKey();
  const tomorrowStr = addDays(todayStr, 1);
  if (dateStr === todayStr) return "сегодня";
  if (dateStr === tomorrowStr) return "завтра";
  return d.toLocaleDateString("ru", { day: "numeric", month: "long" });
}
