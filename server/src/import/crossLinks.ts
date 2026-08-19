// Расстановка меншенов в тексте, который уже лежит в базе.
//
// Модель ставить их почти не умеет: на четыре разобранные книги пришлось 17
// меншенов на 99 сцен. Читаешь «Мирт отправляет вас в Синий переулок» — и ни
// одно имя не нажимается, хотя обе сущности в базе есть.
//
// Проход устроен шагами: один шаг — один тип цели. Так сделано не ради
// удобства навигации, а потому что типы требуют разной строгости. У локаций и
// личностей есть синонимы, оригинальные написания и короткие имена; у записей
// компендиума нет ничего, кроме названия, зато среди них «Щит», «Свет» и
// «Ловкость» — слова, которые в тексте почти всегда означают себя, а не
// заклинание. Одним проходом эти правила не развести. Шагами — естественно.
//
// Область поиска задаётся снаружи: набор сеттингов, систем и кампаний, откуда
// брать кандидатов. По умолчанию он зависит от того, где визард запустили, —
// из сеттинга кампанейские сущности не предлагаются, потому что описание
// таверны переживёт конкретную партию, а ссылка на её персонажа — нет.
//
// Каждая находка получает уровень уверенности, а не флажок «отмечено».
// Сигналы, от сильного к слабому: совпало полное название или только часть;
// совпал ли регистр; каким написанием поймалось; отзывается ли имя одной
// сущности или нескольким.

import { db } from "../db/db";
import { parseAliases } from "./names";

/** Где какие текстовые поля и как они называются для человека. */
const OWNER_TEXT: Record<string, { table: string; label: string; fields: Record<string, string> }> = {
  scene: {
    table: "story_scenes",
    label: "Сцена",
    fields: {
      summary: "Сводка",
      read_aloud: "Зачитать вслух",
      whats_happening: "Что происходит",
      entry_condition: "Условие входа",
      outcomes: "Исходы",
    },
  },
  location: {
    table: "setting_locations",
    label: "Локация",
    fields: { description: "Описание" },
  },
  being: {
    table: "setting_beings",
    label: "Личность",
    fields: { description: "Описание", history: "История", behavior: "Поведение" },
  },
  community: {
    table: "setting_communities",
    label: "Сообщество",
    fields: {
      description: "Описание",
      history: "История",
      current_situation: "Текущая ситуация",
      features: "Особенности",
      goals: "Цели",
    },
  },
  artifact: {
    table: "artifacts",
    label: "Предмет",
    fields: { owner: "Владелец", power: "Сила", history: "История", notes: "Заметки" },
  },
  adventure: {
    table: "story_arcs",
    label: "Приключение",
    fields: { description: "Синопсис", hook: "Завязка" },
  },
  campaign_entry: {
    table: "campaign_entries",
    label: "Запись кампании",
    fields: { content: "Содержание" },
  },
  session: {
    table: "sessions",
    label: "Сессия",
    fields: { idea_notes: "Задумки", main_events: "Главные события" },
  },
  preproduction: {
    table: "preproduction",
    label: "Препродакшен",
    fields: {
      adventure_challenge: "Вызов приключения",
      background: "Предыстория",
      adventure_stakes_hooks: "Ставки и зацепки",
      threads_clues_lore: "Нити, улики, лор",
    },
  },
};

/**
 * Типы, чьи страницы существуют: на них и можно сослаться. Каждый — отдельный
 * шаг визарда, в объявленном здесь порядке.
 *
 * `owner` говорит, к чему сущность приписана: по нему область поиска отбирает
 * кандидатов. `spellings` — есть ли у типа что-то кроме названия; у записей
 * компендиума нет, и это главная причина, по которой они судятся строже.
 */
