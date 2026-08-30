// Запись файла system-import/1 в компендиум системы — одной транзакцией.
//
// Главное отличие от импорта приключений: здесь не «залить», а «залить и
// потом править». Книга правил — источник, к которому возвращаются: вышла
// новая глава, нашлась ошибка в старой, модель разобрала таблицу не так.
// Поэтому ключ файла долговечен: system_import_keys помнит, какая запись
// компендиума заведена под каким ключом, и повторный импорт того же ключа
// переписывает ту же запись, а не заводит вторую.
//
// Правка бережная: в data переписываются только те поля, которые файл
// действительно прислал, остальное (то, что человек дописал руками) остаётся.
//
// Порядок записи — два прохода. Первый заводит все записи и раздаёт им id,
// второй заполняет data, где ссылки уже могут указывать на что угодно из
// файла. Иначе пришлось бы угадывать порядок: заклинание ссылается на класс,
// класс — на снаряжение, снаряжение — на свойства оружия из справочника.

import { db } from "../db/db";
import { ensureDefaultMechanicsSection, ensureDefaultVehicleSection } from "../db/defaultSections";
import { backfillCompendiumSummaries } from "../services/monsterSummary";
import { systemPrefixOf, SYSTEM_KEY_PREFIX_TO_KIND } from "./systemFormat";
import { buildTokenWeights, normalizeName, similarity } from "./names";
import { splitBracketName } from "../services/compendiumNames";
import { cleanChallengeRating } from "./creatureMeta";
import { MENTIONABLE, normUid, idOfUid, scanMentions, rewriteMentions, type RefMention } from "../services/mentions";
import type {
  ImportClass,
  ImportEquipment,
  ImportFeature,
  ImportSpell,
  SystemImportFile,
} from "./systemFormat";

export interface ApplySystemOptions {
  /** null — завести новую систему под именем из файла. */
  systemId: number | null;
  fileName?: string;
  /** Ключи, снятые человеком на экране сверки. Дети снятой записи тоже не пишутся. */
  skip?: string[];
  /**
   * Ссылка из файла → запись компендиума, выбранная человеком. Связь
   * запоминается в system_import_keys, поэтому связывать приходится один раз:
   * следующая глава уже найдёт `class.wizard` сама.
   */
  bind?: Record<string, number>;
}

export interface AppliedSystemImport {
  batchId: number;
  systemId: number;
  systemCreated: boolean;
  counts: Record<string, number>;
  warnings: { path: string; message: string }[];
}

/** Ссылка в data компендиума: {id, name} — тот же вид, что кладёт редактор. */
interface Ref {
  id: number;
  name: string;
}

/** Раздел, в который попадает запись данного вида, и как его назвать, если его нет. */
const SECTION_FOR_KIND: Record<string, { kind: string; name: string }> = {
  mechanic_item: { kind: "mechanics", name: "Справочник" },
  bastion: { kind: "bastion", name: "Бастионы" },
  spell: { kind: "spell", name: "Заклинания" },
  class: { kind: "class", name: "Классы" },
  species: { kind: "species", name: "Виды" },
  background: { kind: "background", name: "Предыстории" },
  feat: { kind: "feat", name: "Черты" },
  equipment: { kind: "equipment", name: "Снаряжение" },
  magic_item: { kind: "magic_item", name: "Маг. предметы" },
  monster: { kind: "monster", name: "Бестиарий" },
};

