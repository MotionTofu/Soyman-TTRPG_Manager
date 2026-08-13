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
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return 0;
  const stem = (token: string) => (token.length >= 5 ? token.slice(0, 5) : token);
  let shared = 0;
  for (const token of left) {
    const matched = right.some(
      (other) => other === token || other.includes(stem(token)) || token.includes(stem(other))
    );
    if (matched) shared++;
  }
  return shared / Math.max(left.length, right.length);
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
