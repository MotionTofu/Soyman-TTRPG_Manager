// Сверка имён — общее для плана импорта, записи и подбора по компендиуму.
//
// Одну и ту же сущность разные книги и разные переводы зовут по-разному, и
// сравнивать их приходится в трёх местах: plan.ts ищет совпадения с тем, что
// уже есть в сеттинге, apply.ts дописывает синонимы при склейке, compendium.ts
// подбирает монстра в системе. Нормализатор у всех троих обязан быть один:
// разъехавшись, они начнут находить разное на одних и тех же данных.

/** Найденный кандидат: и для сверки с сеттингом, и для подбора по компендиуму. */
export interface NameMatch {
  /** Кого нашли: "тип:id" — в этом же виде уходит обратно в apply. */
  ref: string;
  name: string;
  /** Подпись под именем: тип локации, категория, название системы. */
  hint: string;
  /** Чем совпало: имя, синоним, оригинал — или это лишь похожее написание. */
  reason: string;
  exact: boolean;
}

/**
 * «Ёлка» и «Ёлка » и «ёлка» — одно и то же имя.
 *
 * Апострофы выбрасываются, а не заменяются пробелом: «Бреган Д'эрт» и «Бреган
 * Дэрт» — один отряд наёмников, и до этой правки они сходились лишь как
 * «похоже». Дефис, наоборот, становится пробелом: «Человек-Ястреб» и «Человек
 * Ястреб» — да, но склеивать слова в «человекястреб» незачем.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’`´ʼ]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ");
}

const STOP_WORDS = new Set(["и", "в", "на", "the", "of", "a"]);

export function tokens(name: string): string[] {
  return normalizeName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Доля общих слов двух имён, 0..1.
 *
 * Русский язык приставками и окончаниями рушит прямое сравнение: «морской» не
 * подстрока «приморского». Поэтому сравниваются корни — первые пять букв.
 */
/**
 * Совпадение по корню засчитывается только начиная с четырёх букв.
 *
 * Вхождение ищется в любом месте слова, а не с начала: русский лепит и
 * приставки, «приморский» содержит «морск». Но на коротком хвосте это ловит
 * что попало — «Мэншун» содержит «шун», и император Амал Шун III оказывался
 * кандидатом на склейку с совершенно посторонним архимагом. Четыре буквы
 * отсекают такие находки, не трогая ценные: «Ваджра Сафар» держится на
 * «сафар», «Лаэраль Сильверхенд» — на «лаэраль».
 */
const MIN_STEM = 4;

function tokensMatch(token: string, other: string): boolean {
  if (token === other) return true;
  const stem = (t: string) => (t.length >= 5 ? t.slice(0, 5) : t);
  const left = stem(token);
  const right = stem(other);
  if (left.length >= MIN_STEM && other.includes(left)) return true;
  if (right.length >= MIN_STEM && token.includes(right)) return true;
  return false;
}

/**
 * Вес слов по редкости в сеттинге.
 *
 * «Северный район» и «Южный район» делят слово ровно так же, как «Важра Сафар»
 * и «Ваджра Сафар», — по одному общему из двух. Отличает их не форма, а то,
 * что «район» в сеттинге встречается десяток раз и почти ничего не значит, а
 * «сафар» — один раз, и потому значит всё. Слово, повторяющееся у многих
 * сущностей, весит соответственно меньше.
 */
export function buildTokenWeights(documents: string[][]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const names of documents) {
    const seen = new Set(names.flatMap(tokens));
    for (const token of seen) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  const weights = new Map<string, number>();
  for (const [token, count] of frequency) weights.set(token, 1 / count);
  return weights;
}

/**
 * Доля общих слов двух имён с поправкой на их редкость, 0..1. Без карты весов
 * все слова равны — так сравнивают между собой имена из самого файла, где
 * корпуса ещё нет.
 */
export function similarity(a: string, b: string, weights?: Map<string, number>): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return 0;
  const weigh = (token: string) => weights?.get(token) ?? 1;

  let shared = 0;
  for (const token of left) {
    if (right.some((other) => tokensMatch(token, other))) shared += weigh(token);
  }
  const total = Math.max(
    left.reduce((sum, t) => sum + weigh(t), 0),
    right.reduce((sum, t) => sum + weigh(t), 0)
  );
  return total ? shared / total : 0;
}

/** Поле aliases хранится в базе JSON-строкой; битое значение — просто пустой список. */
export function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