/** Ключи, уже занятые в системе прошлыми импортами: key → вид записи. */
export function knownSystemKeys(systemId: number): Record<string, string> {
  const rows = db
    .prepare(
      `SELECT k.key, e.kind FROM system_import_keys k
       JOIN compendium_entries e ON e.id = k.entry_id
       WHERE k.system_id = ?`
    )
    .all(systemId) as { key: string; kind: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.kind;
  return out;
}

/** То же, но с названиями — для промпта следующей главы и экрана сверки. */
export function systemKeyDirectory(systemId: number): { key: string; kind: string; name: string }[] {
  return db
    .prepare(
      `SELECT k.key, e.kind, e.name FROM system_import_keys k
       JOIN compendium_entries e ON e.id = k.entry_id
       WHERE k.system_id = ? ORDER BY k.key`
    )
    .all(systemId) as { key: string; kind: string; name: string }[];
}

// --- перевод формата в data компендиума --------------------------------------
//
// Формат пишет snake_case (так его читает человек и так его пишет модель),
// компендиум хранит camelCase внутри checks/effects. Перевод здесь, в одном
// месте: клиент про формат импорта знать не должен.

const CHOSEN_DAMAGE_TYPE: Ref = { id: -1, name: "Выбирается при накладывании" };

type Resolve = (key: string | null | undefined) => Ref | null;

function convertChecks(checks: ImportSpell["checks"]): unknown[] {
  return checks.map((c) => ({
    id: c.id,
    type: c.type,
    ...(c.attack_range ? { attackRange: c.attack_range } : {}),
    ...(c.save_ability ? { saveAbility: c.save_ability } : {}),
    ...(c.dc_override != null ? { dcOverride: c.dc_override } : {}),
  }));
}

function convertEffects(effects: ImportSpell["effects"], resolve: Resolve): unknown[] {
  return effects.map((e, i) => {
    const damageType =
      e.damage_type === "choice" ? CHOSEN_DAMAGE_TYPE : resolve(e.damage_type);
    return {
      // id локален внутри записи; в файле его нет, потому что от модели он
      // ничего не добавляет — только шанс прислать два одинаковых.
      id: `i${i + 1}`,
      type: e.type,
      when: e.when,
      ...(e.check ? { checkId: e.check } : {}),
      ...(e.dice ? { dice: e.dice } : {}),
      ...(damageType ? { damageType } : {}),
      ...(e.half_on_success ? { halfOnSuccess: true } : {}),
      ...(e.upcast_per_level ? { upcastPerLevel: e.upcast_per_level } : {}),
      ...(e.cantrip_scaling ? { cantripScaling: e.cantrip_scaling } : {}),
      ...(e.condition ? { condition: resolve(e.condition) } : {}),
      ...(e.movement_kind ? { movementKind: e.movement_kind } : {}),
      ...(e.distance ? { distance: e.distance } : {}),
      ...(e.zone_shape ? { zoneShape: e.zone_shape } : {}),
      ...(e.zone_size ? { zoneSize: e.zone_size } : {}),
      ...(e.modifier ? { modifier: e.modifier } : {}),
      ...(e.text ? { text: e.text } : {}),
    };
  });
}

/** Общая часть всего применимого: время, броски, эффекты, стоимость. */
function activatableData(
  source: { casting_timing?: string; casting_timing_other?: string } & Pick<
    ImportSpell,
    "checks" | "effects" | "cost"
  >,
  resolve: Resolve
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (source.casting_timing) data.casting_timing = source.casting_timing;
  if (source.casting_timing_other) data.casting_timing_other = source.casting_timing_other;
  // Пустые списки пишутся тоже: «в этой записи бросков нет» — такой же факт,
  // как их наличие, и он должен затирать прошлый разбор.
  data.checks = convertChecks(source.checks);
  data.effects = convertEffects(source.effects, resolve);
  if (source.cost) {
    data.cost = {
      kind: source.cost.kind,
      ...(source.cost.amount != null ? { amount: source.cost.amount } : {}),
      ...(source.cost.per ? { per: source.cost.per } : {}),
    };
  }
  return data;
}

/**
 * Выбрасывает поля, которых в файле не было.
 *
 * Схема подставляет пустые значения вместо отсутствующих (`""`, `[]`), и без
 * этой чистки глава, упоминающая класс мельком — «class.artificer, а вот его
 * подклассы», — приезжала бы как «кость хитов пустая, владений нет, спасбросков
 * нет» и стирала бы то, что заполнила прошлая глава. Пустое значение здесь
 * значит «не знаю», а не «очисти». Логическое `false` — знает: «настройки не
 * требует» такой же факт, как и обратное.
 */
function filled(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Упоминания внутри текста: файл пишет их ключом — `[[spell.mending|Починка]]`,
 * потому что id записи в момент сборки файла ещё не существует. Карточка же
 * умеет только `[[compendium_entry:1234|Починка]]`, и ключ в ней выводился
 * буквально, скобками наружу. Подменяем ключ на id вторым проходом, когда id
 * есть у всех.
 *
 * Уже готовые упоминания (`[[тип:число|…]]`) не трогаем: их поставил человек в
 * редакторе. Неизвестный ключ разворачиваем в обычный текст — лучше слово без
 * ссылки, чем скобки в описании.
 */
function linkMentions(
  text: string,
  resolve: Resolve,
  onMissing: (key: string) => void
): string {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (whole, target: string, label: string) => {
    if (/^\w+:\d+$/.test(target)) return whole;
    if (!systemPrefixOf(target)) return whole;
    const ref = resolve(target);
    if (!ref) {
      onMissing(target);
      return label;
    }
    return `[[compendium_entry:${ref.id}|${label}]]`;
  });
}

/** Владения и прочие списки ссылок: компендиум хранит их как picks с дистанцией. */
function picks(keys: string[], resolve: Resolve, distance?: (key: string) => string): unknown[] {
  return keys
    .map((k) => {
      const ref = resolve(k);
      return ref ? { ...ref, distance: distance ? distance(k) : "" } : null;
    })
    .filter(Boolean);
}

function equipmentSetData(
  slot: "a" | "b",
  set: { items: { ref: string; qty: number }[]; gold?: string; text?: string } | undefined,
  resolve: Resolve
): Record<string, unknown> {
  if (!set) return {};
  const items = set.items
    .map((it) => {
      const ref = resolve(it.ref);
      return ref ? { entryId: ref.id, name: ref.name, qty: it.qty } : null;
    })
    .filter(Boolean);
  return {
    // Текст набора переписывается, только если он в файле есть: в нём живёт
    // то, чего в компендиуме нет («Музыкальный инструмент на ваш выбор»), и
    // затирать его пустотой хуже, чем оставить прошлый.
    ...(set.text ? { [`equipment_${slot}`]: set.text } : {}),
    [`equipment_${slot}_items`]: items,
    ...(set.gold ? { [`equipment_${slot}_gold`]: set.gold } : {}),
  };
}

/**
 * Таблица развития: файл присылает строки массивами (так их видно глазами и
 * так их проще собрать из книги), компендиум хранит по ключам колонок — чтобы
 * удаление колонки в редакторе не сдвигало остальные значения.
 */
function progressionData(source: ImportClass): Record<string, unknown> {
  const p = source.progression;
  if (!p || p.columns.length === 0) return {};
  const columns = p.columns.map((col, i) => ({ key: `c${i + 1}`, label: col.label, role: col.role }));
  const rows = p.rows.map((row) => {
    const out: Record<string, string> = {};
    columns.forEach((col, i) => (out[col.key] = row[i] ?? ""));
    return out;
  });
  return { progression: { columns, rows } };
}

function spellData(source: ImportSpell, resolve: Resolve): Record<string, unknown> {
  // Глава со списками заклинаний присылает только ключ, имя и классы — всё
  // остальное у записи уже есть. Поэтому пишем ровно то, что в файле есть:
  // «нет поля» здесь значит «не трогай», а не «очисти».
  return {
    ...(source.range !== undefined ? { range: source.range } : {}),
    ...(source.duration !== undefined ? { duration: source.duration } : {}),
    ...(source.ritual !== undefined ? { ritual: source.ritual } : {}),
    ...(source.concentration !== undefined ? { concentration: source.concentration } : {}),
    ...(source.school !== undefined ? { school: resolve(source.school) } : {}),
    // В списке классов заклинания подкласс стоит наравне с классом — это и
    // значит «доступно ему». Уровень выдачи живёт на стороне подкласса
    // (granted_spells), туда он и уезжает отдельным проходом.
    // Вид сюда не попадает вовсе: у заклинания нет поля «доступно виду», зато
    // у вида есть «обретаемые заклинания» — там этой связи и место.
    classes: source.classes
      .filter((c) => systemPrefixOf(c.ref) !== "species.")
      .map((c) => resolve(c.ref))
      .filter(Boolean),
    // Список классов не заменяет прежний, а дополняет его (слияние — в
    // applySystemImport): глава «Артефактор» дописывает себя в заклинания,
    // которые до неё уже были доступны волшебнику и барду.
    ...(source.components
      ? {
          component_v: source.components.v,
          component_s: source.components.s,
          component_m: Boolean(source.components.m),
          material_component: source.components.m ?? "",
        }
      : {}),
    ...activatableData(source, resolve),
    // Чем оплачивается накладывание, в файле почти никогда не написано — и не
    // должно быть: это не свойство заклинания, а правило системы. Заклинание
    // тратит ячейку своего круга, заговор не тратит ничего. Выводим сами,
    // иначе половина книги приезжает без стоимости, а заговоры — с ячейкой,
    // которой у них нет.
    ...(source.cost || source.level === undefined
      ? {}
      : { cost: { kind: source.level === 0 ? "none" : "spell_slot" } }),
  };
}

function classData(source: ImportClass, resolve: Resolve): Record<string, unknown> {
  return filled({
    short_description: source.short_description ?? "",
    hit_die: source.hit_die ?? "",
    ...(source.subclass_level != null ? { subclass_level: String(source.subclass_level) } : {}),
    ...(source.options?.title ? { option_section_title: source.options.title } : {}),
    primary_abilities: source.primary_abilities,
    spellcasting_ability: source.spellcasting_ability ?? "",
    saving_throws: source.saving_throws,
    weapon_profs: picks(source.weapon_profs, resolve),
    armor_profs: picks(source.armor_profs, resolve),
    tool_profs: picks(source.tool_profs, resolve),
    ...(source.skill_choice_count != null ? { skill_choice_count: source.skill_choice_count } : {}),
    skill_choice_options: source.skill_choice_options,
    ...equipmentSetData("a", source.starting_equipment?.a, resolve),
    ...equipmentSetData("b", source.starting_equipment?.b, resolve),
    ...progressionData(source),
  });
}

function equipmentData(source: ImportEquipment, resolve: Resolve): Record<string, unknown> {
  return filled({
    category: source.category ?? "",
    cost: source.cost ?? "",
    weight: source.weight ?? "",
    ...(source.damage ? { damage: source.damage } : {}),
    weapon_properties: picks(source.properties, resolve),
    weapon_mastery: resolve(source.mastery),
    ...(source.attack_melee != null ? { attack_melee: source.attack_melee } : {}),
    ...(source.attack_ranged != null ? { attack_ranged: source.attack_ranged } : {}),
    ...(source.armor_type ? { armor_type: source.armor_type } : {}),
    ...(source.ac ? { ac: source.ac } : {}),
    ...(source.max_dex_bonus ? { max_dex_bonus: source.max_dex_bonus } : {}),
    ...(source.str_requirement ? { str_requirement: source.str_requirement } : {}),
    ...(source.stealth_disadvantage != null
      ? { stealth_disadvantage: source.stealth_disadvantage }
      : {}),
    ...(source.dex_bonus != null ? { dex_bonus: source.dex_bonus } : {}),
    ...(source.ability ? { ability: source.ability } : {}),
    ...(source.usage ? { usage: source.usage } : {}),
    // Состав набора экран пока не показывает — хранится на будущее («взять
    // набор путешественника» должно уметь разложить его на предметы).
    ...(source.contents.length
      ? {
          contents: source.contents
            .map((c) => {
              const ref = resolve(c.ref);
              return ref ? { entryId: ref.id, name: ref.name, qty: c.qty } : null;
            })
            .filter(Boolean),
        }
      : {}),
  });
}

function featureData(source: ImportFeature, resolve: Resolve): Record<string, unknown> {
  return activatableData(source, resolve);
}

// --- собственно запись --------------------------------------------------------

interface PendingEntry {
  key: string;
  kind: string;
  name: string;
  level: number | null;
  /** Оригинальное название и синонимы: их колонки ищет поиск. */
  name_original?: string;
  aliases?: string[];
  description: string;
  parentKey: string | null;
  /** Считается вторым проходом, когда id есть у всех. */
  data: (resolve: Resolve) => Record<string, unknown>;
  statblock?: Record<string, unknown>;
}

// П2.6 — фолбэк сплита «Имя [Original]» для файлов без колонок. Модель генерит без name_original, а в name остаётся bracket.
function splitFields<T extends { name: string; name_original?: string; aliases?: string[] }>(o: T): T {
  if (!o.name_original && o.name?.includes("[")) {
    const { name, en } = splitBracketName(o.name);
    if (en) { o.name = name as T["name"]; o.name_original = en as T["name_original"]; }
  }
  if (!Array.isArray(o.aliases)) o.aliases = [];
  return o;
}

/** Разворачивает файл в плоский список записей — в порядке, в котором они лягут. */
function flatten(file: SystemImportFile): PendingEntry[] {
  const out: PendingEntry[] = [];

  const feature = (f: ImportFeature, parentKey: string, kind: "feature" | "class_option") =>
    out.push(splitFields({
      key: f.key,
      kind,
      name: f.name,
      name_original: f.name_original,
      aliases: f.aliases,
      level: f.level ?? null,
      description: f.description,
      parentKey,
      data: (resolve) => featureData(f, resolve),
    }));

  // Справочник первым: на него ссылаются все остальные, и человеку на экране
  // сверки понятнее видеть основу до того, что на неё опирается.
  // Бастионы теперь живут в отдельном табе — механика с группой «Бастионы»
  // сразу кладётся как kind='bastion' в таб Бастионы без группы-обёртки.
  for (const m of file.mechanics) {
    const isBastion = m.group === "Бастионы";
    out.push({
      key: m.key,
      kind: isBastion ? "bastion" : "mechanic_item",
      name: m.name,
      name_original: m.name_original,
      aliases: m.aliases,
      level: null,
      description: m.description,
      // Группа справочника («Типы урона») — не ключ, а название: группы
      // заводятся сами и живут вне ключевого пространства файла.
      parentKey: isBastion ? null : `group:${m.group}`,
      data: () => ({}),
    });
  }
  for (const e of file.equipment) {
    out.push({
      key: e.key,
      kind: "equipment",
      name: e.name,
      name_original: e.name_original,
      aliases: e.aliases,
      level: null,
      description: e.description,
      parentKey: null,
      data: (resolve) => equipmentData(e, resolve),
    });
  }
  for (const s of file.spells) {
    out.push({
      key: s.key,
      kind: "spell",
      name: s.name,
      name_original: s.name_original,
      aliases: s.aliases,
      level: s.level ?? null,
      description: s.description,
      parentKey: null,
      data: (resolve) => spellData(s, resolve),
    });
  }
  for (const c of file.classes) {
    out.push({
      key: c.key,
      kind: "class",
      name: c.name,
      name_original: c.name_original,
      aliases: c.aliases,
      level: null,
      description: c.description,
      parentKey: null,
      data: (resolve) => classData(c, resolve),
    });
    c.features.forEach((f) => feature(f, c.key, "feature"));
    c.options?.entries.forEach((f) => feature(f, c.key, "class_option"));
    for (const sub of c.subclasses) {
      out.push({
        key: sub.key,
        kind: "subclass",
        name: sub.name,
        name_original: sub.name_original,
        aliases: sub.aliases,
        level: null,
        description: sub.description,
        parentKey: c.key,
        data: () => ({}),
      });
      sub.features.forEach((f) => feature(f, sub.key, "feature"));
    }
  }
  for (const s of file.species) {
    out.push({
      key: s.key,
      kind: "species",
      name: s.name,
      name_original: s.name_original,
      aliases: s.aliases,
      level: null,
      description: s.description,
      parentKey: null,
      data: (resolve) => filled({
        ...(s.size ? { size: s.size } : {}),
        creature_type: resolve(s.creature_type),
        senses: picks(
          s.senses.map((x) => x.ref),
          resolve,
          (k) => s.senses.find((x) => x.ref === k)?.distance ?? ""
        ),
        speeds: picks(
          s.speeds.map((x) => x.ref),
          resolve,
          (k) => s.speeds.find((x) => x.ref === k)?.distance ?? ""
        ),
        granted_spells: s.granted_spells
          .map((g) => {
            const ref = resolve(g.ref);
            return ref ? { ...ref, grantLevel: g.grant_level } : null;
          })
          .filter(Boolean),
      }),
    });
    s.features.forEach((f) => feature(f, s.key, "feature"));
  }
  for (const b of file.backgrounds) {
    out.push({
      key: b.key,
      kind: "background",
      name: b.name,
      name_original: b.name_original,
      aliases: b.aliases,
      level: null,
      description: b.description,
      parentKey: null,
      data: (resolve) => filled({
        abilities: b.abilities,
        origin_feat: resolve(b.origin_feat),
        skills: b.skills,
        tools: b.tools ?? "",
        ...equipmentSetData("a", b.starting_equipment?.a, resolve),
        ...equipmentSetData("b", b.starting_equipment?.b, resolve),
      }),
    });
  }
  for (const f of file.feats) {
    out.push({
      key: f.key,
      kind: "feat",
      name: f.name,
      name_original: f.name_original,
      aliases: f.aliases,
      level: null,
      description: f.description,
      parentKey: null,
      data: (resolve) => ({
        ...filled({ category: f.category ?? "", prerequisite: f.prerequisite ?? "" }),
        ...activatableData(f, resolve),
      }),
    });
  }
  for (const m of file.magic_items) {
    out.push({
      key: m.key,
      kind: "magic_item",
      name: m.name,
      name_original: m.name_original,
      aliases: m.aliases,
      level: null,
      description: m.description,
      parentKey: null,
      data: (resolve) => ({
        ...filled({
          item_type: m.item_type ?? "",
          rarity: m.rarity ?? "",
          cost: m.price ?? "",
          attunement: m.attunement,
          classes: m.classes.map((c) => resolve(c)).filter(Boolean),
          ...(m.ac_bonus ? { ac_bonus: m.ac_bonus } : {}),
        }),
        ...activatableData(m, resolve),
      }),
    });
  }
  for (const m of file.monsters) {
    out.push({
      key: m.key,
      kind: "monster",
      name: m.name,
      name_original: m.name_original,
      aliases: m.aliases,
      level: null,
      description: m.description,
      parentKey: null,
      data: () => ({}),
      statblock: m.statblock,
    });
  }
  // П2.6 — все записи через один фолбэк, чтобы не дублировать wrap в каждом out.push
  for (const e of out) splitFields(e as unknown as { name: string; name_original?: string; aliases?: string[] });
  return out;
}

/**
 * Кандидаты на связывание ссылки, которой не на что указывать: записи нужного
 * вида, уже живущие в системе. Первый импорт в компендиум, набитый руками, —
 * это норма, а не сбой: классы там есть, ключей у них нет.
 */
export interface UnresolvedRef {
  ref: string;
  expect: string[];
  paths: string[];
  /** Догадка по английскому оригиналу в скобках: `class.wizard` → «Волшебник [Wizard]». */
  suggestion: { id: number; name: string } | null;
  candidates: { id: number; name: string; kind: string }[];
}

/**
 * Средний кусок ключа справочника → слово из названия его группы. Пишется
 * тут, а не выводится из данных: между `mech.speed.` и группой «Скорости
 * передвижения» связь смысловая, вычислить её неоткуда.
 */
const GROUP_BY_KEY_PART: Record<string, string> = {
  damage: "урон",
  condition: "состоян",
  school: "школ",
  type: "типы существ",
  speed: "скорост",
  sense: "восприят",
  weapon: "оружием",
  wprop: "свойства оружия",
  wmastery: "мастерство оружия",
  armor: "доспехами",
  tool: "инструментами",
  lang: "язык",
  align: "мировоззрен",
};

/**
 * Хвост ключа как набор слов: `sub.druid.land` → «druid land»,
 * `species.wood_elf` → «wood elf». По нему ищется английский оригинал имени.
 */
function keyWords(ref: string): string {
  const prefix = systemPrefixOf(ref);
  const tail = prefix ? ref.slice(prefix.length) : ref;
  return tail.replace(/[._-]+/g, " ").trim().toLowerCase();
}

/** Английский оригинал из имени записи: «Волшебник [Wizard]» → «wizard». */
function originalName(name: string): string {
  const m = /\[([^\]]+)\]/.exec(name);
  return (m ? m[1] : "").trim().toLowerCase();
}

