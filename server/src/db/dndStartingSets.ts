import type { Database } from "better-sqlite3";

/**
 * Стартовые наборы: из свободного текста — в ссылки на снаряжение.
 *
 * Зачем. У класса и предыстории набор «A» лежал одной строкой («Кожаный
 * доспех, 2 кинжала, музыкальный инструмент по вашему выбору, набор артиста
 * и 19 зм»), а поле `equipment_a_items` пустовало у всех 49 записей. Кнопка
 * «взять набор» на листе поэтому добавляла только золото и выглядела
 * сломанной — она и была нечем.
 *
 * Что делает разбор. Отрезает хвост «и N зм» (золото уже разобрано
 * отдельно), режет по запятым **вне скобок** («Музыкальный инструмент (тот,
 * что вы выбрали)» — одна позиция), снимает уточнение в скобках и достаёт
 * из него количество («масло (3 фляги)» → «Масло» ×3), сводит слова по
 * основе («2 кинжала» → «Кинжал», «4 ручных топора» → «Ручной топор»).
 *
 * Правило записи — однозначно или никак. Ссылка ставится, только когда
 * название сошлось ровно с одной записью справочника; всё остальное
 * остаётся подписью в `equipment_a_manual` и попадает в инвентарь строкой
 * «выбрать самому». Так задумано: «инструменты ремесленника, владение
 * которыми вы выбрали ранее» — это выбор игрока, а не предмет.
 *
 * На справочнике владельца: 232 позиции из 243 легли ссылками, 5 остались
 * выбором, 6 — подписью (книга заклинаний, которой в справочнике нет, и
 * «те инструменты, что вы выбрали»).
 */

const MIGRATION_KEY = "dnd_starting_sets_linked";

const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^а-яa-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string): string[] => norm(s).split(" ").filter(Boolean);

/**
 * Слова считаются одним, если различаются только хвостом: «ручных/ручной»,
 * «сумки/сумка», «топора/топор». Общего должно быть всё, кроме двух
 * последних букв, и не меньше четырёх — иначе «лом» сойдётся с «ломбардом».
 */
function sameWord(a: string, b: string): boolean {
  const min = Math.min(a.length, b.length);
  if (min < 4) return a === b;
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= Math.max(4, min - 2);
}

/**
 * Расхождения написания между текстом набора и справочником — ровно те, что
 * вылезли на разборе 49 наборов. Каждое сверено по английскому имени записи:
 * «огниво» — это Tinderbox, «кошель» — Pouch, «набор для грима» — Disguise
 * Kit. Догадок здесь нет: то, что не сошлось, осталось подписью.
 */
const ALIASES: [string, string][] = [
  ["ломик", "Лом"],
  ["огниво", "Трутница"],
  ["кошель", "Сумка"],
  ["кошеля", "Сумка"],
  ["кошелей", "Сумка"],
  ["зеркальце", "Зеркало"],
  ["стальное зеркало", "Зеркало"],
  ["отличная одежда", "Парадная одежда"],
  ["дорожная одежда", "Одежда путешественника"],
  ["обычный фонарь", "Фонарь, закрытый"],
  ["набор для грима", "Набор для маскировки"],
  ["тубус для карт и свитков", "Футляр для карт или свитков"],
  ["проклёпанный кожаный доспех", "Проклёпанная кожа"],
  ["набор лекаря", "Комплект целителя"],
  ["набор целителя", "Комплект целителя"],
  ["комплект для лазания", "Набор для лазания"],
  ["символ религии", "Священный символ"],
  ["метательных копий", "Метательное копьё"],
  ["писчих перьев", "Писчее перо"],
];

interface Item {
  id: number;
  name: string;
  words: string[];
}

type Piece =
  | { kind: "ok"; qty: number; id: number; name: string }
  | { kind: "manual"; text: string };

