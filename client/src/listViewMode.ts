// Per-list display density, persisted per page (localStorage key includes
// the page's own identifier) so switching to "Таблица" on Кампании doesn't
// affect Сеттинги. Read synchronously at each page's own useState initializer
// — same convention as thumbnailStyles.ts/financePrivacy.ts, no cross-tab
// reactivity needed since it's just a personal display preference.
export type ListViewMode = "list" | "table" | "grid";

export function loadListViewMode(key: string): ListViewMode {
  try {
    const v = localStorage.getItem(`listViewMode:${key}`);
    return v === "list" || v === "table" || v === "grid" ? v : "grid";
  } catch {
    return "grid";
  }
}

export function saveListViewMode(key: string, mode: ListViewMode) {
  try {
    localStorage.setItem(`listViewMode:${key}`, mode);
  } catch {
    /* ignore */
  }
}