export function unresolvedRefCandidates(
  systemId: number,
  unresolved: { ref: string; expect: string[]; paths: string[] }[]
): UnresolvedRef[] {
  if (unresolved.length === 0) return [];
  const kinds = [...new Set(unresolved.flatMap((u) => u.expect))];
  const rows = db
    .prepare(
      `SELECT e.id, e.kind, e.name, p.name AS parent_name
         FROM compendium_entries e
         LEFT JOIN compendium_entries p ON p.id = e.parent_id
        WHERE e.system_id = ? AND e.kind IN (${kinds.map(() => "?").join(",")})
        ORDER BY e.kind, e.name`
    )
    .all(systemId, ...kinds) as { id: number; kind: string; name: string; parent_name: string | null }[];

  return unresolved.map((item) => {
    // Вид записи берётся из префикса самого ключа, а не из того, что здесь
    // допустимо: `sub.` — это подкласс, и показывать рядом с ним восемьдесят
    // классов и видов значит топить нужное в списке.
    const prefix = systemPrefixOf(item.ref);
    const kindByPrefix = prefix ? SYSTEM_KEY_PREFIX_TO_KIND[prefix] : null;
    const allowed = kindByPrefix && item.expect.includes(kindByPrefix) ? [kindByPrefix] : item.expect;
    const pool = rows.filter((r) => allowed.includes(r.kind));
    const words = keyWords(item.ref);
    // Подкласс показывается вместе с классом: «Круг земли» из списка сорока
    // подклассов не опознать, «Друид — Круг земли» — сразу.
    const label = (r: (typeof rows)[number]) =>
      r.kind === "subclass" && r.parent_name ? `${r.parent_name} — ${r.name}` : r.name;
    // Догадка только по точному совпадению оригинала: «похоже» здесь хуже
    // молчания — связь запоминается навсегда, и ошибку потом не заметить.
    const hit = pool.find((r) => originalName(r.name) === words);
    // Точной догадки чаще нет: подкласс «Круг земли» с ключом sub.druid.land
    // по-английски не сойдётся никогда. Зато сходится половина ключа — класс,
    // — и подклассы друида уезжают в начало списка вместо семидесяти пятых.
    // Средний кусок ключа справочника называет группу: `mech.speed.walk` —
    // это скорость, и показывать рядом с ним сто семьдесят пять пунктов
    // справочника незачем. Слово ищется в названии группы, а не сверяется с
    // ним целиком: группы в системах называются по-разному.
    const groupWord = GROUP_BY_KEY_PART[item.ref.split(".")[1] ?? ""];
    const parts = new Set(words.split(" ").filter(Boolean));
    const affinity = (r: (typeof rows)[number]) => {
      const own = originalName(r.name).split(" ");
      const parent = originalName(r.parent_name ?? "").split(" ");
      let score = [...own, ...parent].filter((w) => w && parts.has(w)).length;
      if (groupWord && (r.parent_name ?? "").toLowerCase().includes(groupWord)) score += 2;
      return score;
    };
    const ranked = pool
      .map((r) => ({ row: r, score: affinity(r) }))
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, "ru"));
    return {
      ...item,
      suggestion: hit ? { id: hit.id, name: label(hit) } : null,
      candidates: ranked.map(({ row }) => ({ id: row.id, name: label(row), kind: row.kind })),
    };
  });
}

