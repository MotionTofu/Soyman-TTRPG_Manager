import { useEffect, useState } from "react";
import { onState, sendCommand } from "./bus";
import type { SoundState } from "./types";

// Окно пульта: команды наружу, состояние внутрь. Своего звука и своих
// вычислений здесь нет вовсе — см. комментарий к SoundState.
export function useSoundRemote() {
  const [state, setState] = useState<SoundState | null>(null);

  useEffect(() => {
    const off = onState(setState);
    // Главное окно уже играет к моменту открытия пульта, поэтому первый шаг —
    // спросить снимок, а не ждать следующего изменения.
    sendCommand({ kind: "hello" });
    const retry = window.setInterval(() => {
      setState((current) => {
        if (!current) sendCommand({ kind: "hello" });
        return current;
      });
    }, 1000);
    return () => {
      off();
      window.clearInterval(retry);
    };
  }, []);

  return {
    state,
    setSet: (setId: number | null) => sendCommand({ kind: "set", setId }),
    playAmbient: (resourceId: number | null) => sendCommand({ kind: "ambient", resourceId }),
    playWeather: (resourceId: number | null) => sendCommand({ kind: "weather", resourceId }),
    fireStinger: (resourceId: number) => sendCommand({ kind: "stinger", resourceId }),
    setVolume: (channel: "master" | "background" | "ambient" | "weather" | "stinger", value: number) =>
      sendCommand({ kind: "volume", channel, value }),
    setSilence: (on: boolean) => sendCommand({ kind: "silence", on }),
    toggleStop: (channel: "background" | "ambient" | "weather" | "stinger") =>
      sendCommand({ kind: "stop", channel }),
    setKeys: (layout: "digits" | "letters") => sendCommand({ kind: "keys", layout }),
    backgroundAction: (action: "toggle" | "next" | "prev") =>
      sendCommand({ kind: "background", action }),
    playBackgroundTrack: (index: number) => sendCommand({ kind: "background", action: "track", index }),
    setRepeat: (mode: "off" | "track" | "playlist") => sendCommand({ kind: "repeat", mode }),
    setShuffle: (on: boolean) => sendCommand({ kind: "shuffle", on }),
    revertAutoSwitch: () => sendCommand({ kind: "revertAutoSwitch" }),
    reload: () => sendCommand({ kind: "reload" }),
  };
}
