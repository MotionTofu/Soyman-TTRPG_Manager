import type { SideModuleId } from "./SideModules";

// Раскладка модулей правой панели: свёрнутые и высоты от ползунков.
// Живёт в браузере Мастера — это удобство одного места, не данные.
export interface SideLayout {
  collapsed: SideModuleId[];
  heights: Partial<Record<SideModuleId, number>>;
  /** Узкая панель — значки вместо модулей (гриллинг 2026-10-23, Q12). */
  narrow?: boolean;
}

const KEY = "rpgManagerSidePanel";

/** Хоткей оболочки → правая панель: detail true/false — свернуть/развернуть, без detail — переключить. */
export const SIDE_NARROW_EVENT = "side-panel-narrow";

export function loadSideLayout(): SideLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SideLayout> | null;
    return {
      collapsed: Array.isArray(raw?.collapsed) ? raw.collapsed : [],
      heights: raw?.heights && typeof raw.heights === "object" ? raw.heights : {},
      narrow: raw?.narrow === true,
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
