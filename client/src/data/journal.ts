/**
 * Журнал медленных запросов и ошибок (docs/adr/0001, п. 6).
 *
 * Жалобу «зависает, странные ошибки, много где» не удалось воспроизвести на
 * копии базы: замер пяти экранов дал 0,1–0,6 с на действие. Поэтому ловим там,
 * где это случается: транспорт (`api/client.ts`) сообщает сюда о каждом
 * запросе, а в журнал попадают только те, что шли дольше секунды или
 * закончились ошибкой. Записи копятся на устройстве и уходят на сервер пачками;
 * без сети — лежат в localStorage до следующего раза. Мастер смотрит их на
 * странице «Здоровье».
 *
 * Модуль не знает, как отправлять: отправщик ставит транспорт
 * (`setJournalSender`), иначе журнал импортировал бы клиент, а клиент — журнал.
 */

export interface JournalEntry {
  kind: "slow" | "error";
  /** Путь страницы, на которой случилось. */
  screen: string;
  /** Метод и путь запроса. */
  action: string;
  /** HTTP-статус; null — ответа не было (таймаут, сеть). */
  status: number | null;
  durationMs: number;
  message: string;
  /** Время на устройстве: запись могла копиться без сети. */
  occurredAt: string;
  device: string;
}

export interface RequestReport {
  method: string;
  /** Путь без префикса /api. */
  path: string;
  status: number | null;
  durationMs: number;
  /** Текст ошибки; отсутствует — запрос удался. */
  error?: string;
  /** Отмена по инициативе приложения (ушли со страницы) — не ошибка. */
  aborted?: boolean;
}

export type JournalSender = (entries: JournalEntry[]) => Promise<void>;

/** Дольше этого запрос считается медленным. */
export const SLOW_MS = 1000;
/** Больше этого на устройстве не копится: старое вытесняется. */
export const MAX_PENDING = 200;
/** Одна отправка — не больше (столько же принимает сервер). */
export const BATCH_SIZE = 50;
const FLUSH_DELAY_MS = 5_000;
const RETRY_DELAY_MS = 30_000;
const STORAGE_KEY = "soyman.clientJournal.pending";
/** Свои запросы журнала не журналируются — иначе падение сервера зациклится. */
const OWN_PATH = "/client-journal";

let pending: JournalEntry[] = loadPending();
let sender: JournalSender | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function loadPending(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]).slice(-MAX_PENDING) : [];
  } catch {
    return [];
  }
}

function savePending(): void {
  try {
    if (pending.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* приватный режим или переполнение — журнал живёт только в памяти */
  }
}

function describeDevice(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent || "";
  const engine = /Electron\/(\d+)/.exec(ua)?.[0] ?? /(Firefox|Edg|Chrome|Safari)\/(\d+)/.exec(ua)?.[0] ?? "браузер";
  const mobile = /Mobi|Android|iPhone|iPad/.test(ua) ? "телефон" : "компьютер";
  const width = typeof window !== "undefined" ? `${window.innerWidth}px` : "";
  return [mobile, engine, width].filter(Boolean).join(" · ");
}

function currentScreen(): string {
  if (typeof location === "undefined") return "";
  return (location.pathname + location.search).slice(0, 200);
}

function schedule(delay: number): void {
  if (timer || !sender || pending.length === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void flushJournal();
  }, delay);
}

/** Ставит отправщик — транспорт, когда он готов; null снимает. */
export function setJournalSender(next: JournalSender | null): void {
  sender = next;
  schedule(FLUSH_DELAY_MS);
}

/** Транспорт сообщает о каждом запросе; в журнал попадает только важное. */
export function reportRequest(report: RequestReport): void {
  if (report.path.startsWith(OWN_PATH) || report.aborted) return;
  const failed = report.error !== undefined;
  // 401 — это «вышли из учётки», у него свой экран входа, а не сбой.
  if (failed && report.status === 401) return;
  if (!failed && report.durationMs < SLOW_MS) return;
  pending.push({
    kind: failed ? "error" : "slow",
    screen: currentScreen(),
    action: `${report.method.toUpperCase()} ${report.path}`.slice(0, 200),
    status: report.status,
    durationMs: Math.round(report.durationMs),
    message: (report.error ?? "").slice(0, 500),
    occurredAt: new Date().toISOString(),
    device: describeDevice(),
  });
  if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  savePending();
  schedule(FLUSH_DELAY_MS);
}

/** Отправляет накопленное пачками; при неудаче оставляет и пробует позже. */
export async function flushJournal(): Promise<void> {
  if (flushing || !sender) return;
  flushing = true;
  try {
    while (pending.length > 0) {
      const batch = pending.slice(0, BATCH_SIZE);
      try {
        await sender(batch);
      } catch {
        schedule(RETRY_DELAY_MS);
        return;
      }
      pending = pending.slice(batch.length);
      savePending();
    }
  } finally {
    flushing = false;
  }
}

/** Для тестов и страницы «Здоровье»: что лежит неотправленным на этом устройстве. */
export function pendingJournal(): readonly JournalEntry[] {
  return pending;
}

/** Только для тестов. */
export function resetJournalForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = false;
  sender = null;
  pending = [];
  savePending();
}
