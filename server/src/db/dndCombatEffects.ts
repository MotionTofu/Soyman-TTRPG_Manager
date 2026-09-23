import type { Database } from "better-sqlite3";

/**
 * Разметка боевых чисел D&D 5.5 (гриллинг 2026-09-23).
 *
 * Зачем. Лист считал КЗ, атаку и урон только из надетого и по имени одного
 * умения («Защита без доспехов»), а всё остальное — боевые стили, «Доспехи
 * мага», «Щит», кольцо защиты — жило текстом, и игрок прибавлял в уме или не
 * прибавлял вовсе. Модель эффектов получила числа КЗ, условия по надетому и
 * фильтр оружия; этот шаг размечает ими записи справочника.
 *
 * Что размечено:
 * - все 10 боевых стилей PHB, «Мистический воин» (выдача двух заговоров
 *   волшебника);
 * - «Защита без доспехов» монаха и варвара, «Драконья устойчивость»,
 *   «Встроенная защита» Кованого — формулой или прибавкой КЗ;
 * - «Доспехи мага», «Щит», «Щит веры» — числами к уже заведённому эффекту;
 * - магические предметы, чья прибавка к КЗ персонажа сводится к числу, и
 *   доспехи с известной основой (характеристики основы + прибавка).
 *
 * Не размечено намеренно — в тексте остаётся условие, которого число не
 * выразит: «Ловящий стрелы щит» (+2 только против дальнобойных), «Защитник»
 * и «Меч Каса» (перенос бонуса), «Посох акробата» (реакция), «Жезл
 * бдительности» (яркий свет). Доспехи с основой на выбор («Эльфийская
 * кольчуга», «Кольчуга ифритов», «Доспех трамонтаны») ждут выбора основы по
 * списку — пока их характеристик не угадать.
 *
 * Правила записи — как у прочих разметок: дописывается только пустое. Ключ
 * `data` с непустым значением не трогается; в уже заведённый эффект
 * добавляются только отсутствующие поля. Исключение одно — «КД» → «КЗ» в
 * текстах (решение Q21): это правка термина, и она идёт по всем записям.
 */

const MIGRATION_KEY = "dnd_combat_effects_seeded";

type Json = Record<string, unknown>;
type Effect = Json & { id: string; type: string; when: string };

interface Seed {
  /** Как найти запись: имя и вид, при нужде — имя родителя. */
  name: string;
  kind: string;
  parent?: string;
  /** Ключи `data`, которые пишутся, только если пусты. */
  data?: Json;
  /** Эффекты: пустой список заменяется целиком; непустой — дописываются поля. */
  effects?: Effect[];
}

const fx = (type: string, fields: Json): Effect => ({ id: "cf1", type, when: "always", ...fields });

const STYLE_SEEDS: Seed[] = [
  { name: "Стрельба из лука", kind: "feat", effects: [fx("roll_modifier", { modifier: "+2", appliesTo: "attack", weapon: "ranged", flat: 2 })] },
  { name: "Дуэлянт", kind: "feat", effects: [fx("roll_modifier", { modifier: "+2", appliesTo: "damage", weapon: "melee_one_hand", flat: 2 })] },
  { name: "Сражение метательным оружием", kind: "feat", effects: [fx("roll_modifier", { modifier: "+2", appliesTo: "damage", weapon: "thrown", flat: 2 })] },
  { name: "Сражение большим оружием", kind: "feat", effects: [fx("roll_modifier", { modifier: "1–2 на кости = 3", appliesTo: "damage", weapon: "melee_two_hand", dieMinimum: 3 })] },
  { name: "Сражение двумя оружиями", kind: "feat", effects: [fx("roll_modifier", { modifier: "модификатор в урон", appliesTo: "damage", weapon: "offhand_light", addAbility: true })] },
  {
    name: "Сражение голыми руками",
    kind: "feat",
    effects: [
      fx("roll_modifier", {
        modifier: "1к6 (1к8 без оружия и щита)",
        appliesTo: "damage",
        weapon: "unarmed",
        dice: "1к6",
        diceFreeHands: "1к8",
        text: "схваченному в начале хода — 1к4 дробящего",
      }),
    ],
  },
  { name: "Оборона", kind: "feat", effects: [fx("defense", { flat: 1, armorCondition: "armor" })] },
  {
    name: "Защита",
    kind: "feat",
    data: { casting_timing: "Реакция" },
    effects: [fx("special", { text: "помеха атаке по существу в 5 фт. от вас (нужен щит)" })],
  },
  {
    name: "Перехват",
    kind: "feat",
    data: { casting_timing: "Реакция" },
    effects: [fx("defense", { dice: "1к10", proficiency: "full", text: "цели рядом с вами (нужен щит или оружие)" })],
  },
  // Слепое зрение — ссылкой на запись «Справочника», как чувства видов.
  { name: "Сражение вслепую", kind: "feat", data: { senses: [{ ref: "Слепое зрение", distance: "10" }] } },
  // Выдача двух заговоров волшебника; характеристику игрок выбирает сам —
  // выбора модель выдачи пока не знает (записано в находках).
  { name: "Мистический воин", kind: "feat", data: { spell_choices: [{ count: 2, level: 0, className: "Волшебник", schools: [], outsideLimit: true }] } },
];

