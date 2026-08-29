export function toLocalDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const ruDayMonth = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

export function formatDateKeyRu(key: string): string {
  return ruDayMonth.format(parseDateKey(key));
}

export function addDays(key: string, delta: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + delta);
  return toLocalDateKey(d);
}
