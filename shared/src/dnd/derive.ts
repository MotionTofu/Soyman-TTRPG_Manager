/**
 * Производное состояние листа персонажа — одно место, где записаны правила.
 *
 * До этого модуля бонус мастерства считался четырьмя способами, макс. хиты —
 * тремя, а СЛ заклинаний, пассивное восприятие и штраф истощения были
 * константами в теле React-компонента: вызвать их было нельзя, проверить —
 * тем более. Два разбора полётов по хитам («минус шестнадцать хитов»,
 * «81 → 116 вместо 81 → 89») лежат в комментариях визарда левелапа именно
 * потому, что поймать расхождение было нечем.
 *
 * Правила модуля:
 *
 * 1. **Чистый и синхронный.** Выдачи вида, класса и черты приходят из
 *    компендиума по сети — их готовит вызывающий и передаёт готовым листом.
 *    Сделай функцию асинхронной, и асинхронность дойдёт до рендера.
 * 2. **Каждое число со слагаемыми.** `parts` нужны не Мастеру за столом, а
 *    тесту: он отличает «сумма сошлась» от «щит учтён дважды, а доспех не
 *    учтён». Показывать разбор никто не обязан — `value` читается как обычное
 *    число.
 * 3. **Эффекты собираются, но не применяются.** `effects.ts` моделирует их
 *    честно, но ни один потребитель до сих пор не доводил эффект до КЗ, хитов
 *    и скорости. Включение изменит числа на живых листах, поэтому идёт
 *    отдельным решением — здесь эффекты только перечисляются.
 */
import type {
  DndAbilityKey,
  DndCharacterData,
  DndEquipmentSection,
  DndSkillProfLevel,
} from "./types";
import {
  abilityModifier,
  characterSpellcastingAbility,
  parseBonus,
  totalCharacterLevel,
} from "./abilities";
import { SKILL_CATALOG } from "./skillCatalog";
import { computeArmorClass, equippedItems, unarmoredDefenseBonus } from "./armorClass";
import { carryCapacityLb } from "./equipment";

/** Одно слагаемое производной величины. */
export interface Part {
  label: string;
  value: number;
}

/** Производная величина: число и из чего оно сложилось. */
export interface Derived {
  value: number;
  parts: Part[];
  /**
   * Число взято из сохранённого листа, а не посчитано, и почему. Пустое —
   * значит посчитано.
   */
  stale?: string;
}

export interface Sheet {
  /** Суммарный уровень персонажа по всем строкам классов. */
  level: Derived;
  proficiencyBonus: Derived;
  /** Модификаторы характеристик. */
  abilityModifiers: Record<DndAbilityKey, Derived>;
  /** Спасброски. */
  saves: Record<DndAbilityKey, Derived>;
  /** Навыки по английскому ключу каталога. */
  skills: Record<string, Derived>;
  armorClass: Derived;
  maxHitPoints: Derived;
  passivePerception: Derived;
  /** Штраф истощения к любому броску к20 (5.5: −2 за уровень). */
  exhaustionPenalty: Derived;
  /** Пешая скорость в футах. */
  walkSpeed: Derived;
  /** Грузоподъёмность в фунтах. */
  carryCapacity: Derived;
  /** Заклинательство — `null` у неколдующего персонажа. */
  spellcasting: {
    ability: DndAbilityKey;
    saveDc: Derived;
    attackBonus: Derived;
  } | null;
}

const ABILITY_KEYS: DndAbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Складывает слагаемые в величину, отбрасывая нулевые подписи.
 *
 * Инвариант: слагаемые обязаны складываться ровно в `value`. Поэтому нижняя
 * граница — не молчаливый `Math.max`, а отдельное слагаемое: иначе разбор
 * показывает «30 − 35», а число рядом стоит 0, и объяснение врёт. Поймано
 * собственным тестом на разбор.
 */
function sum(parts: Part[], opts: { min?: number; stale?: string } = {}): Derived {
  const all = [...parts];
  const raw = all.reduce((n, p) => n + p.value, 0);
  if (opts.min != null && raw < opts.min) {
    all.push({ label: `Не ниже ${opts.min}`, value: opts.min - raw });
  }
  const value = all.reduce((n, p) => n + p.value, 0);
  const kept = all.filter((p) => p.value !== 0);
  return {
    value,
    parts: kept.length ? kept : all.slice(0, 1),
    ...(opts.stale ? { stale: opts.stale } : {}),
  };
}

