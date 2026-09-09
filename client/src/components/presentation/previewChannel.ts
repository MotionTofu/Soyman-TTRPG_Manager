import type { PresentationLayer } from "../../types";

// Предпросмотр черновика представления в отдельном окне (второй монитор):
// редактор кладёт полезную нагрузку в localStorage (окно может открыться
// позже подписки) и дублирует BroadcastChannel'ом (окно уже открыто).
// Окна одной машины — один origin, localStorage и канал общие.

export interface PreviewPayload {
  background_url: string | null;
  layers: PresentationLayer[];
  visibleIds: number[];
  fadeMs: number;
  transition: string;
  transitionMs: number;
  title: string;
  titleSecs: number;
  playKey: number;
}

const STORAGE_KEY = "presentation-preview-last";
const CHANNEL_NAME = "presentation-preview";

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function postPreview(payload: PreviewPayload): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* приватный режим — останется только канал */
  }
  getChannel()?.postMessage(payload);
}

export function readLastPreview(): PreviewPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreviewPayload;
    if (!parsed || typeof parsed.playKey !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function onPreview(callback: (payload: PreviewPayload) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data.playKey === "number") callback(e.data as PreviewPayload);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
