/**
 * Разовый перевод статблока существа из текста книги в поля модели (боевой
 * режим, шаг 1; решения Q10/Q17/Q19 в `.scratch/combat-mode/notes.md`).
 *
 * Бестиарий 5.5 пришёл импортом в виде текста: «Холодное дыхание (перезарядка
 * 5–6)» в имени, «Легендарная устойчивость (3 в день)» чертой, «Использования
 * легендарных действий: 3» в заметках, заклинания — абзацем действия
 * «Заклинания». Трекерам боевого режима считать по такому нечего.
 *
 * Правило одно: без угадывания. Если хоть что-то в статблоке не разбирается
 * однозначно, существо остаётся как было, а причины уходят в `review` — по ним
 * строится фильтр «Требует разбора». Криво разобранный статблок хуже
 * неразобранного: его не видно.
 */
import { emptyCreature, normalizeDndCreature } from "./creature";
import type {
  DndAbilityKey,
  DndActionUses,
  DndCreatureAction,
  DndCreatureData,
  DndCreatureSpell,
  DndCreatureSpellcasting,
  DndFeature,
  DndLegendaryActionEntry,
} from "./types";

export interface SpellRef {
  entryId: number;
  name: string;
  level: number;
}

/** Ищет заклинание справочника по русскому имени или по английскому из «[...]». */
export type SpellLookup = (name: string, original: string | null) => SpellRef | null;

export interface ConvertResult {
  /** Разобранный статблок; `null`, если перевод не дался (см. `review`). */
  data: DndCreatureData | null;
  review: string[];
}

/** Пробелы и дефисы книги — к одному виду, чтобы шаблоны не зависели от набора. */
function plain(text: string): string {
  return text
    .replace(/[    ]/g, " ")
    .replace(/[‐‑‒–—]/g, "–")
    .replace(/ {2,}/g, " ");
}

const USES_HINT = /в день|\/\s*день|перезаряд/i;

/**
 * Скобка с запасом действия. `null` — скобка про другое («только в форме
 * вампира»); `"unknown"` — похоже на запас, но разобрать нельзя.
 */
export function parseUses(inner: string): DndActionUses | null | "unknown" {
  const t = plain(inner).trim().toLowerCase();
  let m = /^перезарядка (\d)\s*[–-]\s*6$/.exec(t);
  if (m) return { kind: "recharge", min: Number(m[1]) };
  m = /^перезарядка (\d)$/.exec(t);
  if (m) return { kind: "recharge", min: Number(m[1]) };
  m = /^перезарядка после (короткого или )?долгого отдыха$/.exec(t);
  if (m) return { kind: "rest", rest: m[1] ? "short" : "long" };
  m = /^(\d+) в день(?: или (\d+) в день в логове)?$/.exec(t);
  if (m) return { kind: "day", count: Number(m[1]), lairCount: m[2] ? Number(m[2]) : null };
  m = /^(\d+)\s*\/\s*день$/.exec(t);
  if (m) return { kind: "day", count: Number(m[1]), lairCount: null };
  return USES_HINT.test(t) ? "unknown" : null;
}

/** Снимает скобку запаса с имени: «Холодное дыхание (перезарядка 5–6)» → имя + запас. */
function splitNameUses(name: string, where: string, review: string[]): { name: string; uses?: DndActionUses } {
  const groups = [...plain(name).matchAll(/\s*\(([^()]*)\)/g)];
  let uses: DndActionUses | undefined;
  let clean = plain(name);
  for (const g of groups) {
    const parsed = parseUses(g[1]);
    if (parsed === null) continue;
    if (parsed === "unknown") {
      review.push(`${where}: не разобран запас «(${g[1].trim()})»`);
      continue;
    }
    if (uses) {
      review.push(`${where}: два запаса в одном имени`);
      continue;
    }
    uses = parsed;
    clean = clean.replace(g[0], "");
  }
  return uses ? { name: clean.trim(), uses } : { name: clean.trim() };
}

const GLUED = /([.!?])\s+([А-ЯЁ][^.!?()]{0,60}?)\s*\(([^()]*(?:перезарядка|в день|\/\s*день)[^()]*)\)\.\s*/i;

/**
 * Расклейка: импорт книги сливал перезаряжаемое действие с предыдущим —
 * «…урона Холодом. Холодное дыхание (перезарядка 5–6). Испытание…». Граница
 * берётся только по концу предложения; склейка без неё — в разбор.
 */
function unglue<T extends DndCreatureAction>(list: T[], where: string, review: string[]): T[] {
  const out: T[] = [];
  for (const row of list) {
    let current: T = { ...row, description: plain(row.description ?? "") };
    for (let guard = 0; guard < 5; guard++) {
      const m = GLUED.exec(current.description);
      if (!m) break;
      const head = current.description.slice(0, (m.index ?? 0) + 1).trim();
      const tail = current.description.slice((m.index ?? 0) + m[0].length).trim();
      out.push({ ...current, description: head });
      current = { ...row, name: `${m[2].trim()} (${m[3].trim()})`, description: tail } as T;
      if ("cost" in row) (current as unknown as DndLegendaryActionEntry).cost = 1;
    }
    if (/\((?:[^()]*перезарядка[^()]*)\)/i.test(current.description)) {
      review.push(`${where} «${current.name}»: в описании склеено перезаряжаемое действие без границы предложения`);
    }
    out.push(current);
  }
  return out;
}

