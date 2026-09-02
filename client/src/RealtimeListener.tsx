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

    return () => {
      socket.disconnect();
    };
  }, []);

  return null;
}
