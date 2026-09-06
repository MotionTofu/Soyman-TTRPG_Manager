/**
 * Паспортный DPR существа (dnd_creature) — средний урон за свой ход при всех
 * попаданиях. Верхняя граница угрозы, в духе maxAttackBonus на карточке:
 * по нему Мастер решает «кого выставить», а не «сколько хитов снимет точно».
 *
 * Понимает обе формы статблока: новую (категории, damage в полях) и легаси
 * (почти весь живой бестиарий) — там строка атаки это {name, description}:
 * «Бросок рукопашной атаки… Попадание: 4 (1к4 + 2) колющего урона»,
 * а мультиатака опознаётся по имени, флагов у неё нет.
 *
 * Что входит:
 * - действия `actions` категории `attack` (поле `damage`, напр. «2к6+3 рубящий»);
 * - мультиатака разрешается по описанию («две атаки когтями» → Когти ×2);
 * - лучшая бонус-атака добавляется (её можно делать каждый раунд);
 * - спасброски считаются как провал (конвенция DMG для offensive CR).
 *
 * Что НЕ входит: реакции, легендарные и логово-действия (не каждый свой ход),
 * список заклинаний как таковой (слоты кончаются; добавленное строкой действие
 * через «Добавить из заклинаний» — входит, у него уже есть свой damage).
 *
 * Чистая эвристика без внешних вызовов: offline-first, результат считается
 * при отдаче списка и не хранится. `approx` означает «разобрано не точно»
 * (мультиатака без явного числа, нераспознанный урон у лучшей атаки).
 *
 * Рядом лежит extractArmorHp: КЗ и хиты из того же статблока для плиток —
 * та же идея «быстрой инфы без дубля в data», ручные поля записи остаются
 * оверрайдом и применяются уже на клиенте.
 */

export interface CreatureDpr {
  dpr: number | null;
  approx: boolean;
}

interface ActionLike {
  name?: unknown;
  category?: unknown;
  isMultiattack?: unknown;
  damage?: unknown;
  description?: unknown;
}

// Кубы в русских и английских записях: «2к6+3», «1d8», «3к10 - 1».
const DICE_RE = /(\d+)\s*[кКdD]\s*(\d+)(?:\s*([+-])\s*(\d+))?/g;

/** Среднее всех кубов в строке («2к6+3 рубящий» → 10). 0, если кубов нет.
 * Условная альтернатива через «или» («4 (2к4+2) или 9 (3к4+2), если …»)
 * берётся максимумом, а не суммой; «плюс» внутри альтернативы суммируется. */
export function averageDamageText(raw: unknown): { avg: number; parsed: boolean } {
  if (typeof raw !== "string" || !raw) return { avg: 0, parsed: false };
  const alternatives = raw.split(/\s+(?:или|либо|or)\s+/iu);
  let best = 0;
  let found = false;
  for (const alt of alternatives) {
    let total = 0;
    let altFound = false;
    DICE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DICE_RE.exec(alt)) !== null) {
      const count = Number(m[1]);
      const size = Number(m[2]);
      const mod = m[4] ? Number(m[4]) * (m[3] === "-" ? -1 : 1) : 0;
      if (!Number.isFinite(count) || !Number.isFinite(size) || size <= 0) continue;
      total += count * ((size + 1) / 2) + mod;
      altFound = true;
    }
    if (altFound) {
      found = true;
      if (total > best) best = total;
    }
  }
  return { avg: best, parsed: found };
}

function asActionList(value: unknown): ActionLike[] {
  return Array.isArray(value) ? (value as ActionLike[]) : [];
}

/** Строка мультиатаки: флаг новой формы либо имя «Мультиатака» у легаси. */
function isMultiattackRow(a: ActionLike): boolean {
  if (a.isMultiattack === true) return true;
  return /^\s*мультиатака/iu.test(textOf(a.name));
}

/**
 * Строка атаки: категория attack новой формы; строка без осмысленной категории
 * («other» — дефолт миграции легаси, см. migrateLegacyAction) с уроном в поле;
 * либо проза с броском («Бросок … атаки», «Спасбросок …», старый перевод
 * «Испытание …: СЛ»). Кубы вида «30/90» и «5 фт.» парсер кубов не задевает.
 */