export interface LinkableType {
  key: string;
  label: string;
  table: string;
  owner: "setting" | "system";
  hasShortName: boolean;
  hasAliases: boolean;
  hasKind: boolean;
  /** Минимальная длина написания: у типов без синонимов планка выше. */
  minLength: number;
  /**
   * Собственное ли имя у сущностей этого типа.
   *
   * От этого зависит, как читать регистр в тексте. «Синий переулок» и
   * «Гильдия Занатара» — имена собственные: строчная буква у них означает,
   * что это, скорее всего, не они. А «скелет» и «огненный шар» —
   * нарицательные, и строчная у них норма, а не повод усомниться.
   *
   * У существ признак не общий на весь тип: бестиарий — нарицательные виды,
   * остальные три категории — именованные личности. Поэтому «byCategory».
   */
  properNoun: boolean | "byCategory";
}

export const LINKABLE_TYPES: LinkableType[] = [
  { key: "location", label: "Локации", table: "setting_locations", owner: "setting", hasShortName: true, hasAliases: true, hasKind: true, minLength: 4, properNoun: true },
  { key: "being", label: "Личности и бестиарий", table: "setting_beings", owner: "setting", hasShortName: true, hasAliases: true, hasKind: false, minLength: 4, properNoun: "byCategory" },
  { key: "community", label: "Сообщества", table: "setting_communities", owner: "setting", hasShortName: false, hasAliases: true, hasKind: false, minLength: 4, properNoun: true },
  // Предметы — пограничный случай: «Жезл секретов» имя собственное, а «зелье
  // лечения» нет. Считаем собственными, потому что именованных в сокровищнице
  // заметно больше; ошибка при этом уводит находку в «сомнительные», то есть
  // в сторону осторожности.
  { key: "artifact", label: "Предметы", table: "artifacts", owner: "setting", hasShortName: true, hasAliases: true, hasKind: false, minLength: 4, properNoun: true },
  // Записей компендиума почти две тысячи, и у них нет ни синонимов, ни
  // оригинального названия, ни короткого имени — только `name`. Планка длины
  // поднята, чтобы «Щит» и «Свет» вообще не попадали в поиск: слово из четырёх
  // букв без единого различающего признака даёт ложных срабатываний больше,
  // чем верных.
  { key: "compendium_entry", label: "Записи компендиума", table: "compendium_entries", owner: "system", hasShortName: false, hasAliases: false, hasKind: false, minLength: 7, properNoun: false },
];

const LINKABLE_BY_KEY = new Map(LINKABLE_TYPES.map((t) => [t.key, t]));

/** Откуда брать кандидатов: «setting:3», «system:1». */
export interface SourceRef {
  kind: "setting" | "system";
  id: number;
}

export function parseSources(raw: string | undefined): SourceRef[] {
  if (!raw) return [];
  const out: SourceRef[] = [];
  for (const part of raw.split(",")) {
    const [kind, id] = part.split(":");
    if ((kind === "setting" || kind === "system") && Number(id)) {
      out.push({ kind, id: Number(id) });
    }
  }
  return out;
}

// ─── Уровни уверенности ──────────────────────────────────────────────────────

/** Точные отмечаются галочкой сразу, остальные — показываются. */
export type Tier = "exact" | "likely" | "doubtful";

export const TIER_LABEL: Record<Tier, string> = {
  exact: "точные",
  likely: "вероятные",
  doubtful: "сомнительные",
};

// ─── Поиск написаний в тексте ────────────────────────────────────────────────

/**
 * Имя может стоять в тексте в любом падеже: «Мирт» → «Миртом», «Мирта».
 * Окончание отрезать нечем — морфологии в проекте нет, — поэтому имя ищется
 * началом слова, а хвост из букв дописывается в подпись меншена: ссылка
 * получается на «Миртом» целиком, а не на «Мирт» с висящим «ом».
 *
 * Хвост ограничен тремя буквами: этого хватает любому падежу и не хватает,
 * чтобы «Мирт» поймал «Миртаграаль».
 */
const MAX_INFLECTION = 3;
const LETTER = /[\p{L}\p{M}]/u;
const UPPER = /\p{Lu}/u;

