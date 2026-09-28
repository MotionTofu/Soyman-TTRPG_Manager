import type { SideModuleId } from "./SideModules";

// Раскладка модулей правой панели: свёрнутые и высоты от ползунков.
// Живёт в браузере Мастера — это удобство одного места, не данные.
export interface SideLayout {
  collapsed: SideModuleId[];
  heights: Partial<Record<SideModuleId, number>>;
}

const KEY = "rpgManagerSidePanel";

export function loadSideLayout(): SideLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SideLayout> | null;
    return {
      collapsed: Array.isArray(raw?.collapsed) ? raw.collapsed : [],
      heights: raw?.heights && typeof raw.heights === "object" ? raw.heights : {},
    };
  } catch {
    return { collapsed: [], heights: {} };
  }
}

export function saveSideLayout(layout: SideLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* приватный режим — раскладка просто не переживёт перезагрузку */
  }
}