/** Раздел экрана сверки: как называется и что в нём приедет. */
export interface SystemPlanSection {
  id: string;
  title: string;
  entries: {
    key: string;
    name: string;
    kind: string;
    parentKey: string | null;
    exists: boolean;
    /**
     * Запись с тем же названием, уже живущая в компендиуме. Ключей у заведённых
     * руками записей нет, поэтому без сверки по названию первый импорт главы
     * заводил второй «Огненный» рядом с прежним.
     */
    match: { id: number; name: string; exact: boolean } | null;
    /**
     * Чем ещё это может оказаться. Нужно там, где названия разошлись слишком
     * сильно, чтобы сверка их поймала: в книге «Лежащий ничком», в компендиуме
     * «Сбит с ног». Без ручного выбора такое приезжает вторым состоянием.
     */
    candidates: { id: number; name: string }[];
  }[];
}

/** Сколько вариантов показывать в списке «это на самом деле…». */
const CANDIDATE_LIMIT = 30;

/**
 * Сверка объявленных записей с тем, что в системе уже есть, — по названию.
 *
 * Ключ первичен: если он уже привязан, сверять нечего. Но в первый раз ключей
 * нет ни у чего, и единственное, чем «Брызги кислоты [Acid Splash]» из файла
 * связаны с «Брызгами кислоты [Acid Splash]» в компендиуме, — это название.
 */