interface Hit {
  start: number;
  end: number;
  /** К имени дописан падежный хвост: «Мирт» → «Миртом». */
  inflected: boolean;
  /** Написание в тексте совпало по регистру с эталонным. */
  caseMatches: boolean;
  /** Находка стоит в начале предложения — регистр там ничего не значит. */
  atSentenceStart: boolean;
}

/**
 * Начало предложения определяется грубо: точка, восклицательный, вопросительный,
 * перевод строки или начало поля. Сокращения вроде «т. д.» дадут редкую ошибку,
 * но в сторону осторожности — находка просто не получит очко за регистр.
 */
function isSentenceStart(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "«" || ch === '"' || ch === "(") continue;
    if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === ":" || ch === ";") return true;
    return false;
  }
  return true;
}

/** Границей слова служит всё, что не буква: имя не должно ловиться в середине. */
function findSpelling(text: string, spelling: string): Hit[] {
  const found: Hit[] = [];
  const haystack = text.toLowerCase();
  const needle = spelling.toLowerCase();
  if (!needle) return found;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    const before = text[at - 1];
    if (before && LETTER.test(before)) continue;
    // Хвост словоизменения — только у однословных имён: у «Синего переулка»
    // склоняется и первое слово, а его началом уже не поймать.
    let end = at + needle.length;
    if (!needle.includes(" ")) {
      let tail = 0;
      while (tail < MAX_INFLECTION && text[end] && LETTER.test(text[end])) {
        end++;
        tail++;
      }
      // Слово длиннее хвоста — значит это другое слово, а не падеж.
      if (text[end] && LETTER.test(text[end])) continue;
    } else if (text[end] && LETTER.test(text[end])) {
      continue;
    }
    // Регистр — сигнал, которого в проходе раньше не было вовсе: обе стороны
    // приводились к нижнему, и «Паук» с «гигантский паук» выглядели одинаково.
    // Сравнивается только первая буква: внутри слова регистр ничего не решает,
    // а собственное имя от нарицательного отличает именно она.
    const caseMatches = UPPER.test(spelling[0] ?? "") === UPPER.test(text[at] ?? "");
    found.push({
      start: at,
      end,
      inflected: end > at + needle.length,
      caseMatches,
      atSentenceStart: isSentenceStart(text, at),
    });
  }
  return found;
}

/** Куски текста, уже занятые меншенами: внутрь них лезть нельзя. */
function mentionSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /\[\[[^\]]*\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length });
  return spans;
}

// ─── Кандидаты ───────────────────────────────────────────────────────────────

interface Spelling {
  text: string;
  via: string;
  /** Уровень до учёта регистра и неоднозначности. */
  base: Tier;
  doubt?: string;
}

interface Candidate {
  ref: string;
  name: string;
  spellings: Spelling[];
  properNoun: boolean;
}

interface EntityRow {
  id: number;
  name: string;
  category: string;
  short_name: string | null;
  aliases: string;
  name_original: string;
  kind: string;
}

function spellingsOf(entity: EntityRow, type: LinkableType): Spelling[] {
  // Короткое имя заведено для подписи пина на карте, а не для прозы, и часто
  // это простое существительное: у локации «2. Фреска увечий» оно «Фреска»,
  // у «Карты сокровищ» — «Карта». В тексте такие слова стоят сами по себе
  // чаще, чем в значении сущности.
  const doubtShort = "короткое имя — часто простое слово";
  // Сущность, названная собственным видом, — тот же случай, но с названием:
  // локация «Коридор» вида «коридор». Слово «коридор» в тексте почти всегда
  // означает коридор, а не эту локацию.
  const named = entity.name.trim().toLowerCase();
  const selfNamed = !!entity.kind && named === entity.kind.trim().toLowerCase();
  return [
    {
      text: entity.name,
      via: "название",
      base: selfNamed ? ("doubtful" as Tier) : ("exact" as Tier),
      doubt: selfNamed ? "названа собственным видом" : undefined,
    },
    { text: entity.name_original ?? "", via: "оригинал", base: "exact" as Tier },
    ...parseAliases(entity.aliases).map((a) => ({ text: a, via: "синоним", base: "likely" as Tier })),
    { text: entity.short_name ?? "", via: "короткое имя", base: "doubtful" as Tier, doubt: doubtShort },
  ]
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length >= type.minLength);
}

