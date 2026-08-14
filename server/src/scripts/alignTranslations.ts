// Сверка присланных файлов system-import/1 с переводом, принятым в компендиуме.
//
//   npx tsx src/scripts/alignTranslations.ts <файл…> [--system 1] [--apply]
//
// Книгу разбирала нейросеть, и русские названия у неё свои: «Скольжение» там,
// где в компендиуме «Намасливание», «Мельфова кислотная стрела» против
// «Кислотной стрелы Мельфа». Ключ и английский оригинал в скобках при этом
// совпадают — по ним и сверяем, а русскую половину имени заменяем на ту,
// что уже принята.
//
// Без --apply ничего не пишет, только показывает расхождения.

import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { normalizeName } from "../import/names";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const systemIdx = args.indexOf("--system");
const SYSTEM_ID = systemIdx >= 0 ? Number(args[systemIdx + 1]) : 1;
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--system");

/** Английский оригинал в скобках: «Волшебник [Wizard]» → «wizard». */
function original(name: string): string {
  const m = /\[([^\]]+)\]/.exec(name);
  return (m ? m[1] : "").trim().toLowerCase();
}

interface Entry {
  id: number;
  kind: string;
  name: string;
  key: string | null;
}

const entries = db
  .prepare(
    `SELECT e.id, e.kind, e.name, (SELECT key FROM system_import_keys WHERE entry_id = e.id) AS key
       FROM compendium_entries e WHERE e.system_id = ?`
  )
  .all(SYSTEM_ID) as Entry[];

const byKey = new Map<string, Entry>();
const byOriginal = new Map<string, Entry[]>();
const byName = new Map<string, Entry[]>();
for (const e of entries) {
  if (e.key) byKey.set(e.key, e);
  const orig = original(e.name);
  if (orig) {
    const list = byOriginal.get(`${e.kind}|${orig}`) ?? [];
    list.push(e);
    byOriginal.set(`${e.kind}|${orig}`, list);
  }
  const plain = normalizeName(e.name.replace(/\[[^\]]*\]/g, ""));
  if (plain) {
    const list = byName.get(`${e.kind}|${plain}`) ?? [];
    list.push(e);
    byName.set(`${e.kind}|${plain}`, list);
  }
}

/** Ключ файла → вид записи компендиума. */
const KIND_BY_PREFIX: Record<string, string> = {
  "mech.": "mechanic_item",
  "spell.": "spell",
  "class.": "class",
  "sub.": "subclass",
  "feature.": "feature",
  "species.": "species",
  "bg.": "background",
  "feat.": "feat",
  "eq.": "equipment",
  "item.": "magic_item",
  "mon.": "monster",
};

function kindOfKey(key: string): string | null {
  const prefix = Object.keys(KIND_BY_PREFIX).find((p) => key.startsWith(p));
  return prefix ? KIND_BY_PREFIX[prefix] : null;
}

/** Как эта запись называется в компендиуме, если она там есть. */
function compendiumName(key: string, fileName: string): { name: string; how: string } | null {
  const known = byKey.get(key);
  if (known) return { name: known.name, how: "по ключу" };
  const kind = kindOfKey(key);
  if (!kind) return null;
  const orig = original(fileName);
  if (orig) {
    const hits = byOriginal.get(`${kind}|${orig}`) ?? [];
    if (hits.length === 1) return { name: hits[0].name, how: "по оригиналу" };
    if (hits.length > 1) return { name: hits[0].name, how: `по оригиналу (кандидатов ${hits.length})` };
  }
  const plain = normalizeName(fileName.replace(/\[[^\]]*\]/g, ""));
  const same = byName.get(`${kind}|${plain}`) ?? [];
  if (same.length === 1) return { name: same[0].name, how: "по русскому названию" };
  return null;
}

interface Change {
  file: string;
  key: string;
  from: string;
  to: string;
  how: string;
}

const changes: Change[] = [];
const unknown: { file: string; key: string; name: string }[] = [];

/** Обходит всё, у чего есть key и name, на любой глубине файла. */
function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.key === "string" && typeof obj.name === "string") visit(obj);
  for (const value of Object.values(obj)) walk(value, visit);
}

/**
 * Внутри описаний названия стоят вместе с оригиналом: «Опознание [Identify]»,
 * «Кислотная стрела Мельфа [Melf's Acid Arrow]». Русская половина у книги своя,
 * английская — общая, по ней и находим принятый перевод.
 */
