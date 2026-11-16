import { useEffect, useState, useSyncExternalStore } from "react";
import { dataKeys } from "./data/entities";
import { queryClient } from "./data/queryClient";
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

export type BagItem = SearchResult & {
  pdfQuote?: { page: number; text: string };
  rule?: { storageId: string; pinned?: boolean };
};

const STORAGES_KEY = dataKeys.resource("/storages");

function activeStorageId() {
  return queryClient.getQueryData<{ activeId: string }>(STORAGES_KEY)?.activeId;
}

function subscribeToActiveStorage(onChange: () => void) {
  return queryClient.getQueryCache().subscribe(({ query }) => {
    if (query.queryKey[0] === STORAGES_KEY[0] && query.queryKey[1] === STORAGES_KEY[1]) onChange();
  });
}

export function useBagStorageId() {
  return useSyncExternalStore(subscribeToActiveStorage, activeStorageId);
}

const BAG_ITEM_TYPES = new Set([
  "campaign", "setting", "player", "character", "location", "being", "community", "artifact",
  "resource", "adventure", "scene", "session", "compendium_entry", "setting_event",
]);

export function isBagItemType(type: string): boolean {
  return BAG_ITEM_TYPES.has(type);
}

function isValidBagItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const r = item as Record<string, unknown>;
  if (typeof r.type !== "string" || typeof r.id !== "number" || !Number.isFinite(r.id)) return false;
  if (!isBagItemType(r.type)) return false;
  if (typeof r.title !== "string" || r.title.length > 200 || /[<>]/.test(r.title)) return false;
  if (r.rule !== undefined) {
    if (r.type !== "compendium_entry" || !r.rule || typeof r.rule !== "object") return false;
    const { storageId, pinned } = r.rule as Record<string, unknown>;
    return Number.isSafeInteger(r.id) && r.id > 0 && typeof storageId === "string" && storageId.length > 0
      && (pinned === undefined || typeof pinned === "boolean") && r.pdfQuote === undefined;
  }
  if (r.pdfQuote !== undefined) {
    if (r.type !== "resource" || !r.pdfQuote || typeof r.pdfQuote !== "object") return false;
    const { page, text } = r.pdfQuote as Record<string, unknown>;
    return typeof page === "number" && Number.isSafeInteger(page) && page > 0
      && typeof text === "string" && text.length > 0 && text.length <= 10_000;
  }
  return true;
}

function readBagItems(): BagItem[] {
  try {
    const stored = localStorage.getItem(ITEMS_KEY) || "[]";
    const raw = JSON.parse(stored, (key, value: unknown) =>
      key === "__proto__" || key === "constructor" ? undefined : value);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidBagItem) as BagItem[];
  } catch {
    try { localStorage.removeItem(ITEMS_KEY); } catch {}
    return [];
  }
}

function visibleInStorage(item: BagItem, storageId: string | undefined) {
  return !item.rule || item.rule.storageId === storageId;
}

function saveBagItems(items: BagItem[]) {
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

export function bagItemKey(item: BagItem): string {
  return item.pdfQuote
    ? JSON.stringify([item.type, item.id, item.pdfQuote.page, item.pdfQuote.text])
    : JSON.stringify([item.type, item.id, item.rule?.storageId ?? null]);
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
export function addToBag(item: BagItem): BagAddResult {
  if (!isValidBagItem(item)) {
    emitBagToast("Нельзя добавить — неверные данные", "error");
    return "invalid";
  }
  const storageId = activeStorageId();
  if (item.rule && item.rule.storageId !== storageId) return "invalid";
  if (!item.rule && item.type === "compendium_entry" && item.kind === "mechanic_item" && storageId) {
    item = { ...item, rule: { storageId } };
  }
  const stored = readBagItems();
  const items = stored.filter((entry) => visibleInStorage(entry, storageId));
  if (items.some((entry) => bagItemKey(entry) === bagItemKey(item)
    || (!item.rule && !item.pdfQuote && entry.rule && entry.type === item.type && entry.id === item.id))) {
    emitBagToast("Уже в мешке", "info");
    return "duplicate";
  }
  // Явное добавление из текущего справочника даёт происхождение старой записи.
  const legacy = item.rule && stored.find((entry) => !entry.rule && entry.type === item.type
    && entry.id === item.id && entry.title === item.title
    && (entry.system_id == null || item.system_id == null || entry.system_id === item.system_id)
    && (entry.section_id == null || item.section_id == null || entry.section_id === item.section_id));
  const size = loadBagSize();
  if (!legacy && items.length >= size) {
    emitBagToast(`Мешок полон (${items.length}/${size})`, "error");
    return "full";
  }
  saveBagItems(legacy ? stored.map((entry) => entry === legacy ? item : entry) : [...stored, item]);
  emitBagToast(`В мешке: ${item.title}`, "info");
  return "ok";
}

export function setBagRulePinned(item: BagItem, pinned: boolean): boolean {
  const storageId = activeStorageId();
  if (!storageId || item.type !== "compendium_entry" || !visibleInStorage(item, storageId)) return false;
  const stored = readBagItems();
  const key = bagItemKey(item);
  const current = stored.find((entry) => bagItemKey(entry) === key);
  if (!current) return false;
  if (!current.rule && pinned && stored.some((entry) => entry.rule?.storageId === storageId
    && entry.type === current.type && entry.id === current.id)) return false;
  saveBagItems(stored.map((entry) => entry === current ? { ...entry, rule: { storageId, pinned } } : entry));
  return true;
}

export function removeFromBag(item: BagItem) {
  const key = bagItemKey(item);
  saveBagItems(readBagItems().filter((entry) => bagItemKey(entry) !== key));
}

// Запись могли закрепить в другом окне, пока выполнялась выгрузка.
export function removeItemsFromBag(items: BagItem[]) {
  const keys = new Set(items.map(bagItemKey));
  saveBagItems(readBagItems().filter((item) => item.rule?.pinned || !keys.has(bagItemKey(item))));
}

export function useBag() {
  const [items, setItems] = useState<BagItem[]>(readBagItems);
  const [size, setSize] = useState<number>(loadBagSize);
  const storageId = useBagStorageId();

  useEffect(() => {
    const onChange = () => {
      setItems(readBagItems());
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

  return { items: items.filter((item) => visibleInStorage(item, storageId)), size, storageId };
}
