import { useEffect, useState } from "react";

// Ephemeral (session-only, never persisted) shared state for the live-session
// PreviewDock. Exists so SearchPanel's per-result "add" tap target — the
// touch-friendly alternative to dragging a result card into the dock, since
// HTML5 drag-and-drop doesn't fire from touch gestures — can push a card in
// from a different branch of the component tree without prop-drilling
// through AppShell. Resets on reload/navigating away from the pult, same as
// the drag-and-drop path always did.
export interface PreviewDockCard {
  type: string;
  id: number;
}

let cards: PreviewDockCard[] = [];
const EVENT = "preview-dock-cards-changed";

function notify() {
  window.dispatchEvent(new Event(EVENT));
}

export function addPreviewDockCard(card: PreviewDockCard) {
  if (!cards.some((c) => c.type === card.type && c.id === card.id)) {
    cards = [...cards, card];
    notify();
  }
}

export function removePreviewDockCard(type: string, id: number) {
  cards = cards.filter((c) => !(c.type === type && c.id === id));
  notify();
}

export function usePreviewDockCards(): PreviewDockCard[] {
  const [state, setState] = useState(cards);
  useEffect(() => {
    const handler = () => setState(cards);
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return state;
}
