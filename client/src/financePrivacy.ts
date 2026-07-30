// Global "hide commercial info" toggle (Внешний вид settings) — purely a
// display preference, same localStorage-backed pattern as thumbnailStyles.ts/
// loadRadiusOverride. Hides earned totals, rates and payment-type labels
// across the app (useful when screen-sharing/streaming) without touching any
// underlying data — the numbers are still there, just not rendered.
const KEY = "rpgManagerHideFinance";

export function loadHideFinance(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHideFinance(hide: boolean): void {
  try {
    if (hide) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