const ABILITY_STEMS: [RegExp, DndAbilityKey][] = [
  [/Интеллект/, "int"],
  [/Мудрост/, "wis"],
  [/Харизм/, "cha"],
  [/Телосложени/, "con"],
  [/Ловкост/, "dex"],
  [/(?<![А-ЯЁа-яё])Сил[аыу](?![а-яё])/, "str"],
];

const SPELL_GROUP = /(Неограниченно|(\d+)\s*(?:в день|\/\s*день)(?:\s+каждое)?)\s*:/g;

function isSpellBlock(row: DndCreatureAction): boolean {
  const base = plain(row.name).replace(/\s*\([^()]*\)/g, "").trim();
  return /^(Заклинания|Сотворение заклинаний|Врождённое колдовство)$/i.test(base) ||
    new RegExp(SPELL_GROUP.source).test(plain(row.description ?? ""));
}

/** Режет список по запятым и точкам с запятой вне скобок. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSpellBlock(
  row: DndCreatureAction,
  timing: "action" | "trait",
  lookup: SpellLookup,
  where: string,
  review: string[]
): DndCreatureSpellcasting | null {
  const text = plain(row.description ?? "");
  const marks = [...text.matchAll(SPELL_GROUP)];
  if (marks.length === 0) {
    review.push(`${where} «${row.name}»: нет групп «Неограниченно» / «N в день»`);
    return null;
  }
  const preamble = text.slice(0, marks[0].index).trim().replace(/[:.]\s*$/, "").trim();
  const ability = ABILITY_STEMS.find(([re]) => re.test(preamble))?.[1] ?? "";
  if (!ability) review.push(`${where} «${row.name}»: не найдена заклинательная характеристика`);
  const dc = /(?:СЛ|Сл)[^0-9]{0,40}?(\d+)/.exec(preamble);
  const atk = /\+(\d+) к (?:броскам атаки заклинанием|попаданию атакой заклинанием)/.exec(preamble);

  const spells: DndCreatureSpell[] = [];
  marks.forEach((mk, i) => {
    const start = (mk.index ?? 0) + mk[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index ?? text.length : text.length;
    const body = text.slice(start, end).trim().replace(/[.;]\s*$/, "");
    const perDay = mk[2] ? Number(mk[2]) : null;
    for (const item of splitTopLevel(body)) {
      const original = /\[([^\]]+)\]/.exec(item)?.[1]?.trim() ?? null;
      const notes = [...item.matchAll(/\(([^()]*)\)/g)].map((g) => g[1].trim());
      const name = item
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\([^()]*\)/g, "")
        .replace(/[«»"]/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s:.,;]+|[\s.]+$/g, "")
        .trim();
      if (!name) continue;
      const ref = lookup(name, original);
      if (!ref) {
        review.push(`${where}: заклинание «${name}» не найдено в справочнике`);
        continue;
      }
      spells.push({
        name: ref.name,
        level: ref.level,
        entryId: ref.entryId,
        frequency: perDay === null ? "atwill" : "perday",
        perDayCount: perDay,
        description: notes.join("; "),
      });
    }
  });

  const condition = /\(([^()]*)\)/.exec(plain(row.name))?.[1]?.trim();
  return {
    enabled: true,
    ability,
    slots: [],
    spells,
    saveDC: dc ? Number(dc[1]) : null,
    attackBonus: atk ? Number(atk[1]) : null,
    note: [condition, preamble].filter(Boolean).join(". "),
    timing,
  };
}

// `\b` в JS не видит границ кириллических слов — граница явная.
const LR_NAME = /^Легендарн(?:ая устойчивость|ое сопротивление)(?![а-яё])/i;
const LA_PREAMBLE = /Использования легендарных действий:\s*(\d+)(?:\s*\((\d+) в логове\))?\.\s*/i;
const ONCE_PER_TURN = /не может (?:совершить|выполнить|использовать) это действие (?:снова )?до начала (?:своего|его|её) следующего хода/i;

/**
 * Переводит статблок. Уже переведённое (`legendary`/`spellcasting` в полях,
 * КЗ числом) проходит без изменений — повторный запуск ничего не портит.
 */
