import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "./api/client";

// First socket.io *client* connection in this package — until now the
// desktop app only ever broadcast (POST /campaigns/:id/show-image), never
// listened. Only connects when there's an auth token (hosted/AUTH_ENABLED
// deployment); a bare local desktop instance has no token, so this is a
// harmless no-op there, same reasoning as ShowImageListener on the
// player-app side. Re-broadcasts received events as window CustomEvents so
// any open page (e.g. CharacterDetailPage) can listen without this
// component needing to know what's currently on screen.
export function RealtimeListener() {
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    const socket: Socket = io(window.location.origin, { auth: { token } });

    socket.on("character-updated", (payload: { characterId: number }) => {
      window.dispatchEvent(new CustomEvent("character-updated", { detail: payload }));
    });
    socket.on("show-entries", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("show-entries", { detail: payload }));
    });
    socket.on("show-image", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("show-image", { detail: payload }));
    });
    socket.on("hunter-mark", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("hunter-mark", { detail: payload }));
    });
    // Игрок назвал или сбросил свою инициативу. Событие уходит окном, а не
    // пропсом: трекер смонтирован дважды (колонка пульта и поисковая панель),
    // и оба экземпляра должны перезагрузиться, иначе Мастер увидит число в
    // одном месте и не увидит в другом.
    socket.on("initiative-updated", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("initiative-updated", { detail: payload }));
    });
    // Данные кампании изменились (выдача Мастера, запись игрока в дневник):
    // открытый экран перечитывает задетое сам — data/syncAffects.ts.
    socket.on("campaign-data-changed", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("campaign-data-changed", { detail: payload }));
    });
    // Мастер поправил компендиум системы: лист перечитывает свои записи.
    socket.on("system-data-changed", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("system-data-changed", { detail: payload }));
    });
    // Мастер переименовал игрока или оставил ему напоминание: кабинет и партия.
    socket.on("player-data-changed", (payload: unknown) => {
      window.dispatchEvent(new CustomEvent("player-data-changed", { detail: payload }));
    });
    // Связь вернулась после обрыва (телефон заснул, пропал Wi-Fi): сигналы за
    // это время потеряны и сервер их не копит — открытое перечитывается целиком.
    // Первое подключение не в счёт: данные только что прочитаны.
    let connectedOnce = false;
    socket.on("connect", () => {
      if (connectedOnce) window.dispatchEvent(new CustomEvent("realtime-reconnected"));
      connectedOnce = true;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return null;
}