/** Бонус мастерства по суммарному уровню: 1-4 → +2, далее +1 за четыре. */
export function proficiencyBonusForLevel(totalLevel: number): number {
  return Math.min(6, 2 + Math.floor((Math.max(1, totalLevel) - 1) / 4));
}

/**
 * Макс. хиты из сохранённых слагаемых.
 *
 * Вывести их из класса и уровня нельзя: броски кости хитов есть только в
 * `hpRolls`, а `hpLump` — дайсовая часть без Телосложения. У листов, заведённых
 * до появления этой модели (и у всех импортированных из Long Story Short —
 * импорт копирует `hp-max` строкой и `hpLump` не ставит вовсе), пересчитать
 * нечем: отдаём сохранённое число и говорим об этом через `stale`.
 */
function maxHitPoints(c: DndCharacterData, conMod: number, level: number): Derived {
  const stored = Number.parseInt(c.hitPointMax || "0", 10) || 0;
  const temp = Number.parseInt(c.hitPointMaxTemp || "0", 10) || 0;
  const tempPart: Part[] = temp ? [{ label: "Временный предел", value: temp }] : [];

  if (c.hpLump == null) {
    // Зажима «не ниже 1» здесь нет намеренно: у листа с незаполненными хитами
    // сохранено пусто, и приложение показывает пусто. Подставить единицу
    // значило бы выдумать число там, где Мастер его ещё не вписал.
    return sum([{ label: "Сохранено на листе", value: stored }, ...tempPart], {
      stale: "Лист заведён до модели слагаемых хитов (или импортирован) — пересчитать нечем",
    });
  }

  const rolls = (c.hpRolls ?? []).reduce((a, b) => a + b, 0);
  const hasTough = (c.feats ?? []).some((f) => (f.name ?? "").includes("Крепкий"));
  const perLevel = (hasTough ? 2 : 0) + (c.hpMiscPerLevel ?? 0);

  const parts: Part[] = [
    { label: "Кости хитов (база)", value: c.hpLump },
    { label: "Броски за уровни", value: rolls },
    { label: `Телосложение ×${level}`, value: conMod * level },
  ];
  if (perLevel) parts.push({ label: `Прочее за уровень ×${level}`, value: perLevel * level });
  parts.push(...tempPart);

  // Отрицательное Телосложение с «прочим» может увести итог в ноль.
  return sum(parts, { min: 1 });
}

/**
 * КЗ: вычисленное — или сохранённое, если вычислять не из чего.
 *
 * У листа, импортированного из Long Story Short, снаряжение не отмечено
 * надетым, и вычисление честно даёт голые 10 — при том что импорт сохранил
 * настоящие 15 в свободном поле `armorClass`. Показать 10 значит молча
 * ухудшить то, что Мастер видит в списке персонажей, ради согласованности.
 * Поэтому здесь так же, как с хитами: отдаём сохранённое и говорим, почему
 * оно не пересчитано. Корень (импорт должен отмечать снаряжение надетым)
 * чинится отдельно.
 */
function armorClassOf(
  c: DndCharacterData,
  sections: DndEquipmentSection[],
  computedParts: Part[]
): Derived {
  const computed = sum(computedParts);
  const stored = Number.parseInt((c.armorClass ?? "").trim(), 10);
  const nothingWorn = equippedItems(sections).length === 0;
  if (nothingWorn && Number.isFinite(stored) && stored !== computed.value) {
    return sum([{ label: "Сохранено на листе", value: stored }], {
      stale: "В инвентаре ничего не надето — вычислять не из чего, показано сохранённое значение",
    });
  }
  return computed;
}

/** Пешая скорость: структура скоростей главнее legacy-строки. */
function walkSpeed(c: DndCharacterData, exhaustion: number): Derived {
  const base = c.speeds?.walk ?? 0;
  const parts: Part[] = [{ label: "Пешая скорость", value: base }];
  // 5.5: истощение снимает 5 футов за уровень.
  if (exhaustion) parts.push({ label: `Истощение ${exhaustion}`, value: -exhaustion * 5 });
  return sum(parts, { min: 0 });
}

/**
 * Лист персонажа → все производные числа.
 *
 * Вход — сохранённый лист (уже нормализованный: `normalizeDndCharacter`).
 * Хранимые производные поля (`proficiencyBonus: "+2"`, `armorClass` строкой)
 * НЕ читаются: они устаревали молча при любой правке класса или уровня, и
 * ровно это было корнем расхождений.
 */
