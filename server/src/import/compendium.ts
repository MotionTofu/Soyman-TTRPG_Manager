// Подбор монстра из компендиума системы для записи бестиария.
//
// В файле книги у монстра есть compendium_hints — как он называется в системе
// («Гоблин-воин»). Формат обещает, что импортёр попробует найти их и предложит
// связать; здесь это и делается.
//
// Сеттинг с системой не связан: у settings нет system_id, а Вотердип живёт
// одновременно в кампании на D&D 5.5 и в кампании на Legend in the Mist.
// Поэтому искать надо в компендиумах всех систем, до которых дотягиваются
// кампании сеттинга, — ровно поэтому being_compendium_links и сделана
// многие-ко-многим. Автоматически ничего не связывается: выбор за человеком.

import { db } from "../db/db";
import { NameMatch, buildTokenWeights, normalizeName, parseAliases, similarity } from "./names";
import { matchCreatureType, parseCreatureMeta } from "./creatureMeta";

interface Candidate {
  id: number;
  name: string;
  system: string;
  /** Все написания, по которым эту запись можно узнать. */
  names: string[];
}

/**
 * Имена компендиума, по которым запись ищешь. Раньше оригинал жил в скобках —
 * «Нимблрайт [Nimblewright]» — и его надо было выковыривать из имени; теперь
 * он лежит в отдельной колонке наравне с синонимами, но скобочная конвенция
 * осталась в базах, импортированных до реформы, поэтому разбирается и она:
 * перевод книги совпадёт с русской половиной, оригинал — с английской.
 */
function spellings(name: string, name_original: string, aliases: string): string[] {
  const out = [name];
  const bracket = name.match(/\[([^\]]+)\]/);
  if (bracket) {
    out.push(bracket[1]);
    // Хвост после скобки — пометка источника вроде «PBSO», не часть имени.
    out.push(name.slice(0, bracket.index).trim());
  }
  if (name_original.trim()) out.push(name_original.trim());
  for (const alias of parseAliases(aliases)) if (alias.trim()) out.push(alias.trim());
  return out.filter((n) => n.trim());
}

/** Вид записи компендиума: монстр для бестиария, маг. предмет для сокровищницы. */
export type CompendiumKind = "monster" | "magic_item";

/**
 * Записи одного вида из всех систем, в которых водят кампании по этому
 * сеттингу.
 */
