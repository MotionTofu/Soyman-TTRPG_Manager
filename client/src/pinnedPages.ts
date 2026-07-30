import { useEffect, useState } from "react";

// Pinned pages are a view-only preference (localStorage), shared between the
// search panel and the nav widget — both read/write the same key and stay in
// sync via a same-tab custom event ("storage" only fires cross-tab).
export interface PinnedPage {
  path: string;
  label: string;
}

export const MAX_PINS = 7;
const PINS_KEY = "pinned-pages";
const PINS_EVENT = "pinned-pages-changed";

function loadPins(): PinnedPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PINS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function savePins(pins: PinnedPage[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  window.dispatchEvent(new Event(PINS_EVENT));
}

// Builds a pin label from the current page's <h1> plus its active tab (if
// any) — detail pages sync their active tab into ?tab= via useTabState, so
// e.g. pinning Население inside a setting reads "Вотердип — Население"
// instead of just "Вотердип".
export function buildPageLabel(pathname: string, search: string): string {
  const title = document.querySelector("h1")?.textContent?.trim() || pathname;
  const tab = new URLSearchParams(search).get("tab");
  return tab ? `${title} — ${tab}` : title;
}

export function usePinnedPages() {
  const [pins, setPins] = useState<PinnedPage[]>(loadPins);

  useEffect(() => {
    const onChange = () => setPins(loadPins());
    window.addEventListener(PINS_EVENT, onChange);
    return () => window.removeEventListener(PINS_EVENT, onChange);
  }, []);

  function pin(path: string, label: string) {
    const current = loadPins();
    if (current.length >= MAX_PINS || current.some((p) => p.path === path)) return;
    savePins([...current, { path, label }]);
  }

  function unpin(path: string) {
    savePins(loadPins().filter((p) => p.path !== path));
  }

  return { pins, pin, unpin };
}
