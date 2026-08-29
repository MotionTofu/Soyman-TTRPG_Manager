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
const BAG_TOAST_EVENT = "rpg-manager-bag-toast";

export const DEFAULT_BAG_SIZE = 16;
export const MIN_BAG_SIZE = 4;
export const MAX_BAG_SIZE = 64;

function isValidBagItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const r = item as Record<string, unknown>;
  if (typeof r.type !== "string" || typeof r.id !== "number" || !Number.isFinite(r.id)) return false;
  // allowlist — только реальные типы
  const allowed = ["campaign","setting","player","character","location","being","community","artifact","resource","adventure","scene","session","compendium_entry","setting_event"];
  if (!allowed.includes(r.type as string)) return false;
  if (typeof r.title !== "string" || r.title.length > 200 || /[<>]/.test(r.title)) return false;
  return true;
}

export function loadBagItems(): SearchResult[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ITEMS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidBagItem) as SearchResult[];
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

export type BagAddResult = "ok" | "invalid" | "full" | "duplicate";

function emitBagToast(message: string, kind: "info" | "error" = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BAG_TOAST_EVENT, { detail: { message, kind } }));
}

export function onBagToast(callback: (payload: { message: string; kind: "info" | "error" }) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent).detail);
  window.addEventListener(BAG_TOAST_EVENT, handler as EventListener);
  return () => window.removeEventListener(BAG_TOAST_EVENT, handler as EventListener);
}

// Возвращает причину отказа, чтобы UI мог показать тост вместо тишины.
export function addToBag(item: SearchResult): BagAddResult {
  if (!isValidBagItem(item)) {
    emitBagToast("Нельзя добавить — неверные данные", "error");
    return "invalid";
  }
  const items = loadBagItems();
  if (items.length >= loadBagSize()) {
    emitBagToast(`Мешок полон (${items.length}/${loadBagSize()})`, "error");
    return "full";
  }
  if (items.some((i) => itemKey(i) === itemKey(item))) {
    emitBagToast("Уже в мешке", "info");
    return "duplicate";
  }
  saveBagItems([...items, item]);
  emitBagToast(`В мешке: ${item.title}`, "info");
  return "ok";
}

export function removeFromBag(index: number) {
  saveBagItems(loadBagItems().filter((_, i) => i !== index));
}

// Убрать сразу несколько — после выгрузки мешка на страницу, где индексы
// сдвигались бы после каждого удаления.
export function removeItemsFromBag(items: SearchResult[]) {
  const keys = new Set(items.map(itemKey));
  saveBagItems(loadBagItems().filter((i) => !keys.has(itemKey(i))));
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
    // Мешок общий на все окна приложения: они смотрят в один localStorage, а
    // событие storage приходит как раз в *остальные* окна того же адреса. Так
    // сущность кладут в мешок в окне со списком и достают в окне локации —
    // перетащить напрямую между окнами Chromium не даёт.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === ITEMS_KEY || e.key === SIZE_KEY) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BAG_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { items, size };
}
