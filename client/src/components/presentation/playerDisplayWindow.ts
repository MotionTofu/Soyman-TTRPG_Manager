import type { PlayerDisplayOpenResult } from "@shared/playerDisplay";
import { openOnScreen, saveLastScreenId, type ScreenChoice } from "./screens";

export const PLAYER_DISPLAY_ROUTE = "/player-display";
const WINDOW_NAME = "soyman-player-display";
const CONTROL_CHANNEL = "soyman-player-display-window";
let managed: Window | null = null;

export function isPlayerDisplayRoute(path: string): boolean {
  return /^\/player-display\/?$/.test(path) || /^\/sessions\/\d+\/live\/show\/?$/.test(path);
}

/** Opening is separate from publishing: a blocked popup must not change the players' frame. */
export async function openPlayerDisplayWindow(screen: ScreenChoice | null): Promise<PlayerDisplayOpenResult> {
  try {
    if (window.electronAPI?.openPlayerDisplay) {
      const result = await window.electronAPI.openPlayerDisplay(screen);
      if (result.ok && screen) saveLastScreenId(screen.id);
      return result.ok ? { ...result, screenId: screen?.id ?? null } : result;
    }
    // Empty URL obtains the named window without reloading an existing show.
    // A newly created window starts at about:blank, so wasOpen is measured, not guessed from a TTL.
    const win = managed && !managed.closed ? managed : openOnScreen("", WINDOW_NAME, screen);
    if (!win) return { ok: false, reason: "Браузер заблокировал окно игроков. Разрешите всплывающие окна." };
    const wasOpen = win.location.href !== "about:blank";
    let windowId = wasOpen ? new URL(win.location.href).searchParams.get("windowId") : null;
    if (!windowId) windowId = crypto.randomUUID();
    if (!wasOpen) win.location.replace(`${PLAYER_DISPLAY_ROUTE}?windowId=${encodeURIComponent(windowId)}`);
    else if (!new URL(win.location.href).searchParams.has("windowId")) {
      win.history.replaceState(null, "", `${win.location.pathname}?windowId=${encodeURIComponent(windowId)}`);
    }
    if (screen) {
      try { win.moveTo(screen.left, screen.top); win.resizeTo(screen.width, screen.height); } catch { /* browser policy */ }
    }
    managed = win;
    if (screen) saveLastScreenId(screen.id);
    win.focus();
    return { ok: true, wasOpen, openedByCall: !wasOpen, windowId, screenId: screen?.id ?? null };
  } catch {
    return { ok: false, reason: "Не удалось открыть окно игроков" };
  }
}

/** Runtime decides Q65; this guard cannot close an older or subsequently reopened window. */
export async function closePlayerDisplayWindow(opened: PlayerDisplayOpenResult): Promise<boolean> {
  if (!opened.ok || !opened.openedByCall) return false;
  if (window.electronAPI?.closePlayerDisplay) return window.electronAPI.closePlayerDisplay(opened.windowId);
  if (!managed || managed.closed) return requestClose(opened.windowId);
  if (new URL(managed.location.href).searchParams.get("windowId") !== opened.windowId) return false;
  managed.close(); managed = null; return true;
}

interface WindowMessage { type: "close" | "closing"; windowId: string; requestId: string }
function windowChannel(onMessage: (message: WindowMessage) => void) {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CONTROL_CHANNEL);
  const receive = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as WindowMessage;
    if ((msg.type === "close" || msg.type === "closing") && typeof msg.windowId === "string" && typeof msg.requestId === "string") onMessage(msg);
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== CONTROL_CHANNEL || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch { /* malformed unrelated storage */ }
  };
  if (channel) channel.onmessage = e => receive(e.data);
  else window.addEventListener("storage", storage);
  return {
    send: (msg: WindowMessage) => {
      if (channel) channel.postMessage(msg);
      else try { localStorage.setItem(CONTROL_CHANNEL, JSON.stringify(msg)); } catch { /* unavailable storage */ }
    },
    dispose: () => { channel?.close(); window.removeEventListener("storage", storage); },
  };
}
function requestClose(windowId: string): Promise<boolean> {
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const channel = windowChannel(msg => {
      if (msg.type === "closing" && msg.windowId === windowId && msg.requestId === requestId) finish(true);
    });
    const timer = window.setTimeout(() => finish(false), 500);
    const finish = (closed: boolean) => { clearTimeout(timer); channel.dispose(); resolve(closed); };
    channel.send({ type: "close", windowId, requestId });
  });
}
/** A recovered GM runtime can close its own script-opened window after the opener reloads. */
export function listenForPlayerWindowClose(): () => void {
  const windowId = new URL(window.location.href).searchParams.get("windowId");
  if (!windowId || window.electronAPI?.closePlayerDisplay) return () => {};
  const channel = windowChannel(msg => {
    if (msg.type !== "close" || msg.windowId !== windowId) return;
    channel.send({ ...msg, type: "closing" });
    window.close();
  });
  return channel.dispose;
}