function isAttackRow(a: ActionLike): boolean {
  if (a.category === "attack") return true;
  const cat = a.category;
  if (cat !== undefined && cat !== null && cat !== "" && cat !== "other") return false;
  if (typeof a.damage === "string" && a.damage.trim() !== "") return true;
  return /атак|спасбросок|испытани/iu.test(textOf(a.description));
}

/** Урон: поле damage новой формы, иначе проза описания (легаси). */
function damageText(a: ActionLike): unknown {
  if (typeof a.damage === "string" && a.damage.trim() !== "") return a.damage;
  return a.description;
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Число словами и цифрами. Цифры ищутся ПОСЛЕ вырезания кубов («2к6» —
// не число атак), поэтому вход сюда приходит уже без них.
const COUNT_WORDS: [RegExp, number][] = [
  [/(^|[^\p{L}])пять(?![\p{L}])/u, 5],
  [/(^|[^\p{L}])четырежды(?![\p{L}])/u, 4],
  [/(^|[^\p{L}])четыре(?![\p{L}])/u, 4],
  [/(^|[^\p{L}])трижды(?![\p{L}])/u, 3],
  [/(^|[^\p{L}])три(?![\p{L}])/u, 3],
  [/(^|[^\p{L}])дважды(?![\p{L}])/u, 2],
  [/(^|[^\p{L}])две(?![\p{L}])/u, 2],
  [/(^|[^\p{L}])два(?![\p{L}])/u, 2],
  [/(^|[^\p{L}])одну(?![\p{L}])/u, 1],
  [/(^|[^\p{L}])один(?![\p{L}])/u, 1],
  [/(^|[^\p{L}])одна(?![\p{L}])/u, 1],
];

function wordsOf(s: string): string[] {
  return (s.toLowerCase().replace(/ё/g, "е").match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 3);
}

/**
 * Имя атаки упомянуто в тексте? Стемминг первыми 3 буквами: «Когти»→«ког»
 * ловит «когтями», а «Коготь»→«ког» ловит и «когтем» (беглый гласный).
 * Возвращает позицию первого совпавшего слова — по ней пара «число + имя»
 * выбирает ближайшее упоминание, а не первое в списке атак.
 */
function mentionPos(text: string, attackName: string): number {
  const hay = wordsOf(text);
  if (hay.length === 0) return -1;
  const stems = wordsOf(attackName).map((w) => w.slice(0, 3));
  for (let i = 0; i < hay.length; i++) {
    for (const stem of stems) {
      if (hay[i].startsWith(stem)) return i;
    }
  }
  return -1;
}

function mentionsAttack(text: string, attackName: string): boolean {
  return mentionPos(text, attackName) >= 0;
}

interface AttackInfo {
  name: string;
  /** Итог строки (база + limited/3) — для одиночных атак и «и использует». */
  avg: number;
  /** Повторяемая часть — ею умножает мультиатака; limited-хвост идёт разово. */
  base: number;
  parsed: boolean;
  /** Ограниченное применение (Перезарядка, 1/день): урон делится на 3. */
  limited: boolean;
  /** Эвристическое среднее (случайный выбор из вариантов). */
  approx: boolean;
}

/**
 * Ограниченное применение бьёт не каждый раунд (конвенция DMG для
 * offensive CR): размазываем на 3 раунда. Но глушить всю строку нельзя:
 * часто база бьёт каждый раунд, а limited только райдер («…урона Ядом.
 * Голод (перезарядка 5–6). Провал: 28 (8к6)…») — делим только хвост после
 * маркера. Маркер в имени — вся строка limited.
 */
export function splitLimitedUse(name: string, desc: string): { base: string; limited: string } {
  const m = /перезаряд[^.]*\./iu.exec(desc);
  if (m) return { base: desc.slice(0, m.index), limited: desc.slice(m.index + m[0].length) };
  if (/перезаряд|1\s*\/\s*день/iu.test(name)) return { base: "", limited: desc };
  if (/1\s*\/\s*день/iu.test(desc)) return { base: "", limited: desc };
  return { base: desc, limited: "" };
}

/** Среднее строки с учётом limited-хвоста; округление вниз как в книгах. */
export function rowAverage(a: ActionLike): {
  avg: number;
  base: number;
  parsed: boolean;
  limited: boolean;
  approx: boolean;
} {
  const src = damageText(a);
  const text = typeof src === "string" ? src : "";
  const { base, limited } = splitLimitedUse(textOf(a.name), text);
  const b = averageDamageText(base);
  const l = averageDamageText(limited);
  const baseAvg = Math.floor(b.avg);
  const limAvg = Math.floor(l.avg / 3);
  let avg = baseAvg + limAvg;
  let approx = false;
  // Случайный выбор из пронумерованных вариантов («бросьте 1к4», «1. … 2. …»):
  // срабатывает один, берём среднее по вариантам, а не сумму всех.
  const options = randomOptionCount(text);
  if (options >= 2 && avg > 0) {
    avg = Math.floor(avg / options);
    approx = true;
  }
  return { avg, base: approx ? avg : baseAvg, parsed: b.parsed || l.parsed, limited: l.parsed, approx };
}

/**
 * Число пронумерованных вариантов случайного выбора («1. Луч … 2. Луч …»).
 * Только маленькие номера: «СЛ 14. Провал» — не вариант.
 */
function randomOptionCount(text: string): number {
  if (!/случайным образом|случайный луч|бросьте 1к/iu.test(text)) return 0;
  const marks = text.match(/(?:^|[.!?]\s*)(?:[1-9]|10)\.\s+[А-ЯЁ]/gmu);
  return marks ? marks.length : 0;
}

/**
 * Разбор одной мультиатаки. Возвращает сумму и флаг точности.
 * Стратегия: пары «число + имя атаки» («одну укусом и две когтями») — точно;
 * иначе общее число × упомянутая атака; иначе — фолбэк на лучшую атаку.
 */
function resolveMultiattack(
  multi: ActionLike,
  attacks: AttackInfo[]
): { total: number; exact: boolean } {
  const best = attacks.length ? Math.max(...attacks.map((a) => a.avg)) : 0;
  if (!attacks.length) return { total: 0, exact: false };
  const rawText = `${textOf(multi.name)} ${textOf(multi.description)}`.toLowerCase().replace(/ё/g, "е");
  // Кубы из подсчёта чисел исключаем: «2к6» — не «2 атаки».
  // Дефисы приводим к ASCII: «(5-й круг)» с неразрывным дефисом иначе
  // читается как «5 атак».
  const text = rawText
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/(\d+)\s*[ккdD]\s*(\d+)/g, " ");

  const referenced = attacks.filter((a) => mentionsAttack(text, a.name));
  const pool = referenced.length ? referenced : attacks;
  const poolBest = Math.max(...pool.map((a) => a.avg));
  // База без разовых замен и limited-хвостов — ею множит мультиатака.
  const poolBaseBest = Math.max(...pool.map((a) => a.base));
  const limSum = referenced.reduce((s, a) => s + (a.avg - a.base), 0);

  // Пары «число …имя»: число действует на ближайшую упомянутую далее атаку.
  const pairRe =
    /(пять|четырежды|четыре|трижды|три|дважды|две|два|одну|один|одна|([1-5]))(?![\p{L}])/gu;
  let pairSum = 0;
  let pairCount = 0;
  const pairUsed = new Set<string>();
  // Атаки из пар-замен («может заменить одну на атаку Хвостом»): разовые,
  // остаток и потолок считаются без них.
  const swapNames = new Set<string>();
  let m: RegExpExecArray | null;
  const WORD_VALUE: Record<string, number> = {
    одну: 1,
    один: 1,
    одна: 1,
    две: 2,
    два: 2,
    дважды: 2,
    три: 3,
    трижды: 3,
    четыре: 4,
    четырежды: 4,
    пять: 5,
  };
  while ((m = pairRe.exec(text)) !== null) {
    const word = m[1].toLowerCase();
    const n = /^\d$/.test(word) ? Number(word) : WORD_VALUE[word] ?? 0;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    // Ведущее общее число («три атаки: …») — это totalCount, а не пара:
    // за ним идёт слово «атаки», а не имя приёма.
    if (/^\s*атак/u.test(tail)) continue;
    // Ближайшее упоминание, а не первое в списке: «одну укусом и две
    // когтями» — «одну» относится к укусу, хоть Когти и раньше в списке.
    const hit = pool
      .map((a) => ({ a, pos: mentionPos(tail, a.name) }))
      .filter((x) => x.pos >= 0)
      .sort((x, y) => x.pos - y.pos)[0]?.a;
    if (hit && n > 0) {
      // Пары множат базу: limited-хвост идёт разово через limSum ниже.
      pairSum += n * hit.base;
      pairCount += n;
      pairUsed.add(hit.name);
      // «…может заменить одну…» левее числа — пара разовая, не база.
      if (/замен/iu.test(text.slice(Math.max(0, m.index - 20), m.index))) swapNames.add(hit.name);
    }
  }
  // Общее число атак в тексте (максимум из названных).
  let totalCount = 0;
  for (const [re, n] of COUNT_WORDS) {
    if (re.test(text)) totalCount = Math.max(totalCount, n);
  }
  const digitOnly = text.match(/(^|[^a-zа-яё\d/])([1-5])(?![a-zа-яё\d/-])/);
  // «(5-й круг)», «30/120», «1/день» — не число атак: дефис и слэш тоже границы.
  if (digitOnly) totalCount = Math.max(totalCount, Number(digitOnly[2]));

  // «…и использует X» — дополнительное действие сверх посчитанного
  // («одну атаку Касанием и использует Обворожение или Поцелуй»): лучший
  // бьющий из упомянутых после, уже спаренные не дублируем. Граница слева
  // обязательна: иначе «Зомби использует» читается как «и использует».
  let extra = 0;
  const useRe = /(?:^|[^\p{L}])и\s+(?:может\s+)?использует\s+/giu;
  let um: RegExpExecArray | null;
  while ((um = useRe.exec(text)) !== null) {
    const tail = text.slice(um.index + um[0].length, um.index + um[0].length + 40);
    for (const a of pool) {
      if (pairUsed.has(a.name)) continue;
      if (mentionsAttack(tail, a.name) && a.avg > extra) extra = a.avg;
    }
  }

  let core: { total: number; exact: boolean };
  if (pairSum > 0) {
    // База без разовых замен; нечем заполнить — берём общий лучший базовый.
    const restPool = pool.filter((a) => !swapNames.has(a.name));
    const restBest = restPool.length ? Math.max(...restPool.map((a) => a.base)) : poolBaseBest;
    // Пар больше, чем всего атак (опциональная замена посчитана как
    // дополнительная): потолок — все атаки лучшим из незаменных.
    if (totalCount > 0 && pairCount > totalCount) {
      core = { total: totalCount * restBest + limSum, exact: false };
    } else {
      const rest = totalCount - pairCount;
      const base = rest > 0 ? pairSum + rest * restBest : pairSum;
      // Опциональная замена («может заменить одну на…») — тоже интерпретация:
      // верхняя граница берёт максимум из «как написано» и «всё лучшим».
      const ceiling = totalCount > 0 ? totalCount * restBest : base;
      const plain = ceiling > base ? ceiling : base;
      core = { total: plain + limSum, exact: limSum === 0 && ceiling <= base && rest <= 0 };
    }
  } else if (totalCount > 0 && referenced.length === 1) {
    const r = referenced[0];
    core = { total: totalCount * r.base + (r.avg - r.base), exact: r.avg === r.base };
  } else if (totalCount > 0) {
    core = { total: totalCount * poolBaseBest + limSum, exact: false };
  } else {
    core = { total: best, exact: false };
  }
  if (extra > 0) return { total: core.total + extra, exact: false };
  if (core.exact && pool.some((a) => a.approx)) return { total: core.total, exact: false };
  return core;
}

export interface StatblockArmorHp {
  ac: string | null;
  hp: string | null;
}

function leadingNumber(raw: string): string | null {
  const m = raw.trim().match(/^\d+/);
  return m ? m[0] : null;
}

/**
 * КЗ и хиты из dnd-статблока для плиток бестиария. Понимает и новую форму
 * (armorClass.value, hitPoints в полях), и легаси-строки («45 (6к10+18)»).
 * Среднее хитов — тем же округлением вниз, что cardHitPoints на карточке.
 */
export function extractArmorHp(content: string): StatblockArmorHp {
  let sb: Record<string, unknown>;
  try {
    sb = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { ac: null, hp: null };
  }
  if (!sb || typeof sb !== "object") return { ac: null, hp: null };

  let ac: string | null = null;
  const rawAc = sb.armorClass;
  if (rawAc && typeof rawAc === "object") {
    const v = (rawAc as { value?: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v)) ac = String(v);
  } else if (typeof rawAc === "string" && rawAc.trim()) {
    ac = leadingNumber(rawAc) ?? rawAc.trim();
  }

  let hp: string | null = null;
  const rawHp = sb.hitPoints;
  if (rawHp && typeof rawHp === "object") {
    const o = rawHp as { diceCount?: unknown; dieSize?: unknown; bonus?: unknown; formula?: unknown };
    if (typeof o.diceCount === "number" && typeof o.dieSize === "number" && o.diceCount > 0 && o.dieSize > 0) {
      const bonus = typeof o.bonus === "number" && Number.isFinite(o.bonus) ? o.bonus : 0;
      hp = String(Math.floor(o.diceCount * (o.dieSize / 2 + 0.5)) + bonus);
    } else if (typeof o.formula === "string" && o.formula.trim()) {
      hp = leadingNumber(o.formula);
    }
  } else if (typeof rawHp === "string" && rawHp.trim()) {
    hp = leadingNumber(rawHp);
  }

  return { ac, hp };
}

export function estimateCreatureDpr(content: string): CreatureDpr {
  let sb: Record<string, unknown>;
  try {
    sb = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { dpr: null, approx: false };
  }
  if (!sb || typeof sb !== "object") return { dpr: null, approx: false };

  const actionRows = [...asActionList(sb.actions), ...asActionList((sb as { bonusActions?: unknown }).bonusActions)];
  const attacks: AttackInfo[] = [];
  for (const a of actionRows) {
    if (!isAttackRow(a) || isMultiattackRow(a)) continue;
    const { avg, base, parsed, limited, approx } = rowAverage(a);
    attacks.push({ name: textOf(a.name), avg, base, parsed, limited, approx });
  }
  const multis = asActionList(sb.actions).filter((a) => isMultiattackRow(a));
  const bonusAttacks = asActionList((sb as { bonusActions?: unknown }).bonusActions).filter((a) =>
    isAttackRow(a)
  );

  if (!attacks.length && !multis.length && !bonusAttacks.length) {
    // Атак нет вовсе (или статблок не разобран в поля) — DPR неизвестен, не ноль.
    return { dpr: null, approx: false };
  }

  let approx = false;
  let main: number | null = 0;
  if (multis.length) {
    // Мультиатака без единой строки атаки (кривой импорт — см. Арканалот):
    // разрешать нечего, это «неизвестно», а не ноль.
    if (!attacks.length) {
      main = null;
    } else {
      let bestTotal = 0;
      let bestExact = false;
      for (const multi of multis) {
        const r = resolveMultiattack(multi, attacks);
        if (r.total > bestTotal || (r.total === bestTotal && r.exact)) {
          bestTotal = r.total;
          bestExact = r.exact;
        }
      }
      main = bestTotal;
      if (!bestExact) approx = true;
    }
  } else if (attacks.length) {
    const best = attacks.reduce((a, b) => (b.avg > a.avg ? b : a));
    main = best.avg;
    if (!best.parsed && best.avg === 0) approx = true;
    if (best.limited || best.approx) approx = true;
  }

  // Лучшая бонус-атака — каждый раунд сверх основного действия.
  let bonus = 0;
  let bonusLimited = false;
  let bonusApprox = false;
  for (const a of bonusAttacks) {
    if (isMultiattackRow(a)) continue;
    const { avg, limited, approx: rowApprox } = rowAverage(a);
    if (avg > bonus) {
      bonus = avg;
      bonusLimited = limited;
      bonusApprox = rowApprox;
    }
  }

  if (main === null) {
    return bonus > 0 ? { dpr: Math.floor(bonus), approx: true } : { dpr: null, approx: false };
  }
  return { dpr: Math.floor(main + bonus), approx: approx || (bonus > 0 && (bonusLimited || bonusApprox)) };
}