function loadCandidate(type: LinkableType, row: EntityRow): Candidate | null {
  const spellings = spellingsOf(row, type);
  if (!spellings.length) return null;
  // Длинные написания вперёд: «Синий переулок» должен побеждать «Синий».
  spellings.sort((a, b) => b.text.length - a.text.length);
  // Бестиарий — виды существ, а не личности: «скелет» пишется со строчной и
  // остаётся скелетом. Остальные категории населения — именованные.
  const properNoun =
    type.properNoun === "byCategory" ? row.category !== "bestiary" : type.properNoun;
  return { ref: `${type.key}:${row.id}`, name: row.name, spellings, properNoun };
}

/** Все кандидаты одного типа из перечисленных источников. */
function candidatesOfType(type: LinkableType, sources: SourceRef[]): Candidate[] {
  const ids = sources.filter((s) => s.kind === type.owner).map((s) => s.id);
  if (!ids.length) return [];
  const ownerColumn = type.owner === "system" ? "system_id" : "setting_id";
  const archived = type.key === "compendium_entry" ? "" : "AND archived_at IS NULL";
  const rows = db
    .prepare(
      `SELECT id, name,
              ${type.properNoun === "byCategory" ? "category" : "'' AS category"},
              ${type.hasShortName ? "short_name" : "'' AS short_name"},
              ${type.hasAliases ? "aliases, name_original" : "'' AS aliases, '' AS name_original"},
              ${type.hasKind ? "kind" : "'' AS kind"}
         FROM ${type.table}
        WHERE ${ownerColumn} IN (${ids.map(() => "?").join(",")}) ${archived}`
    )
    .all(...ids) as EntityRow[];
  return rows.map((r) => loadCandidate(type, r)).filter((c): c is Candidate => !!c);
}

/**
 * Сколько сущностей отзывается на одно написание.
 *
 * Считается по **всем** типам области поиска разом, хотя сопоставление идёт по
 * одному типу за шаг. Иначе пошаговость потеряла бы эту защиту: имя, которое
 * одновременно локация и заклинание, в шаге «локации» выглядело бы
 * однозначным, и галочка встала бы уверенно.
 */
function ambiguousSpellings(all: Candidate[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const c of all) {
    for (const s of c.spellings) {
      const key = s.text.toLowerCase();
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(c.ref);
    }
  }
  return new Set([...owners.entries()].filter(([, refs]) => refs.size > 1).map(([key]) => key));
}

// ─── Тексты, в которых ищем ──────────────────────────────────────────────────

interface Doc {
  ownerType: string;
  ownerId: number;
  ownerName: string;
  text: Record<string, string>;
}

