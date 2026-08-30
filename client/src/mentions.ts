import { useSyncExternalStore } from "react";
import { api } from "./api/client";

// Ссылки внутри текста: единственное место, где на клиенте описана их
// грамматика, и карта, по которой они резолвятся.
//
// Форма одна: `[[being@8f3c1a2e|wdh|Мирт]]` — тип, начало глобального uid цели,
// код (или имя) модуля-источника, подпись. Локального id в тексте нет: он верен
// ровно в пределах одного файла базы (подробности — server/src/services/mentions.ts).
//
// **Жива ли ссылка — вычисляется, а не хранится.** Она жива ровно тогда, когда
// её ключ находится в карте ниже. Поэтому у ссылок нет двух состояний в тексте
// и нет проходов, которые эти состояния поддерживают.

/** Рабочая форма. Держится здесь одна: три копии этой регулярки уже дали баг. */
export const MENTION_RE =
  /\[\[(\w+)@([0-9a-fA-F][0-9a-fA-F-]{7,})\|([^|\]]*)\|([^\]]*)\]\]/g;

/**
 * Наследство: локальный id. Только читается — разовая миграция не заходит в
 * `modules.source_json`, и оттуда старый токен может всплыть.
 */
export const LEGACY_MENTION_RE = /\[\[(\w+):(\d+)\|([^\]]+)\]\]/g;

/** Обе формы разом: нужно там, где токен надо найти в строке, не разбирая. */
export const ANY_MENTION_RE =
  /\[\[\w+@[0-9a-fA-F][0-9a-fA-F-]{7,}\|[^|\]]*\|[^\]]*\]\]|\[\[\w+:\d+\|[^\]]+\]\]/g;

export interface MentionToken {
  type: string;
  /** Как записано в тексте: префикс uid. */
  uid: string;
  /** Код или имя модуля-источника. */
  source: string;
  label: string;
}

/** uid без дефисов и в нижнем регистре — единственная форма для сравнения. */
export const normUid = (uid: string) => uid.replace(/-/g, "").toLowerCase();

