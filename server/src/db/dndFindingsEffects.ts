import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

/**
 * Разметка по находкам ревизии OneShot (гриллинг 2026-09-24).
 *
 * Модель получила: `classIds` у черты (стиль только своему классу),
 * `ability` у выбора заклинаний, переключаемый эффект (Дуэлянт), основу на
 * выбор у магических доспехов и оружия (`base_options`), бонус оружия с
 * переносом в КЗ (`magic_bonus`, `ac_shift`), ситуативную прибавку КЗ
 * (`situational`), «КЗ не меньше» (`acMin`) и предел Ловкости среднего
 * доспеха (`mediumDexCap`). Этот шаг размечает ими записи справочника и
 * добавляет «Благословенного воина», которого в справочнике не было.
 *
 * Правила — как у dndCombatEffects: дописывается только пустое; уже
 * заполненное поле не трогается. Исключение — эффект «special» с пустым
 * текстом у «Дубовой кожи»: он пустышка импорта и уступает место числу.
 */

const MIGRATION_KEY = "dnd_findings_effects_seeded";

type Json = Record<string, unknown>;
type Effect = Json & { id: string; type: string; when: string };

export interface FindingsChange {
  id: number | null;
  name: string;
  what: string[];
}

const fx = (type: string, fields: Json, id = "cf1"): Effect => ({ id, type, when: "always", ...fields });
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function parse(raw: string | null): Json {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

// Текст владельца (2026-09-24) — перевод PHB.
const BLESSED_WARRIOR_TEXT =
  "Вы изучаете два заговора Жреца на ваш выбор. Рекомендуются Наставление и Священное пламя. " +
  "Эти заговоры считаются для вас заклинаниями Паладина; вашей заклинательной характеристикой для них " +
  "является Харизма. Каждый раз, когда вы получаете уровень Паладина, вы можете заменить один из этих " +
  "заговоров другим заговором Жреца.";

export function planDndFindingsEffects(database: Database, opts: { dryRun: boolean }): FindingsChange[] {
  const changes: FindingsChange[] = [];
  const rows = database.prepare("SELECT id, name, data FROM compendium_entries WHERE kind = ? AND name = ?");
  const idOf = (kind: string, name: string) => (rows.get(kind, name) as { id: number } | undefined)?.id ?? null;
  const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

  /** Правка записей по имени: `fn` меняет data и говорит, что сделал. */
  const edit = (kind: string, name: string, fn: (data: Json) => string[]) => {
    for (const row of rows.all(kind, name) as { id: number; name: string; data: string }[]) {
      const data = parse(row.data);
      const what = fn(data);
      if (!what.length) continue;
      changes.push({ id: row.id, name: row.name, what });
      if (!opts.dryRun) update.run(JSON.stringify(data), row.id);
    }
  };
  const setIfEmpty = (data: Json, key: string, value: unknown, what: string[]) => {
    if (!empty(data[key])) return;
    data[key] = value;
    what.push(`${key}: ${JSON.stringify(value)}`);
  };
  const effectsIfEmpty = (effects: Effect[]) => (data: Json) => {
    const what: string[] = [];
    setIfEmpty(data, "effects", effects, what);
    return what;
  };
  /** Характеристика выбору заклинаний, где её нет. */
  const choiceAbility = (ability: string) => (data: Json) => {
    const choices = data.spell_choices as Json[] | undefined;
    if (!Array.isArray(choices) || choices.every((c) => !empty(c.ability))) return [];
    data.spell_choices = choices.map((c) => (empty(c.ability) ? { ...c, ability } : c));
    return [`spell_choices: ability=${ability}`];
  };

  // Стили: переключатель Дуэлянта, классы и характеристики выдач.
  edit("feat", "Дуэлянт", (data) => {
    const effects = (data.effects as Effect[] | undefined) ?? [];
    const e = effects.find((x) => x.type === "roll_modifier" && x.weapon === "melee_one_hand");
    if (!e || e.toggleable !== undefined) return [];
    e.toggleable = true;
    if (empty(e.text)) e.text = "одно оружие в руках";
    return ["эффект: toggleable, text «одно оружие в руках»"];
  });
  const ranger = idOf("class", "Следопыт");
  edit("feat", "Воин-друид", (data) => {
    const what: string[] = [];
    if (ranger != null) setIfEmpty(data, "classIds", [ranger], what);
    return [...what, ...choiceAbility("wis")(data)];
  });
  edit("feat", "Мистический воин", choiceAbility("int"));

  // «Благословенный воин» — новой записью рядом с остальными стилями.
  const paladin = idOf("class", "Паладин");
  const cleric = idOf("class", "Жрец");
  const duel = database
    .prepare("SELECT system_id, section_id, data FROM compendium_entries WHERE kind = 'feat' AND name = 'Дуэлянт'")
    .get() as { system_id: number; section_id: number; data: string } | undefined;
  if (duel && paladin != null && cleric != null && idOf("feat", "Благословенный воин") == null) {
    const data = {
      category: "Боевой Стиль",
      prerequisite: parse(duel.data).prerequisite ?? "",
      checks: [],
      effects: [],
      source: "PHB",
      classIds: [paladin],
      spell_choices: [{ count: 2, level: 0, classIds: [cleric], schools: [], outsideLimit: true, ability: "cha" }],
    };
    changes.push({ id: null, name: "Благословенный воин", what: ["новая запись: стиль Паладина, 2 заговора Жреца, Харизма"] });
    if (!opts.dryRun) {
      const pos = database
        .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM compendium_entries WHERE section_id = ?")
        .get(duel.section_id) as { p: number };
      database
        .prepare(
          `INSERT INTO compendium_entries (system_id, section_id, kind, name, name_original, data, description, position, uid)
           VALUES (?, ?, 'feat', 'Благословенный воин', 'Blessed Warrior', ?, ?, ?, ?)`
        )
        .run(duel.system_id, duel.section_id, JSON.stringify(data), BLESSED_WARRIOR_TEXT, pos.p, randomUUID());
    }
  }

  // Магические доспехи и оружие с основой на выбор (Q8, Q11).
  const namesWhere = (sql: string) =>
    (database.prepare(`SELECT name FROM compendium_entries WHERE kind = 'equipment' AND ${sql} ORDER BY name`).all() as { name: string }[]).map(
      (r) => r.name
    );
  const lightMedium = namesWhere("json_extract(data, '$.armor_type') IN ('Лёгкий доспех', 'Средний доспех')");
  const meleeWeapons = namesWhere("json_extract(data, '$.attack_melee') = 1 AND json_extract(data, '$.damage') IS NOT NULL");
  const item = (name: string, fields: Json, effects?: Effect[]) =>
    edit("magic_item", name, (data) => {
      const what: string[] = [];
      for (const [k, v] of Object.entries(fields)) setIfEmpty(data, k, v, what);
      if (effects) setIfEmpty(data, "effects", effects, what);
      return what;
    });
  const chain = ["Кольчуга", "Кольчужная рубаха"];
  item("Эльфийская кольчуга", { base_options: chain }, [fx("defense", { flat: 1 })]);
  item("Кольчуга ифритов", { base_options: chain }, [fx("defense", { flat: 3 })]);
  item("Доспех трамонтаны", { base_options: lightMedium }, [fx("defense", { flat: 1 })]);
  item("Ловящий стрелы щит", { base_options: ["Щит"] }, [fx("defense", { flat: 2, situational: "против дальнобойных атак" })]);
  item("Защитник", { base_options: meleeWeapons, magic_bonus: 3, ac_shift: true });
  item("Меч Каса", { base_options: ["Длинный меч"], magic_bonus: 3, ac_shift: true });
  item("Посох акробата", { base_options: ["Боевой посох"], magic_bonus: 2 }, [
    fx("defense", { flat: 5, situational: "реакцией против одной атаки" }),
  ]);
  item("Жезл бдительности", {}, [fx("defense", { flat: 1, situational: "в ярком свете воткнутого жезла (и +1 к спасброскам)" })]);

  // Правила КЗ (Q12).
  edit("spell", "Дубовая кожа", (data) => {
    const effects = ((data.effects as Effect[] | undefined) ?? []).filter((e) => !(e.type === "special" && empty(e.text)));
    if (effects.some((e) => e.type === "defense")) return [];
    data.effects = [...effects, fx("defense", { acMin: 17 }, "i1")];
    return ["эффект: КЗ не меньше 17"];
  });
  edit("feat", "Мастер средних доспехов", effectsIfEmpty([fx("defense", { mediumDexCap: 3 })]));
  edit("feat", "Оборонительный дуэлянт", (data) => {
    const what: string[] = [];
    setIfEmpty(data, "casting_timing", "Реакция", what);
    setIfEmpty(
      data,
      "effects",
      [fx("defense", { proficiency: "full", situational: "против рукопашных атак до начала вашего хода (с фехтовальным оружием)" })],
      what
    );
    return what;
  });
  edit("feature", "Славная защита", effectsIfEmpty([fx("special", { text: "+Хар (минимум +1) к КЗ цели против этой атаки" })]));

  return changes;
}

export function migrateDndFindingsEffects(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;
  database.transaction(() => {
    planDndFindingsEffects(database, { dryRun: false });
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
  })();
}
