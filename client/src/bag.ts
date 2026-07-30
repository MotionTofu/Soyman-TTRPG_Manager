import { useEffect, useState } from "react";
import type { SearchResult } from "./types";

// "Мешок" — a small cross-page holding pen in the sidebar. While reading any
// entity's own page, drop it into a bag slot with one click; later drag it
// out onto any SEARCH_DRAG_MIME drop target (session Локации/Противники,
// LinkDropZone, playlists, …) without re-searching for it. Persisted like
// pinned pages (localStorage) — a personal, disposable staging area, not
// campaign data, so it doesn't belong in the DB.
const ITEMS_KEY = "rpg-manager-bag-items";
const SIZE_KEY = "rpg-manager-bag-size";
const BAG_EVENT = "rpg-manager-bag-changed";

export const DEFAULT_BAG_SIZE = 16;
export const MIN_BAG_SIZE = 4;
export const MAX_BAG_SIZE = 64;

export function loadBagItems(): SearchResult[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ITEMS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBagItems(items: SearchResult[]) {
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(BAG_EVENT));
}

export function loadBagSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return Number.isFinite(n) && n >= MIN_BAG_SIZE ? n : DEFAULT_BAG_SIZE;
  } catch {
    return DEFAULT_BAG_SIZE;
  }
}

export function saveBagSize(size: number) {
  localStorage.setItem(SIZE_KEY, String(size));
  window.dispatchEvent(new Event(BAG_EVENT));
}

function itemKey(item: SearchResult): string {
  return `${item.type}:${item.id}`;
}

// Silently no-ops if the bag is full or the item's already in it — the
// caller (BagWidget) doesn't need to distinguish those cases, both just mean
// "nothing changed".
export function addToBag(item: SearchResult) {
  const items = loadBagItems();
  if (items.length >= loadBagSize()) return;
  if (items.some((i) => itemKey(i) === itemKey(item))) return;
  saveBagItems([...items, item]);
}

export function removeFromBag(index: number) {
  saveBagItems(loadBagItems().filter((_, i) => i !== index));
}

export function useBag() {
  const [items, setItems] = useState<SearchResult[]>(loadBagItems);
  const [size, setSize] = useState<number>(loadBagSize);

  useEffect(() => {
    const onChange = () => {
      setItems(loadBagItems());
      setSize(loadBagSize());
    };
    window.addEventListener(BAG_EVENT, onChange);
    return () => window.removeEventListener(BAG_EVENT, onChange);
  }, []);

  return { items, size };
}