export function compendiumCandidates(
  settingId: number | null,
  kind: CompendiumKind = "monster"
): Candidate[] {
  if (settingId == null) return [];
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.name_original, e.aliases, sys.name AS system
         FROM compendium_entries e
         JOIN systems sys ON sys.id = e.system_id
        WHERE e.kind = ?
          AND e.system_id IN (SELECT DISTINCT system_id FROM campaigns WHERE setting_id = ?)
        ORDER BY sys.name, e.name`
    )
    .all(kind, settingId) as {
    id: number;
    name: string;
    name_original: string;
    aliases: string;
    system: string;
  }[];
  return rows.map((row) => ({
    ...row,
    names: spellings(row.name, row.name_original, row.aliases),
  }));
}

/**
 * Кандидаты для одной записи бестиария. Точные совпадения показываются все;
 * похожие — только если точных не нашлось вовсе, иначе «похоже» лишь мусорит
 * рядом с уверенным попаданием. Порог тот же, что на экране сверки.
 */
export function matchCompendium(names: string[], candidates: Candidate[]): NameMatch[] {
  const wanted = names.filter((n) => n && n.trim());
  if (!wanted.length) return [];

  const exact: NameMatch[] = [];
  const seen = new Set<number>();
  for (const candidate of candidates) {
    const hit = candidate.names.find((cn) =>
      wanted.some((w) => normalizeName(w) === normalizeName(cn))
    );
    if (!hit) continue;
    seen.add(candidate.id);
    exact.push({
      ref: `compendium:${candidate.id}`,
      name: candidate.name,
      hint: candidate.system,
      reason: "совпадает название в компендиуме",
      exact: true,
    });
  }
  if (exact.length) return exact;

  // Вес по редкости и здесь: «зверь» встречается у половины бестиария системы
  // и почти ничего не значит, «нимблрайт» — у одного.
  const weights = buildTokenWeights(candidates.map((c) => c.names));
  const fuzzy: (NameMatch & { score: number })[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    let score = 0;
    for (const w of wanted)
      for (const cn of candidate.names) score = Math.max(score, similarity(w, cn, weights));
    if (score >= 0.5) {
      fuzzy.push({
        ref: `compendium:${candidate.id}`,
        name: candidate.name,
        hint: candidate.system,
        reason: "похоже по написанию",
        exact: false,
        score,
      });
    }
  }
  fuzzy.sort((a, b) => b.score - a.score);
  return fuzzy.slice(0, 3).map(({ score, ...match }) => {
    void score;
    return match;
  });
}

/**
 * Системы, в компендиум которых импорт может дописывать: те же, до которых
 * дотягиваются кампании сеттинга. Разделы обоих видов необязательны — система
 * может вести бестиарий и не вести маг. предметы, — но хотя бы один нужен,
 * иначе писать некуда и выбирать такую систему не из чего.
 */
export interface ImportSystem {
  id: number;
  name: string;
  /** id раздела, в который ляжет новая запись. null — раздела в системе нет. */
  monster_section_id: number | null;
  magic_item_section_id: number | null;
}

export function importSystems(settingId: number | null): ImportSystem[] {
  if (settingId == null) return [];
  return db
    .prepare(
      `SELECT sys.id, sys.name,
              (SELECT id FROM system_sections WHERE system_id = sys.id AND kind = 'monster')
                AS monster_section_id,
              (SELECT id FROM system_sections WHERE system_id = sys.id AND kind = 'magic_item')
                AS magic_item_section_id
         FROM systems sys
        WHERE sys.archived_at IS NULL
          AND sys.id IN (SELECT DISTINCT system_id FROM campaigns WHERE setting_id = ?)
        ORDER BY sys.name`
    )
    .all(settingId)
    .filter(
      (s) => (s as ImportSystem).monster_section_id || (s as ImportSystem).magic_item_section_id
    ) as ImportSystem[];
}

/**
 * Словарь типов и редкостей: книга пишет «кольцо, необычное», а компендиум
 * хранит «Кольца» и «Необычный» — те же значения, что стоят в выпадающих
 * списках раздела. Без перевода фильтры новую запись не увидят.
 */
// Списки повторяют MAGIC_ITEM_TYPES и MAGIC_ITEM_RARITIES из client/src/
// compendium.ts — это ровно те значения, что стоят в фильтрах раздела и в
// выпадающих списках редактора. Расходиться им нельзя: значение мимо списка
// молча выпадает из всех фильтров.
const ITEM_TYPES = [
  "Доспехи",
  "Жезлы",
  "Зелья",
  "Кольца",
  "Оружие",
  "Палочки",
  "Посохи",
  "Свитки",
  "Чудесные предметы",
  "Щиты",
];
const RARITIES = [
  "Обычный",
  "Необычный",
  "Редкий",
  "Очень редкий",
  "Легендарный",
  "Артефакт",
  "Варьируется",
];

/** Слово книги → значение списка: «кольцо» → «Кольца», «необычное» → «Необычный». */
function fromVocabulary(raw: string, vocabulary: string[]): string {
  const wanted = normalizeName(raw);
  if (!wanted) return "";
  const exact = vocabulary.find((v) => normalizeName(v) === wanted);
  if (exact) return exact;
  // Род и число книга пишет как придётся: «необычное», «кольцо», «доспех»,
  // «чудесный предмет». Расходятся ровно окончания, поэтому слова сверяются
  // по общему началу — и все, иначе «редкое» цеплялось бы к «Очень редкий».
  return (
    vocabulary.find((v) => {
      const left = normalizeName(v).split(" ");
      const right = wanted.split(" ");
      return left.length === right.length && left.every((word, i) => sameStem(word, right[i]));
    }) ?? ""
  );
}

/** Слова с общим началом и разными окончаниями: «кольцо» и «кольца». */
function sameStem(a: string, b: string): boolean {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  const shortest = Math.min(a.length, b.length);
  // Обычно хватает четырёх общих букв, но у коротких слов их столько и нет:
  // «щит» и «Щиты» расходятся одной буквой из четырёх.
  return shared >= Math.max(Math.min(4, shortest), shortest - 3);
}

export const itemType = (raw: string) => fromVocabulary(raw, ITEM_TYPES);
export const itemRarity = (raw: string) => fromVocabulary(raw, RARITIES);

/**
 * Размер и тип существа из строки «Средний гуманоид, любое мировоззрение».
 * Разбор общий с кнопкой «Привести справочник в порядок» — см. creatureMeta.ts;
 * клиент разбирает ту же строку так же (normalizeDndCreature), но у записи
 * компендиума размер и класс опасности живут ещё и в data: по ним работают
 * фильтры раздела бестиария, а карточка статблока к ним не подключена.
 */
export function parseSizeType(sizeTypeAlignment: string): { size: string; type: string } {
  const meta = parseCreatureMeta(sizeTypeAlignment);
  return { size: meta.size, type: meta.type || meta.unknownType };
}

/**
 * Мировоззрение из той же строки «Средний гуманоид, хаотично-злой». Хвост
 * берётся целиком — книга пишет там условия («любое не-доброе»), а не пункт
 * списка.
 */
export function parseAlignment(sizeTypeAlignment: string): string {
  return parseCreatureMeta(sizeTypeAlignment).alignment;
}

export { cleanChallengeRating } from "./creatureMeta";

/** Типы существ из справочника механик системы — словарь, к которому сводится тип. */
export function creatureTypeVocabulary(systemId: number): { id: number; name: string }[] {
  return db
    .prepare(
      `SELECT child.id, child.name
         FROM compendium_entries child
         JOIN compendium_entries grp ON grp.id = child.parent_id
        WHERE grp.system_id = ? AND grp.kind = 'mechanic_group'
          AND grp.name = 'Типы существ и их особенности'`
    )
    .all(systemId) as { id: number; name: string }[];
}

/**
 * Тип существа из списка механик системы — иначе фильтр по типу его не увидит.
 * Точного совпадения мало: книга склоняет тип по стае и роду («Зверей»,
 * «Исчадий»), а справочник хранит именительный.
 */
export function creatureTypeRef(systemId: number, type: string): { id: number; name: string } | null {
  if (!type.trim()) return null;
  const rows = creatureTypeVocabulary(systemId);
  const exact = rows.find((r) => normalizeName(r.name) === normalizeName(type));
  if (exact) return exact;
  const matched = matchCreatureType(type, rows.map((r) => r.name));
  return matched ? rows.find((r) => r.name === matched) ?? null : null;
}

/**
 * Отсев идентификаторов, пришедших с экрана сверки: связать запись бестиария
 * можно только с монстром системы, в которую сеттинг действительно играет.
 * Клиент присылает то, что показали ему мы, но проверить дешевле, чем потом
 * искать в базе связь на монстра из чужой системы.
 */
export function validCompendiumIds(
  settingId: number,
  ids: number[],
  kind: CompendiumKind = "monster"
): number[] {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return [];
  const allowed = new Set(compendiumCandidates(settingId, kind).map((c) => c.id));
  return wanted.filter((id) => allowed.has(id));
}