const BRACKETED = /\[([A-Za-z][^\]]*)\]/g;
const textChanges = new Map<string, number>();

/**
 * Где кончается предложение и начинается название.
 *
 * Скобка с оригиналом стоит после русского имени, но сколько слов перед ней
 * относится к имени — не видно: «Вы знаете заговор Дружба [Friends]» и
 * «Кислотная стрела Мельфа [Melf's Acid Arrow]» устроены одинаково. Правило
 * простое и держится на грамматике: имя начинается с заглавной буквы, а
 * предложение до него кончается строчным словом. Из подходящих кусков берём
 * самый длинный, но не длиннее принятого названия, — иначе «Затем Опознание»
 * целиком сойдёт за имя.
 */
function nameSpanBefore(text: string, end: number, canonicalWords: number): number | null {
  const head = text.slice(0, end).replace(/\s+$/, "");
  const words: { text: string; start: number }[] = [];
  const re = /[А-Яа-яЁё0-9'’-]+/g;
  for (const m of head.matchAll(re)) words.push({ text: m[0], start: m.index! });
  if (words.length === 0) return null;

  let best: number | null = null;
  for (let take = 1; take <= Math.min(6, words.length); take += 1) {
    const first = words[words.length - take];
    const spanStart = first.start;
    // Между словами куска не должно быть знаков препинания — иначе кусок
    // перешагнул границу предложения или перечисления.
    const span = head.slice(spanStart);
    if (/[.,;:!?()«»"—]/.test(span)) break;
    if (!/^[А-ЯЁ]/.test(first.text)) continue;
    if (take > canonicalWords) break;
    best = spanStart;
  }
  return best;
}

function alignText(text: string, file: string): string {
  let result = "";
  let cursor = 0;
  for (const m of text.matchAll(BRACKETED)) {
    const orig = m[1].trim().toLowerCase();
    // Ищем по всему компендиуму: в описании рядом могут стоять заклинание,
    // предмет и состояние, и заранее неизвестно, что именно упомянуто.
    const hits = entries.filter((e) => original(e.name) === orig);
    if (hits.length !== 1) continue;
    const canonical = hits[0].name;
    const canonicalRu = canonical.replace(/\[[^\]]*\]/g, "").trim();
    const start = nameSpanBefore(text, m.index!, canonicalRu.split(/\s+/).length);
    if (start == null || start < cursor) continue;
    const was = text.slice(start, m.index! + m[0].length);
    if (normalizeName(was) === normalizeName(canonical)) continue;
    const label = `${file}: «${was}» → «${canonical}»`;
    textChanges.set(label, (textChanges.get(label) ?? 0) + 1);
    const wasRu = was.replace(/\[[^\]]*\]/g, "").trim();
    if (wasRu && wasRu !== canonicalRu) learned.set(wasRu, canonicalRu);
    result += text.slice(cursor, start) + canonical;
    cursor = m.index! + m[0].length;
  }
  return result + text.slice(cursor);
}

/**
 * Русское название → принятое в компендиуме, для мест, где английского
 * оригинала рядом нет: в списках заклинаний подкласса книга перечисляет их
 * прозой. Пары со скобками собираются сами (см. learned ниже), а эти
 * пришлось выписать: угадывать «Оживление» → «Воскрешение» не по чему.
 */
const PROSE_FIXES: Record<string, string> = {
  "Кислотная стрела Мельфа": "Мельфова кислотная стрела",
  // В меншене `[[spell.grease|Намасливание]]` — там же именительный падеж.
  "Намасливание": "Скольжение",
  "Оживление": "Воскрешение",
  "Огненная стена": "Стена огня",
  "Силовая стена": "Стена силы",
};

/** Пары, собранные из мест, где оригинал в скобках всё-таки был. */
const learned = new Map<string, string>();

/** Все названия компендиума без английского хвоста — по ним ставится защита. */
const canonicalNames = new Set(
  entries.map((e) => e.name.replace(/\[[^\]]*\]/g, "").trim()).filter(Boolean)
);