export function convertLegacyCreature(raw: unknown, lookup: SpellLookup): ConvertResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.armorClass !== "string") return { data: null, review: [] };

  const review: string[] = [];
  const data = normalizeDndCreature(raw);

  // 0. Хиты: среднее книги должно сходиться с костями. Импорт терял знак
  // («13 (9к10 36)»), и молча пересчитанное число было бы другим существом.
  if (typeof r.hitPoints === "string") {
    const stated = /^\s*(\d+)/.exec(r.hitPoints)?.[1];
    const { diceCount, dieSize, bonus } = data.hitPoints;
    const computed = diceCount && dieSize ? Math.floor(diceCount * (dieSize / 2 + 0.5)) + (bonus ?? 0) : null;
    if (stated && computed !== null && Number(stated) !== computed) {
      review.push(`Хиты «${r.hitPoints}»: среднее ${stated} не сходится с костями (${computed})`);
    }
  }

  // 1. Склейки — до разбора имён: у отклеенного действия скобка запаса в имени.
  data.traits = unglue(data.traits as DndCreatureAction[], "Черты", review) as unknown as DndFeature[];
  data.actions = unglue(data.actions, "Действия", review);
  data.bonusActions = unglue(data.bonusActions, "Бонусные действия", review);
  data.reactions = unglue(data.reactions, "Реакции", review);
  data.legendary.actions = unglue(data.legendary.actions, "Легендарные действия", review);

  // 2. Легендарная устойчивость — из черт в легендарное.
  const traits: DndFeature[] = [];
  for (const t of data.traits) {
    const name = plain(t.name ?? "");
    if (!LR_NAME.test(name)) {
      traits.push(t);
      continue;
    }
    const { uses } = splitNameUses(name, "Черты", review);
    if (!uses || uses.kind !== "day") {
      review.push(`Черты «${name}»: не разобрано число легендарной устойчивости`);
      traits.push(t);
      continue;
    }
    data.legendary.resistanceEnabled = true;
    data.legendary.resistanceCount = uses.count;
    data.legendary.resistanceLairCount = uses.lairCount ?? null;
  }
  data.traits = traits;

  // 3. Заклинания — из действия или черты в свои поля.
  const blocks: { list: "actions" | "traits"; row: DndCreatureAction }[] = [
    ...data.actions.filter(isSpellBlock).map((row) => ({ list: "actions" as const, row })),
    ...(data.traits as DndCreatureAction[]).filter((t) => isSpellBlock({ ...t, category: "other" })).map((row) => ({ list: "traits" as const, row })),
  ];
  if (blocks.length > 1) review.push(`Заклинания: блоков ${blocks.length}, а поле одно`);
  else if (blocks.length === 1 && !data.spellcasting.enabled) {
    const { list, row } = blocks[0];
    const where = list === "actions" ? "Действия" : "Черты";
    const sc = parseSpellBlock(row, list === "actions" ? "action" : "trait", lookup, where, review);
    if (sc) {
      data.spellcasting = sc;
      if (list === "actions") data.actions = data.actions.filter((a) => a !== row);
      else data.traits = data.traits.filter((t) => (t as unknown) !== row);
    }
  }

  // 4. Запасы в именах действий.
  const withUses = <T extends DndCreatureAction>(list: T[], where: string): T[] =>
    list.map((a) => {
      const { name, uses } = splitNameUses(a.name ?? "", where, review);
      return uses ? { ...a, name, uses } : { ...a, name };
    });
  data.actions = withUses(data.actions, "Действия");
  data.bonusActions = withUses(data.bonusActions, "Бонусные действия");
  data.reactions = withUses(data.reactions, "Реакции");
  data.legendary.actions = withUses(data.legendary.actions, "Легендарные действия");
  data.legendary.lairActions = withUses(data.legendary.lairActions, "Действия логова");
  data.traits = data.traits.map((t) => {
    const { name, uses } = splitNameUses(t.name ?? "", "Черты", review);
    return uses ? { ...t, name, uses } : { ...t, name };
  });

  // 5. Легендарные действия: число из заметок, «не чаще раза до своего хода».
  const notes = plain(data.notes ?? "");
  const pre = LA_PREAMBLE.exec(notes);
  if (pre) {
    data.legendary.actionsEnabled = true;
    data.legendary.actionPoints = Number(pre[1]);
    data.legendary.actionPointsLair = pre[2] ? Number(pre[2]) : null;
    // Предложение-правило «сразу после хода… восстанавливает все в начале
    // своего хода» уходит вместе с числом: его смысл теперь в полях.
    const rest = notes.slice((pre.index ?? 0) + pre[0].length);
    const rule = /^[^]*?в начале каждого своего хода\.\s*/i.exec(rest);
    data.notes = (notes.slice(0, pre.index) + (rule ? rest.slice(rule[0].length) : rest)).replace(/\s{2,}/g, " ").trim();
  } else if (data.legendary.actions.length > 0) {
    review.push("Легендарные действия: не найдено число использований");
  }
  data.legendary.actions = data.legendary.actions.map((a) =>
    ONCE_PER_TURN.test(plain(a.description ?? "")) ? { ...a, oncePerTurn: true } : a
  );

  if (review.length > 0) return { data: null, review: [...new Set(review)] };

  // Наружу — только поля модели: текстовые хвосты импорта своё отработали.
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(emptyCreature())) clean[key] = (data as unknown as Record<string, unknown>)[key];
  if (data.portraitFocus) clean.portraitFocus = data.portraitFocus;
  return { data: clean as unknown as DndCreatureData, review: [] };
}
