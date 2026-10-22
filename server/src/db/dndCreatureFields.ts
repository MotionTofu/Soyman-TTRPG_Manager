import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { convertLegacyCreature, type SpellLookup, type SpellRef } from "@soyman/shared";

/**
 * Боевой режим, шаг 1: статблоки существ D&D из текста книги — в поля модели
 * (запасы действий, легендарное, заклинания ссылками), чтобы трекерам гнезда
 * было по чему считать. Разбор — `convertLegacyCreature` в shared; здесь
 * только справочник заклинаний и запись. Решения Q10/Q17/Q19/Q45–Q50 —
 * `.scratch/combat-mode/notes.md`.
 *
 * Бестиарий переведён по «Монстрономикону», справочник заклинаний — по «Книге
 * игрока»: «Тавматургия» там «Чудотворство». Поэтому сначала имена бестиария
 * дописываются в «другие названия» заклинаний (по английскому имени — у друга
 * id другие), потом идёт перевод. Таблица проверена владельцем 2026-10-22:
 * `.scratch/combat-mode/spell-aliases.md`.
 *
 * [имя в бестиарии, английское имя заклинания справочника]
 */
export const BESTIARY_SPELL_ALIASES: readonly (readonly [string, string])[] = [
  ["Магическая рука", "Mage Hand"],
  ["Планарный переход", "Plane Shift"],
  ["Тавматургия", "Thaumaturgy"],
  ["Метаморфоза", "Shapechange"],
  ["Тайновидение", "Scrying"],
  ["Полиглот", "Tongues"],
  ["Полноценный образ", "Major Image"],
  ["Обнаружение зла и добра", "Detect Evil and Good"],
  ["Мелкие фокусы", "Prestidigitation"],
  ["Изменение облика", "Alter Self"],
  ["Газообразность", "Gaseous Form"],
  ["Друидизм", "Druidcraft"],
  ["Дружба с животным", "Animal Friendship"],
  ["Управление погодой", "Control Weather"],
  ["Дверь в пространстве", "Dimension Door"],
  ["Стихийность", "Elementalism"],
  ["Удар молнии", "Lightning Bolt"],
  ["Направляющий луч", "Guiding Bolt"],
  ["Место истины", "Zone of Truth"],
  ["Магический доспех", "Mage Armor"],
  ["Рассеивание зла и добра", "Dispel Evil and Good"],
  ["Укол разума", "Mind Spike"],
  ["Опаляющий луч", "Scorching Ray"],
  ["Паралич гуманоида", "Hold Person"],
  ["Дыхание под водой", "Water Breathing"],
  ["Разговор с мёртвым", "Speak with Dead"],
  ["Божественное откровение", "Commune"],
  ["Гейс", "Geas"],
  ["Ясновидение", "Clairvoyance"],
  ["Огненная стена", "Wall of Fire"],
  ["Манипуляция памятью", "Modify Memory"],
  ["Убийственный фантазм", "Phantasmal Killer"],
  ["Разбивающий звук", "Shatter"],
  ["Управление водой", "Control Water"],
  ["Бесследный шаг", "Pass without Trace"],
  ["Возвращение к жизни", "Raise Dead"],
  ["Едкая сфера", "Vitriolic Sphere"],
  ["Огненный столп", "Flame Strike"],
  ["Сон", "Sleep"],
  ["Волна разрушения", "Destructive Wave"],
  ["Паралич чудовища", "Hold Monster"],
  ["Ледяной нож", "Ice Knife"],
  ["Смертельное облако", "Cloudkill"],
  ["Фантомный скакун", "Phantom Steed"],
  ["Поиск предмета", "Locate Object"],
  ["Проекция образа", "Project Image"],
  ["Массовое внушение", "Mass Suggestion"],
  ["Создание еды и питья", "Create Food and Water"],
  ["Создание нежити", "Create Undead"],
  ["Громовая волна", "Thunderwave"],
  ["Животное-посланник", "Animal Messenger"],
  ["Спокойствие", "Calm Emotions"],
  ["Подчинение гуманоида", "Dominate Person"],
  ["Иной облик", "Alter Self"],
  ["Создание или уничтожение воды", "Create or Destroy Water"],
  ["Ледяная буря", "Ice Storm"],
  ["Снятие проклятия", "Remove Curse"],
  ["Кислотная стрела Мелфа", "Melf's Acid Arrow"],
  ["Безудержный смех Таши", "Tasha’s Hideous Laughter"],
  ["Завораживающий узор", "Hypnotic Pattern"],
  ["Прострация", "Befuddlement"],
  ["Иллюзорная местность", "Hallucinatory Terrain"],
  ["Слово силы: шок", "Power Word Stun"],
  ["Масло", "Grease"],
  ["Слепота/глухота", "Blindness/Deafness"],
  ["Фейское сияние", "Faerie Fire"],
  ["Преображение камня", "Stone Shape"],
  ["Движение грунта", "Move Earth"],
  ["Проход сквозь стену", "Passwall"],
  ["Каменная стена", "Wall of Stone"],
  ["Путешествие с ветром", "Wind Walk"],
  ["Творение", "Creation"],
  ["Приворот чудовища", "Charm Monster"],
  ["Лунный свет", "Moonbeam"],
  ["Слово возвращения", "Word of Recall"],
  ["Грёзы", "Dream"],
  ["Сияющая буря Джалларзи", "Jallarzi's Storm of Radiance"],
  ["Прорицание", "Divination"],
  ["Цепь молний", "Chain Lightning"],
  ["Очищение еды и питья", "Purify Food and Drink"],
  ["Повреждение", "Harm"],
  ["Рой саранчи", "Insect Plague"],
  ["Истинное видение", "True Seeing"],
  ["Исцеление ран", "Cure Wounds"],
  ["Выход в Эфир", "Etherealness"],
  ["Облако тумана", "Fog Cloud"],
  ["Приворот гуманоида", "Charm Person"],
  ["Пробуждение", "Awaken"],
  ["Животные облики", "Animal Shapes"],
  ["Солнечная вспышка", "Sunburst"],
  ["Призрачные стражи", "Spirit Guardians"],
  ["Увядание", "Blight"],
  ["Синаптический шум", "Synaptic Static"],
  ["Волшебный глаз", "Arcane Eye"],
  ["Низшее восстановление", "Lesser Restoration"],
  ["Обнаружение мыслей", "Detect Thoughts"],
  ["Левитация", "Levitate"],
  ["Подчинение чудовища", "Dominate Monster"],
  ["Уход в иной мир", "Plane Shift"],
];