function applyProse(text: string, file: string): string {
  let out = text;
  for (const [wrong, right] of [...Object.entries(PROSE_FIXES), ...learned]) {
    if (wrong === right || !out.includes(wrong)) continue;
    // «Вызов феи» — не чужой перевод, а название заклинания Conjure Fey.
    // Такую пару применять нельзя вовсе: она сломает правильное название.
    if (canonicalNames.has(wrong)) continue;
    // Только целым названием: «Стена ветров» внутри «Стена ветров и льда»
    // трогать нельзя, а конец строки и запятая — законная граница.
    // Слева допустим и `|` — название встречается внутри меншена
    // `[[ключ|Название]]`, справа тогда закрывающая скобка.
    const re = new RegExp(`(^|[\\s(«"—:;,|])${wrong}(?=$|[\\s)»".,;:—\\]])`, "g");
    const before = out;
    out = out.replace(re, (m, lead, offset: number) => {
      // «Оживление» внутри «Оживление мертвецов» — часть чужого названия.
      const at = offset + lead.length;
      const tail = out.slice(at);
      const longer = [...canonicalNames].some(
        (name) => name.length > wrong.length && tail.startsWith(name)
      );
      return longer ? m : `${lead}${right}`;
    });
    if (out !== before) {
      const label = `${file}: «${wrong}» → «${right}» (прозой, без оригинала)`;
      textChanges.set(label, (textChanges.get(label) ?? 0) + 1);
    }
  }
  return out;
}

/** Меншены `[[ключ|слово]]`: ключ известен, а слово может быть из чужого перевода. */
const MENTION = /\[\[([a-z][\w.]*)\|([^\]]+)\]\]/g;
const mentionNotes = new Set<string>();

function checkMentions(text: string, file: string): void {
  for (const m of text.matchAll(MENTION)) {
    const target = byKey.get(m[1]);
    if (!target) continue;
    const canonical = target.name.replace(/\[[^\]]*\]/g, "").trim();
    if (normalizeName(canonical) !== normalizeName(m[2])) {
      mentionNotes.add(`${file}: [[${m[1]}|${m[2]}]] — в компендиуме «${canonical}»`);
    }
  }
}

function alignAllText(node: unknown, file: string): void {
  if (Array.isArray(node)) {
    // Строки внутри массивов — это ячейки таблицы развития, а в них тоже
    // стоят названия умений.
    node.forEach((item, i) => {
      if (typeof item === "string") {
        checkMentions(item, file);
        node[i] = alignText(item, file);
      } else alignAllText(item, file);
    });
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [field, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      if (field === "name" || field === "key") continue; // имена правит первый проход
      checkMentions(value, file);
      obj[field] = alignText(value, file);
    } else {
      alignAllText(value, file);
    }
  }
}

/** Второй проход по тексту: словарь названий без скобок. */
function applyProseAll(node: unknown, file: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (typeof item === "string") node[i] = applyProse(item, file);
      else applyProseAll(item, file);
    });
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [field, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      if (field === "name" || field === "key") continue;
      obj[field] = applyProse(value, file);
    } else {
      applyProseAll(value, file);
    }
  }
}

// Порядок важен: сначала по всем файлам собираются пары «книжное название →
// принятое» из мест с оригиналом в скобках, и только потом они применяются к
// прозе — иначе список заклинаний подкласса из второй главы чинился бы парами,
// которых на тот момент ещё нет.
const parsed = files.map((file) => ({
  file,
  short: path.basename(file),
  raw: JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
}));

// --- умения внутри класса, подкласса и вида ----------------------------------
//
// У умений нет ни ключа в компендиуме, ни английского хвоста в названии, а
// одинаковых имён по системе много: «Увеличение характеристик» есть у каждого
// класса. Поэтому сверяются они не по всему компендиуму, а внутри своего
// родителя — и главный признак там уровень: на 6-м уровне у Артефактора ровно
// одно умение, как бы книга его ни называла.

function resolveEntry(key: string, name: string): Entry | null {
  const known = byKey.get(key);
  if (known) return known;
  const kind = kindOfKey(key);
  if (!kind) return null;
  const orig = original(name);
  const byOrig = orig ? byOriginal.get(`${kind}|${orig}`) ?? [] : [];
  if (byOrig.length === 1) return byOrig[0];
  const same = byName.get(`${kind}|${normalizeName(name.replace(/\[[^\]]*\]/g, ""))}`) ?? [];
  return same.length === 1 ? same[0] : null;
}

const childrenOf = db.prepare(
  "SELECT id, kind, name, level FROM compendium_entries WHERE parent_id = ? AND kind = ?"
);