interface Declared {
  match: { id: number; name: string; exact: boolean } | null;
  candidates: { id: number; name: string }[];
}

function matchDeclared(
  systemId: number,
  all: PendingEntry[],
  known: Record<string, string>
): Map<string, Declared> {
  const out = new Map<string, Declared>();
  const kinds = [...new Set(all.map((p) => p.kind))];
  if (kinds.length === 0) return out;

  const rows = db
    .prepare(
      `SELECT e.id, e.kind, e.name, e.parent_id, p.name AS parent_name,
              (SELECT key FROM system_import_keys WHERE entry_id = e.id) AS taken
         FROM compendium_entries e
         LEFT JOIN compendium_entries p ON p.id = e.parent_id
        WHERE e.system_id = ? AND e.kind IN (${kinds.map(() => "?").join(",")})`
    )
    .all(systemId, ...kinds) as {
    id: number;
    kind: string;
    name: string;
    parent_id: number | null;
    parent_name: string | null;
    taken: string | null;
  }[];

  const weights = buildTokenWeights(rows.map((r) => [r.name]));
  // Ключ этой сессии → id найденной записи: нужен, чтобы умение сверялось
  // внутри своего класса, а не по всему компендиуму.
  const chosenParent = new Map<string, number>();

  for (const entry of all) {
    if (known[entry.key]) continue; // ключ уже привязан — сверять нечего
    const groupName = entry.parentKey?.startsWith("group:")
      ? entry.parentKey.slice("group:".length)
      : null;
    const parentId = entry.parentKey && !groupName ? chosenParent.get(entry.parentKey) : undefined;

    const pool = rows.filter((r) => {
      if (r.kind !== entry.kind) return false;
      // Занятая чужим ключом запись — не кандидат: иначе один ключ увёл бы
      // запись у другого и оба стали бы указывать в одно место.
      if (r.taken) return false;
      if (groupName) return r.parent_name === groupName;
      // Вложенная запись сверяется только внутри найденного родителя. Если
      // родитель не найден, значит класс новый — и умения у него новые.
      if (entry.parentKey) return parentId != null && r.parent_id === parentId;
      return true;
    });
    if (pool.length === 0) continue;

    const wanted = normalizeName(entry.name);
    const original = originalName(entry.name);
    let hit = pool.find((r) => normalizeName(r.name) === wanted);
    // «Огненный шар [Fireball]» и «Огненный шар» — одно заклинание: сходится
    // английский оригинал, а перевод у книг разный.
    if (!hit && original) hit = pool.find((r) => originalName(r.name) === original);

    // Список «а вдруг это вот эта»: по убыванию похожести, чтобы нужное было
    // сверху даже когда сверка ничего не нашла.
    const ranked = pool
      .map((row) => ({ row, score: similarity(entry.name, row.name, weights) }))
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, "ru"))
      .slice(0, CANDIDATE_LIMIT)
      .map(({ row }) => ({ id: row.id, name: row.name }));

    if (hit) {
      out.set(entry.key, {
        match: { id: hit.id, name: hit.name, exact: true },
        candidates: ranked,
      });
      chosenParent.set(entry.key, hit.id);
      continue;
    }
    // Похожее показывается, но само не выбирается: «Огонь» и «Огненный» — почти
    // наверняка одно, а «Свет» и «Светлячок» — нет, и решать это человеку.
    let best: { row: (typeof rows)[number]; score: number } | null = null;
    for (const row of pool) {
      // Разные английские оригиналы — разные вещи, как бы ни были похожи
      // переводы: «Небесная завеса [Sky Veil]» и «Небесный зверь [Beast of the
      // Sky]» отличаются одной буквой по-русски и всем остальным по сути.
      const rowOriginal = originalName(row.name);
      if (original && rowOriginal && original !== rowOriginal) continue;
      const score = similarity(entry.name, row.name, weights);
      if (score >= 0.5 && (!best || score > best.score)) best = { row, score };
    }
    out.set(entry.key, {
      match: best ? { id: best.row.id, name: best.row.name, exact: false } : null,
      candidates: ranked,
    });
  }
  return out;
}

const PLAN_TITLES: Record<string, string> = {
  mechanic_item: "Справочник",
  bastion: "Бастионы",
  equipment: "Снаряжение",
  spell: "Заклинания",
  class: "Классы",
  species: "Виды",
  background: "Предыстории",
  feat: "Черты",
  magic_item: "Магические предметы",
  monster: "Бестиарий",
};

/**
 * Что файл сделает — поимённо, до всякой записи. Группируется по разделу, в
 * который запись попадёт, а не по виду: умение волшебника человек ищет внутри
 * классов, а не отдельным списком.
 */
export function describeSystemImport(
  file: SystemImportFile,
  known: Record<string, string> = {},
  systemId: number | null = null
): SystemPlanSection[] {
  const all = flatten(file);
  const sectionKind = sectionKindByKey(all);
  const matches = systemId ? matchDeclared(systemId, all, known) : new Map();
  const sections = new Map<string, SystemPlanSection>();
  for (const entry of all) {
    const id = sectionKind.get(entry.key) ?? entry.kind;
    const section = sections.get(id) ?? { id, title: PLAN_TITLES[id] ?? id, entries: [] };
    section.entries.push({
      key: entry.key,
      name: entry.name,
      kind: entry.kind,
      parentKey: entry.parentKey?.startsWith("group:") ? null : entry.parentKey,
      exists: Boolean(known[entry.key]),
      match: matches.get(entry.key)?.match ?? null,
      candidates: matches.get(entry.key)?.candidates ?? [],
    });
    sections.set(id, section);
  }
  return [...sections.values()];
}