function readDocs(ownerType: string, where: string, params: unknown[]): Doc[] {
  const meta = OWNER_TEXT[ownerType];
  const fields = Object.keys(meta.fields);
  // У препродакшена и сессий имени нет — показываем то, что есть.
  const cols = (db.prepare(`PRAGMA table_info(${meta.table})`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const nameExpr = cols.includes("name") ? "name" : cols.includes("title") ? "title" : "''";
  const rows = db
    .prepare(`SELECT id, ${nameExpr} AS owner_name, ${fields.join(", ")} FROM ${meta.table} ${where}`)
    .all(...params) as Record<string, string | number>[];
  return rows.map((row) => ({
    ownerType,
    ownerId: Number(row.id),
    ownerName: String(row.owner_name || meta.label),
    text: Object.fromEntries(fields.map((f) => [f, String(row[f] ?? "")])),
  }));
}

/** Тексты сцен приключения вместе с его главами. Только оригиналы сеттинга. */
function docsOfArc(arcId: number): Doc[] {
  const fields = Object.keys(OWNER_TEXT.scene.fields);
  return (
    db
      .prepare(
        `SELECT s.id, s.name AS owner_name, ${fields.map((f) => `s.${f}`).join(", ")}
           FROM story_scenes s
           JOIN story_arcs a ON a.id = s.arc_id
          WHERE (a.id = ? OR a.parent_id = ?)
            AND a.archived_at IS NULL
            AND s.campaign_id IS NULL AND s.archived_at IS NULL
          ORDER BY s.position, s.id`
      )
      .all(arcId, arcId) as Record<string, string | number>[]
  ).map((row) => ({
    ownerType: "scene",
    ownerId: Number(row.id),
    ownerName: String(row.owner_name),
    text: Object.fromEntries(fields.map((f) => [f, String(row[f] ?? "")])),
  }));
}

/** Тексты сеттинга вне сцен: карточки сущностей и синопсисы приключений. */
function docsOfSetting(settingId: number): Doc[] {
  const docs: Doc[] = [];
  for (const ownerType of ["location", "being", "community", "artifact", "adventure"]) {
    docs.push(...readDocs(ownerType, "WHERE setting_id = ? AND archived_at IS NULL", [settingId]));
  }
  return docs;
}

/** Тексты кампании: записи, задумки и события сессий, препродакшен. */
function docsOfCampaign(campaignId: number): Doc[] {
  return [
    ...readDocs("campaign_entry", "WHERE campaign_id = ?", [campaignId]),
    ...readDocs("session", "WHERE campaign_id = ? AND archived_at IS NULL", [campaignId]),
    ...readDocs("preproduction", "WHERE campaign_id = ?", [campaignId]),
  ];
}

export function docsOfOwner(ownerKind: string, ownerId: number): Doc[] {
  if (ownerKind === "adventure") return docsOfArc(ownerId);
  if (ownerKind === "campaign") return docsOfCampaign(ownerId);
  return docsOfSetting(ownerId);
}

// ─── Проход ──────────────────────────────────────────────────────────────────

export interface CrossLinkProposal {
  /** Чей это текст: «scene», «location», «being»… */
  ownerType: string;
  ownerId: number;
  ownerName: string;
  ownerLabel: string;
  field: string;
  fieldLabel: string;
  /** Тип и id цели: «being:410». */
  ref: string;
  targetName: string;
  /** Как имя написано в тексте: «Миртом», «Синего переулка». */
  matched: string;
  /** Кусок текста вокруг находки — по нему человек и решает. */
  context: string;
  /** Каким написанием поймалось: по нему видно, насколько находке верить. */
  via: string;
  tier: Tier;
  /** Почему уровень ниже точного: показывается рядом с группой. */
  doubt?: string;
}

const CONTEXT = 60;

/**
 * Контекст показывается человеку, а не разбирается машиной, поэтому разметку
 * из него надо убрать: в куске текста вокруг находки почти всегда попадаются
 * уже расставленные ссылки, а окно в шестьдесят символов режет их посередине,
 * и в списке появляются обрывки вида «5[[Глубоководьем]]».
 */
function readable(snippet: string): string {
  return snippet
    .replace(/\[\[(\w+):(\d+)\|([^\]]*)\]\]/g, "$3")
    .replace(/\[\[(\w+)@[0-9a-fA-F-]+\|[^|\]]*\|([^\]]*)\]\]/g, "$2");
}

/**
 * Границы окна контекста, раздвинутые так, чтобы не разрезать ссылку пополам.
 *
 * Окно в шестьдесят символов регулярно попадает в середину уже расставленного
 * меншена, и в списке появляется «…5|Глубоководьем». Чистить обрывки задним
 * числом бессмысленно — проще не резать: если край окна оказался внутри
 * токена, край сдвигается наружу, к его границе.
 */
function contextRange(
  text: string,
  start: number,
  end: number,
  spans: { start: number; end: number }[]
): { from: number; to: number } {
  let from = Math.max(0, start - CONTEXT);
  let to = Math.min(text.length, end + CONTEXT);
  for (const s of spans) {
    if (from > s.start && from < s.end) from = s.start;
    if (to > s.start && to < s.end) to = s.end;
  }
  return { from, to };
}
const TIER_ORDER: Record<Tier, number> = { exact: 0, likely: 1, doubtful: 2 };
const lower = (t: Tier, to: Tier): Tier => (TIER_ORDER[to] > TIER_ORDER[t] ? to : t);