/** Доля общих корней двух названий, 0..1. */
function nameOverlap(a: string, b: string): number {
  const stem = (w: string) => w.slice(0, 4);
  const left = new Set(normalizeName(a).split(" ").filter(Boolean).map(stem));
  const right = new Set(normalizeName(b).split(" ").filter(Boolean).map(stem));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function alignChildren(
  parentKey: string,
  parentName: string,
  kids: { key: string; name: string; level?: number }[],
  kind: "feature" | "class_option",
  file: string
): void {
  const parent = resolveEntry(parentKey, parentName);
  if (!parent) return;
  const pool = childrenOf.all(parent.id, kind) as { id: number; name: string; level: number | null }[];
  if (pool.length === 0) return;

  const free = [...pool];
  // Список умений файла трогать нельзя: он и есть содержимое главы. Сопоставление
  // ведётся на копии, из неё же и вычёркиваются уже разобранные.
  const rest = [...kids];
  // Хвостовая точка в названии — след копирования из книги, а не другой
  // перевод: «Ментальная дисциплина. » и «Ментальная дисциплина» — одно и то
  // же, и портить файл ради этого не надо (импорт заодно почистит запись).
  const bare = (name: string) => normalizeName(name.replace(/[.\s]+$/, ""));
  const take = (index: number, kid: { key: string; name: string }) => {
    const target = free.splice(index, 1)[0];
    if (bare(target.name) === bare(kid.name)) return;
    // Хвостовую точку не тащим в файл: она попала в компендиум при вставке из
    // книги, и импорт заодно уберёт её из самой записи.
    const clean = target.name.replace(/[.\s]+$/, "");
    changes.push({
      file,
      key: kid.key,
      from: kid.name,
      to: clean,
      how: `умение ${parentName}`,
    });
    // Умения ссылаются друг на друга по названию прямо в тексте («для вашего
    // умения Воссоздание магического предмета»), поэтому пара уходит в общий
    // словарь и правит эти упоминания тоже.
    learned.set(kid.name, clean);
    kid.name = clean;
  };

  // Сначала точные совпадения — но только на своём уровне. Иначе «Мастер
  // магических предметов» 6-го уровня цепляется к одноимённому умению 18-го,
  // а настоящая пара (в компендиуме он «Магический мастеровой») остаётся ни с
  // чем.
  for (const kid of [...rest]) {
    const i = free.findIndex(
      (c) => bare(c.name) === bare(kid.name) && (kid.level == null || c.level === kid.level)
    );
    if (i >= 0) {
      take(i, kid);
      rest.splice(rest.indexOf(kid), 1);
    }
  }
  // Затем по уровню: если на уровне осталось по одному с каждой стороны —
  // это одно и то же умение, как бы оно ни называлось.
  for (const kid of [...rest]) {
    if (kid.level == null) continue;
    const same = free.filter((c) => c.level === kid.level);
    const rivals = rest.filter((k) => k.level === kid.level);
    if (same.length === 1 && rivals.length === 1) {
      take(free.indexOf(same[0]), kid);
      rest.splice(rest.indexOf(kid), 1);
    }
  }
  // Одноимённое на другом уровне — всё-таки одно и то же умение: увеличение
  // характеристик книга даёт на 4-м, а в компендиуме оно записано на 8-м.
  for (const kid of [...rest]) {
    const i = free.findIndex((c) => bare(c.name) === bare(kid.name));
    if (i >= 0) {
      take(i, kid);
      rest.splice(rest.indexOf(kid), 1);
    }
  }
  // Остальное на том же уровне — по похожести названия.
  for (const kid of [...rest]) {
    if (kid.level == null) continue;
    const scored = free
      .map((c, i) => ({ i, c, score: c.level === kid.level ? nameOverlap(kid.name, c.name) : 0 }))
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      take(scored[0].i, kid);
      rest.splice(rest.indexOf(kid), 1);
    }
  }
}

