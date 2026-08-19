// Ссылки внутри текста: разбор, перезапись и глобальные ключи.
//
// В тексте ссылка живёт двумя формами.
//
// **Живая** — `[[being:412|Мирт]]`. Числовой id строки, верный ровно в
// пределах одного файла базы. Рендерится ссылкой, кликается, ведёт на
// страницу.
//
// **Подвешенная** — `[[being@0f3a…|Вотердип|Мирт]]`. Глобальный uid цели плюс
// имя модуля, откуда цель родом. Появляется там, где локального id назвать
// нельзя: при импорте, когда цель не приехала вместе с файлом, и при
// физическом удалении цели из Архива. Рендерится зачёркнутым текстом и
// оживает сама, когда нужный модуль появится в базе.
//
// Обе формы разбирает один сканер, и вся работа с ссылками — экспорт, импорт,
// слияние, исцеление, удаление — выражена через одну функцию `rewriteMentions`.
// Это сделано намеренно: пока перезапись была размазана по маршрутам, экспорт
// её просто не делал, и ссылки после переноса указывали на чужие сущности.

import crypto from "crypto";
import { db } from "../db/db";

/**
 * Всё, на что можно сослаться из текста, и где оно лежит. Список ведёт себя
 * как источник истины для uid: у каждого типа отсюда есть колонка `uid`,
 * и по ней сущность опознаётся между устройствами.
 */
export const MENTIONABLE: Record<string, string> = {
  campaign: "campaigns",
  setting: "settings",
  player: "players",
  character: "characters",
  location: "setting_locations",
  being: "setting_beings",
  community: "setting_communities",
  artifact: "artifacts",
  resource: "resources",
  mastering: "mastering_notes",
  adventure: "story_arcs",
  scene: "story_scenes",
  session: "sessions",
  compendium_entry: "compendium_entries",
  setting_event: "setting_calendar_events",
};

/**
 * Что вообще ездит между устройствами: содержимое сеттингов и систем. На
 * остальное (кампания, сессия, персонаж, игрок) ссылку подвешивать
 * бессмысленно — эти сущности не переносятся, и обещание «оживёт, когда
 * поставишь модуль» будет ложным. Такие ссылки схлопываются в обычный текст.
 */
export const TRANSFERABLE = new Set([
  "setting",
  "location",
  "being",
  "community",
  "artifact",
  "adventure",
  "scene",
  "compendium_entry",
  "setting_event",
]);

/**
 * Таблицы, чьи тексты трогать нельзя, даже если в них попался токен.
 *
 * `modules.source_json` — замороженный файл модуля: перезаписать его значило
 * бы подделать источник, из которого модуль потом разворачивается. Журналы
 * импорта хранят прежние значения полей для отката — переписать их значит
 * сломать откат. `archived_files` — то же самое для удалённых файлов.
 */
const NEVER_REWRITE = new Set([
  "modules",
  "import_batches",
  "import_records",
  "system_import_batches",
  "system_import_records",
  "archived_files",
  "app_settings",
  "vault_files",
]);

// ─── Грамматика токена ───────────────────────────────────────────────────────

// Живая форма — та же, что была всегда: тип, двоеточие, число.
// Подвешенная — тип, собака, uid, и на одно поле больше (имя модуля перед
// подписью). Модуль стоит раньше подписи, потому что подпись пишет человек и
// в ней может оказаться «|», а имя модуля мы чистим при записи.
const MENTION_RE =
  /\[\[(\w+):(\d+)\|([^\]]*)\]\]|\[\[(\w+)@([0-9a-fA-F][0-9a-fA-F-]{7,})\|([^|\]]*)\|([^\]]*)\]\]/g;

export interface LiveMention {
  kind: "live";
  type: string;
  id: number;
  label: string;
  raw: string;
  start: number;
  end: number;
}

