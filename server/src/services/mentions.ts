// Ссылки внутри текста: разбор, перезапись и глобальные ключи.
//
// В тексте ссылка живёт **одной** формой:
//
//     [[being@8f3c1a2e|wdh|Мирт]]
//
// Первое поле — тип, второе — начало глобального uid цели, третье — код (или
// имя) модуля, откуда цель родом, четвёртое — подпись, которую читает человек.
//
// Локального id в тексте нет и не должно быть: он верен ровно в пределах
// одного файла базы, и любой путь переноса данных обязан был бы отдельно
// переписывать все id в текстах — а тот путь, который об этом забудет, молча
// переклеит ссылки на чужие сущности.
//
// **Жива ли ссылка — не записано, а вычисляется.** Она жива ровно тогда, когда
// её uid находится в базе. Поэтому здесь нет ни прохода подвешивания при
// удалении, ни прохода исцеления после установки модуля: удалили цель — ссылка
// зачёркнута сама, поставили модуль — ожила сама. Раньше состояние дублировалось
// в текст, и два прохода существовали только затем, чтобы этот дубль не
// разъезжался с базой.
//
// **Почему в тексте не полный uid.** Мастер редактирует в сыром `<textarea>` и
// видит токен целиком. Полный UUID превращает абзац с тремя ссылками в кашу, а
// платится эта цена при каждой правке — в отличие от переноса, который бывает
// раз в полгода. Поэтому пишется минимальный однозначный префикс: не короче
// восьми символов, длиннее — если внутри того же типа нашёлся двойник.
//
// **Наследство.** Старая форма `[[being:412|Мирт]]` ещё читается: разовая
// миграция не заходит в `modules.source_json`, переписывать который нельзя, и
// оттуда старый токен может всплыть. Но никогда не пишется.
//
// Вся работа со ссылками — экспорт, импорт, слияние, снятие — выражена через
// одну функцию `rewriteMentions`. Это сделано намеренно: пока перезапись была
// размазана по маршрутам, экспорт её просто не делал, и ссылки после переноса
// указывали на чужие сущности.

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
 * остальное (кампания, сессия, персонаж, игрок) ссылку выпускать наружу
 * бессмысленно — эти сущности не переносятся, и обещание «оживёт, когда
 * поставишь модуль» будет ложным. Такие ссылки при экспорте схлопываются в
 * обычный текст.
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

// Рабочая форма стоит первой ветвью не случайно: обе начинаются с «[[», и если
// первым пробовать наследство, его `(\d+)` не совпадёт, а разбор уедет в
// следующий токен.
//
// Дефисы в uid принимаются, хотя мы их не пишем: файлы, выгруженные до
// перехода на префиксы, несут полный UUID с дефисами, и читать их надо.
//
// Код модуля стоит раньше подписи, потому что подпись пишет человек и в ней
// может оказаться «|», а код мы чистим при записи.
const MENTION_RE =
  /\[\[(\w+)@([0-9a-fA-F][0-9a-fA-F-]{7,31})\|([^|\]]*)\|([^\]]*)\]\]|\[\[(\w+):(\d+)\|([^\]]*)\]\]/g;

export interface RefMention {
  kind: "ref";
  type: string;
  /** Как записано в тексте: префикс uid, возможно с дефисами. */
  uid: string;
  /** Код или имя модуля, откуда цель родом: его показывает окно «ссылка не работает». */
  source: string;
  label: string;
  raw: string;
  start: number;
  end: number;
}

/** Наследство: локальный id. Только читается, никогда не пишется. */
export interface LegacyMention {
  kind: "legacy";
  type: string;
  id: number;
  label: string;
  raw: string;
  start: number;
  end: number;
}

export type Mention = RefMention | LegacyMention;

/** Код модуля пишется в текст, поэтому в нём не должно быть разделителей. */
const cleanSource = (s: string) => s.replace(/[|\]\[]/g, " ").trim();

/** uid без дефисов и в нижнем регистре — единственная форма, в которой их сравнивают. */
export const normUid = (uid: string) => uid.replace(/-/g, "").toLowerCase();

export const formatRef = (type: string, uid: string, source: string, label: string) =>
  `[[${type}@${normUid(uid)}|${cleanSource(source)}|${label}]]`;