function alignNested(raw: unknown, file: string): void {
  const data = raw as {
    classes?: {
      key: string;
      name: string;
      features?: { key: string; name: string; level?: number }[];
      options?: { entries?: { key: string; name: string; level?: number }[] };
      subclasses?: {
        key: string;
        name: string;
        features?: { key: string; name: string; level?: number }[];
      }[];
    }[];
    species?: {
      key: string;
      name: string;
      features?: { key: string; name: string; level?: number }[];
    }[];
  };
  for (const c of data.classes ?? []) {
    alignChildren(c.key, c.name, c.features ?? [], "feature", file);
    alignChildren(c.key, c.name, c.options?.entries ?? [], "class_option", file);
    for (const sub of c.subclasses ?? []) {
      // Название подкласса к этому моменту уже приведено к принятому — иначе
      // родителя было бы не найти.
      alignChildren(sub.key, sub.name, sub.features ?? [], "feature", file);
    }
  }
  for (const s of data.species ?? []) {
    alignChildren(s.key, s.name, s.features ?? [], "feature", file);
  }
}

for (const p of parsed) alignAllText(p.raw, p.short);
for (const p of parsed) applyProseAll(p.raw, p.short);

for (const { file, short, raw } of parsed) {
  walk(raw, (obj) => {
    const key = obj.key as string;
    const name = obj.name as string;
    const hit = compendiumName(key, name);
    if (!hit) {
      unknown.push({ file: short, key, name });
      return;
    }
    if (hit.name === name) return;
    changes.push({ file: short, key, from: name, to: hit.name, how: hit.how });
    obj.name = hit.name;
  });
  void file;
}

// Умения — последними: их родителей (класс, подкласс, вид) к этому моменту уже
// переименовали в принятые названия, и только по ним они и находятся.
for (const { short, raw } of parsed) alignNested(raw, short);

// И ещё раз по тексту: теперь словарь знает и переименованные умения.
for (const p of parsed) applyProseAll(p.raw, p.short);

for (const { file, raw } of parsed) {
  if (APPLY) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

console.log("\n=== Сверка перевода с компендиумом ===\n");
const byFile = new Map<string, Change[]>();
for (const c of changes) {
  const list = byFile.get(c.file) ?? [];
  list.push(c);
  byFile.set(c.file, list);
}
for (const [file, list] of byFile) {
  console.log(`  ${file} — расхождений ${list.length}`);
  for (const c of list) console.log(`      «${c.from}» → «${c.to}»  (${c.how})`);
}
// Не нашлось по ключу, оригиналу и названию — но это ещё не значит «нового
// содержимого». Умения Эберрона в компендиуме и правда новые, а вот справочник,
// черты и виды там наверняка есть — просто названы иначе и без английского
// хвоста, по которому сверяются остальные. Поэтому для них показываем похожее.
const EXPECTED_NEW = new Set(["feature", "class_option"]);
const suspicious = unknown.filter((u) => {
  const kind = kindOfKey(u.key);
  return kind && !EXPECTED_NEW.has(kind);
});
const expected = unknown.length - suspicious.length;

console.log(`\n  === Названия внутри описаний ===`);
const sortedText = [...textChanges.entries()].sort((a, b) => b[1] - a[1]);
for (const [label, count] of sortedText) {
  console.log(`      ${label}${count > 1 ? ` ×${count}` : ""}`);
}
console.log(`  всего замен в тексте: ${[...textChanges.values()].reduce((a, b) => a + b, 0)}`);

if (mentionNotes.size > 0) {
  console.log(`\n  === Меншены с чужим переводом (правятся вручную, там падежи) ===`);
  for (const note of mentionNotes) console.log(`      ${note}`);
}

console.log(`\n  новых умений и опций (так и должно быть): ${expected}`);
console.log(`  прочих ненайденных: ${suspicious.length}\n`);
for (const u of suspicious) {
  const kind = kindOfKey(u.key)!;
  const wanted = normalizeName(u.name.replace(/\[[^\]]*\]/g, ""));
  const pool = entries.filter((e) => e.kind === kind);
  const scored = pool
    .map((e) => ({ e, score: overlap(wanted, normalizeName(e.name.replace(/\[[^\]]*\]/g, ""))) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const hint = scored.length ? scored.map((s) => `«${s.e.name}»`).join(" | ") : "ничего похожего";
  console.log(`      ${u.key} — «${u.name}» → ${hint}`);
}

/** Доля общих корней (первые 5 букв слова) — грубо, но для подсказки хватает. */
function overlap(a: string, b: string): number {
  const stem = (w: string) => w.slice(0, 5);
  const left = new Set(a.split(" ").filter(Boolean).map(stem));
  const right = new Set(b.split(" ").filter(Boolean).map(stem));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

console.log(APPLY ? "\nФайлы перезаписаны." : "\nСухой прогон: файлы не изменены. Для записи — --apply.");
