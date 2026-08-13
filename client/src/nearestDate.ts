// Shared by any "nearest planned session" list (PlayersListPage, LibraryPage,
// ...) that highlights an upcoming date — same today/tomorrow/date-in-words
// formatting everywhere instead of each page re-deriving it.
export function formatNearestDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === todayStr) return "сегодня";
  if (dateStr === tomorrowStr) return "завтра";
  return d.toLocaleDateString("ru", { day: "numeric", month: "long" });
}
