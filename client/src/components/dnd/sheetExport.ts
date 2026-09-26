import { readOnce } from "../../data/imperative";

// Скачивание листа D&D в форматах OneShot (гриллинг 2026-09-26, Q13/Q14):
// сервер собирает данные со срезом справочника, оболочку автономного листа
// даёт сборка OneShot (standalone-template.html кладётся в public при сборке
// клиента — npm run build:standalone в корне).

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function fileBase(name: string) {
  return (name.trim() || "персонаж").replace(/[\\/:*?"<>|]+/g, "_");
}

// Тяжёлые ответы: весь справочник системы в копии, картинки в HTML.
const EXPORT_TIMEOUT = 120000;

export async function downloadSheetHtml(statblockId: number, name: string) {
  const [payload, response] = await Promise.all([
    readOnce<unknown>(`/statblocks/${statblockId}/portable`, { timeoutMs: EXPORT_TIMEOUT }),
    fetch("/standalone-template.html"),
  ]);
  if (!response.ok) throw new Error("Не удалось загрузить оболочку автономного листа.");
  const template = await response.text();
  if (!template.includes("__ONESHOT_PAYLOAD__")) throw new Error("Повреждена оболочка автономного листа.");
  // Как renderPortable в OneShot: «<» экранирован, чтобы данные не закрыли <script>.
  const html = template.replace("__ONESHOT_PAYLOAD__", () => JSON.stringify(payload).replaceAll("<", "\\u003c"));
  save(new Blob([html], { type: "text/html" }), `${fileBase(name)}.html`);
}

export async function downloadSheetBackup(statblockId: number, name: string, largeCards: boolean) {
  const backup = await readOnce<unknown>(`/statblocks/${statblockId}/portable?kind=backup&large=${largeCards ? 1 : 0}`, {
    timeoutMs: EXPORT_TIMEOUT,
  });
  save(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `oneshot-${fileBase(name)}.json`);
}

const LARGE_KEY = "sheet-backup-large-cards";
export function loadLargeCards(): boolean {
  try {
    return localStorage.getItem(LARGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function saveLargeCards(v: boolean) {
  try {
    localStorage.setItem(LARGE_KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
}