const FEATURE_SEEDS: Seed[] = [
  { name: "Защита без доспехов", kind: "feature", parent: "Монах", effects: [fx("defense", { acBase: { base: 10, abilities: ["dex", "wis"] }, armorCondition: "no_armor_no_shield" })] },
  { name: "Защита без доспехов", kind: "feature", parent: "Варвар", effects: [fx("defense", { acBase: { base: 10, abilities: ["dex", "con"] }, armorCondition: "no_armor" })] },
  { name: "Драконья устойчивость", kind: "feature", effects: [fx("defense", { acBase: { base: 10, abilities: ["dex", "cha"] }, armorCondition: "no_armor" })] },
  { name: "Встроенная защита", kind: "feature", effects: [fx("defense", { flat: 1 })] },
];

// Заклинаниям числа дописываются в уже заведённый эффект защиты (id «i1»
// с текстом) — второй эффект того же смысла был бы дублем.
const SPELL_SEEDS: Seed[] = [
  { name: "Доспехи мага", kind: "spell", effects: [fx("defense", { acBase: { base: 13, abilities: ["dex"] }, armorCondition: "no_armor" })] },
  { name: "Щит", kind: "spell", effects: [fx("defense", { flat: 5 })] },
  { name: "Щит веры", kind: "spell", effects: [fx("defense", { flat: 2 })] },
];

const save1 = fx("roll_modifier", { id: "cf2", modifier: "+1 к спасброскам", appliesTo: "save", flat: 1 });
const ITEM_SEEDS: Seed[] = [
  { name: "Кольцо защиты", kind: "magic_item", effects: [fx("defense", { flat: 1 }), save1] },
  { name: "Плащ защиты", kind: "magic_item", effects: [fx("defense", { flat: 1 }), save1] },
  { name: "Скарабей защиты", kind: "magic_item", effects: [fx("defense", { flat: 1 })] },
  { name: "Камень Айун (защита)", kind: "magic_item", effects: [fx("defense", { flat: 1 })] },
  { name: "Палочка Оркуса", kind: "magic_item", effects: [fx("defense", { flat: 3 })] },
  {
    name: "Посох силы",
    kind: "magic_item",
    effects: [fx("defense", { flat: 2 }), fx("roll_modifier", { id: "cf2", modifier: "+2 к спасброскам", appliesTo: "save", flat: 2 })],
  },
  { name: "Наручи защиты", kind: "magic_item", effects: [fx("defense", { flat: 2, armorCondition: "no_armor_no_shield" })] },
  { name: "Мантия архимага", kind: "magic_item", effects: [fx("defense", { acBase: { base: 15, abilities: ["dex"] }, armorCondition: "no_armor" })] },
];

/** Доспехи с известной основой: характеристики основы + прибавка эффектом. */
const ARMOR_SEEDS: { name: string; base: string; bonus: number }[] = [
  { name: "Демонический доспех", base: "Латы", bonus: 1 },
  { name: "Доспех из драконьей чешуи", base: "Чешуйчатый доспех", bonus: 1 },
  { name: "Латы дварфов", base: "Латы", bonus: 2 },
  { name: "Красивый проклёпанный доспех", base: "Проклёпанная кожа", bonus: 1 },
  // Щит кавалериста — сам щит: +2 щита и +2 своей прибавкой.
  { name: "Щит кавалериста", base: "Щит", bonus: 2 },
];

const ARMOR_KEYS = ["armor_type", "ac", "max_dex_bonus", "dex_bonus", "strength", "stealth"] as const;

/** «КД» отдельным словом — не часть другого слова. */
const KD = /(?<![А-Яа-яЁё])КД(?![А-Яа-яЁё])/g;

export interface CombatEffectsChange {
  id: number;
  name: string;
  what: string[];
}