/** Режет по запятым вне скобок: запятая внутри уточнения — часть фразы. */
function splitPieces(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

function matchPiece(raw: string, index: Item[], aliases: Map<string, Item>): Piece {
  let qty = 1;
  const paren = /\(([^)]*)\)/.exec(raw);
  let body = raw.replace(/\([^)]*\)/g, " ").trim();
  if (paren) {
    const num = /(\d+)/.exec(paren[1]);
    if (num) qty = Number(num[1]);
  }
  const leading = /^(\d+)\s+(.+)$/.exec(body);
  if (leading) {
    qty = Number(leading[1]);
    body = leading[2];
  }

  const alias = aliases.get(norm(body));
  if (alias) return { kind: "ok", qty, id: alias.id, name: alias.name };

  const bodyWords = words(body);
  if (bodyWords.length === 0) return { kind: "manual", text: raw };

  // Совпасть должны все слова с обеих сторон — иначе «набор путешественника»
  // сошёлся бы с «набором взломщика».
  const scored = index
    .map((it) => {
      const forward = bodyWords.filter((w) => it.words.some((x) => sameWord(w, x))).length;
      const back = it.words.filter((x) => bodyWords.some((w) => sameWord(w, x))).length;
      if (forward !== bodyWords.length) return null;
      return { it, exact: back === it.words.length };
    })
    .filter((x): x is { it: Item; exact: boolean } => x !== null);
  const exact = scored.filter((x) => x.exact);
  const pool = exact.length > 0 ? exact : scored;
  if (pool.length === 1) return { kind: "ok", qty, id: pool[0].it.id, name: pool[0].it.name };
  return { kind: "manual", text: raw };
}

export function migrateDndStartingSets(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let linked = 0;
  let manualCount = 0;
  let sets = 0;

  const run = database.transaction(() => {
    const owners = database
      .prepare(
        `SELECT e.id, e.system_id, e.data
           FROM compendium_entries e
           JOIN system_sections s ON s.id = e.section_id
          WHERE s.kind IN ('class', 'background') AND e.parent_id IS NULL`
      )
      .all() as { id: number; system_id: number; data: string }[];
    const equipmentOf = database.prepare(
      `SELECT e.id, e.name
         FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
        WHERE s.kind = 'equipment' AND e.system_id = ?`
    );
    const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

    // Справочник снаряжения свой у каждой системы — индекс строится по мере
    // надобности и переиспользуется.
    const indexes = new Map<number, { index: Item[]; aliases: Map<string, Item> }>();
    function indexFor(systemId: number) {
      const cached = indexes.get(systemId);
      if (cached) return cached;
      const rows = equipmentOf.all(systemId) as { id: number; name: string }[];
      const index: Item[] = rows.map((r) => ({ id: r.id, name: r.name, words: words(r.name) }));
      const aliases = new Map<string, Item>();
      for (const [from, to] of ALIASES) {
        const target = index.find((it) => norm(it.name) === norm(to));
        if (target) aliases.set(norm(from), target);
      }
      const built = { index, aliases };
      indexes.set(systemId, built);
      return built;
    }

    for (const owner of owners) {
      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(owner.data || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        data = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      // Уже разобрано (руками владельца или прошлым запуском) — не трогаем.
      if (Array.isArray(data.equipment_a_items) && data.equipment_a_items.length > 0) continue;
      const text = typeof data.equipment_a === "string" ? data.equipment_a : "";
      if (!text.trim()) continue;

      const { index, aliases } = indexFor(owner.system_id);
      if (index.length === 0) continue;

      // Хвост «и 19 зм» — это золото, оно лежит в equipment_a_gold.
      const body = text.replace(/\s*,?\s*и\s+\d+\s*зм\.?\s*$/i, "").trim();
      const pieces = splitPieces(body).map((p) => matchPiece(p, index, aliases));

      const items = pieces
        .filter((p): p is Extract<Piece, { kind: "ok" }> => p.kind === "ok")
        .map((p) => ({ entryId: p.id, name: p.name, qty: p.qty }));
      // Соседние неразобранные куски склеиваются обратно: у Монаха это
      // «инструменты ремесленника или музыкальный инструмент, владение
      // которыми вы выбрали ранее» — одна фраза, разорванная запятой.
      const manual: string[] = [];
      let joinable = false;
      for (const p of pieces) {
        if (p.kind === "ok") {
          joinable = false;
          continue;
        }
        if (joinable) manual[manual.length - 1] = `${manual[manual.length - 1]}, ${p.text}`;
        else manual.push(p.text);
        joinable = true;
      }

      if (items.length === 0 && manual.length === 0) continue;
      data.equipment_a_items = items;
      data.equipment_a_manual = manual;
      update.run(JSON.stringify(data), owner.id);
      linked += items.length;
      manualCount += manual.length;
      sets++;
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (sets > 0) {
    console.log(
      `[db] Стартовые наборы: разобрано ${sets}, ссылками ${linked}, подписью «выбрать самому» ${manualCount}`
    );
  }
}
