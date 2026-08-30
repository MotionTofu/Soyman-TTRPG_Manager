import { useEffect, useState } from "react";

// Display prefs for the floating navigation widget — independent of the app
// theme (a layout/display preference, persisted the same way as
// thumbnail styles/theme id: localStorage only). The widget itself stays
// mounted for the whole SPA session (in AppShell), while the settings page
// that edits these prefs is a separate mounted tree — so writes notify a
// same-tab custom event ("storage" only fires cross-tab) to keep both in sync.
export type NavWidgetPosition = "left" | "top" | "bottom" | "right";

export interface NavWidgetPrefs {
  position: NavWidgetPosition;
  showLabels: boolean;
}

// Единственный вид — сверху по центру без подсказок
const DEFAULTS: NavWidgetPrefs = { position: "top", showLabels: false };
const STORAGE_KEY = "rpgManagerNavWidget";
const CHANGE_EVENT = "nav-widget-prefs-changed";

export function loadNavWidgetPrefs(): NavWidgetPrefs {
  return { ...DEFAULTS };
}

export function saveNavWidgetPrefs(prefs: NavWidgetPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function useNavWidgetPrefs() {
  const [prefs, setPrefs] = useState<NavWidgetPrefs>(loadNavWidgetPrefs);

  useEffect(() => {
    const onChange = () => setPrefs(loadNavWidgetPrefs());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  function update(patch: Partial<NavWidgetPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveNavWidgetPrefs(next);
  }

  return { prefs, update };
}
