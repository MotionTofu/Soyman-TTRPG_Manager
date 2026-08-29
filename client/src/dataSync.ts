import { useEffect, useState } from "react";

// Окна приложения смотрят в один сервер и одну базу, но каждое держит свою
// копию уже загруженных данных: добавил жителя в локацию в одном окне — второе
// окно с той же локацией об этом не знает. Поэтому каждая правка объявляется
// остальным окнам, а те обновляют страницу, когда в них возвращаются.
//
// BroadcastChannel не доставляет сообщение отправителю — окно, сделавшее
// правку, свой же пинг не увидит и лишний раз не перезагрузится. Там, где его
// нет, роль канала играет запись в localStorage: событие storage приходит
// ровно в остальные окна того же адреса.
//
// Это синхронизация между окнами одной машины. Для нескольких машин на общем
// сервере правильный канал — socket.io (см. RealtimeListener), но он требует
// рассылки с сервера на каждую правку; здесь она не нужна.
const CHANNEL_NAME = "rpg-manager-data-changed";

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function notifyDataChanged(): void {
  const ch = getChannel();
  if (ch) {
    ch.postMessage(Date.now());
    return;
  }
  try {
    localStorage.setItem(CHANNEL_NAME, String(Date.now()));
  } catch {
    /* приватный режим без хранилища — синхронизации просто не будет */
  }
}

export function onDataChangedElsewhere(callback: () => void): () => void {
  const ch = getChannel();
  if (ch) {
    const listener = () => callback();
    ch.addEventListener("message", listener);
    return () => ch.removeEventListener("message", listener);
  }
  const listener = (e: StorageEvent) => {
    if (e.key === CHANNEL_NAME) callback();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

// Перезагружать страницу под руками нельзя: в полях может быть недописанный
// текст, а в модалке — незавершённое действие. Одного activeElement мало:
// пользователь мог печатать, уйти в соседнее окно и вернуться — поле к тому
// времени фокус потеряет, а текст в нём останется. Поэтому ещё и «недавно
// печатали».
const RECENT_INPUT_MS = 30_000;
let lastInputAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener("input", () => (lastInputAt = Date.now()), true);
}

// Exported so client.ts can reuse the same "не перезагружать под руками"
// guard when another window's login/logout invalidates this window's token —
// a forced reload mid-edit would drop the very work П0.6 tries to protect.
export function isBusyEditing(): boolean {
  if (Date.now() - lastInputAt < RECENT_INPUT_MS) return true;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
    return true;
  }
  return !!document.querySelector(".modal-backdrop");
}

export function useCrossWindowDataSync(): { stale: boolean; refresh: () => void } {
  const [stale, setStale] = useState(false);

  useEffect(() => onDataChangedElsewhere(() => setStale(true)), []);

  useEffect(() => {
    if (!stale) return;
    // Обычный случай: пинг пришёл, пока окно было в стороне — обновляемся
    // молча, когда в него возвращаются. Если в этот момент что-то правится,
    // остаётся полоска с кнопкой, и решает пользователь.
    const reloadIfIdle = () => {
      if (!isBusyEditing()) window.location.reload();
    };
    // Событие focus само по себе значит «в окно вернулись»; проверка
    // hasFocus нужна только для случая, когда пинг пришёл в окно, которое и
    // так активно (второй монитор, окно рядом).
    if (document.hasFocus()) reloadIfIdle();
    window.addEventListener("focus", reloadIfIdle);
    return () => window.removeEventListener("focus", reloadIfIdle);
  }, [stale]);

  return { stale, refresh: () => window.location.reload() };
}