export function deriveSheet(c: DndCharacterData): Sheet {
  const level = totalCharacterLevel(c.classes ?? []);
  const pb = proficiencyBonusForLevel(level);
  const exhaustion = Math.min(6, Math.max(0, c.exhaustion ?? 0));
  // На КЗ и на сложность заклинаний истощение не влияет — это не броски к20.
  const penalty = exhaustion * 2;

  const mods = {} as Record<DndAbilityKey, Derived>;
  for (const key of ABILITY_KEYS) {
    const score = c.abilities?.[key] ?? 10;
    mods[key] = {
      value: abilityModifier(score),
      parts: [{ label: `Значение ${score}`, value: abilityModifier(score) }],
    };
  }

  const saves = {} as Record<DndAbilityKey, Derived>;
  for (const key of ABILITY_KEYS) {
    const proficient = !!c.savingThrowProfs?.[key];
    const parts: Part[] = [{ label: "Характеристика", value: mods[key].value }];
    if (proficient) parts.push({ label: "Владение", value: pb });
    if (penalty) parts.push({ label: `Истощение ${exhaustion}`, value: -penalty });
    saves[key] = sum(parts);
  }

  const skills: Record<string, Derived> = {};
  for (const def of SKILL_CATALOG) {
    const profLevel = (c.skillProfs?.[def.original] ?? 0) as DndSkillProfLevel;
    const abilityMod = mods[def.ability as DndAbilityKey]?.value ?? 0;
    const parts: Part[] = [{ label: "Характеристика", value: abilityMod }];
    if (profLevel === 1) parts.push({ label: "Владение", value: pb });
    if (profLevel === 2) parts.push({ label: "Экспертиза", value: pb * 2 });
    if (penalty) parts.push({ label: `Истощение ${exhaustion}`, value: -penalty });
    skills[def.original] = sum(parts);
  }

  const sections = c.equipmentSections ?? [];
  const acBase = computeArmorClass(mods.dex.value, sections, parseBonus(c.manualAcBonus || ""));
  const unarmored = unarmoredDefenseBonus(
    c.classFeatures ?? [],
    c.classes ?? [],
    mods.wis.value,
    mods.con.value,
    sections
  );
  const acParts: Part[] = [{ label: "Доспех и Ловкость", value: acBase }];
  if (unarmored.bonus) acParts.push({ label: unarmored.source ?? "Защита без доспехов", value: unarmored.bonus });
  const armorClass = armorClassOf(c, sections, acParts);

  // Пассивное восприятие: 10 + навык. Штраф истощения сюда входит, потому что
  // пассивное значение — это тот же бросок, только без кубика. В шпаргалках
  // истощение раньше не вычиталось — расхождение сведено сюда.
  const perceptionKey = SKILL_CATALOG.find((d) => d.original === "Perception")?.original ?? "Perception";
  const perception = skills[perceptionKey];
  const passiveParts: Part[] = [{ label: "База", value: 10 }, ...(perception?.parts ?? [])];

  const spellAbility = characterSpellcastingAbility(c.classes ?? []);
  const spellcasting = spellAbility
    ? {
        ability: spellAbility,
        saveDc: sum([
          { label: "База", value: 8 },
          { label: "Характеристика", value: mods[spellAbility].value },
          { label: "Владение", value: pb },
          { label: "Прочее", value: parseBonus(c.spellDcMisc || "") },
        ]),
        attackBonus: sum([
          { label: "Характеристика", value: mods[spellAbility].value },
          { label: "Владение", value: pb },
          { label: "Прочее", value: parseBonus(c.spellAttackMisc || "") },
          ...(penalty ? [{ label: `Истощение ${exhaustion}`, value: -penalty }] : []),
        ]),
      }
    : null;

  return {
    level: { value: level, parts: (c.classes ?? []).map((k) => ({ label: k.className || "Класс", value: k.level || 0 })) },
    proficiencyBonus: { value: pb, parts: [{ label: `Уровень ${level}`, value: pb }] },
    abilityModifiers: mods,
    saves,
    skills,
    armorClass,
    maxHitPoints: maxHitPoints(c, mods.con.value, level),
    passivePerception: sum(passiveParts),
    exhaustionPenalty: { value: penalty, parts: [{ label: `Истощение ${exhaustion}`, value: penalty }] },
    walkSpeed: walkSpeed(c, exhaustion),
    carryCapacity: {
      value: carryCapacityLb(c.abilities?.str ?? 10, 0),
      parts: [{ label: `Сила ${c.abilities?.str ?? 10} ×15`, value: carryCapacityLb(c.abilities?.str ?? 10, 0) }],
    },
    spellcasting,
  };
}