/** Все ссылки в тексте, в порядке появления. */
export function scanMentions(text: string): Mention[] {
  const found: Mention[] = [];
  if (!text || !text.includes("[[")) return found;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text))) {
    const [raw, refType, uid, source, refLabel, oldType, oldId, oldLabel] = m;
    if (refType) {
      found.push({
        kind: "ref",
        type: refType,
        uid,
        source: source ?? "",
        label: refLabel ?? "",
        raw,
        start: m.index,
        end: m.index + raw.length,
      });
    } else if (oldType) {
      found.push({
        kind: "legacy",
        type: oldType,
        id: Number(oldId),
        label: oldLabel ?? "",
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

/** Короче этого префикс в тексте не бывает. */
export const MIN_PREFIX = 8;

/**
 * Все сущности типа, чей uid начинается с тех же восьми символов.
 *
 * Дефисы в UUID стоят на фиксированных местах, поэтому первые восемь
 * шестнадцатеричных символов — это ровно `substr(uid, 1, 8)`, и отбор делает
 * SQLite. Дальше сравнение идёт в JS по нормализованному виду: кандидатов
 * почти всегда один.
 */
function siblings(type: string, prefix8: string): { id: number; uid: string }[] {
  const table = MENTIONABLE[type];
  if (!table) return [];
  return db
    .prepare(`SELECT id, uid FROM ${table} WHERE substr(lower(uid), 1, 8) = ?`)
    .all(prefix8) as { id: number; uid: string }[];
}

/**
 * То, что пишется в текст: минимальный префикс uid, однозначный **внутри
 * своего типа**. Типов пятнадцать, и `[[being@…]]` с `[[location@…]]` друг
 * другу не мешают, поэтому запас шире, чем кажется по длине.
 */
export function prefixOf(type: string, id: number): string | null {
  const uid = uidOf(type, id);
  if (!uid) return null;
  const full = normUid(uid);
  const rivals = siblings(type, full.slice(0, MIN_PREFIX))
    .filter((r) => r.id !== id)
    .map((r) => normUid(r.uid));
  if (!rivals.length) return full.slice(0, MIN_PREFIX);
  for (let len = MIN_PREFIX + 4; len < full.length; len += 4) {
    const head = full.slice(0, len);
    if (!rivals.some((r) => r.startsWith(head))) return head;
  }
  return full;
}

/**
 * Обратный поиск: есть ли на этом устройстве сущность с таким глобальным
 * ключом. Принимает и полный uid, и префикс — в тексте лежит префикс, а в
 * файлах, выгруженных до перехода, полный UUID.
 *
 * Неоднозначный префикс (двойник появился после того, как ссылку написали) не
 * резолвится ни во что: показать зачёркнутую ссылку честнее, чем угадать одну
 * из двух сущностей.
 */
export function idOfUid(type: string, uid: string): number | null {
  const want = normUid(uid);
  const rows = siblings(type, want.slice(0, MIN_PREFIX));
  const exact = rows.find((r) => normUid(r.uid) === want);
  if (exact) return exact.id;
  const matches = rows.filter((r) => normUid(r.uid).startsWith(want));
  return matches.length === 1 ? matches[0].id : null;
}

/** Существует ли строка вообще. */
export function exists(type: string, id: number): boolean {
  const table = MENTIONABLE[type];
  if (!table) return false;
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
}

/** Сеттинг или система, которой сущность принадлежит. */
function ownerOf(type: string, id: number): { table: string; id: number } | null {
  const table = MENTIONABLE[type];
  if (!table) return null;
  if (type === "setting") return { table: "settings", id };
  const owner =
    type === "compendium_entry"
      ? { column: "system_id", table: "systems" }
      : { column: "setting_id", table: "settings" };
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!cols.includes(owner.column)) return null;
  const row = db.prepare(`SELECT ${owner.column} AS owner FROM ${table} WHERE id = ?`).get(id) as
    | { owner: number | null }
    | undefined;
  return row?.owner == null ? null : { table: owner.table, id: row.owner };
}

/**
 * Чьё это, глазами человека: короткий код модуля (`wdh`), если Мастер его
 * назначил, иначе полное имя сеттинга или системы.
 *
 * Попадает в токен и оттуда — в окно «поставьте модуль такой-то». Код короче и
 * потому не мешает читать сырой текст при правке; имя остаётся запасным
 * вариантом, чтобы коды можно было не заводить вовсе.
 */
export function sourceCodeOf(type: string, id: number): string {
  const owner = ownerOf(type, id);
  if (!owner) return "";
  const row = db.prepare(`SELECT code, name FROM ${owner.table} WHERE id = ?`).get(owner.id) as
    | { code: string | null; name: string }
    | undefined;
  if (!row) return "";
  return (row.code || "").trim() || row.name;
}

/** Код едет в текст ссылки, поэтому в нём нет ни разделителей, ни пробелов. */
export const cleanCode = (s: string) =>
  s.replace(/[^0-9a-zA-Zа-яёА-ЯЁ_-]/g, "").slice(0, 16).toLowerCase();

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

const latin = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");

/**
 * Что подставить в поле кода при создании сеттинга или системы.
 *
 * Это предложение, а не решение: «Вотердип» даст `vtr`, хотя Мастер захочет
 * `wdh` — потому что это аббревиатура книги, которую он знает наизусть, а не
 * сокращение слова. Смысл автовыбора в другом: не превращать создание сеттинга
 * в задачу «придумай код» ровно тогда, когда человек хотел просто завести
 * сеттинг. Многословное имя сокращается по первым буквам («Legend in the Mist»
 * → `litm`), однословное — по согласным.
 */
export function suggestCode(table: "settings" | "systems", name: string): string {
  const words = latin(name)
    .split(/[^0-9a-z]+/)
    .filter(Boolean);
  let base = "";
  if (words.length > 1) {
    base = words.map((w) => w[0]).join("").slice(0, 4);
  } else if (words.length === 1) {
    const w = words[0];
    base = (w[0] + w.slice(1).replace(/[aeiouy]/g, "")).slice(0, 3) || w.slice(0, 3);
  }
  base = cleanCode(base);
  if (!base) return "";
  let candidate = base;
  for (let n = 2; codeTakenBy(candidate, table, null) && n < 100; n++) {
    candidate = `${base}${n}`;
  }
  return candidate;
}

/**
 * Все модули с их кодами и именами.
 *
 * Читается целиком и сравнивается в JS, а не запросом с `lower()`: SQLite
 * приводит регистр только у ASCII, и «Вотердип» там остаётся «Вотердип» — из-за
 * чего поиск по имени молча не находил ничего. Строк здесь полтора десятка,
 * так что читать их дешевле, чем городить регистронезависимое сравнение в SQL.
 */
function moduleOwners(): { table: string; id: number; code: string; name: string }[] {
  const out: { table: string; id: number; code: string; name: string }[] = [];
  for (const table of ["settings", "systems"]) {
    const rows = db.prepare(`SELECT id, code, name FROM ${table}`).all() as {
      id: number;
      code: string | null;
      name: string;
    }[];
    for (const r of rows) out.push({ table, id: r.id, code: r.code ?? "", name: r.name });
  }
  return out;
}

/** Кто уже носит такой код — имя владельца или null. Проверка, а не запрет. */
export function codeTakenBy(
  code: string,
  table: "settings" | "systems",
  exceptId: number | null
): string | null {
  const want = cleanCode(code);
  if (!want) return null;
  const hit = moduleOwners().find(
    (o) =>
      o.code.toLowerCase() === want && !(o.table === table && exceptId != null && o.id === exceptId)
  );
  return hit ? hit.name : null;
}

/**
 * Обратное превращение для окна неработающей ссылки: код `wdh` → «Вотердип».
 * Отвечает только про то, что известно этому устройству; каталог модулей
 * спрашивает маршрут, который это зовёт.
 */
export function sourceNameByCode(code: string): string | null {
  const want = code.trim().toLowerCase();
  if (!want) return null;
  const hit = moduleOwners().find(
    (o) => o.code.toLowerCase() === want || o.name.toLowerCase() === want
  );
  return hit ? hit.name : null;
}

// ─── Политики: что делать со ссылкой в каждой из ситуаций ────────────────────

/**
 * **Экспорт.** Ссылка на непереносимое (кампания, сессия, персонаж, игрок,
 * ресурс, мастерская заметка) схлопывается в подпись: на чужом устройстве она
 * не оживёт никогда, и обещать модуль, которого не существует, — то самое
 * враньё, ради недопущения которого глобальная форма и заводилась.
 *
 * Наследство переводится в глобальную форму по дороге: локальный id в файле на
 * чужом устройстве означает другую сущность.
 */
export function exportMention(m: Mention): string | null {
  if (!TRANSFERABLE.has(m.type)) return m.label;
  if (m.kind === "ref") return null;
  const prefix = prefixOf(m.type, m.id);
  if (!prefix) return m.label;
  return formatRef(m.type, prefix, sourceCodeOf(m.type, m.id), m.label);
}

/**
 * **Импорт.** Собирает то, что импорт создал, и по окончании поправляет ссылки
 * в его текстах.
 *
 * Ключевая тонкость — почему нельзя просто оставить uid из файла как есть.
 * Модуль можно поставить второй раз, не удаляя первый: тогда ключ уже занят,
 * копия получает свежий, и тексты копии, приехавшие со старыми ключами,
 * показывали бы на **первую** копию. Поэтому импорт помнит, какой ключ из
 * файла во что превратился, и переписывает свои тексты на новые ключи.
 */
export class ImportedEntities {
  /** тип → [uid из файла, новый локальный id]. Ищется по префиксу, как и в тексте. */
  private byUid = new Map<string, { uid: string; id: number }[]>();
  /** Строки, созданные импортом: только их тексты и правим. */
  private rows: { table: string; id: number }[] = [];

  /**
   * Закрепляет за новой строкой её глобальный ключ.
   *
   * uid из файла сохраняется как есть — благодаря этому удалённый и заново
   * поставленный модуль опознаётся как тот же самый, и зачёркнутые ссылки на
   * него оживают. Если ключ уже занят (тот же модуль ставят второй раз), копия
   * получает свежий: уникальность важнее совпадения, иначе две копии стали бы
   * одной сущностью.
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
    if (fromFile) {
      const list = this.byUid.get(type) ?? [];
      list.push({ uid: normUid(fromFile), id: newId });
      this.byUid.set(type, list);
    }
  }

  /** Строка без собственного uid — статблок, глава, — но с текстом под правку. */
  track(table: string, id: number): void {
    this.rows.push({ table, id });
  }

  /** Кого этот импорт создал под ключом, начинающимся так, как написано в тексте. */
  private mine(type: string, uid: string): number | null {
    const want = normUid(uid);
    const list = this.byUid.get(type) ?? [];
    const exact = list.find((e) => e.uid === want);
    if (exact) return exact.id;
    const hits = list.filter((e) => e.uid.startsWith(want) || want.startsWith(e.uid));
    return hits.length === 1 ? hits[0].id : null;
  }

  /**
   * Второй проход: ссылки в созданных текстах приводятся к местным ключам.
   *
   * Наследственная форма во входящем файле означает ровно одно — файл сделан
   * до появления глобальных ключей. Опознать её цель нечем и никогда не будет
   * чем, а числу в ней верить нельзя: оно указывает на строку чужой базы.
   * Такая схлопывается в подпись — проза читается как читалась, ложной ссылки
   * не остаётся.
   *
   * Ссылка на то, чего этот импорт не создавал, не трогается: либо цель уже
   * есть в базе под тем же ключом и всё сойдётся само, либо её нет и ссылка
   * честно останется зачёркнутой до установки нужного модуля.
   */
  resolve(): number {
    return rewriteRows(this.rows, (m) => {
      if (m.kind === "legacy") return m.label;
      const id = this.mine(m.type, m.uid);
      if (id == null) return null;
      const prefix = prefixOf(m.type, id);
      if (!prefix) return null;
      return formatRef(m.type, prefix, sourceCodeOf(m.type, id) || m.source, m.label);
    });
  }
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
let cachedMentionColumns: TextColumn[] | null = null;
let cachedMentionColumnsAt = 0;
export function mentionTextColumns(): TextColumn[] {
  const now = Date.now();
  if (cachedMentionColumns && now - cachedMentionColumnsAt < 10000) return cachedMentionColumns;
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
  cachedMentionColumns = out;
  cachedMentionColumnsAt = now;
  return out;
}
export function invalidateMentionColumnsCache() {
  cachedMentionColumns = null;
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

/**
 * Карта для клиента: чем является каждый глобальный ключ на этом устройстве.
 *
 * Рендер ссылок синхронный — `MentionText` разбирает текст и сразу строит
 * маршрут, без единого запроса, — поэтому знание «uid → тип:id» должно быть
 * у клиента заранее. Одной картой закрываются сразу три нужды: куда ведёт
 * ссылка, зачёркнута ли она (uid не нашёлся) и какой локальный id положить в
 * граф связей.
 *
 * Владельцы вынесены отдельным словарём, а не повторены в каждой строке:
 * сеттингов и систем полтора десятка на тысячи сущностей.
 */
export interface MentionIndex {
  owners: Record<string, { code: string; name: string }>;
  entities: Record<string, [number, string, string | null][]>;
}

export function mentionIndex(): MentionIndex {
  const owners: MentionIndex["owners"] = {};
  for (const [table, prefix] of [
    ["settings", "s"],
    ["systems", "y"],
  ] as const) {
    const rows = db.prepare(`SELECT id, code, name FROM ${table}`).all() as {
      id: number;
      code: string | null;
      name: string;
    }[];
    for (const r of rows) owners[`${prefix}${r.id}`] = { code: r.code ?? "", name: r.name };
  }

  const entities: MentionIndex["entities"] = {};
  for (const [type, table] of Object.entries(MENTIONABLE)) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!cols.includes("uid")) continue;
    const ownerCol = type === "setting" ? null : cols.includes("system_id") ? "system_id" : cols.includes("setting_id") ? "setting_id" : null;
    const ownerPrefix = ownerCol === "system_id" ? "y" : "s";
    const rows = db
      .prepare(
        `SELECT id, uid${ownerCol ? `, ${ownerCol} AS owner` : ""} FROM ${table} WHERE uid IS NOT NULL`
      )
      .all() as { id: number; uid: string; owner?: number | null }[];
    entities[type] = rows.map((r) => [
      r.id,
      normUid(r.uid),
      type === "setting"
        ? `s${r.id}`
        : r.owner == null
          ? null
          : `${ownerPrefix}${r.owner}`,
    ]);
  }
  return { owners, entities };
}