function parse(raw: string | null): Json {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * План и применение одной функцией: `dryRun` возвращает список изменений и
 * ничего не пишет — его показывают владельцу до применения.
 */
export function planDndCombatEffects(database: Database, opts: { dryRun: boolean }): CombatEffectsChange[] {
  const changes: CombatEffectsChange[] = [];
  const find = database.prepare(
    `SELECT e.id, e.name, e.data, e.description FROM compendium_entries e
       LEFT JOIN compendium_entries p ON p.id = e.parent_id
      WHERE e.kind = ? AND e.name = ? AND (? IS NULL OR p.name = ?)`
  );
  const byName = database.prepare("SELECT id, name, data FROM compendium_entries WHERE kind = ? AND name = ?");
  const update = database.prepare("UPDATE compendium_entries SET data = ?, description = ? WHERE id = ?");
  // Все записи с одним data/description — чтобы правки разных шагов
  // (разметка и «КД») в одной записи не затирали друг друга.
  const pending = new Map<number, { name: string; data: Json; description: string | null; what: string[] }>();
  const load = (row: { id: number; name: string; data: string; description: string | null }) => {
    let p = pending.get(row.id);
    if (!p) {
      p = { name: row.name, data: parse(row.data), description: row.description, what: [] };
      pending.set(row.id, p);
    }
    return p;
  };

  const applySeed = (seed: Seed) => {
    const rows = find.all(seed.kind, seed.name, seed.parent ?? null, seed.parent ?? null) as {
      id: number;
      name: string;
      data: string;
      description: string | null;
    }[];
    for (const row of rows) {
      const p = load(row);
      for (const [key, value] of Object.entries(seed.data ?? {})) {
        if (!empty(p.data[key])) continue;
        p.data[key] = value;
        p.what.push(`${key}: ${JSON.stringify(value)}`);
      }
      if (!seed.effects) continue;
      const current = Array.isArray(p.data.effects) ? (p.data.effects as Effect[]) : [];
      if (current.length === 0) {
        p.data.effects = seed.effects;
        p.what.push(`effects: ${seed.effects.map((e) => JSON.stringify(e)).join(", ")}`);
        continue;
      }
      // Эффект уже есть — дописываем поля в эффект того же типа, а
      // недостающие эффекты добавляем.
      const next = current.map((e) => ({ ...e }));
      for (const want of seed.effects) {
        const same = next.find((e) => e.type === want.type && (want.type !== "roll_modifier" || e.appliesTo === want.appliesTo || e.appliesTo === undefined));
        if (!same) {
          next.push(want);
          p.what.push(`+ эффект ${JSON.stringify(want)}`);
          continue;
        }
        const added: string[] = [];
        for (const [k, v] of Object.entries(want)) {
          if (k === "id" || k === "when" || k === "type" || k === "text") continue;
          if (!empty(same[k])) continue;
          same[k] = v;
          added.push(`${k}=${JSON.stringify(v)}`);
        }
        if (added.length) p.what.push(`эффект «${String(same.type)}»: ${added.join(", ")}`);
      }
      p.data.effects = next;
    }
  };

  // Ссылки по именам — на id записей этой установки (у друга id другие).
  const resolveRefs = () => {
    for (const p of pending.values()) {
      const senses = p.data.senses as { ref?: string; name?: string; distance?: string }[] | undefined;
      if (Array.isArray(senses)) {
        p.data.senses = senses.map((s) => {
          if (!s.ref) return s;
          const hit = byName.get("mechanic_item", s.ref) as { id: number; name: string } | undefined;
          return { id: hit?.id ?? null, name: hit?.name ?? s.ref, distance: s.distance ?? "" };
        });
      }
      const choices = p.data.spell_choices as (Json & { className?: string })[] | undefined;
      if (Array.isArray(choices)) {
        p.data.spell_choices = choices.map(({ className, ...rest }) => {
          if (!className) return rest;
          const hit = byName.get("class", className) as { id: number } | undefined;
          return { ...rest, classIds: hit ? [hit.id] : [] };
        });
      }
    }
  };

  for (const seed of [...STYLE_SEEDS, ...FEATURE_SEEDS, ...SPELL_SEEDS, ...ITEM_SEEDS]) applySeed(seed);

  for (const armor of ARMOR_SEEDS) {
    const base = byName.get("equipment", armor.base) as { id: number; data: string } | undefined;
    const rows = find.all("magic_item", armor.name, null, null) as { id: number; name: string; data: string; description: string | null }[];
    if (!base) continue;
    const baseData = parse(base.data);
    for (const row of rows) {
      const p = load(row);
      const copied: string[] = [];
      for (const k of ARMOR_KEYS) {
        if (!empty(p.data[k]) || baseData[k] === undefined) continue;
        p.data[k] = baseData[k];
        copied.push(`${k}=${JSON.stringify(baseData[k])}`);
      }
      if (copied.length) p.what.push(`основа «${armor.base}»: ${copied.join(", ")}`);
    }
    applySeed({ name: armor.name, kind: "magic_item", effects: [fx("defense", { flat: armor.bonus })] });
  }
  resolveRefs();

  // «КД» → «КЗ» в описаниях и текстах эффектов (решение Q21).
  const withKd = database
    .prepare("SELECT id, name, data, description FROM compendium_entries WHERE description LIKE '%КД%' OR data LIKE '%КД%'")
    .all() as { id: number; name: string; data: string; description: string | null }[];
  for (const row of withKd) {
    const p = load(row);
    let n = 0;
    if (p.description) {
      const fixed = p.description.replace(KD, () => (n++, "КЗ"));
      p.description = fixed;
    }
    if (Array.isArray(p.data.effects)) {
      p.data.effects = (p.data.effects as Effect[]).map((e) =>
        typeof e.text === "string" ? { ...e, text: e.text.replace(KD, () => (n++, "КЗ")) } : e
      );
    }
    if (n) p.what.push(`«КД» → «КЗ» ×${n}`);
  }

  for (const [id, p] of pending) {
    if (p.what.length === 0) continue;
    changes.push({ id, name: p.name, what: p.what });
    if (!opts.dryRun) update.run(JSON.stringify(p.data), p.description, id);
  }
  return changes;
}

export function migrateDndCombatEffects(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;
  database.transaction(() => {
    planDndCombatEffects(database, { dryRun: false });
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(MIGRATION_KEY);
  })();
}
