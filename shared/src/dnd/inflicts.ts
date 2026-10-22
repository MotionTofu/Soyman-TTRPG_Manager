/**
 * Разметка «что накладывает» по тексту книги (боевой режим, шаг 3, Q61/Q64):
 * повтор спасброска у заклинаний, состояние, длительность и повтор у действий
 * чудовищ. Разовая: по ней миграция заполняет поля `DndCheck.repeat` и
 * `DndCreatureAction.inflicts`, дальше их правят в формах.
 *
 * Правило шага 1 — без угадывания. Что не разбирается однозначно, не
 * размечается: причина и цитата уходят в `review`, поле остаётся пустым.
 *
 * В регулярках буквы — `[а-яё]`, а не `\w`: в JS `\w` кириллицу не ловит.
 */
import type { DndCombatDuration, DndMechanicsRef, DndRepeatSaveAt } from "./effects";
import type { DndAbilityKey } from "./types";

/** Найденное — с цитатой, по которой его нашли (для таблицы проверки). */
export interface Found<T> {
  value: T;
  quote: string;
}
export interface Review {
  review: string;
  quote: string;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// «Спасбросок» в бестиарии — «испытание» (перевод по «Монстрономикону»).
const SAVE = "(?:спасброс|испытани)";
const REPEAT = new RegExp(
  `повтор[а-яё]*\\s+(?:этот\\s+|свой\\s+|повторн[а-яё]+\\s+)?${SAVE}|повторн[а-яё]*\\s+(?:совершить\\s+|совершает\\s+)?${SAVE}|совершать\\s+повторн[а-яё]*\\s+${SAVE}`,
  "i"
);
const OWN_TURN = "(?:каждого\\s+)?(?:своего|его|её|ее|их)\\s+(?:следующего\\s+)?хода";
const AT_END = new RegExp(`в\\s+конце\\s+${OWN_TURN}`, "i");
const AT_START = new RegExp(`в\\s+начале\\s+${OWN_TURN}`, "i");

const ON_DAMAGE = /получа[а-яё]*\s+урон/i;
// Вторая формулировка книги — без слова «повтор»: «В конце каждого своего
// хода цель совершает новый спасбросок Мудрости» (Таши, кары). Только
// настоящее время: «должно совершить спасбросок» — это первый бросок.
const SAVE_AGAIN = new RegExp(`(?:совершает|делает)\\s+(?:новый\\s+|ещё\\s+один\\s+)?${SAVE}`, "i");

// Характеристика в родительном падеже; «Выносливость» — Телосложение у «Монстрономикона».
const ABILITY_WORDS: [DndAbilityKey, string][] = [
  ["str", "силы"],
  ["dex", "ловкости"],
  ["con", "(?:телосложения|выносливости)"],
  ["int", "интеллекта"],
  ["wis", "мудрости"],
  ["cha", "харизмы"],
];
const ABILITY_GENITIVE: [DndAbilityKey, RegExp][] = ABILITY_WORDS.map(([k, w]) => [
  k,
  new RegExp(`${SAVE}[а-яё]*\\s+${w}`, "i"),
]);

/**
 * Характеристика и СЛ спасброска из текста действия («Испытание Выносливости:
 * СЛ 15», «спасброске Телосложения Сл 10») — у действий, переведённых из
 * текста, поля `saveAbility`/`saveDC` пусты, а повтору нужна СЛ.
 */
export function recognizeSave(text: string): Found<{ ability: DndAbilityKey; dc: number }> | null {
  const found = new Map<string, Found<{ ability: DndAbilityKey; dc: number }>>();
  for (const [ability, w] of ABILITY_WORDS) {
    const re = new RegExp(`${SAVE}[а-яё]*\\s+${w}:?\\s*С[Лл]\\s*(\\d+)`, "gi");
    for (const m of text.matchAll(re)) {
      const dc = Number(m[1]);
      found.set(`${ability}:${dc}`, { value: { ability, dc }, quote: m[0] });
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

export interface RepeatFound extends Found<DndRepeatSaveAt[]> {
  /** Характеристика, если фраза её называет, — сверить со спасброском записи. */
  ability: DndAbilityKey | null;
}

/** Повтор спасброска в тексте: когда, или почему не размечено. */
export function recognizeRepeat(text: string): RepeatFound | Review | null {
  const hits = sentences(text).filter(
    (s) => REPEAT.test(s) || (SAVE_AGAIN.test(s) && (AT_END.test(s) || AT_START.test(s)))
  );
  if (hits.length === 0) return null;
  const at = new Set<DndRepeatSaveAt>();
  const abilities = new Set<DndAbilityKey>();
  for (const s of hits) {
    const end = AT_END.test(s);
    const start = AT_START.test(s);
    const damage = ON_DAMAGE.test(s);
    if (!end && !start && !damage) return { review: "повтор не по ходу и не по урону", quote: s };
    if (end) at.add("turn_end");
    if (start) at.add("turn_start");
    if (damage) at.add("on_damage");
    for (const [key, re] of ABILITY_GENITIVE) if (re.test(s)) abilities.add(key);
  }
  const quote = hits.join(" … ");
  if (at.has("turn_end") && at.has("turn_start")) return { review: "повтор и в начале, и в конце хода", quote };
  if (abilities.size > 1) return { review: "разные спасброски", quote };
  const order: DndRepeatSaveAt[] = ["turn_start", "turn_end", "on_damage"];
  return { value: order.filter((a) => at.has(a)), quote, ability: [...abilities][0] ?? null };
}

/**
 * Основы имён состояний — как они склоняются в тексте книги. «Невидимый» не
 * ищется: в действиях чудовищ это почти всегда «становится невидимым» само.
 * «Истощённый» — уровень истощения, не чип состояния.
 */
const CONDITION_STEMS: [string, RegExp][] = [
  ["Ослеплённый", /ослеп(?!ит)/i],
  // «Обворожена» у «Монстрономикона» — очарованный.
  ["Очарованный", /очарова|обворож/i],
  // «Оглушена» у «Монстрономикона» — оглохший (Какофония стаи воронов, гром).
  ["Оглохший", /оглох|оглуш/i],
  ["Испуганный", /испуга|напуга/i],
  ["Недееспособный", /недееспособ/i],
  ["Парализованный", /парализ/i],
  ["Отравленный", /отравлен/i],
  ["Лежащий ничком", /ничком|сбит[а-яё]*\s+с\s+ног/i],
  // «Обездвижен» у «Монстрономикона» — опутанный (Restrained).
  ["Опутанный", /опутан|обездвиж/i],
  ["Ошеломлённый", /ошеломл/i],
  ["Бессознательный", /бессознат|без\s+сознания/i],
  ["Схваченный", /схвач|захвачен|в\s+захват/i],
  ["Окаменевший", /окамен/i],
];

/** Состояние упомянуто не как наложенное: иммунитет, преимущество, «не может». */
const NOT_INFLICTED =
  /иммун|невосприимч|преимуществ|не\s+может\s+(?:быть|стать)|не\s+становится|оканчива|заканчива|прекраща|снима/i;

/** Строка цели: «Испытание Ловкости: СЛ 17, одно Захваченное глабрезу существо». */
const TARGET_LINE = new RegExp(`^${SAVE}[а-яё]*\\s+[а-яё]+:`, "i");

/** Состояние — признак цели, а не наложенное: «Захваченное глабрезу существо», «Схваченная Гарпуном цель». */
function describesTarget(s: string, re: RegExp): boolean {
  return new RegExp(
    `(?:${re.source})[а-яё]*(?:ое|ого|ому|ым|ых|ую|ые|ий|ый|ой|ая)\\s+(?:[^\\s.,;]+\\s+){0,3}(?:существ|цел)`,
    "i"
  ).test(s);
}

function conditionsIn(text: string, known: readonly DndMechanicsRef[]): Found<DndMechanicsRef[]> | null {
  const out: DndMechanicsRef[] = [];
  const quotes: string[] = [];
  for (const raw of sentences(text)) {
    if (NOT_INFLICTED.test(raw) || TARGET_LINE.test(raw)) continue;
    // «перестаёт быть Обездвиженной и становится Окаменевшей» — снятое не в счёт.
    const s = raw.replace(/перестаёт\s+быть\s+[а-яё]+/gi, "");
    for (const [name, re] of CONDITION_STEMS) {
      if (!re.test(s) || describesTarget(s, re)) continue;
      const ref = known.find((k) => k.name === name);
      if (!ref || out.some((r) => r.id === ref.id)) continue;
      out.push(ref);
      if (!quotes.includes(raw)) quotes.push(raw);
    }
  }
  return out.length ? { value: out, quote: quotes.join(" … ") } : null;
}

/** Длительность наложенного; null — в тексте не сказано. */
export function recognizeDuration(text: string): Found<DndCombatDuration> | Review | null {
  const found: Found<DndCombatDuration>[] = [];
  // «Невосприимчива на 24 часа» — срок иммунитета, а не наложенного.
  const t = sentences(text)
    .filter((s) => !/иммун|невосприимч/i.test(s))
    .join(" ");
  const add = (value: DndCombatDuration, m: RegExpMatchArray | null) => {
    if (m) found.push({ value, quote: m[0] });
  };
  add({ rounds: 10 }, t.match(/(?:на|в\s+течение)\s+1\s+минут[уы]/i));
  add({ rounds: 100 }, t.match(/(?:на|в\s+течение)\s+10\s+минут/i));
  const rounds = t.match(/(?:на|в\s+течение)\s+(\d+)\s+раунд/i);
  if (rounds) add({ rounds: Number(rounds[1]) }, rounds);
  add({ until: "combat" }, t.match(/(?:на|в\s+течение)\s+(?:1\s+час|\d+\s+час|1\s+день|24\s+час)/i));
  add({ until: "target_turn_end" }, t.match(/до\s+конца\s+(?:своего|его|её|ее)\s+(?:следующего\s+)?хода/i));
  // «до начала следующего хода гуля» — ход наложившего: один раунд.
  add({ rounds: 1 }, t.match(/до\s+начала\s+следующего\s+хода\s+(?!цели)[^\s.,;]+/i));
  // «до конца следующего хода мефита» — до конца следующего хода наложившего.
  add({ until: "caster_turn_end" }, t.match(/до\s+конца\s+следующего\s+хода\s+(?!цели)[^\s.,;]+/i));
  add({ until: "combat" }, t.match(/пока\s+(?:захват\s+не|не\s+освобод|не\s+высвобод|длится\s+захват)/i));
  const own = t.match(/до\s+начала\s+своего\s+следующего\s+хода/i);
  if (own) return { review: "чей ход — не ясно", quote: own[0] };
  if (found.length === 0) return null;
  const distinct = new Set(found.map((f) => JSON.stringify(f.value)));
  if (distinct.size > 1) return { review: "разные длительности", quote: found.map((f) => f.quote).join(" … ") };
  return found[0];
}

export interface InflictsProposal {
  conditions: Found<DndMechanicsRef[]>;
  duration: Found<DndCombatDuration> | null;
  repeat: RepeatFound | null;
}

/**
 * Разметка действия чудовища: состояние обязательно (без него окошку эффекта
 * накладывать нечего), длительность и повтор — если сказаны однозначно.
 */
export function recognizeActionInflicts(
  description: string,
  known: readonly DndMechanicsRef[]
): InflictsProposal | Review | null {
  const conditions = conditionsIn(description, known);
  if (!conditions) return null;
  const duration = recognizeDuration(description);
  if (duration && "review" in duration) return duration;
  const repeat = recognizeRepeat(description);
  if (repeat && "review" in repeat) return repeat;
  return { conditions, duration, repeat };
}

/** Действие целиком: «Мультиатака» называет чужие атаки («Отравленным клинком») — не размечается. */
export function recognizeCreatureAction(
  action: { name: string; description?: string; isMultiattack?: boolean },
  known: readonly DndMechanicsRef[]
): InflictsProposal | Review | null {
  if (action.isMultiattack || /^мультиатака/i.test(action.name.trim())) return null;
  return recognizeActionInflicts(action.description ?? "", known);
}