export interface DeadMention {
  kind: "dead";
  type: string;
  uid: string;
  /** Имя модуля, откуда цель родом: его и показывает окно «ссылка не работает». */
  source: string;
  label: string;
  raw: string;
  start: number;
  end: number;
}

export type Mention = LiveMention | DeadMention;

/** Имя модуля пишется в текст, поэтому в нём не должно быть разделителей. */
const cleanSource = (s: string) => s.replace(/[|\]\[]/g, " ").trim();

export const formatLive = (type: string, id: number, label: string) => `[[${type}:${id}|${label}]]`;

export const formatDead = (type: string, uid: string, source: string, label: string) =>
  `[[${type}@${uid}|${cleanSource(source)}|${label}]]`;

/** Все ссылки в тексте, в порядке появления. */
export function scanMentions(text: string): Mention[] {
  const found: Mention[] = [];
  if (!text || !text.includes("[[")) return found;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text))) {
    const [raw, liveType, liveId, liveLabel, deadType, uid, source, deadLabel] = m;
    if (liveType) {
      found.push({
        kind: "live",
        type: liveType,
        id: Number(liveId),
        label: liveLabel ?? "",
        raw,
        start: m.index,
        end: m.index + raw.length,
      });
    } else if (deadType) {
      found.push({
        kind: "dead",
        type: deadType,
        uid,
        source: source ?? "",
        label: deadLabel ?? "",
        raw,
        start: m.index,
        end: m.index + raw.length,
      });
    }
  }
  return found;
}

/**
 * Единственный способ менять ссылки в тексте. Обработчик получает разобранный
 * токен и возвращает то, чем его заменить: другой токен, голую подпись
 * (ссылка снимается) или `null`, если трогать не надо.
 *
 * Замены собираются справа налево, чтобы смещения не поехали.
 */
export function rewriteMentions(text: string, fn: (m: Mention) => string | null): string {
  const found = scanMentions(text);
  if (!found.length) return text;
  let out = text;
  for (let i = found.length - 1; i >= 0; i--) {
    const next = fn(found[i]);
    if (next == null || next === found[i].raw) continue;
    out = out.slice(0, found[i].start) + next + out.slice(found[i].end);
  }
  return out;
}

// ─── Глобальные ключи ────────────────────────────────────────────────────────

/**
 * uid сущности. Выдаётся лениво: миграция засыпает существующие строки, но
 * строка могла появиться и после неё — из импорта, из ручного создания, из
 * ветки, которая про uid не знает. Дешевле выдать здесь, чем ловить пустоту в
 * каждом вызывающем.
 */
export function uidOf(type: string, id: number): string | null {
  const table = MENTIONABLE[type];
  if (!table) return null;
  const row = db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(id) as
    | { uid: string | null }
    | undefined;
  if (!row) return null;
  if (row.uid) return row.uid;
  const uid = crypto.randomUUID();
  db.prepare(`UPDATE ${table} SET uid = ? WHERE id = ?`).run(uid, id);
  return uid;
}

