import { safeGetItem, safeSetItem } from "./utils/safeStorage";

// Наборы курсоров (мировоззрения ДнД). Выбор хранится локально
// (личное оформление, как рубашка карт) и применяется мгновенно:
// на body ставится data-cursor-set, а правила из cursorSets.css
// подменяют стрелку, руку, часы, помощь и меч на герое Главной.
//
// Указатель «рука» в приложении задан сотнями классовых правил
// (cursor: pointer на обычных div) плюс десятками инлайн style={{cursor}},
// перечислить их селекторами невозможно — поэтому модуль помечает элементы
// по ВЫЧИСЛЕННОМУ курсору атрибутом data-cc, а CSS бьёт по нему с
// !important (иначе инлайн всегда выигрывает у stylesheet). Скоуп узкий:
// data-cc, форм-контролы, :disabled и инлайн-default — остальное не трогаем.
// перемещения (включая grab/grabbing перетаскивания), кубик-единица
// (not-allowed и :disabled — критпровал), текстовая каретка и ресайзы
// (se едет на спрайте 14-nwse — та же диагональ SE↔NW). Исключение:
// ручка canvas с se-resize !important остаётся системной — её бьёт
// только !important, которым не разбрасываемся.
export const CURSOR_SET_SYSTEM = "system" as const;

const SET_FOLDERS = [
  "lawfull-good",
  "neutral-good",
  "chaotic-good",
  "lawfull-neutral",
  "true-neutral",
  "chaotic-neutral",
  "lawfull-evil",
  "neutral-evil",
  "chaotic-evil",
] as const;

export type CursorSetFolder = (typeof SET_FOLDERS)[number];
export type CursorSetId = typeof CURSOR_SET_SYSTEM | CursorSetFolder;

export interface CursorSetInfo {
  id: CursorSetId;
  /** Русское название мировоззрения для кнопок. */
  label: string;
  /** Папка набора в res/Cursors и префикс файлов в /cursors. null — системный. */
  folder: CursorSetFolder | null;
  /** Превью для кнопки (стрелка набора). null — системный. */
  preview: string | null;
}

export const CURSOR_SETS: readonly CursorSetInfo[] = [
  { id: CURSOR_SET_SYSTEM, label: "Стандартный (системный)", folder: null, preview: null },
  { id: "lawfull-good", label: "Законно-добрый", folder: "lawfull-good", preview: "/cursors/lawfull-good-01-arrow.png" },
  { id: "neutral-good", label: "Нейтрально-добрый", folder: "neutral-good", preview: "/cursors/neutral-good-01-arrow.png" },
  { id: "chaotic-good", label: "Хаотично-добрый", folder: "chaotic-good", preview: "/cursors/chaotic-good-01-arrow.png" },
  { id: "lawfull-neutral", label: "Законно-нейтральный", folder: "lawfull-neutral", preview: "/cursors/lawfull-neutral-01-arrow.png" },
  { id: "true-neutral", label: "Истинно нейтральный", folder: "true-neutral", preview: "/cursors/true-neutral-01-arrow.png" },
  { id: "chaotic-neutral", label: "Хаотично-нейтральный", folder: "chaotic-neutral", preview: "/cursors/chaotic-neutral-01-arrow.png" },
  { id: "lawfull-evil", label: "Законно-злой", folder: "lawfull-evil", preview: "/cursors/lawfull-evil-01-arrow.png" },
  { id: "neutral-evil", label: "Нейтрально-злой", folder: "neutral-evil", preview: "/cursors/neutral-evil-01-arrow.png" },
  { id: "chaotic-evil", label: "Хаотично-злой", folder: "chaotic-evil", preview: "/cursors/chaotic-evil-01-arrow.png" },
];

export function isCursorSetId(v: unknown): v is CursorSetId {
  return v === CURSOR_SET_SYSTEM || (SET_FOLDERS as readonly string[]).includes(v as string);
}

const STORAGE_KEY = "cursorSet";

export function loadCursorSet(): CursorSetId {
  const v = safeGetItem(STORAGE_KEY);
  return isCursorSetId(v) ? v : CURSOR_SET_SYSTEM;
}

const BODY_ATTR = "data-cursor-set";
const TAG_ATTR = "data-cc";

type CursorTag = "hand" | "wait" | "help" | "move" | "d1" | "text" | "ew" | "ns" | "nesw" | "nwse" | "se";

function tagFor(computed: string): CursorTag | null {
  // getComputedStyle возвращает первое ключевое слово; url()-курсоры
  // (меч на герое) возвращают "url(...), ..." — их не трогаем, герой
  // перекрашивается отдельным правилом в cursorSets.css.
  const first = computed.split(",")[0].trim();
  if (first === "pointer") return "hand";
  if (first === "wait") return "wait";
  if (first === "help") return "help";
  if (first === "move") return "move";
  if (first === "grab" || first === "grabbing") return "move";
  if (first === "not-allowed") return "d1";
  if (first === "text") return "text";
  if (first === "ew-resize") return "ew";
  if (first === "ns-resize") return "ns";
  if (first === "nesw-resize") return "nesw";
  if (first === "nwse-resize") return "nwse";
  if (first === "se-resize") return "se";
  return null;
}

function tagElement(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  if (el.hasAttribute(TAG_ATTR)) return;
  const tag = tagFor(getComputedStyle(el).cursor);
  if (tag) el.setAttribute(TAG_ATTR, tag);
}

function tagSubtree(root: ParentNode): void {
  if (root instanceof HTMLElement) tagElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    tagElement(node as Element);
    node = walker.nextNode();
  }
}

function untagAll(): void {
  for (const el of document.querySelectorAll(`[${TAG_ATTR}]`)) {
    el.removeAttribute(TAG_ATTR);
  }
}

let observer: MutationObserver | null = null;
let debounceTimer: number | null = null;

function stopObserver(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  observer?.disconnect();
  observer = null;
}

function startObserver(): void {
  if (observer) return;
  let pending: Element[] = [];
  const flush = () => {
    debounceTimer = null;
    const batch = pending;
    pending = [];
    for (const el of batch) {
      if (el.isConnected) tagSubtree(el);
    }
  };
  observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof Element) pending.push(n);
      }
    }
    if (debounceTimer === null) debounceTimer = window.setTimeout(flush, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Применить набор: сохранить, выставить атрибут, перетегировать DOM. */
export function applyCursorSet(id: CursorSetId): void {
  if (typeof document === "undefined") return;
  safeSetItem(STORAGE_KEY, id);
  document.body.removeAttribute(BODY_ATTR);
  untagAll();
  stopObserver();
  if (id === CURSOR_SET_SYSTEM) return;
  document.body.setAttribute(BODY_ATTR, id);
  tagSubtree(document.body);
  startObserver();
}