export function parseMentions(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  const seen = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(MENTION_RE)) {
    const key = `${m[1]}:${normUid(m[2])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: m[1], uid: m[2], source: m[3], label: m[4] });
  }
  return out;
}

export function formatMentionToken(
  type: string,
  uid: string,
  source: string,
  label: string
): string {
  return `[[${type}@${normUid(uid)}|${source.replace(/[|\]\[]/g, " ").trim()}|${label}]]`;
}

// ─── Карта глобальных ключей ─────────────────────────────────────────────────
//
// Рендер ссылок синхронный: MentionText разбирает абзац и сразу строит
// маршрут, без запросов, — иначе каждая заметка дёргала бы сервер при
// отрисовке. Поэтому «этот ключ — вот эта строка» должно быть известно
// заранее и целиком.
//
// Одной картой закрываются три нужды: куда ведёт ссылка, зачёркнута ли она и
// какой локальный id положить в граф связей при сохранении текста.

interface IndexPayload {
  owners: Record<string, { code: string; name: string }>;
  entities: Record<string, [number, string, string | null][]>;
}

interface Entry {
  id: number;
  uid: string;
  owner: string | null;
}

interface Loaded {
  owners: Record<string, { code: string; name: string }>;
  /** тип → первые восемь символов ключа → сущности с таким началом. */
  byHead: Map<string, Map<string, Entry[]>>;
  /** «тип:id» → сущность, для обратного пути: что писать в текст. */
  byId: Map<string, Entry>;
}

let loaded: Loaded | null = null;
let inFlight: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function announce() {
  version++;
  for (const fn of listeners) fn();
}

function build(payload: IndexPayload): Loaded {
  const byHead = new Map<string, Map<string, Entry[]>>();
  const byId = new Map<string, Entry>();
  for (const [type, rows] of Object.entries(payload.entities)) {
    const heads = new Map<string, Entry[]>();
    for (const [id, uid, owner] of rows) {
      const entry: Entry = { id, uid, owner };
      const head = uid.slice(0, 8);
      const list = heads.get(head);
      if (list) list.push(entry);
      else heads.set(head, [entry]);
      byId.set(`${type}:${id}`, entry);
    }
    byHead.set(type, heads);
  }
  return { owners: payload.owners, byHead, byId };
}

/** Загрузка карты. Зовётся один раз при старте приложения. */
export function loadMentionIndex(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = api
    .get<IndexPayload>("/mentions/index")
    .then((payload) => {
      loaded = build(payload);
      missed.clear();
      announce();
    })
    .catch(() => {
      // Ссылки покажутся зачёркнутыми, и это честно: без карты мы про них
      // ничего не знаем. Повторная попытка приедет со следующим обновлением.
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Перечитать карту целиком. Зовётся там, где сущности появляются или исчезают
 * пачками: импорт, установка и удаление модуля, удаление из Архива.
 */
export function refreshMentionIndex(): Promise<void> {
  if (inFlight) return inFlight;
  return loadMentionIndex();
}

export function useMentionIndex(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version
  );
}

/**
 * Ключ, которого в карте не нашлось.
 *
 * Сущность могла появиться путём, о котором карта не узнала, — тогда одно
 * перечитывание всё чинит. Но гораздо чаще ключ не находится потому, что цели
 * на этом устройстве просто нет: нужный модуль не поставлен. Такие ключи
 * запоминаются, чтобы зачёркнутая ссылка на экране не заказывала перезагрузку
 * карты при каждой отрисовке.
 */
const missed = new Set<string>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function noteMiss(key: string) {
  if (missed.has(key) || !loaded) return;
  missed.add(key);
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadMentionIndex();
  }, 1500);
}

function lookup(type: string, uid: string): Entry | null {
  if (!loaded) return null;
  const want = normUid(uid);
  const list = loaded.byHead.get(type)?.get(want.slice(0, 8));
  if (!list || !list.length) return null;
  const exact = list.find((e) => e.uid === want);
  if (exact) return exact;
  const hits = list.filter((e) => e.uid.startsWith(want));
  // Двойник появился после того, как ссылку написали: показать зачёркнутую
  // честнее, чем увести на одну из двух сущностей наугад.
  return hits.length === 1 ? hits[0] : null;
}

/** Локальный id цели, или null — ссылка ведёт в модуль, которого здесь нет. */
export function resolveMention(type: string, uid: string): number | null {
  const hit = lookup(type, uid);
  if (!hit) {
    noteMiss(`${type}:${normUid(uid)}`);
    return null;
  }
  return hit.id;
}

/** Загрузилась ли карта вообще: до этого «не нашлось» ничего не значит. */
export const mentionIndexReady = () => loaded != null;

/**
 * То, что пишется в текст: минимальный префикс ключа, однозначный внутри
 * своего типа. Восемь символов на три сотни целей — запас в миллионы раз, и
 * он шире, чем кажется: `[[being@…]]` и `[[location@…]]` друг другу не мешают.
 */
export function mentionPrefix(type: string, id: number): string | null {
  if (!loaded) return null;
  const self = loaded.byId.get(`${type}:${id}`);
  if (!self) return null;
  const rivals = (loaded.byHead.get(type)?.get(self.uid.slice(0, 8)) ?? []).filter(
    (e) => e.id !== id
  );
  if (!rivals.length) return self.uid.slice(0, 8);
  for (let len = 12; len < self.uid.length; len += 4) {
    const head = self.uid.slice(0, len);
    if (!rivals.some((r) => r.uid.startsWith(head))) return head;
  }
  return self.uid;
}

/** Код (или имя) модуля, откуда сущность родом — третье поле токена. */
export function mentionSource(type: string, id: number): string {
  if (!loaded) return "";
  const self = loaded.byId.get(`${type}:${id}`);
  const owner = self?.owner ? loaded.owners[self.owner] : null;
  if (!owner) return "";
  return owner.code || owner.name;
}

/** Имя модуля по коду из токена — для окна неработающей ссылки. */
export function knownSourceName(code: string): string | null {
  if (!loaded || !code) return null;
  const want = code.trim().toLowerCase();
  for (const owner of Object.values(loaded.owners)) {
    if (owner.code.toLowerCase() === want || owner.name.toLowerCase() === want) return owner.name;
  }
  return null;
}

/**
 * Готовый токен для вставки в текст.
 *
 * Обычно всё берётся из карты и получается мгновенно. Но сущность могли
 * создать прямо сейчас — тем самым окном «создать новую», из которого её и
 * вставляют, — и тогда карты для неё ещё нет. Тогда спрашиваем сервер: одна
 * поездка на localhost в момент осознанного действия человека незаметна, а
 * молча вставить ссылку в никуда нельзя.
 */
export async function buildMentionToken(
  type: string,
  id: number,
  label: string
): Promise<string | null> {
  const prefix = mentionPrefix(type, id);
  if (prefix) return formatMentionToken(type, prefix, mentionSource(type, id), label);
  try {
    const r = await api.get<{ prefix: string | null; source: string }>(
      `/mentions/token?type=${encodeURIComponent(type)}&id=${id}`
    );
    if (!r.prefix) return null;
    void loadMentionIndex();
    return formatMentionToken(type, r.prefix, r.source, label);
  } catch {
    return null;
  }
}

// ─── Граф связей ─────────────────────────────────────────────────────────────

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  section: string | null;
}

/**
 * Сверяет ссылки в старом и новом тексте и заводит/убирает соответствующие
 * `generic_links` (с пометкой section="mention"), чтобы упоминания попадали в
 * граф связей, не дублируя связи, сделанные перетаскиванием.
 *
 * В `generic_links` лежат локальные id, и это правильно: таблица не уезжает в
 * файл, а внутри одного файла базы id законен и держится внешними ключами.
 * Поэтому ключ из текста здесь резолвится в id — а упоминание, чья цель на
 * этом устройстве не установлена, в граф не попадает: связывать не с чем.
 */
export async function syncMentionLinks(
  entityType: string,
  entityId: number,
  oldText: string,
  newText: string
): Promise<void> {
  const keyOf = (m: MentionToken) => `${m.type}:${normUid(m.uid)}`;
  const oldMentions = parseMentions(oldText);
  const newMentions = parseMentions(newText);
  const oldKeys = new Set(oldMentions.map(keyOf));
  const newKeys = new Set(newMentions.map(keyOf));

  const toAdd = newMentions.filter((m) => !oldKeys.has(keyOf(m)));
  const toRemove = oldMentions.filter((m) => !newKeys.has(keyOf(m)));

  for (const m of toAdd) {
    const id = resolveMention(m.type, m.uid);
    if (id == null) continue;
    await api.post("/links", {
      from_type: entityType,
      from_id: entityId,
      to_type: m.type,
      to_id: id,
      section: "mention",
    });
  }

  if (toRemove.length > 0) {
    for (const m of toRemove) {
      const id = resolveMention(m.type, m.uid);
      if (id == null) continue;
      // Re-read before each delete to avoid race condition with concurrent calls
      const existing = await api.get<GenericLink[]>(
        `/links?type=${entityType}&id=${entityId}&section=mention`
      );
      const match = existing.find(
        (l) =>
          (l.to_type === m.type && l.to_id === id) || (l.from_type === m.type && l.from_id === id)
      );
      if (match) await api.del(`/links/${match.id}`);
    }
  }
}