export function applySystemImport(
  file: SystemImportFile,
  options: ApplySystemOptions
): AppliedSystemImport {
  const warnings: { path: string; message: string }[] = [];
  const counts: Record<string, number> = {};
  const bump = (what: string, by = 1) => (counts[what] = (counts[what] ?? 0) + by);
  const skip = new Set(options.skip ?? []);

  const run = db.transaction((): AppliedSystemImport => {
    let systemCreated = false;
    let systemId = options.systemId;
    if (systemId == null) {
      // Имя системы уникально: одноимённая уже есть — значит, файл про неё,
      // и заводить вторую нельзя (да и база не даст).
      const sameName = db.prepare("SELECT id FROM systems WHERE name = ?").get(file.system.name) as
        | { id: number }
        | undefined;
      if (sameName) {
        systemId = sameName.id;
        warnings.push({
          path: "system",
          message: `система «${file.system.name}» уже есть — импорт пошёл в неё`,
        });
      } else {
        systemId = Number(
          db
            .prepare("INSERT INTO systems (name, description) VALUES (?, ?)")
            .run(file.system.name, file.system.description).lastInsertRowid
        );
        systemCreated = true;
        ensureDefaultMechanicsSection(db, systemId);
        ensureDefaultVehicleSection(db, systemId);
        bump("создано систем");
      }
    }
    const sid = systemId;

    const batchId = Number(
      db
        .prepare(
          `INSERT INTO system_import_batches
             (system_id, format, language, system_key, source_title, source_part, file_name,
              counts_json, warnings_json, created_system)
           VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?)`
        )
        .run(
          sid,
          file.format,
          file.language,
          file.system.key,
          file.source?.title ?? "",
          file.source?.part ?? "",
          options.fileName ?? "",
          systemCreated ? 1 : 0
        ).lastInsertRowid
    );

    const recordCreate = db.prepare(
      "INSERT INTO system_import_records (batch_id, entry_id, action, payload) VALUES (?, ?, 'create', '')"
    );
    const recordUpdate = db.prepare(
      "INSERT INTO system_import_records (batch_id, entry_id, action, payload) VALUES (?, ?, 'update', ?)"
    );

    // --- разделы ---------------------------------------------------------
    const sectionCache = new Map<string, number>();
    const sectionFor = (kind: string): number => {
      const wanted = SECTION_FOR_KIND[kind];
      if (!wanted) throw new Error(`нет раздела для вида «${kind}»`);
      const cached = sectionCache.get(wanted.kind);
      if (cached) return cached;
      const existing = db
        .prepare("SELECT id FROM system_sections WHERE system_id = ? AND kind = ? ORDER BY position LIMIT 1")
        .get(sid, wanted.kind) as { id: number } | undefined;
      let id = existing?.id;
      if (!id) {
        const position = Number(
          (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?").get(sid) as { p: number }).p
        );
        id = Number(
          db
            .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, ?)")
            .run(sid, position, wanted.name, wanted.kind).lastInsertRowid
        );
        bump("создано разделов");
      }
      sectionCache.set(wanted.kind, id);
      return id;
    };

    // --- записи ----------------------------------------------------------
    const keyToEntry = new Map<string, Ref>();
    for (const row of db
      .prepare(
        `SELECT k.key, e.id, e.name FROM system_import_keys k
         JOIN compendium_entries e ON e.id = k.entry_id WHERE k.system_id = ?`
      )
      .all(sid) as { key: string; id: number; name: string }[]) {
      keyToEntry.set(row.key, { id: row.id, name: row.name });
    }

    const rememberKey = db.prepare(
      "INSERT INTO system_import_keys (system_id, key, entry_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(system_id, key) DO UPDATE SET entry_id = excluded.entry_id"
    );
    const nextPosition = db.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE section_id = ? AND IFNULL(parent_id, 0) = IFNULL(?, 0)"
    );

    // Связи, проставленные человеком: ключ файла привязывается к записи,
    // которая в компендиуме уже есть. Пишется до всего остального, потому что
    // дальше по этой связи разрешаются ссылки — и остаётся навсегда, так что
    // следующая глава про эти классы уже не спросит.
    for (const [key, entryId] of Object.entries(options.bind ?? {})) {
      const target = db
        .prepare("SELECT id, name FROM compendium_entries WHERE id = ? AND system_id = ?")
        .get(entryId, sid) as { id: number; name: string } | undefined;
      if (!target) {
        warnings.push({ path: key, message: `запись ${entryId} не найдена в этой системе` });
        continue;
      }
      rememberKey.run(sid, key, target.id);
      keyToEntry.set(key, target);
      bump("связано с существующими записями");
    }

    /** Группа справочника заводится по названию — ключа у неё в файле нет. */
    const groupCache = new Map<string, number>();
    const mechanicGroup = (name: string): number => {
      const cached = groupCache.get(name);
      if (cached) return cached;
      const sectionId = sectionFor("mechanic_item");
      const existing = db
        .prepare(
          "SELECT id FROM compendium_entries WHERE system_id = ? AND kind = 'mechanic_group' AND name = ?"
        )
        .get(sid, name) as { id: number } | undefined;
      let id = existing?.id;
      if (!id) {
        const position = (nextPosition.get(sectionId, null) as { p: number }).p;
        id = Number(
          db
            .prepare(
              `INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, data, description, position)
               VALUES (?, ?, NULL, 'mechanic_group', ?, '{}', '', ?)`
            )
            .run(sid, sectionId, name, position).lastInsertRowid
        );
        recordCreate.run(batchId, id);
        bump("создано списков справочника");
      }
      groupCache.set(name, id);
      return id;
    };

    const pending = flatten(file).filter((p) => !skip.has(p.key));
    // Ребёнок снятой записи писать некуда — снимается вместе с родителем.
    const written = new Set(pending.map((p) => p.key));
    const alive = pending.filter((p) => {
      const ok =
        !p.parentKey ||
        p.parentKey.startsWith("group:") ||
        written.has(p.parentKey) ||
        keyToEntry.has(p.parentKey);
      if (!ok) bump("пропущено (снят родитель)");
      return ok;
    });
    const sectionKind = sectionKindByKey(alive);

    // Проход 1: у каждой записи появляется id.
    const rowsToFill: { entry: PendingEntry; id: number; created: boolean; before: unknown }[] = [];
    for (const p of alive) {
      const parentId = p.parentKey
        ? p.parentKey.startsWith("group:")
          ? mechanicGroup(p.parentKey.slice("group:".length))
          : keyToEntry.get(p.parentKey)?.id ?? null
        : null;
      // Родитель мог приехать прошлой главой — тогда раздел берётся у него, а
      // не выводится из вида: у умения своего раздела нет.
      const inheritedSection = parentId
        ? (db.prepare("SELECT section_id FROM compendium_entries WHERE id = ?").get(parentId) as
            | { section_id: number }
            | undefined)?.section_id
        : undefined;
      const sectionId = inheritedSection ?? sectionFor(sectionKind.get(p.key) ?? p.kind);

      const existing = keyToEntry.get(p.key);
      const row = existing
        ? (db.prepare(
            "SELECT id, name, level, aliases, name_original, data, description FROM compendium_entries WHERE id = ?"
          ).get(existing.id) as
            | {
                id: number;
                name: string;
                level: number | null;
                aliases: string;
                name_original: string;
                data: string;
                description: string;
              }
            | undefined)
        : undefined;

      if (row) {
        // Круг, которого в файле нет, не затирается: глава со списками
        // заклинаний знает только их ключи и классы. То же для синонимов и
        // оригинала: их отсутствие в файле не значит, что их нет у записи.
        const level = p.level ?? row.level;
        const aliases = p.aliases !== undefined ? JSON.stringify(p.aliases) : row.aliases;
        const name_original = p.name_original !== undefined ? p.name_original : row.name_original;
        db.prepare(
          `UPDATE compendium_entries
              SET name = ?, level = ?, parent_id = ?, section_id = ?, aliases = ?, name_original = ?
            WHERE id = ?`
        ).run(p.name, level, parentId, sectionId, aliases, name_original, row.id);
        rowsToFill.push({ entry: p, id: row.id, created: false, before: row });
        keyToEntry.set(p.key, { id: row.id, name: p.name });
      } else {
        const position = (nextPosition.get(sectionId, parentId) as { p: number }).p;
        const id = Number(
          db
            .prepare(
              `INSERT INTO compendium_entries
                 (system_id, section_id, parent_id, kind, name, level, aliases, name_original, data, description, position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '', ?)`
            )
            .run(
              sid,
              sectionId,
              parentId,
              p.kind,
              p.name,
              p.level,
              JSON.stringify(p.aliases ?? []),
              p.name_original ?? "",
              position
            ).lastInsertRowid
        );
        rememberKey.run(sid, p.key, id);
        recordCreate.run(batchId, id);
        rowsToFill.push({ entry: p, id, created: true, before: null });
        keyToEntry.set(p.key, { id, name: p.name });
      }
    }

    // Подкласс в списках доступности пишется вместе с классом («Волшебник —
    // Воплотитель»): ровно так его кладёт редактор, и ровно так он читается в
    // списке, где рядом стоят подклассы разных классов. Другие места на
    // подкласс не ссылаются, поэтому правило можно держать прямо в резолвере.
    const parentName = db.prepare(
      "SELECT p.name FROM compendium_entries e JOIN compendium_entries p ON p.id = e.parent_id WHERE e.id = ?"
    );
    const kindOf = db.prepare("SELECT kind FROM compendium_entries WHERE id = ?");
    const resolve: Resolve = (key) => {
      if (!key) return null;
      const ref = keyToEntry.get(key);
      if (!ref) return null;
      const kind = (kindOf.get(ref.id) as { kind: string } | undefined)?.kind;
      if (kind !== "subclass") return ref;
      const parent = (parentName.get(ref.id) as { name: string } | undefined)?.name;
      return parent ? { id: ref.id, name: `${parent} — ${ref.name}` } : ref;
    };

    // Проход 2: data и описание, когда ссылаться уже есть на что.
    const readData = db.prepare("SELECT data FROM compendium_entries WHERE id = ?");
    for (const item of rowsToFill) {
      const previous = JSON.parse(
        ((readData.get(item.id) as { data: string } | undefined)?.data || "{}") as string
      ) as Record<string, unknown>;
      // Слияние, а не замена: поля, которых в файле нет, дописаны человеком в
      // редакторе — импорт их не трогает.
      const merged = { ...previous, ...item.entry.data(resolve) };
      // Доступность заклинания классам — единственное поле, которое
      // складывается, а не заменяется: глава про Артефактора дописывает его в
      // заклинания, где уже стоят Волшебник и Бард, и заменить список значило
      // бы вычеркнуть их.
      if (item.entry.kind === "spell" && Array.isArray(merged.classes)) {
        const before = Array.isArray(previous.classes) ? (previous.classes as Ref[]) : [];
        const union = new Map(before.map((c) => [c.id, c]));
        for (const c of merged.classes as Ref[]) union.set(c.id, c);
        merged.classes = [...union.values()];
      }
      const linked = linkMentions(item.entry.description, resolve, (key) =>
        warnings.push({
          path: item.entry.key,
          message: `упоминание «${key}» в описании указывает в пустоту — осталось обычным текстом`,
        })
      );
      const description = linked.trim();
      if (description) {
        db.prepare("UPDATE compendium_entries SET data = ?, description = ? WHERE id = ?").run(
          JSON.stringify(merged),
          linked,
          item.id
        );
      } else {
        db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(
          JSON.stringify(merged),
          item.id
        );
      }
      if (!item.created) recordUpdate.run(batchId, item.id, JSON.stringify(item.before));
      bump(item.created ? "создано записей" : "обновлено записей");
    }

    // Заклинания, выдаваемые подклассу: в 5.5 ссылка заклинания на подкласс с
    // уровнем и значит «этот подкласс получает его всегда подготовленным».
    // Сторона подкласса заполняется отсюда, чтобы в файле это писалось один
    // раз — рядом с заклинанием, где это и написано в книге.
    // Вид попадает сюда всегда: в его списке заклинание значит «знает с
    // первого уровня», уровень в книге при этом не пишется.
    const grantsByEntry = new Map<number, { id: number; name: string; grantLevel: number }[]>();
    for (const spell of file.spells) {
      const spellRef = keyToEntry.get(spell.key);
      if (!spellRef) continue;
      for (const c of spell.classes) {
        const isSpecies = systemPrefixOf(c.ref) === "species.";
        if (c.grant_level == null && !isSpecies) continue;
        const target = keyToEntry.get(c.ref);
        if (!target) {
          // Молча потерять выдачу нельзя: на карточке подкласса просто не
          // появится половина заклинаний, и понять почему будет неоткуда.
          warnings.push({
            path: spell.key,
            message: `заклинание выдаётся «${c.ref}», но такой записи в системе нет — заклинание не попало в обретаемые; залейте главу с этим подклассом и повторите`,
          });
          continue;
        }
        const list = grantsByEntry.get(target.id) ?? [];
        list.push({ id: spellRef.id, name: spellRef.name, grantLevel: c.grant_level ?? 1 });
        grantsByEntry.set(target.id, list);
      }
    }
    for (const [entryId, grants] of grantsByEntry) {
      const row = readData.get(entryId) as { data: string } | undefined;
      const data = JSON.parse(row?.data || "{}") as Record<string, unknown>;
      const existing = Array.isArray(data.granted_spells)
        ? (data.granted_spells as { id: number }[])
        : [];
      const byId = new Map(existing.map((g) => [g.id, g]));
      for (const g of grants) byId.set(g.id, g);
      data.granted_spells = [...byId.values()];
      db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(
        JSON.stringify(data),
        entryId
      );
    }

    // Статблоки бестиария: карточка либо есть, либо её нет — пустых не бывает,
    // поэтому повторный импорт переписывает содержимое, а не заводит вторую.
    for (const p of alive) {
      if (!p.statblock) continue;
      const ref = keyToEntry.get(p.key);
      if (!ref) continue;
      const existing = db
        .prepare("SELECT id FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ?")
        .get(ref.id) as { id: number } | undefined;
      const statblock: Record<string, unknown> = { name: p.name, ...(p.statblock ?? {}) };
      // Тот же канонизатор, что в adventure-импорте (apply.ts:435): иначе
      // грязное «3 (200 опыта)» доживает до статблока — бэкфилл чистит
      // только data.cr, а сам статблок остаётся грязным (находка 10.5).
      if (typeof statblock.challengeRating === "string") {
        statblock.challengeRating = cleanChallengeRating(statblock.challengeRating);
      }
      // Форма берётся из статблока, если он её несёт (з.record этого не
      // гарантирует) — по умолчанию dnd_creature, и этим полем контент не
      // засоряется (в apply.ts format из контента изымается).
      const format =
        typeof statblock.format === "string" && statblock.format ? statblock.format : "dnd_creature";
      delete statblock.format;
      const content = JSON.stringify(statblock);
      if (existing) {
        db.prepare("UPDATE statblocks SET content = ? WHERE id = ?").run(content, existing.id);
        bump("обновлено статблоков");
      } else {
        db.prepare(
          `INSERT INTO statblocks (owner_type, owner_id, kind, format, content)
           VALUES ('compendium_entry', ?, 'full', ?, ?)`
        ).run(ref.id, format, content);
        bump("создано статблоков");
      }
    }

    db.prepare("UPDATE system_import_batches SET counts_json = ?, warnings_json = ? WHERE id = ?").run(
      JSON.stringify(counts),
      JSON.stringify(warnings),
      batchId
    );

    return { batchId, systemId: sid, systemCreated, counts, warnings };
  });

  const result = run();
  // Импорт пишет монстров с пустой data (её хранит статблок) — сводка нужна
  // разделу сразу, поэтому дозаполняем после транзакции, а не на каждый GET.
  if (result.systemId != null) {
    backfillCompendiumSummaries(db, result.systemId);
    // Починка мёртвых UID-ссылок в описаниях: при повторном импорте UID записей
    // мог измениться, а ссылки из прошлой версии остались со старыми.
    fixDeadUidMentionsInSystem(result.systemId);
  }
  return result;
}

