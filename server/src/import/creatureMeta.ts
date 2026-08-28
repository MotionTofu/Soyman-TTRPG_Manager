// Разбор строки «Средний гуманоид (человек), хаотично-злой» на размер, тип
// существа и мировоззрение.
//
// Строку в таком виде хранит статблок формата dnd_creature — поле
// sizeTypeAlignment, — и в таком же виде её отдаёт файл книги при импорте
// приключения. Записи компендиума нужны те же значения по отдельности: по ним
// работают фильтры раздела Бестиарий, а карточка статблока к ним не подключена.
//
// Разбор общий у импортёра и у кнопки «Привести справочник в порядок»: иначе
// импорт снова заводил бы записи с пустым размером, и кнопку пришлось бы жать
// после каждого импорта.

/** Размеры в том виде, в каком их хранит запись компендиума. */
export const CREATURE_SIZES = [
  "Крошечный",
  "Маленький",
  "Средний",
  "Большой",
  "Огромный",
  "Громадный",
] as const;

// Размер в книге согласован с типом по роду и числу — «Среднее Исчадие»,
// «Большая стая Крошечных Зверей», — поэтому узнаётся по основе, а не по
// точному написанию. «Небольшой» и «Крупный» — синонимы из другого перевода.
const SIZE_STEMS: { stem: string; size: string }[] = [
  { stem: "крошечн", size: "Крошечный" },
  { stem: "небольш", size: "Маленький" },
  { stem: "маленьк", size: "Маленький" },
  { stem: "средн", size: "Средний" },
  { stem: "крупн", size: "Большой" },
  { stem: "больш", size: "Большой" },
  { stem: "огромн", size: "Огромный" },
  { stem: "громадн", size: "Громадный" },
];

/** Типы существ D&D — запасной словарь, когда справочник механик недоступен. */
export const DND_CREATURE_TYPES = [
  "Аберрация",
  "Великан",
  "Гуманоид",
  "Дракон",
  "Зверь",
  "Исчадие",
  "Конструкт",
  "Небожитель",
  "Нежить",
  "Растение",
  "Студень",
  "Фея",
  "Чудовище",
  "Элементаль",
];

const lower = (word: string) => word.toLowerCase().replace(/ё/g, "е");

/**
 * Слово книги и слово справочника — одно и то же с точностью до окончания:
 * «Зверей» и «Зверь», «Исчадий» и «Исчадие», «Нежити» и «Нежить». Сверяются
 * по общему началу, но не по четырём буквам жёстко: у «Феи» их столько нет.
 */
export function sameWordStem(a: string, b: string): boolean {
  const left = lower(a);
  const right = lower(b);
  if (left.length < 3 || right.length < 3) return false;
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++;
  const shortest = Math.min(left.length, right.length);
  return shared >= Math.max(2, Math.min(4, shortest - 1));
}

/** Размер по одному слову: «Средняя» → «Средний», «Небольшой» → «Маленький». */
export function matchSize(word: string): string {
  const plain = lower(word);
  return SIZE_STEMS.find((s) => plain.startsWith(s.stem))?.size ?? "";
}

/**
 * Тип существа по одному слову. Неоднозначное слово не сопоставляется вовсе:
 * лучше пустое поле, которое человек дозаполнит, чем тихо неверная ссылка.
 */
export function matchCreatureType(word: string, vocabulary: string[]): string {
  const hits = vocabulary.filter((v) => sameWordStem(v, word));
  return hits.length === 1 ? hits[0] : "";
}

export interface CreatureMeta {
  size: string;
  /** Значение словаря, а не слово книги: «Зверей» → «Зверь». Пусто, если не узнан. */
  type: string;
  /** Хвост строки как есть — книга пишет там условия («любое не-доброе»). */
  alignment: string;
  /** Слово, принятое за тип, но не найденное в словаре: «Объект», «бестия». */
  unknownType: string;
}

/**
 * Скобки снимаются до разбора: уточнение в них — не часть типа («гуманоид
 * (любая раса)», «монстр (перевёртыш)»), а запятая внутри них не отделяет
 * мировоззрение. У «Средний гуманоид (человек, перевёртыш), хаотично-злой»
 * разрез по первой запятой оставлял «гуманоид (человек» — и тип не находился.
 */
export function parseCreatureMeta(
  sizeTypeAlignment: string,
  vocabulary: string[] = DND_CREATURE_TYPES
): CreatureMeta {
  const plain = (sizeTypeAlignment ?? "").replace(/\s*\([^)]*\)/g, "");
  const comma = plain.indexOf(",");
  const head = (comma === -1 ? plain : plain.slice(0, comma)).trim();
  const alignment = comma === -1 ? "" : plain.slice(comma + 1).trim();

  // Заголовок бывает составным: «Средний или Маленький Гуманоид», «Большая
  // стая Крошечных Зверей», «Огромный Небожитель или Исчадие». Берётся первое
  // подходящее слово каждого рода: размер существа, а не стаи, и первый тип.
  const words = head.split(/\s+/).filter(Boolean);
  let size = "";
  let type = "";
  let unknownType = "";
  for (const word of words) {
    const asSize = matchSize(word);
    if (asSize) {
      if (!size) size = asSize;
      continue;
    }
    if (/^(или|и|стая|стаи|рой|роя)$/i.test(word)) continue;
    if (type) continue;
    const asType = matchCreatureType(word, vocabulary);
    if (asType) type = asType;
    else if (!unknownType) unknownType = word;
  }

  return { size, type, alignment, unknownType };
}

/**
 * Опыт из строки опасности: книга пишет «1/2 (100 опыта)», а поле хранит одну
 * только опасность. Хвост ломает и фильтр раздела (там ровно «1/2»), и расчёт
 * бонуса мастерства на карточке — он читает число.
 */
export function cleanChallengeRating(raw: string): string {
  return (raw ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Первая буква заглавная: в статблоках мировоззрение пишут со строчной. */
export function capitalize(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : "";
}
