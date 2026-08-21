import type { SoundState } from "./types";

// Шина между главным окном и окном пульта.
//
// Тот же механизм, что у dataSync.ts: BroadcastChannel между окнами одной
// машины, с откатом на localStorage там, где его нет. Отдельный сервер или
// IPC главного процесса здесь не нужен — пульт всегда открыт на той же
// машине, где играет звук (планшет и MIDI отложены, см. later.md).
//
// Направления два и они не симметричны: пульт шлёт команды, движок рассылает
// снимок состояния. Пульт ничего не вычисляет сам — см. комментарий к
// SoundState.

const CHANNEL_NAME = "rpg-manager-sound";

export type SoundCommand =
  | { kind: "hello" }
  | { kind: "set"; setId: number | null }
  | { kind: "ambient"; resourceId: number | null }
  | { kind: "weather"; resourceId: number | null }
  | { kind: "stinger"; resourceId: number }
  | { kind: "volume"; channel: "master" | "background" | "ambient" | "weather" | "stinger"; value: number }
  | { kind: "silence"; on: boolean }
  // Стоп в центре ручки: один жест на канал, «выключить» и «запустить заново»
  // различает движок — пульт ничего не вычисляет сам.
  | { kind: "stop"; channel: "background" | "ambient" | "weather" | "stinger" }
  | { kind: "background"; action: "toggle" | "next" | "prev" }
  // Щелчок по строке списка: номер в очереди, а не id ресурса — один и тот же
  // звук может стоять в очереди дважды, и id не сказал бы, по какому попали.
  | { kind: "background"; action: "track"; index: number }
  | { kind: "repeat"; mode: "off" | "track" | "playlist" }
  | { kind: "shuffle"; on: boolean }
  | { kind: "keys"; layout: "digits" | "letters" }
  | { kind: "revertAutoSwitch" }
  // Набор включила запущенная сцена, а не рука Мастера. Отдельно от "set"
  // ровно потому же, почему бой отделён от обычного переключения: смену, о
  // которой не просили, надо подписать и уметь откатить.
  | { kind: "sceneSet"; setId: number | null; sceneName: string; setName: string }
  | { kind: "revertSceneSet" }
  | { kind: "reload" };

type Envelope = { from: string; command?: SoundCommand; state?: SoundState };

// Каждое окно метит свои сообщения: BroadcastChannel не доставляет
// отправителю, а localStorage-откат доставляет — без метки окно ловило бы
// собственную команду.
const SELF = Math.random().toString(36).slice(2);

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function post(envelope: Envelope): void {
  const ch = getChannel();
  if (ch) {
    ch.postMessage(envelope);
    return;
  }
  try {
    localStorage.setItem(CHANNEL_NAME, JSON.stringify({ ...envelope, at: Date.now() }));
  } catch {
    /* приватный режим без хранилища — второе окно просто не подхватит */
  }
}

function listen(handler: (envelope: Envelope) => void): () => void {
  const ch = getChannel();
  if (ch) {
    const listener = (e: MessageEvent) => {
      const envelope = e.data as Envelope;
      if (envelope?.from !== SELF) handler(envelope);
    };
    ch.addEventListener("message", listener);
    return () => ch.removeEventListener("message", listener);
  }
  const listener = (e: StorageEvent) => {
    if (e.key !== CHANNEL_NAME || !e.newValue) return;
    try {
      const envelope = JSON.parse(e.newValue) as Envelope;
      if (envelope?.from !== SELF) handler(envelope);
    } catch {
      /* мусор в хранилище — пропускаем */
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function sendCommand(command: SoundCommand): void {
  post({ from: SELF, command });
}

export function publishState(state: SoundState): void {
  post({ from: SELF, state });
}

export function onCommand(handler: (command: SoundCommand) => void): () => void {
  return listen((envelope) => {
    if (envelope.command) handler(envelope.command);
  });
}

export function onState(handler: (state: SoundState) => void): () => void {
  return listen((envelope) => {
    if (envelope.state) handler(envelope.state);
  });
}
