import type { Affect } from "./data/entities";

// Окна приложения смотрят в один сервер и одну базу, но каждое держит свою
// копию уже загруженных данных: добавил жителя в локацию в одном окне — второе
// окно с той же локацией об этом не знает. Поэтому каждая правка объявляется
// остальным окнам, а те перечитывают задетое (data/DataLayerSync.tsx).
// Перезагрузки окна по сигналу больше нет: все страницы на слое данных
// (docs/adr/0001, п. 8).
//
// BroadcastChannel не доставляет сообщение отправителю — окно, сделавшее
// правку, свой же пинг не увидит и лишний раз не перечитает. Там, где его
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

/**
 * Что пришло в сигнале. `affects` кладёт слой данных (data/hooks.ts), чтобы
 * другое окно перечитало ровно задетое; без него — задето всё. Старые окна
 * присылали голое число — оно читается как «всё».
 */
export interface DataChangedPayload {
  at: number;
  affects?: readonly Affect[];
}

function parsePayload(raw: unknown): DataChangedPayload {
  if (raw && typeof raw === "object" && "at" in raw) return raw as DataChangedPayload;
  if (typeof raw === "string") {
    try {
      return parsePayload(JSON.parse(raw));
    } catch {
      /* старое значение-число строкой */
    }
  }
  return { at: Number(raw) || Date.now() };
}

export function notifyDataChanged(affects?: readonly Affect[]): void {
  const payload: DataChangedPayload = { at: Date.now(), ...(affects && affects.length ? { affects } : {}) };
  const ch = getChannel();
  if (ch) {
    ch.postMessage(payload);
    return;
  }
  try {
    localStorage.setItem(CHANNEL_NAME, JSON.stringify(payload));
  } catch {
    /* приватный режим без хранилища — синхронизации просто не будет */
  }
}

export function onDataChangedElsewhere(callback: (payload: DataChangedPayload) => void): () => void {
  const ch = getChannel();
  if (ch) {
    const listener = (e: MessageEvent) => callback(parsePayload(e.data));
    ch.addEventListener("message", listener);
    return () => ch.removeEventListener("message", listener);
  }
  const listener = (e: StorageEvent) => {
    if (e.key === CHANNEL_NAME) callback(parsePayload(e.newValue));
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

// Нужен транспорту (api/client.ts): вход или выход в другом окне меняет токен
// этого окна, и перезагрузка посреди правки потеряла бы набранное.
export function isBusyEditing(): boolean {
  if (Date.now() - lastInputAt < RECENT_INPUT_MS) return true;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
    return true;
  }
  return !!document.querySelector(".modal-backdrop");
}
