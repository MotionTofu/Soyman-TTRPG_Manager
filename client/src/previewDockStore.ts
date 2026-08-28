import { useEffect, useState } from "react";

// Состав докстанции пульта (PreviewDock). Живёт в localStorage: Мастер
// набирает в док участников боя один раз и ждёт их там же после перезагрузки —
// раньше состав был эфемерным и пропадал при любом обновлении страницы, то
// есть набирать приходилось заново посреди сессии.
//
// Здесь же — общее состояние для SearchPanel: её кнопка «+» на результате
// (тач-замена перетаскиванию, у которого нет touch-события) толкает карточку в
// док из другой ветки дерева, без прокидывания пропсов через AppShell.
export interface PreviewDockCard {
  type: string;
  id: number;
}

const KEY = "rpgManagerPreviewDock";
const EVENT = "preview-dock-cards-changed";

function read(): PreviewDockCard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is PreviewDockCard =>
        !!c && typeof c.type === "string" && typeof c.id === "number"
    );
  } catch {
    return [];
  }
}

let cards: PreviewDockCard[] = read();

function commit(next: PreviewDockCard[]) {
  cards = next;
  try {
    if (next.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* приватный режим или переполненное хранилище — док просто не переживёт
       перезагрузку, работать он от этого не перестаёт */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addPreviewDockCard(card: PreviewDockCard) {
  if (!cards.some((c) => c.type === card.type && c.id === card.id)) {
    commit([...cards, card]);
  }
}

export function removePreviewDockCard(type: string, id: number) {
  commit(cards.filter((c) => !(c.type === type && c.id === id)));
}

export function usePreviewDockCards(): PreviewDockCard[] {
  const [state, setState] = useState(cards);
  useEffect(() => {
    const handler = () => setState(cards);
    const storageHandler = () => {
      // Второе окно приложения (попаут пульта) правит тот же ключ.
      cards = read();
      setState(cards);
    };
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  return state;
}