/**
 * Ищет и чинит мёртвые [[type@uid|code|label]] ссылки в описаниях записей системы.
 * UID восстанавливается по имени метки (label). Неизвестные ссылки схлопываются в текст.
 */
function fixDeadUidMentionsInSystem(systemId: number): number {
  const columns = (
    db.prepare("PRAGMA table_info(compendium_entries)").all() as { name: string; type: string }[]
  )
    .filter((c) => /TEXT|CLOB|CHAR/i.test(c.type))
    .map((c) => c.name);

  let fixed = 0;

  for (const column of columns) {
    const rows = db
      .prepare(`SELECT id, ${column} AS v FROM compendium_entries WHERE system_id = ? AND ${column} LIKE '%[[%@%'`)
      .all(systemId) as { id: number; v: string }[];

    for (const row of rows) {
      const next = rewriteMentions(row.v, (m) => {
        if (m.kind !== "ref") return null;
        const rm = m as RefMention;
        if (!MENTIONABLE[rm.type]) return null;
        if (idOfUid(rm.type, rm.uid) != null) return null; // UID живой

        // Ищем актуальный UID по имени метки внутри этой же системы
        const table = MENTIONABLE[rm.type];
        if (!table) return rm.label;
        const candidates = db
          .prepare(`SELECT uid, name FROM ${table} WHERE uid IS NOT NULL AND system_id = ?`)
          .all(systemId) as { uid: string; name: string }[];
        const lower = rm.label.toLowerCase();
        const hit = candidates.find(
          (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().startsWith(lower + " ")
        );
        if (hit) {
          fixed++;
          return `[[${rm.type}@${normUid(hit.uid)}|${rm.source}|${rm.label}]]`;
        }
        return rm.label; // не нашли — схлопнуть в текст
      });

      if (next !== row.v) {
        db.prepare(`UPDATE compendium_entries SET ${column} = ? WHERE id = ?`).run(next, row.id);
      }
    }
  }
  return fixed;
}

/**
 * В какой раздел кладётся каждая запись. Вложенная живёт там же, где её
 * корень: умение — в разделе своего класса или вида, а не отдельным списком.
 */
function sectionKindByKey(all: PendingEntry[]): Map<string, string> {
  const byKey = new Map(all.map((p) => [p.key, p]));
  const out = new Map<string, string>();
  for (const entry of all) {
    let current = entry;
    const guard = new Set<string>();
    while (current.parentKey && !current.parentKey.startsWith("group:")) {
      if (guard.has(current.key)) break;
      guard.add(current.key);
      const parent = byKey.get(current.parentKey);
      if (!parent) break;
      current = parent;
    }
    out.set(entry.key, SECTION_FOR_KIND[current.kind] ? current.kind : "mechanic_item");
  }
  return out;
}

/**
 * Откат батча: созданное удаляется, переписанное возвращается к прежнему виду.
 * Связь «ключ → запись» у созданных уходит каскадом вместе с самой записью,
 * у переписанных остаётся — запись-то чужая, она была и до импорта.
 */
export function rollbackSystemBatch(batchId: number): { deleted: number; restored: number } {
  const records = db
    .prepare("SELECT entry_id, action, payload FROM system_import_records WHERE batch_id = ? ORDER BY id DESC")
    .all(batchId) as { entry_id: number; action: string; payload: string }[];

  return db.transaction(() => {
    let deleted = 0;
    let restored = 0;
    for (const r of records) {
      if (r.action === "create") {
        deleted += db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(r.entry_id).changes;
        db.prepare("DELETE FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ?").run(
          r.entry_id
        );
      } else if (r.payload) {
        const before = JSON.parse(r.payload) as {
          name: string;
          level: number | null;
          aliases: string;
          name_original: string;
          data: string;
          description: string;
        };
        restored += db
          .prepare(
            `UPDATE compendium_entries
                SET name = ?, level = ?, aliases = ?, name_original = ?, data = ?, description = ?
              WHERE id = ?`
          )
          .run(
            before.name,
            before.level,
            before.aliases ?? "[]",
            before.name_original ?? "",
            before.data,
            before.description,
            r.entry_id
          ).changes;
      }
    }
    const batch = db.prepare("SELECT created_system, system_id FROM system_import_batches WHERE id = ?").get(batchId) as
      | { created_system: number; system_id: number }
      | undefined;
    db.prepare("DELETE FROM system_import_batches WHERE id = ?").run(batchId);
    // Система, заведённая этим же импортом, уходит с ним: без неё пустая
    // оболочка осталась бы висеть в списке систем.
    if (batch?.created_system) db.prepare("DELETE FROM systems WHERE id = ?").run(batch.system_id);
    return { deleted, restored };
  })();
}
