export function toLocalDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  if (m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return new Date(NaN);
  return dt;
}

const ruDayMonth = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

export function formatDateKeyRu(key: string): string {
  const d = parseDateKey(key);
  if (Number.isNaN(d.getTime())) return key;
  return ruDayMonth.format(d);
}

export function addDays(key: string, delta: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + delta);
  return toLocalDateKey(d);
}
