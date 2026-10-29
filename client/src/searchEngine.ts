// «Найти в …» из меню ПКМ редактора (2026-10-29): поисковик выбирается в
// Настройках → Интерфейс, хранится в браузере, как прочие настройки вида.
// Главный поисковик самого браузера приложению недоступен — поэтому свой выбор.
import { hasElectronAPI } from "./electronApi";

export const SEARCH_ENGINES = [
  { id: "google", label: "Google", url: "https://www.google.com/search?q=" },
  { id: "yandex", label: "Яндекс", url: "https://yandex.ru/search/?text=" },
  { id: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
] as const;
export type SearchEngineId = (typeof SEARCH_ENGINES)[number]["id"];

const KEY = "rpgManagerSearchEngine";

export function loadSearchEngine() {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  return SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0];
}

export function saveSearchEngine(id: SearchEngineId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** Открыть поиск в браузере по умолчанию (в приложении — системном). */
export function searchWeb(text: string): void {
  const url = loadSearchEngine().url + encodeURIComponent(text.trim());
  if (hasElectronAPI()) window.electronAPI!.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