export interface PlanRequest {
  ownerKind: string;
  ownerId: number;
  targetType: string;
  sources: SourceRef[];
}

/** Что проход предлагает разметить. Ничего не пишет. */
export function planCrossLinks(req: PlanRequest): CrossLinkProposal[] {
  const type = LINKABLE_BY_KEY.get(req.targetType);
  if (!type) return [];

  // Карта неоднозначности — по всем типам области, см. ambiguousSpellings.
  const everything = LINKABLE_TYPES.flatMap((t) => candidatesOfType(t, req.sources));
  const ambiguous = ambiguousSpellings(everything);
  const candidates = everything.filter((c) => c.ref.startsWith(`${type.key}:`));
  if (!candidates.length) return [];

  const proposals: CrossLinkProposal[] = [];
  for (const doc of docsOfOwner(req.ownerKind, req.ownerId)) {
    const meta = OWNER_TEXT[doc.ownerType];
    if (!meta) continue;
    for (const [field, fieldLabel] of Object.entries(meta.fields)) {
      const text = doc.text[field] ?? "";
      if (!text.trim()) continue;
      // Занятые куски копятся по ходу: две находки не должны накладываться,
      // а первой идёт та, что нашлась более длинным написанием.
      const spans = mentionSpans(text);
      const busy = [...spans];
      for (const candidate of candidates) {
        // Ссылка сущности на саму себя смысла не имеет.
        if (candidate.ref === `${doc.ownerType}:${doc.ownerId}`) continue;
        // Одна ссылка на сущность в поле — правило, которое должно держаться и
        // между запусками. Без этой проверки второй проход предлагал следующее
        // вхождение того же имени, третий — ещё одно, и текст постепенно
        // покрывался ссылками на одно и то же.
        if (text.includes(`[[${candidate.ref}|`)) continue;
        for (const spelling of candidate.spellings) {
          const hits = findSpelling(text, spelling.text);
          if (!hits.length) continue;
          // Одна ссылка на сущность в поле: текст, где имя размечено пять раз
          // подряд, читать невозможно.
          const hit = hits.find((h) => !busy.some((b) => h.start < b.end && b.start < h.end));
          if (!hit) continue;
          busy.push(hit);

          let tier = spelling.base;
          let doubt = spelling.doubt;
          if (candidate.properNoun) {
            // У имени собственного строчная буква — сильный довод против:
            // «гигантский паук» почти наверняка не Неззнар по прозвищу «Паук».
            // В начале предложения прописная не значит ничего, поэтому там
            // регистр не судится ни за, ни против.
            if (!hit.caseMatches && !hit.atSentenceStart) {
              tier = lower(tier, "doubtful");
              doubt = doubt ?? "со строчной буквы, а имя собственное";
            }
          } else if (hit.inflected) {
            // У нарицательного строчная — норма: «пятерка скелетов» это и есть
            // ссылка на бестиарий. Зато опасен дописанный хвост: «шпион» плюс
            // «ить» даёт глагол «шпионить», а не существо. Морфологии в проекте
            // нет, отличить нечем — поэтому такие показываются, но галочкой не
            // отмечаются.
            tier = lower(tier, "likely");
            doubt = doubt ?? "слово с дописанным окончанием";
          }
          if (ambiguous.has(spelling.text.toLowerCase())) {
            tier = lower(tier, "doubtful");
            doubt = "так зовут не только её";
          }

          proposals.push({
            ownerType: doc.ownerType,
            ownerId: doc.ownerId,
            ownerName: doc.ownerName,
            ownerLabel: meta.label,
            field,
            fieldLabel,
            ref: candidate.ref,
            targetName: candidate.name,
            matched: text.slice(hit.start, hit.end),
            via: spelling.via,
            tier,
            doubt,
            context: (() => {
              const { from, to } = contextRange(text, hit.start, hit.end, spans);
              return (
                (from > 0 ? "…" : "") +
                readable(text.slice(from, to)).trim() +
                (to < text.length ? "…" : "")
              );
            })(),
          });
          break;
        }
      }
    }
  }
  // Точные вперёд: человек проверяет список сверху вниз и до сомнительных
  // доходит, уже поняв, как проход себя ведёт.
  proposals.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return proposals;
}