/** Обратный поиск: есть ли на этом устройстве сущность с таким глобальным ключом. */
export function idOfUid(type: string, uid: string): number | null {
  const table = MENTIONABLE[type];
  if (!table) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE uid = ?`).get(uid) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

/** Существует ли строка вообще — по ней отличается «удалена» от «в архиве». */
export function exists(type: string, id: number): boolean {
  const table = MENTIONABLE[type];
  if (!table) return false;
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
}

/**
 * Чьё это, если смотреть глазами пользователя: имя сеттинга или системы, к
 * которым сущность принадлежит. Попадает в подвешенный токен и оттуда — в
 * окно «поставьте модуль такой-то», поэтому важно, чтобы это было имя,
 * которое человек увидит в списке модулей.
 */
export function sourceNameOf(type: string, id: number): string {
  const table = MENTIONABLE[type];
  if (!table) return "";
  if (type === "setting") {
    const row = db.prepare("SELECT name FROM settings WHERE id = ?").get(id) as
      | { name: string }
      | undefined;
    return row?.name ?? "";
  }
  const owner =
    type === "compendium_entry"
      ? { column: "system_id", table: "systems" }
      : { column: "setting_id", table: "settings" };
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!cols.includes(owner.column)) return "";
  const row = db
    .prepare(
      `SELECT o.name AS name FROM ${table} t
         JOIN ${owner.table} o ON o.id = t.${owner.column}
        WHERE t.id = ?`
    )
    .get(id) as { name: string } | undefined;
  return row?.name ?? "";
}

// ─── Политики: что делать со ссылкой в каждой из трёх ситуаций ───────────────

/**
 * **Экспорт.** В файле локальных id быть не должно — на чужом устройстве они
 * означают другие сущности. Живая ссылка переводится в глобальную форму,
 * ссылка на непереносимое (кампания, сессия, персонаж, игрок, ресурс,
 * мастерская заметка) схлопывается в подпись: обещать, что она оживёт, нечем.
 * Уже подвешенная едет как есть — она и так глобальная.
 */
export function exportMention(m: Mention): string | null {
  if (m.kind === "dead") return null;
  if (!TRANSFERABLE.has(m.type)) return m.label;
  const uid = uidOf(m.type, m.id);
  if (!uid) return m.label;
  return formatDead(m.type, uid, sourceNameOf(m.type, m.id), m.label);
}

/**
 * **Импорт.** Собирает то, что импорт создал, и по окончании переводит ссылки
 * в его текстах на новые локальные id.
 *
 * Ключевая тонкость — почему нельзя просто искать uid по всей базе. Модуль
 * можно поставить второй раз, не удаляя первый: тогда цель ссылки в базе уже
 * есть, но это **другая копия**, и глобальный поиск склеил бы новый сеттинг
 * со старым. Поэтому сначала смотрим на то, что создал этот же импорт, и
 * только потом — на остальную базу.
 */
export class ImportedEntities {
  /** «тип:uid из файла» → новый локальный id. */
  private byUid = new Map<string, number>();
  /** Строки, созданные импортом: только их тексты и правим. */
  private rows: { table: string; id: number }[] = [];

  /**
   * Закрепляет за новой строкой её глобальный ключ.
   *
   * uid из файла сохраняется как есть — благодаря этому удалённый и заново
   * поставленный модуль опознаётся как тот же самый, и подвешенные ссылки на
   * него оживают. Если ключ уже занят (тот же модуль ставят второй раз),
   * копия получает свежий: уникальность важнее совпадения, иначе две копии
   * стали бы одной сущностью.
   */
  claim(type: string, newId: number, wanted?: unknown): void {
    const table = MENTIONABLE[type];
    if (!table) return;
    this.rows.push({ table, id: newId });
    const fromFile = typeof wanted === "string" && wanted ? wanted : null;
    const holder = fromFile != null ? idOfUid(type, fromFile) : null;
    const free = fromFile != null && (holder == null || holder === newId);
    const uid = free ? fromFile! : crypto.randomUUID();
    db.prepare(`UPDATE ${table} SET uid = ? WHERE id = ?`).run(uid, newId);
    if (fromFile) this.byUid.set(`${type}:${fromFile}`, newId);
  }

  /** Строка без собственного uid — статблок, глава, — но с текстом под правку. */
  track(table: string, id: number): void {
    this.rows.push({ table, id });
  }

  /**
   * Второй проход: ссылки в созданных текстах становятся живыми.
   *
   * Живая ссылка во входящем файле означает ровно одно — файл сделан до
   * появления глобальных ключей. Опознать её цель нечем и никогда не будет
   * чем, а числу в ней верить нельзя: оно указывает на строку чужой базы.
   * Такая схлопывается в подпись — проза читается как читалась, ложной
   * ссылки не остаётся.
   */
  resolve(): number {
    return rewriteRows(this.rows, (m) => {
      if (m.kind === "live") return m.label;
      const mine = this.byUid.get(`${m.type}:${m.uid}`);
      if (mine != null) return formatLive(m.type, mine, m.label);
      const elsewhere = idOfUid(m.type, m.uid);
      return elsewhere == null ? null : formatLive(m.type, elsewhere, m.label);
    });
  }
}

/**
 * **Исцеление.** То же правило, но только в сторону оживления: чужие живые
 * ссылки, уже лежащие в базе, трогать нельзя — они верны.
 */
export function healMention(m: Mention): string | null {
  if (m.kind === "live") return null;
  const id = idOfUid(m.type, m.uid);
  return id == null ? null : formatLive(m.type, id, m.label);
}

/** Кто чем был до удаления: «тип:id» → его глобальный ключ и имя источника. */
export type Identities = Map<string, { uid: string; source: string }>;

/**
 * Снимок личностей всех ссылаемых сущностей.
 *
 * Нужен перед физическим удалением: после `DELETE` строки нет, а вместе с ней
 * нет и uid — подвесить ссылку будет уже нечем, останется только выбросить.
 * Снимок делается целиком, а не по удаляемой ветке, потому что каскад уносит
 * потомков на любую глубину (сеттинг → локации → главы), и предсказывать его
 * состав дороже, чем прочитать три тысячи строк.
 */
export function identitySnapshot(): Identities {
  const snap: Identities = new Map();
  for (const [type, table] of Object.entries(MENTIONABLE)) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!cols.includes("uid")) continue;
    const owner = cols.includes("system_id")
      ? { column: "system_id", table: "systems" }
      : cols.includes("setting_id")
        ? { column: "setting_id", table: "settings" }
        : null;
    const rows = db
      .prepare(
        owner
          ? `SELECT t.id, t.uid, o.name AS source FROM ${table} t
               LEFT JOIN ${owner.table} o ON o.id = t.${owner.column}`
          : `SELECT id, uid, '' AS source FROM ${table}`
      )
      .all() as { id: number; uid: string | null; source: string | null }[];
    for (const r of rows) {
      if (r.uid) snap.set(`${type}:${r.id}`, { uid: r.uid, source: r.source ?? "" });
    }
  }
  return snap;
}

/**
 * **Удаление.** Проходит по всем текстам и подвешивает живые ссылки, чьи цели
 * исчезли. Ссылка не пропадает и не врёт: она зачёркнута, объясняет, какого
 * модуля не хватает, и оживёт сама, если сущность вернётся.
 *
 * Личность, которой нет в снимке, опознать нечем — такая ссылка схлопывается
 * в подпись.
 */
export function dangleDeleted(snap: Identities): number {
  return rewriteAllMentions((m) => {
    if (m.kind === "dead") return null;
    if (!MENTIONABLE[m.type] || exists(m.type, m.id)) return null;
    const was = snap.get(`${m.type}:${m.id}`);
    if (!was) return m.label;
    return formatDead(m.type, was.uid, was.source, m.label);
  });
}

/**
 * **Исцеление.** Подвешенные ссылки оживают, если их цели появились в базе.
 * Зовётся после каждой материализации модуля — установки из файла, установки
 * из каталога, включения и обновления, — и вручную кнопкой «Проверить
 * зависимости».
 */
export function healAllMentions(): number {
  return rewriteAllMentions(healMention);
}

/**
 * Проход по готовой структуре экспорта: правит каждую строку, где есть токен.
 *
 * По той же причине, что и обход по колонкам, — не по именам полей: тексты в
 * выгрузке лежат и в плоских полях, и внутри JSON статблоков, и в `data`
 * записей компендиума, и перечислять их поимённо значит что-то забыть.
 */
export function rewritePayload<T>(value: T, fn: (m: Mention) => string | null): T {
  if (typeof value === "string") {
    return (value.includes("[[") ? rewriteMentions(value, fn) : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewritePayload(value[i], fn);
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = rewritePayload(obj[key], fn);
    return value;
  }
  return value;
}

// ─── Обход текстов базы ──────────────────────────────────────────────────────

export interface TextColumn {
  table: string;
  column: string;
}

/**
 * Где в базе может лежать ссылка.
 *
 * Не список полей, а список текстовых колонок: меншен можно поставить в
 * несколько десятков разных полей, часть из которых — JSON внутри
 * `statblocks.content` и `compendium_entries.data`. Перечислять их по именам
 * значит гарантированно что-то забыть, а забытое поле — это ссылка, которую
 * перенос молча испортит.
 *
 * Токен внутри JSON правится тем же текстовым способом: кавычек и обратных
 * слэшей в нём нет, так что подстановка не ломает разметку.
 */
export function mentionTextColumns(): TextColumn[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const out: TextColumn[] = [];
  for (const { name } of tables) {
    if (NEVER_REWRITE.has(name)) continue;
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as {
      name: string;
      type: string;
    }[];
    if (!cols.some((c) => c.name === "id")) continue;
    for (const c of cols) {
      if (/TEXT|CLOB|CHAR/i.test(c.type)) out.push({ table: name, column: c.name });
    }
  }
  return out;
}

/** Текстовые колонки одной таблицы — с кэшем, потому что импорт зовёт это часто. */
const columnsCache = new Map<string, string[]>();
function textColumnsOf(table: string): string[] {
  const hit = columnsCache.get(table);
  if (hit) return hit;
  const cols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]
  )
    .filter((c) => /TEXT|CLOB|CHAR/i.test(c.type))
    .map((c) => c.name);
  columnsCache.set(table, cols);
  return cols;
}

/**
 * Правит ссылки в поимённо перечисленных строках. Этим пользуется импорт: он
 * точно знает, что создал, и трогать чужие тексты ему нельзя.
 */
export function rewriteRows(
  rows: { table: string; id: number }[],
  fn: (m: Mention) => string | null
): number {
  let changed = 0;
  const run = db.transaction(() => {
    for (const { table, id } of rows) {
      if (NEVER_REWRITE.has(table)) continue;
      for (const column of textColumnsOf(table)) {
        const row = db.prepare(`SELECT ${column} AS value FROM ${table} WHERE id = ?`).get(id) as
          | { value: string | null }
          | undefined;
        if (!row?.value || !row.value.includes("[[")) continue;
        const next = rewriteMentions(row.value, fn);
        if (next !== row.value) {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(next, id);
          changed++;
        }
      }
    }
  });
  run();
  return changed;
}

/**
 * Прогоняет обработчик по всем текстам базы, где вообще есть токен. Возвращает
 * число изменённых полей.
 *
 * `scope` сужает обход одной сущностью-владельцем — им пользуется экспорт,
 * которому нужны только тексты выгружаемого сеттинга или системы.
 */
export function rewriteAllMentions(
  fn: (m: Mention, where: TextColumn & { id: number }) => string | null,
  scope?: { column: string; value: number }
): number {
  let changed = 0;
  const run = db.transaction(() => {
    for (const { table, column } of mentionTextColumns()) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name
      );
      if (scope && !cols.includes(scope.column)) continue;
      const where = scope
        ? `${column} LIKE '%[[%' AND ${scope.column} = ?`
        : `${column} LIKE '%[[%'`;
      const rows = db
        .prepare(`SELECT id, ${column} AS value FROM ${table} WHERE ${where}`)
        .all(...(scope ? [scope.value] : [])) as { id: number; value: string | null }[];
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
      for (const row of rows) {
        if (!row.value) continue;
        const next = rewriteMentions(row.value, (m) => fn(m, { table, column, id: row.id }));
        if (next !== row.value) {
          update.run(next, row.id);
          changed++;
        }
      }
    }
  });
  run();
  return changed;
}