/**
 * Одно имя — разные заклинания: «Замешательство» справочника — Befuddlement
 * (8 круг), а у Глабрезу так переведено Confusion («Смятение»).
 * [английское имя существа] → {имя в статблоке → английское имя заклинания}
 */
const CREATURE_SPELL_OVERRIDES: Record<string, Record<string, string>> = {
  Glabrezu: { Замешательство: "Confusion" },
};

const key = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

function parseAliases(raw: string | null): string[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseEntryData(raw: string | null): Record<string, unknown> {
  try {
    const d = JSON.parse(raw || "{}");
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

/** Дописывает имена бестиария в `aliases` заклинаний; возвращает число правок. */
export function applyBestiarySpellAliases(database: Database.Database): number {
  const find = database.prepare(
    "SELECT id, name, aliases FROM compendium_entries WHERE kind = 'spell' AND lower(name_original) = lower(?)"
  );
  const save = database.prepare("UPDATE compendium_entries SET aliases = ? WHERE id = ?");
  let added = 0;
  for (const [ru, en] of BESTIARY_SPELL_ALIASES) {
    for (const row of find.all(en) as { id: number; name: string; aliases: string | null }[]) {
      const aliases = parseAliases(row.aliases);
      if (key(row.name) === key(ru) || aliases.some((a) => key(a) === key(ru))) continue;
      save.run(JSON.stringify([...aliases, ru]), row.id);
      added++;
    }
  }
  return added;
}

/**
 * Переводит все текстовые статблоки существ (бестиарий и существа сеттинга).
 * Неразобранные остаются как были, с причинами в `review` — это фильтр
 * «Требует разбора». `updated_at` не трогается: правка не владельца.
 */
export function migrateDndCreatureFields(database: Database.Database, dbDir: string): void {
  applyBestiarySpellAliases(database);

  const byKey = new Map<string, SpellRef>();
  const byOriginal = new Map<string, SpellRef>();
  const spells = database
    .prepare("SELECT id, name, name_original, aliases, level FROM compendium_entries WHERE kind = 'spell'")
    .all() as { id: number; name: string; name_original: string | null; aliases: string | null; level: number | null }[];
  for (const s of spells) {
    const name = s.name.replace(/\s*\[.*\]\s*$/, "").trim();
    const ref: SpellRef = { entryId: s.id, name, level: s.level ?? 0 };
    for (const n of [name, s.name_original ?? "", ...parseAliases(s.aliases)]) if (n && !byKey.has(key(n))) byKey.set(key(n), ref);
    if (s.name_original) byOriginal.set(key(s.name_original), ref);
  }
  const lookupFor = (creatureOriginal: string | null): SpellLookup => {
    const overrides = CREATURE_SPELL_OVERRIDES[creatureOriginal ?? ""] ?? {};
    return (name, original) => {
      const forced = overrides[name];
      if (forced) return byOriginal.get(key(forced)) ?? null;
      return byKey.get(key(name)) ?? (original ? byOriginal.get(key(original)) ?? byKey.get(key(original)) : undefined) ?? null;
    };
  };

  const rows = database
    .prepare(
      `SELECT s.id, s.content, COALESCE(e.name_original, b.name_original) AS original, e.data AS entry_data
       FROM statblocks s
       LEFT JOIN compendium_entries e ON s.owner_type = 'compendium_entry' AND e.id = s.owner_id
       LEFT JOIN setting_beings b ON s.owner_type = 'being' AND b.id = s.owner_id
       WHERE s.format = 'dnd_creature'`
    )
    .all() as { id: number; content: string; original: string | null; entry_data: string | null }[];

  const results: { id: number; content: string }[] = [];
  let converted = 0;
  let review = 0;
  for (const row of rows) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(row.content || "{}");
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const res = convertLegacyCreature(raw, lookupFor(row.original));
    if (res.data) {
      // Размер, тип и мировоззрение записи бестиария — уже разобранные при
      // импорте и, возможно, поправленные Мастером. Берутся они, а не новый
      // разбор строки: иначе первое же сохранение статблока сдвинуло бы
      // сводку раздела (syncCreatureDataFromStatblock).
      const entry = parseEntryData(row.entry_data);
      const type = (entry.creature_type as { name?: unknown } | undefined)?.name;
      if (typeof type === "string" && type) res.data.creatureType = type;
      if (typeof entry.size === "string" && entry.size) res.data.size = entry.size;
      if (typeof entry.alignment === "string" && entry.alignment) res.data.alignment = entry.alignment;
      results.push({ id: row.id, content: JSON.stringify(res.data) });
      converted++;
    } else if (res.review.length) {
      results.push({ id: row.id, content: JSON.stringify({ ...raw, review: res.review }) });
      review++;
    }
  }
  if (!results.length) return;

  const snapshot = path.join(dbDir, `app-before-creature-fields-${randomUUID()}.db`);
  database.prepare("VACUUM INTO ?").run(snapshot);
  const save = database.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
  database.transaction(() => {
    for (const r of results) save.run(r.content, r.id);
  })();
  console.log(`[migrate] dnd_creature_fields_v1: переведено ${converted}, требует разбора ${review}. Снимок: ${snapshot}`);
}