// ─── Запись ──────────────────────────────────────────────────────────────────

export interface CrossLinkChoice {
  ownerType: string;
  ownerId: number;
  field: string;
  ref: string;
  matched: string;
}

const choiceId = (c: CrossLinkChoice | CrossLinkProposal) =>
  `${c.ownerType}|${c.ownerId}|${c.field}|${c.ref}|${c.matched}`;

/**
 * Записывает выбранное. Ищется всё заново по тому же правилу: между показом и
 * подтверждением текст мог измениться, и подставлять меншен по запомненному
 * смещению значило бы попасть в середину чужого слова.
 */
export function applyCrossLinks(req: PlanRequest, chosen: CrossLinkChoice[]): { written: number } {
  const proposals = planCrossLinks(req);
  const wanted = new Set(chosen.map(choiceId));
  const linkMention = db.prepare(
    `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
     VALUES (?, ?, ?, ?, 'mention')`
  );
  const run = db.transaction(() => {
    let written = 0;
    for (const proposal of proposals) {
      if (!wanted.has(choiceId(proposal))) continue;
      const meta = OWNER_TEXT[proposal.ownerType];
      if (!meta || !meta.fields[proposal.field]) continue;
      const row = db
        .prepare(`SELECT ${proposal.field} AS value FROM ${meta.table} WHERE id = ?`)
        .get(proposal.ownerId) as { value: string } | undefined;
      if (!row) continue;
      const busy = mentionSpans(row.value);
      const hit = findSpelling(row.value, proposal.matched).find(
        (h) => !busy.some((b) => h.start < b.end && b.start < h.end)
      );
      if (!hit) continue;
      const next =
        row.value.slice(0, hit.start) +
        `[[${proposal.ref}|${row.value.slice(hit.start, hit.end)}]]` +
        row.value.slice(hit.end);
      db.prepare(`UPDATE ${meta.table} SET ${proposal.field} = ? WHERE id = ?`).run(
        next,
        proposal.ownerId
      );
      // Меншен, поставленный руками в редакторе, заводит связь с пометкой
      // «mention» — здесь то же самое, иначе текст и карточка «Связи»
      // разъедутся. Уже существующую связь INSERT OR IGNORE не трогает:
      // ключ таблицы не включает section.
      const [type, id] = proposal.ref.split(":");
      linkMention.run(proposal.ownerType, proposal.ownerId, type, Number(id));
      written++;
    }
    return { written };
  });
  return run();
}

/** Снятие меншенов: подпись остаётся, ссылка уходит. */
export function stripCrossLinks(ownerKind: string, ownerId: number): { removed: number } {
  const docs = docsOfOwner(ownerKind, ownerId);
  const run = db.transaction(() => {
    let removed = 0;
    for (const doc of docs) {
      const meta = OWNER_TEXT[doc.ownerType];
      for (const field of Object.keys(meta.fields)) {
        const text = doc.text[field] ?? "";
        if (!text.includes("[[")) continue;
        // Подвешенные ссылки не трогаем: у них четыре поля, и «снять все» тут
        // означает снять расставленное, а не то, что ждёт своего модуля.
        const next = text.replace(/\[\[(\w+):(\d+)\|([^\]]*)\]\]/g, (_, __, ___, label: string) => {
          removed++;
          return label;
        });
        if (next !== text) {
          db.prepare(`UPDATE ${meta.table} SET ${field} = ? WHERE id = ?`).run(next, doc.ownerId);
        }
      }
    }
    return { removed };
  });
  return run();
}
