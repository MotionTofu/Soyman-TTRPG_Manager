// Лист D&D, «Действия»: строки атак (оружие, заклинания, умения, ручные),
// таблица атак, трата действий и окно действия, пулы действий.
import type { DndActionTiming, DndSpellEntry, DndFeature, DndEquipmentSection, DndCharacterData, DndEquipmentItem, DndAbilityKey, DndAbilityScores, DndManualAttack, DndPinnedAction, CompendiumEntry, DndCreatureSpeed } from "../../types";
import type { WeaponUse, WeaponEffects } from "@shared/dnd/derive";
import { abilityModifier, formatModifier, ABILITY_NAME_TO_KEY, ABILITY_LABELS } from "./AbilityScores";
import { wornArmorState } from "./armorClass";
import { upgradeDamageDie } from "./dndMonk";
import { hasResolvableEffect, checksLabel, effectsLabel, type DcExtra, resolveLevelDice, costSummary } from "./effects";
import { inferTimingFromLegacyText } from "./dndFeatures";
import { type NavIconName, NavIcon } from "../NavIcons";
import { type ReactNode, useState, useEffect } from "react";
import { textOnClassColor } from "./dndClassColors";
import { MentionText } from "../mentions/MentionText";
import { type DndResourceDef, featurePoolKey, type ClassResourceSource, allResources, showClassSuffix } from "./dndResources";
import { ActiveSpellToggle, spellChangesSheet, spellActivationPatch, MARK_SPELLS, spellNameParts } from "./SheetSpells";
import { write } from "../../data/hooks";
import { afterWriteAnywhere } from "../../data/imperative";
import { useCompendiumEntries } from "./useCompendiumEntries";
import { loadDndMechanicsGroupEntries } from "./dndCompendium";
import { weaponMasteryName } from "./StartingEquipmentPicker";
import { Modal } from "../Modal";
import { type DndDistanceUnit, formatDistance } from "../../dndPrefs";
import { PoolMeter, poolShowsNumber } from "./TofuPips";
import { PROGRESSION_RECHARGE_LABELS } from "./progression";

export interface AttackRow {
  name: string;
  bonus: string;
  damage: string;
  range: string;
  description?: string;
  timing: DndActionTiming;
  // Откуда строка пришла — чтобы клик открыл её карточку, а окно знало, что
  // именно тратить. У оружия и вручную вписанных атак источника нет: тратить
  // им нечего, а описание ручной атаки и так стоит в строке. У оружия зато
  // есть entryId записи снаряжения — по нему окно показывает описание.
  source?:
    | { kind: "spell"; spell: DndSpellEntry; level: number }
    | { kind: "feature"; feature: DndFeature };
  entryId?: number | null;
  /** Строка оружия: в какой группе «Действий» (Q17). */
  group?: "melee" | "mixed" | "ranged";
}

// Equipped weapons show up as attack rows automatically — no need to
// duplicate a weapon's damage/properties into a separate hand-written entry
// once it's marked "надето". Attack bonus assumes proficiency (this app
// doesn't track weapon-proficiency booleans separately) and picks the
// higher of STR/DEX for finesse weapons, DEX for ranged-only, STR otherwise.
//
// Руки: «надето» — при себе, не «в руках» (визард надевает всё оружие,
// гриллинг 2026-09-24, Q7). Нелёгкое рукопашное не двуручное — одной рукой;
// Дуэлянт выключается переключателем (Q14). Универсальное без щита даёт две
// строки — одной рукой и двумя. Два лёгких рукопашных дают строку доп. атаки
// бонусным действием без положительного модификатора (Q11). Прибавки стилей
// приходят из `fx` — эффектов с фильтром оружия; их источник подписан в
// строке, чтобы число не было загадкой (Q23).
const DIE_STEPS = [4, 6, 8, 10, 12];
/** «1к8 рубящий» → «1к10»: кость на ступень больше, или undefined. */
function nextDamageDie(damage: string): string | undefined {
  const m = /^\s*(\d+)\s*к\s*(\d+)/i.exec(damage);
  if (!m) return undefined;
  const step = DIE_STEPS.indexOf(Number(m[2]));
  return step >= 0 && step < DIE_STEPS.length - 1 ? `${m[1]}к${DIE_STEPS[step + 1]}` : undefined;
}

export function weaponAttackRows(
  sections: DndEquipmentSection[],
  abilities: DndCharacterData["abilities"],
  profBonus: number,
  exhaustionPenalty = 0,
  // Боевые искусства монаха: кость для замены и классификатор строк.
  // Без него (немонах, умение погашено) — всё как было.
  martial?: { die: string; isMonkWeapon: (item: DndEquipmentItem) => boolean } | null,
  // Освоенные типы оружия («Оружейные приёмы» Воина, тикет 06): свойство
  // мастерства применимо только к освоенному. null/пусто — воин без выбора,
  // не-воин или старый лист: показ как раньше, без пометок.
  mastered?: { ids: Set<number>; names: Set<string> } | null,
  fx?: (use: WeaponUse) => WeaponEffects
): AttackRow[] {
  const str = abilityModifier(abilities.str);
  const dex = abilityModifier(abilities.dex);
  const noFx: WeaponEffects = { attack: [], damage: [], addAbility: null, dieMinimum: null, dice: null, notes: [] };
  const effectsOf = (use: WeaponUse) => (fx ? fx(use) : noFx);
  // Отданная вещь из боя исключена вместе с КЗ (этап 4б): ею не бьют.
  const weapons = sections.flatMap((s) => s.items).filter((i) => i.equipped && !i.transferOut && i.weaponDamage);
  const { hasShield } = wornArmorState(sections);
  // Свойства оружия приходят строкой из компендиума, поэтому признаки
  // ищутся без учёта регистра: «Фехтовальное» и «фехтовальное» — одно и
  // то же, а раньше вторая форма молча меняла характеристику атаки.
  const propsOf = (i: DndEquipmentItem) => (i.weaponProperties ?? "").toLowerCase();
  const melee = weapons.filter((i) => i.weaponAttackMelee);
  const lights = melee.filter((i) => /л[её]гк/.test(propsOf(i)));
  const rows: AttackRow[] = [];

  const build = (
    i: DndEquipmentItem,
    use: WeaponUse,
    opts: { label?: string; range?: string; die?: string; timing?: DndActionTiming; offhand?: boolean } = {}
  ): AttackRow => {
    const props = propsOf(i);
    const finesse = props.includes("фехтовальн");
    const thrown = props.includes("метательн");
    // Метательное ближнее оружие бросают Силой, если оно не фехтовальное —
    // то есть выбор характеристики тот же, что и в ближнем бою.
    const rangedOnly = !!i.weaponAttackRanged && !i.weaponAttackMelee && !thrown;
    // Ловкие атаки монаха: монашеское оружие бьёт Ловкостью (фехтовальное —
    // как было, max, чтобы умение не занижало готовую строку).
    const monkWeapon = !!martial && martial.isMonkWeapon(i);
    const mod = monkWeapon ? (finesse ? Math.max(str, dex) : dex) : finesse ? Math.max(str, dex) : rangedOnly ? dex : str;
    const range =
      opts.range ?? (i.weaponAttackMelee && i.weaponAttackRanged ? "Ближний/Дальний" : i.weaponAttackRanged ? "Дальний" : "Ближний");
    // Кость боевых искусств вместо своей, если больше («1к4 колющий» кинжала
    // на 1к8 с 5 уровня). Тип урона и хвост сохраняются в upgradeDamageDie.
    const upgraded = monkWeapon ? upgradeDamageDie(i.weaponDamage ?? "", martial.die) : null;
    const versatile = opts.die ? upgradeDamageDie(i.weaponDamage ?? "", opts.die) : null;
    const baseDamage = versatile ?? upgraded ?? i.weaponDamage;
    // «Тяжёлое» — свойство оружия, а не хват: ставится здесь, для любой строки.
    const e = effectsOf({ ...use, heavy: /тяж[её]л/.test(props) });
    // «Защитник»: перенесённое в КЗ уходит из атаки и урона (Q11).
    const shift = i.acShiftable ? Math.min(i.acShift ?? 0, i.magicBonus ?? 0) : 0;
    const magic = (i.magicBonus ?? 0) - shift;
    const attackExtra = e.attack.reduce((n, p) => n + p.value, 0);
    const damageExtra = e.damage.reduce((n, p) => n + p.value, 0);
    // Доп. атака: модификатор в урон не идёт, если он положительный (5.5);
    // «Сражение двумя оружиями» его возвращает.
    const abilityDmg = opts.offhand && !e.addAbility ? Math.min(mod, 0) : mod;
    const dmgMod = abilityDmg + magic + damageExtra;
    // Урон печатался как есть — «1к8» без модификатора, который игрок
    // прибавлял в уме каждый бросок. Теперь формула полная: «1к8 +3».
    const damageWithMod = baseDamage ? `${baseDamage}${dmgMod !== 0 ? ` ${formatModifier(dmgMod)}` : ""}` : "";
    // Мастерство применимо, только если оружие освоено. Список пуст —
    // старый лист или не-воин: показываем как раньше, без пометок.
    const masteryKnown = mastered == null || (mastered.ids.size === 0 && mastered.names.size === 0);
    // «Защитник (Длинный меч)» освоен, если освоена основа в скобках.
    const baseName = /\(([^)]+)\)\s*$/.exec(i.name)?.[1]?.trim().toLowerCase();
    const isMastered =
      masteryKnown ||
      (i.entryId != null && mastered.ids.has(i.entryId)) ||
      mastered.names.has(i.name.trim().toLowerCase()) ||
      (!!baseName && mastered.names.has(baseName));
    const masteryText =
      i.weaponMastery && isMastered
        ? `Мастерство: ${i.weaponMastery}`
        : i.weaponMastery && !masteryKnown
          ? "Мастерство: не освоено"
          : "";
    const sources = [
      ...e.attack.map((p) => `${p.label} ${formatModifier(p.value)} к атаке`),
      ...e.damage.map((p) => `${p.label} ${formatModifier(p.value)} к урону`),
      ...(e.addAbility && opts.offhand ? [`${e.addAbility}: модификатор в урон`] : []),
      ...(e.dieMinimum ? [`1–2 на кости = ${e.dieMinimum.value} (${e.dieMinimum.source})`] : []),
      ...(shift ? [`${shift} бонуса перенесено в КЗ`] : []),
      ...e.notes,
    ];
    const damage = [
      damageWithMod,
      i.weaponProperties,
      masteryText,
      upgraded || (monkWeapon && !finesse && !rangedOnly) ? "кость боевых искусств" : "",
      ...sources,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      name: opts.label ? `${i.name} (${opts.label})` : i.name,
      bonus: formatModifier(mod + profBonus + magic + attackExtra - exhaustionPenalty),
      damage,
      range,
      timing: opts.timing ?? ("action" as const),
      entryId: i.entryId ?? null,
      // Группы «Действий» (Q17): рукопашное, рукопашное и метательное, дальнобойное.
      group: !i.weaponAttackMelee ? ("ranged" as const) : thrown ? ("mixed" as const) : ("melee" as const),
    };
  };

  for (const i of weapons) {
    const props = propsOf(i);
    const thrown = props.includes("метательн");
    if (!i.weaponAttackMelee) {
      // Дальнобойное: лук, арбалет, праща; дротики — дальнобойное и
      // метательное сразу.
      rows.push(build(i, { ranged: true, thrown }));
      continue;
    }
    // Кость двумя руками — из скобок свойства, если справочник её пишет, иначе
    // по правилу 5.5: у всего универсального оружия она на ступень больше
    // (посох 1к6 → 1к8, длинный меч 1к8 → 1к10). В живом справочнике поле
    // пустое у всех, поэтому правило — основной путь.
    const versatile = props.includes("универсальн");
    const versatileDie = versatile
      ? /универсальн\S*\s*\((\d+\s*к\s*\d+)\)/.exec(props)?.[1]?.trim() ?? nextDamageDie(i.weaponDamage ?? "")
      : undefined;
    // Что в руках, лист не угадывает: Дуэлянт решается переключателем
    // (гриллинг 2026-09-24, Q14), а остальное оружие висит на поясе.
    if (props.includes("двуручн")) rows.push(build(i, { twoHand: true }));
    else if (versatileDie && !hasShield) {
      rows.push(build(i, { oneHand: true }, { label: "одной рукой" }));
      rows.push(build(i, { twoHand: true }, { label: "двумя руками", die: versatileDie }));
    } else rows.push(build(i, { oneHand: true }));
    // Бросок метательного рукопашного — отдельной строкой, только когда
    // бросок считается иначе («Сражение метательным оружием»): иначе строка
    // была бы дублем.
    const throwFx = effectsOf({ thrown: true });
    if (thrown && (throwFx.attack.length || throwFx.damage.length || throwFx.dieMinimum || throwFx.notes.length)) {
      rows.push(build(i, { thrown: true }, { label: "метнуть", range: "Дальний" }));
    }
  }
  if (lights.length >= 2) {
    rows.push(build(lights[1], { offhand: true }, { label: "доп. атака", timing: "bonus", offhand: true }));
  }
  // Два одинаковых кинжала в руках дают одну строку атаки, а не две.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = [r.name, r.bonus, r.damage, r.range, r.timing].join("|");
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

// A spell's `attackSave` field holds one of SPELL_ATTACK_SAVE_OPTIONS —
// "Атака ближняя"/"Атака дальняя" or "Спасбросок <Ability>" — plain option
// text, not a number. Converts it into the same "АТК +N" / "СЛ <ABBR> N"
// shorthand the Атаки table shows for weapons, using the character's own
// spell-attack-bonus/spell-DC formulas (already computed by the caller).
function formatSpellAttackSave(attackSave: string | undefined, spellAttackBonus: number, spellDc: number): string {
  if (!attackSave) return "—";
  if (attackSave.startsWith("Атака")) return `АТК ${formatModifier(spellAttackBonus)}`;
  if (attackSave.startsWith("Спасбросок")) {
    const abilityName = attackSave.replace("Спасбросок", "").trim();
    const key = ABILITY_NAME_TO_KEY[abilityName];
    const abbr = key ? ABILITY_LABELS.find((a) => a.key === key)?.label : null;
    return `СЛ ${abbr ?? abilityName} ${spellDc}`;
  }
  return attackSave;
}

// Показываем в Бою только то, что реально подготовлено (звёздочка), иначе
// таблица Атак раздувается всем, что вообще есть в книге заклинаний —
// заговоры получают тот же звёздочный переключатель, что и заклинания по
// уровням (см. togglePrepared в DndSpellLevelSection), так что фильтр по
// prepared применяется к обоим одинаково.
export function combatSpellRows(
  cantrips: DndSpellEntry[],
  spellsByLevel: DndSpellEntry[][],
  spellAttackBonus: number,
  spellDc: number,
  // Числа для своей характеристики заклинания (Q4, 2026-09-24).
  numbersFor?: (ability: DndAbilityKey) => { attack: number; dc: number },
  // «2к8 + ваш модификатор…» в кубах — числом (аудит 2026-09-26).
  mods?: { spell: number | null; abilities: DndAbilityScores }
): AttackRow[] {
  // Круг нужен строке: по нему окно знает, какую ячейку тратить.
  const withLevel: { spell: DndSpellEntry; level: number }[] = [
    ...cantrips.filter((s) => s.prepared > 0).map((spell) => ({ spell, level: 0 })),
    ...spellsByLevel.flatMap((lvl, i) => lvl.filter((s) => s.prepared > 0).map((spell) => ({ spell, level: i + 1 }))),
  ];
  return withLevel
    .map(({ spell, level }) => ({ ...spell, __level: level }) as DndSpellEntry & { __level: number })
    .filter((s) => {
      // Раньше здесь стоял фильтр по полю `category`, которое заполнялось
      // у меньшинства записей и потому прятало большую часть книги. Теперь
      // критерий механический — есть бросок или числовой эффект; для листов
      // со старым снапшотом остаётся прежняя проверка.
      if (s.checks?.length || s.effects?.length) return hasResolvableEffect(s.checks ?? [], s.effects ?? []);
      return s.category === "Боевое" || s.category === "Лечащее";
    })
    .map((s) => {
      const timing = s.castingTiming ?? (s.castingTime ? inferTimingFromLegacyText(s.castingTime).timing : "action");
      const structured = !!(s.checks?.length || s.effects?.length);
      const own = s.ability && numbersFor ? numbersFor(s.ability) : null;
      const atk = own?.attack ?? spellAttackBonus;
      const dc = own?.dc ?? spellDc;
      const label = structured ? checksLabel(s.checks ?? [], atk, dc) : formatSpellAttackSave(s.attackSave, atk, dc);
      return {
        name: s.name,
        // Своя характеристика заклинания (черта) уже в числе; подпись «· Инт»
        // не читалась и отнимала место (владелец 2026-09-26).
        bonus: label,
        damage: structured
          ? effectsLabel(s.effects ?? [], s.checks ?? [], undefined, mods && {
              spell: s.ability ? abilityModifier(mods.abilities[s.ability]) : mods.spell,
              int: abilityModifier(mods.abilities.int),
            })
          : s.damage || s.healing || "—",
        range: s.range || "—",
        timing,
        source: { kind: "spell", spell: s, level: s.__level },
      };
    });
}

// Умения классов, видов, черт и прочего, у которых проставлено время
// накладывания — Второе дыхание, Наложение рук, Ярость. До появления
// эффектов такие способности во вкладку не попадали вовсе: она собиралась
// только из оружия, заклинаний и вручную вписанных атак.
// classLevelOf — уровень класса-хозяина по sourceParentId (строка класса или
// подкласса): им резолвятся кубы levelDice (пушка +1к8 на 9-м). Без него —
// базовые кубы.
export function featureActionRows(
  groups: DndFeature[][],
  spellAttackBonus: number,
  spellDc: number,
  classLevelOf?: (sourceParentId: number | null | undefined) => number | null,
  // СЛ сейвов не от заклинательной характеристики (Ошеломляющий удар — Муд):
  // без неё чистый монах видел СЛ 8 + 0 + БМ.
  dcExtra?: DcExtra
): AttackRow[] {
  return groups
    .flat()
    .filter((f) => !!f.castingTiming)
    .map((f) => ({
      name: f.name,
      bonus: checksLabel(f.checks ?? [], spellAttackBonus, spellDc, dcExtra),
      damage: effectsLabel(
        resolveLevelDice(f.effects ?? [], classLevelOf?.(f.sourceParentId) ?? null),
        f.checks ?? [],
        dcExtra?.profBonus,
        dcExtra ? { int: abilityModifier(dcExtra.abilities.int) } : undefined
      ),
      // Время не дублируем — оно и есть заголовок секции таблицы; в этой
      // колонке у умения полезнее его стоимость («Ячейка», «1 за долгий
      // отдых»), и «Иное» показываем только когда оно что-то уточняет.
      // Уточнение времени — и у «Действия»: Дыхание дракона — «вместо одной
      // атаки; конус или линия».
      range: [f.castingTimingOther ?? "", costSummary(f.cost)]
        .filter(Boolean)
        .join(", ") || "—",
      timing: f.castingTiming as DndActionTiming,
      source: { kind: "feature", feature: f },
    }));
}

export function manualAttackRows(attacks: DndManualAttack[]): AttackRow[] {
  return attacks.map((a) => ({
    name: a.name || "Без названия",
    bonus: "",
    damage: "",
    range: "",
    description: a.description,
    timing: a.timing,
  }));
}

// Same equipped-weapon source as weaponAttackRows, but as a single-line
// name+description pair for the compact mini card, which has no room for a
// table.
export function equippedWeaponSummaries(sections: DndEquipmentSection[]): DndFeature[] {
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.equipped && !i.transferOut && i.weaponDamage)
    .map((i) => {
      const type = i.weaponAttackMelee && i.weaponAttackRanged ? "Ближняя/дальняя атака" : i.weaponAttackRanged ? "Дальняя атака" : "Ближняя атака";
      const parts = [type, i.weaponDamage, i.weaponProperties, i.weaponMastery && `Мастерство: ${i.weaponMastery}`].filter(Boolean);
      return { name: i.name, description: parts.join(" · ") };
    });
}

export function pickBookmarks(rows: AttackRow[], pinned: DndPinnedAction[] | undefined): AttackRow[] {
  if (pinned && pinned.length > 0) {
    // По имени, а не по id: у оружия и ручных атак записи компендиума нет
    // вовсе, а имя строки — то, что игрок видел, когда закреплял.
    return pinned
      .map((p) => rows.find((r) => r.name === p.name))
      .filter((r): r is AttackRow => !!r)
      .slice(0, 3);
  }
  // Числа, а не прочерки: строка «Сотворение заклинаний — — —» на карте
  // занимает место закладки и не отвечает ни на один вопрос за столом.
  const hasNumbers = (r: AttackRow) => {
    const num = (v: string) => !!v && v !== "—";
    return num(r.bonus) || num(r.damage);
  };
  const out: AttackRow[] = [];
  const weapon = rows.find((r) => !r.source && hasNumbers(r));
  if (weapon) out.push(weapon);
  const spells = rows.filter((r) => r.source?.kind === "spell" && hasNumbers(r));
  const topSpell = spells.reduce<AttackRow | null>((best, r) => {
    const level = r.source?.kind === "spell" ? r.source.level : 0;
    const bestLevel = best?.source?.kind === "spell" ? best.source.level : -1;
    return level > bestLevel ? r : best;
  }, null);
  if (topSpell) out.push(topSpell);
  // Третьей — первая же строка обычного действия, ещё не попавшая в список:
  // у персонажа без оружия и без магии закладки иначе пустуют совсем.
  const filler = rows.find((r) => r.timing === "action" && hasNumbers(r) && !out.includes(r));
  if (filler && out.length < 3) out.push(filler);
  return out;
}

// Тип строки действия — им выбирается значок слева. Источник знают
// заклинания и умения; вписанная руками строка узнаётся по описанию (числа
// у неё не считаются), всё остальное пришло из снаряжения — оружие, к
// которому относится и безоружный удар.
function actionIcon(r: AttackRow): NavIconName {
  if (r.source?.kind === "spell") return "spark";
  if (r.source?.kind === "feature") return "rune";
  if (r.description !== undefined) return "dots";
  return "sword";
}

const ACTION_ICON_TITLES: Record<string, string> = {
  spark: "Заклинание",
  rune: "Способность",
  dots: "Прочее",
  sword: "Оружие",
};

// Скобочная часть имени («Кинжал (метательный)», «Свиток заклинания
// (уровень 1)») уходит в подпись: в справочнике она уточняет запись, а в
// списке действий крадёт место у самого имени и мешает вести по нему глаз.
function splitActionName(name: string): { title: string; qualifier: string } {
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (!m || !m[1].trim()) return { title: name, qualifier: "" };
  return { title: m[1].trim(), qualifier: m[2].trim() };
}

export function AttacksTable({
  title,
  rows,
  onOpen,
  pinnedNames,
  onPin,
  resourceLabels,
  color,
  headExtra,
}: {
  title: string;
  rows: AttackRow[];
  /** Рядом с заголовком — переключатель Дуэлянта у «Рукопашного» (Q17). */
  headExtra?: ReactNode;
  /** Имена строк, вынесенных закладкой на первую карту. */
  pinnedNames?: string[];
  onPin?: (row: AttackRow) => void;
  // Строка со источником кликабельна: раньше вкладка показывала имя,
  // бонус и урон, а прочитать, что способность делает, было нельзя — только
  // уйти на другую вкладку и искать её там заново.
  onOpen?: (row: AttackRow) => void;
  /** Подписи пулов по resourceKey — для бейджей цен («−2 Очки чародейства»). */
  resourceLabels?: Record<string, string>;
  /** Цвет класса — кромка тратящих строк, единственная краска. */
  color?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="cs-list">
      {/* Заголовок раздела — слово и планка цветом класса ровно по его
          ширине: он отбивает раздел вместо линеек между строками. */}
      <div className="dnd-action-head">
        <span style={color ? { borderBottomColor: color } : undefined}>{title}</span>
        {headExtra && <span className="dnd-action-head-extra">{headExtra}</span>}
      </div>
      <div className="stack dnd-action-cards" style={{ gap: 0 }}>
        {rows.map((r, i) => {
          // Строка, из-за которой всплывает лента пулов, подсвечена и несёт
          // цену прямо на себе (канвас Actions) — за столом видно, чем платишь,
          // не открывая окно.
          const cost = r.source?.kind === "feature" ? r.source.feature.cost : undefined;
          const poolKey = cost?.kind === "resource" ? (cost.resourceKey ?? null) : null;
          const spending = poolKey != null;
          const amount = cost?.amount && cost.amount > 0 ? cost.amount : 1;
          const badge =
            spending && poolKey
              ? `−${amount} ${resourceLabels?.[poolKey] ?? "ресурс"}`
              : null;
          const { title: rowTitle, qualifier } = splitActionName(r.name);
          // Вторая строка подписи: скобочная часть имени, потом круг и
          // дальность у заклинания, уже собранная цена у умения («1 за долгий
          // отдых»), дальность у оружия.
          const meta = [
            qualifier,
            r.source?.kind === "spell"
              ? [`${r.source.level === 0 ? "Заговор" : `${r.source.level} круг`}`, r.range !== "—" ? r.range : ""]
                  .filter(Boolean)
                  .join(" · ")
              : r.range !== "—" && r.range !== ""
                ? r.range
                : "",
          ]
            .filter(Boolean)
            .join(" · ");
          const pinned = pinnedNames?.includes(r.name) ?? false;
          const icon = actionIcon(r);
          return (
            <div
              key={i}
              className={`dnd-action-card${spending ? " is-spending" : ""}`}
              style={spending && color ? { borderLeftColor: color } : undefined}
              role={onOpen ? "button" : undefined}
              tabIndex={onOpen ? 0 : undefined}
              aria-label={onOpen ? `${r.name} — открыть описание` : undefined}
              onClick={onOpen ? () => onOpen(r) : undefined}
              onKeyDown={
                onOpen
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(r);
                      }
                    }
                  : undefined
              }
            >
              {/* Значок типа строки, он же закладка на первую карту. Мишень
                  своя: щелчок по строке открывает описание, и закрепление
                  по промаху было бы худшим из двух исходов. Залитый значок =
                  строка на карте, всё равно, руками её туда отправили или
                  лист сам. */}
              <button
                type="button"
                className={`dnd-action-chip${pinned ? " is-on" : ""}`}
                disabled={!onPin}
                title={
                  onPin
                    ? `${ACTION_ICON_TITLES[icon]} · ${pinned ? "убрать с карты" : "вынести на карту"}`
                    : ACTION_ICON_TITLES[icon]
                }
                aria-pressed={onPin ? pinned : undefined}
                aria-label={
                  onPin
                    ? `${r.name} — ${pinned ? "убрать с карты" : "вынести на карту"}`
                    : `${r.name} — ${ACTION_ICON_TITLES[icon]}`
                }
                style={pinned && color ? { background: color, borderColor: color, color: textOnClassColor(color) } : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onPin?.(r);
                }}
              >
                <NavIcon name={icon} />
              </button>
              <span className="dnd-action-main">
                <span className="dnd-action-name">{rowTitle}</span>
                {r.description !== undefined ? (
                  <span className="dnd-action-meta">
                    <MentionText text={r.description} />
                  </span>
                ) : (
                  meta && <span className="dnd-action-meta">{meta}</span>
                )}
              </span>
              {/* Две клетки постоянной ширины: сверху то, чем платишь (СЛ,
                  бонус атаки или цена пула), снизу то, что выходит (урон или
                  эффект). Пустая клетка остаётся пустой и держит место. */}
              {r.description === undefined && (
                <span className="dnd-action-nums">
                  <span className="dnd-action-bonus">
                    {badge ? (
                      <span
                        className="dnd-action-cost"
                        title={badge}
                        style={color ? { background: color, color: textOnClassColor(color) } : undefined}
                      >
                        {badge}
                      </span>
                    ) : (
                      r.bonus
                    )}
                  </span>
                  <span className="dnd-action-damage">{r.damage && r.damage !== "—" ? r.damage : ""}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SpendAction({
  row,
  value,
  slots,
  pact,
  resources,
  characterId,
  onQuickUpdate,
  onDone,
}: {
  row: AttackRow;
  value: DndCharacterData;
  slots: number[];
  /** Договор магии колдуна: отдельная дорожка, в slots её нет вовсе. */
  pact: { count: number; circle: number } | null;
  resources: DndResourceDef[];
  /** Id персонажа — для сигнала мастеру (метка/сглаз). Без него кнопок нет. */
  characterId?: number | null;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onDone: () => void;
}) {
  const [onOther, setOnOther] = useState(false);
  if (row.source?.kind === "spell") {
    const level = row.source.level;
    const castSpell = row.source.spell;
    const toggle = <ActiveSpellToggle spell={castSpell} value={value} free={level === 0} onQuickUpdate={onQuickUpdate} />;
    // Меняет числа и накладывается не только на себя — спросить, на кого.
    const changesNumbers = spellChangesSheet(castSpell);
    const targetPick = changesNumbers && !/на себя|личн/i.test(castSpell.range ?? "") && (
      <div className="row" role="group" aria-label="На кого" style={{ gap: 6 }}>
        <button type="button" className="comp-mini" aria-pressed={!onOther} onClick={() => setOnOther(false)}>
          На себя
        </button>
        <button type="button" className="comp-mini" aria-pressed={onOther} onClick={() => setOnOther(true)}>
          На другого
        </button>
      </div>
    );
    if (level === 0)
      return (
        <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
          <span className="muted">Заговор — тратить нечего.</span>
          {toggle}
        </div>
      );
    // Арканум колдуна (тикет 03 warlock): ячейки нет, есть 1 использование
    // на долгий отдых — трек тот же (пипсы круга), подпись честная.
    const isArcanum = row.source.spell.arcanum === true;
    // Договор магии колдуна в slots не входит вовсе (своя дорожка, свой
    // счётчик, возврат коротким отдыхом). Для траты он равен ячейке круга
    // pact.circle: колдун всегда кастует своим кругом. У чистого колдуна
    // это единственный источник — без этой ветки лист говорил «свободных
    // ячеек нет» при полном треке договора.
    const pactUsed = value.pactSlotsUsed ?? 0;
    const pactFree = pact != null && pact.count > pactUsed && pact.circle >= level;
    // Ищем ближайший круг с непотраченной ячейкой, начиная со своего.
    let use = -1;
    for (let i = level - 1; i < slots.length; i++) {
      if ((slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) {
        use = i;
        break;
      }
    }
    // Основная кнопка — самый дешёвый круг; при равном круге выигрывает
    // договор (возвращается коротким отдыхом, а обычная ячейка — долгим).
    const usePact = pactFree && (use < 0 || pact!.circle <= use + 1);
    if (use < 0 && !pactFree)
      return (
        <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
        <span className="muted">
          {isArcanum
            ? "Арканум уже использован — вернётся долгим отдыхом."
            : pact != null && pact.circle >= level && !slots.some((n, i) => i >= level - 1 && n > 0)
              ? // Чистый колдун: обычных ячеек у него нет вовсе, и говорить
                // про их круги бессмысленно — кончился именно договор. У
                // мультикласса ячейки есть, и там честнее общая формулировка.
                "Ячейки договора кончились — вернутся коротким отдыхом."
              : `Свободных ячеек ${level} круга и выше нет.`}
        </span>
        {toggle}
        </div>
      );
    // Вниз кастовать нельзя (только вверх), поэтому другие круги — тоже
    // от своего и выше. Основная кнопка — ближайший свободный (обычный
    // случай за столом), остальные — мелкими: выбор круга не должен стоить
    // второго окна. Усиление от высокого круга лист пока не считает —
    // см. «на будущее» в Charnik_dodelat.md.
    const spend = (circle: number) => {
      const next = value.spellSlotsUsed.slice();
      next[circle] = (next[circle] ?? 0) + 1;
      onQuickUpdate({ spellSlotsUsed: next, ...spellActivationPatch(castSpell, value, onOther) });
      onDone();
    };
    const spendPact = () => {
      onQuickUpdate({ pactSlotsUsed: pactUsed + 1, ...spellActivationPatch(castSpell, value, onOther) });
      onDone();
    };
    const spendPrimary = () => (usePact ? spendPact() : spend(use));
    const others: number[] = [];
    for (let i = level - 1; i < slots.length; i++) {
      if ((usePact || i !== use) && (slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) others.push(i);
    }
    // Договор во втором ряду — когда основной кнопкой стала обычная ячейка.
    const pactOther = pactFree && !usePact;
    // Сигнал мастеру о метке/сглазе (и «вешаю», и «перевешиваю»): стол
    // устный, а кнопка — фиксация. Тихо при офлайне: игра идёт словами.
    const notifyMark = (spell: string, mode: "spend" | "move") => {
      if (characterId == null) return;
      write
        .post(`/player/characters/${characterId}/mark`, { spell, mode })
        // Метка кладёт напоминалку кампании и отмечает цель в очереди — то же,
        // что задевает событие hunter-mark (data/syncAffects.ts).
        .then(() => afterWriteAnywhere([{ path: "/campaigns" }, { path: "/players" }, { path: "/initiative-entries" }]))
        .catch(() => {
          /* офлайн — мастер услышал вслух */
        });
    };
    const markSpell =
      row.source.spell.name && MARK_SPELLS.includes(row.source.spell.name)
        ? row.source.spell.name
        : null;
    // Пул бесплатных использований — только у Метки (Избранный враг
    // следопыта): трата идёт из него, пока есть остаток, иначе — ячейка.
    const markPool =
      markSpell === "Метка охотника"
        ? resources.find((r) => r.label === "Избранный враг")
        : undefined;
    const markPoolLeft = markPool
      ? markPool.max + (value.resourceBonus[markPool.key] ?? 0) - (value.resourceUsed[markPool.key] ?? 0)
      : 0;
    const hangMark = (mode: "spend" | "move") => {
      if (!markSpell) return;
      if (mode === "spend") {
        if (markPool && markPoolLeft > 0) {
          onQuickUpdate({
            resourceUsed: { ...value.resourceUsed, [markPool.key]: (value.resourceUsed[markPool.key] ?? 0) + 1 },
            concentration: markSpell,
          });
        } else {
          spendPrimary();
          onQuickUpdate({ concentration: markSpell });
        }
      } else {
        onQuickUpdate({ concentration: markSpell });
      }
      notifyMark(markSpell, mode);
      // Окно закрывает spend() сам в ветке ячейки; в остальных — здесь.
      if (!(mode === "spend" && !(markPool && markPoolLeft > 0))) onDone();
    };
    return (
      <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
        {targetPick}
        <button
          type="button"
          className="primary"
          style={{ alignSelf: "flex-start" }}
          onClick={spendPrimary}
        >
          {isArcanum
            ? "Использовать арканум"
            : usePact
              ? `Потратить ячейку договора (${pact!.circle} круг)`
              : `Потратить ячейку ${use + 1} круга`}
        </button>
        {toggle}
        {markSpell && characterId != null && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="comp-mini"
              title="Первое наложение: трата использования или ячейки, мастеру уйдёт уведомление"
              onClick={() => hangMark("spend")}
            >
              Вешаю{markPool && markPoolLeft > 0 ? " (из Избранного врага)" : ""} — заявить столу
            </button>
            <button
              type="button"
              className="comp-mini"
              title="Цель упала — переношу метку бонусным действием, без траты"
              onClick={() => hangMark("move")}
            >
              Перевесить — заявить столу
            </button>
          </div>
        )}
        {(others.length > 0 || pactOther) && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">другой круг:</span>
            {others.map((i) => (
              <button key={i} type="button" className="comp-mini" onClick={() => spend(i)}>
                {i + 1}й
              </button>
            ))}
            {pactOther && (
              <button type="button" className="comp-mini" onClick={spendPact}>
                договор ({pact!.circle}й)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  const feature = row.source?.kind === "feature" ? row.source.feature : undefined;
  const cost = feature?.cost;
  // Ключ пула: классовый — по resourceKey, свой — по записи умения
  // (featurePools). Третий путь — по названию: у классовых пулов в ключ
  // зашит id записи класса, и из справочника на них ссылаются названием
  // («Очки чародейства»). Дублироваться им не с чего: пул классовый.
  // Без флага uses остаётся текстом: механики нет.
  const poolKey =
    cost?.kind === "resource"
      ? (cost.resourceKey ?? null)
      : cost?.kind === "uses" && cost.ownResource && typeof feature?.entryId === "number"
        ? featurePoolKey(feature.entryId)
        : null;
  if (!cost) return null;
  const blocks: ReactNode[] = [];
  // 1) Трата из пула — как было. Кнопки может не быть (пул неизвестен или
  // пуст), а слотовая ниже — быть: источники независимы.
  const res =
    poolKey != null
      ? resources.find((r) => r.key === poolKey)
      : cost.kind === "resource" && cost.resourceLabel
        ? resources.find((r) => r.label.toLowerCase() === cost.resourceLabel!.toLowerCase())
        : undefined;
  // Состояние пула считаем один раз: нужно и кнопке траты, и возврату ячейки
  // (поглощение идёт в счёт пула 1/долгий — без заряда только плашка).
  const bonus = res ? (value.resourceBonus[res.key] ?? 0) : 0;
  const max = res ? res.max + bonus : 0;
  const used = res ? (value.resourceUsed[res.key] ?? 0) : 0;
  // uses-пул: amount — размер запаса («2 за долгий отдых»), а не цена нажатия.
  // Одно применение = один заряд (Врождённое чародейство и пр.). У resource
  // наоборот: amount — цена одного применения в очках (Бастион закона ×5).
  const amount = cost.kind === "uses" ? 1 : cost.amount && cost.amount > 0 ? cost.amount : 1;
  const poolDepleted = !!res && used + amount > max;
  if (res) {
    if (poolDepleted) {
      blocks.push(<span key="pool-empty" className="muted">«{res.label}» — не осталось.</span>);
    } else {
      blocks.push(
        <button
          key="pool"
          type="button"
          className="primary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            onQuickUpdate({ resourceUsed: { ...value.resourceUsed, [res.key]: used + amount } });
            onDone();
          }}
        >
          Потратить: {res.label}
          {amount > 1 ? ` ×${amount}` : ""}
        </button>
      );
    }
  }
  // 2.5) Возврат потраченной ячейки (поглощение реплики). Круги, в которых
  // есть потраченные, — кнопками; пусто — плашкой. Редкость развеянного
  // (обычный→1, необычный/редкий→2) — на честности игрока: лист видит
  // только ячейки, а какой предмет развеян — выбирается руками в инвентаре.
  // Возврат идёт в счёт пула одним нажатием (лимит 1/долгий): без заряда
  // поглощать нечего, плашка «не осталось» уже показана веткой пула выше.
  if (cost.slotReturn && !poolDepleted) {
    const spent: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if ((value.spellSlotsUsed[i] ?? 0) > 0) spent.push(i);
    }
    if (spent.length === 0) {
      blocks.push(<span key="slotback-empty" className="muted">Потраченных ячеек нет.</span>);
    } else {
      const unspend = (circle: number) => {
        const next = value.spellSlotsUsed.slice();
        next[circle] = Math.max(0, (next[circle] ?? 0) - 1);
        onQuickUpdate({
          spellSlotsUsed: next,
          // Пул тоже тратим (если он есть): поглощение — одно действие целиком.
          ...(res ? { resourceUsed: { ...value.resourceUsed, [res.key]: used + amount } } : {}),
        });
        onDone();
      };
      blocks.push(
        <div key="slotback" className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
          <span className="muted">Вернуть ячейку (развейте предмет в инвентаре):</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {spent.map((i) => (
              <button key={i} type="button" className="comp-mini" onClick={() => unspend(i)}>
                {i + 1}й круг
              </button>
            ))}
          </div>
        </div>
      );
    }
  }
  // 2) Активация тратой ячейки (пушка/эликсир/защитник: повторное создание
  // за слот). Круг не важен — берём самую дешёвую свободную, остальные
  // мелкими, тем же рядом, что у заклинаний.
  if (cost.slotSpend) {
    let first = -1;
    const rest: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if ((slots[i] ?? 0) > (value.spellSlotsUsed[i] ?? 0)) {
        if (first < 0) first = i;
        else rest.push(i);
      }
    }
    // Договор магии тут тоже годится: для умения важно, что ячейка есть, а
    // не какого она круга. Кнопкой он идёт последним — круг у него высокий.
    const pactUsed = value.pactSlotsUsed ?? 0;
    const pactFree = pact != null && pact.count > pactUsed;
    const spendPact = () => {
      onQuickUpdate({ pactSlotsUsed: pactUsed + 1 });
      onDone();
    };
    if (first < 0 && pactFree) {
      blocks.push(
        <button
          key="slot-pact"
          type="button"
          style={{ alignSelf: "flex-start" }}
          onClick={spendPact}
        >
          Потратить ячейку договора ({pact!.circle} круг)
        </button>
      );
    } else if (first < 0) {
      blocks.push(<span key="slot-empty" className="muted">Свободных ячеек нет.</span>);
    } else {
      const spendSlot = (circle: number) => {
        const next = value.spellSlotsUsed.slice();
        next[circle] = (next[circle] ?? 0) + 1;
        onQuickUpdate({ spellSlotsUsed: next });
        onDone();
      };
      blocks.push(
        <div key="slot" className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
          <button type="button" style={{ alignSelf: "flex-start" }} onClick={() => spendSlot(first)}>
            Потратить ячейку {first + 1} круга
          </button>
          {(rest.length > 0 || pactFree) && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted">другой круг:</span>
              {rest.map((i) => (
                <button key={i} type="button" className="comp-mini" onClick={() => spendSlot(i)}>
                  {i + 1}й
                </button>
              ))}
              {pactFree && (
                <button type="button" className="comp-mini" onClick={spendPact}>
                  договор ({pact!.circle}й)
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
  }
  if (blocks.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>
      {blocks}
    </div>
  );
}

// Окно строки «Действий» без источника: оружие и вписанные руками атаки
// (владелец 2026-09-26: описание должно читаться у всех действий). Оружие —
// числа строки, описание записи снаряжения, приём и свойства с описаниями
// из групп механик (связь по имени без [англ.], как в визарде).
export function ActionInfoModal({ row, systemId, onClose }: { row: AttackRow; systemId: number | null; onClose: () => void }) {
  const getEntry = useCompendiumEntries([row.entryId]);
  const entry = getEntry(row.entryId);
  const [mech, setMech] = useState<{ mastery: CompendiumEntry[]; props: CompendiumEntry[] } | null>(null);
  useEffect(() => {
    if (!systemId || row.entryId == null) return;
    const ac = new AbortController();
    Promise.all([
      loadDndMechanicsGroupEntries(systemId, "Мастерство оружия", { signal: ac.signal }),
      loadDndMechanicsGroupEntries(systemId, "Свойства оружия", { signal: ac.signal }),
    ])
      .then(([mastery, props]) => setMech({ mastery, props }))
      .catch(() => undefined);
    return () => ac.abort();
  }, [systemId, row.entryId]);
  const bare = (x: string) => x.replace(/\s*\[.*\]$/, "");
  const masteryName = entry ? bare(weaponMasteryName(entry)) : "";
  const mastery = mech?.mastery.find((m) => m.name === masteryName);
  const props = (Array.isArray(entry?.data.weapon_properties) ? (entry.data.weapon_properties as unknown[]) : [])
    .map((x) => x as { name?: unknown; distance?: unknown })
    .map((x) => ({
      name: typeof x?.name === "string" ? bare(x.name) : "",
      distance: typeof x?.distance === "string" ? x.distance : "",
    }))
    .filter((x) => x.name);
  const { ru, en } = spellNameParts({ name: row.name, nameOriginal: entry?.name_original });
  // Урон строки — «1к8 +3 · Свойства · Мастерство: … · источники»: по пункту
  // в строку, первым — урон.
  const lines = [row.bonus && row.bonus !== "—" ? `Атака ${row.bonus}` : "", row.range, ...(row.damage || "").split(" · ")].filter(
    (x) => x && x !== "—"
  );
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="dnd-spell-modal-title">
            <h3 style={{ margin: 0 }}>{ru}</h3>
            {en && <div className="dnd-spell-modal-en">{en}</div>}
          </div>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>
        {lines.length > 0 && (
          <div className="stack" style={{ gap: 2 }}>
            {lines.map((l, i) => (
              <span key={i} className={i === 0 ? undefined : "muted"}>
                {l}
              </span>
            ))}
          </div>
        )}
        {entry?.description?.trim() ? <MentionText text={entry.description} /> : null}
        {row.description?.trim() ? <MentionText text={row.description} /> : null}
        {masteryName && (
          <div className="stack" style={{ gap: 4 }}>
            <strong>Приём: {masteryName}</strong>
            {mastery?.description?.trim() ? <MentionText text={mastery.description} /> : null}
          </div>
        )}
        {props.map((pr) => {
          const d = mech?.props.find((m) => m.name === pr.name)?.description?.trim();
          return (
            <div key={pr.name} className="stack" style={{ gap: 4 }}>
              <strong>
                Свойство: {pr.name}
                {pr.distance ? ` (${pr.distance})` : ""}
              </strong>
              {d ? <MentionText text={d} /> : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Скорость для кости: число и единица порознь.
 *
 * В шестиугольник «30 фт.» одной строкой не влезает и читается хуже соседних
 * КЗ и хитов — а ряд костей держится именно на том, что все четыре числа
 * одного размера. Единицу берём из той же formatDistance, а не собираем
 * заново: настройка «футы/клетки» одна на приложение, и второе место, где
 * она пишется руками, разъехалось бы с первым.
 */
export function walkDieParts(
  speeds: DndCreatureSpeed,
  exhaustion: number,
  unit: DndDistanceUnit,
  // Движение без доспехов монаха — прибавка к базе ходьбы. Ноль по умолчанию:
  // у существ и немонахов кости без бонуса, как было.
  bonus = 0
): { value: string; sub: string } {
  if (speeds.walk === null) return { value: "—", sub: "" };
  const penalty = Math.max(0, exhaustion) * 5;
  const reduced = Math.max(0, speeds.walk + Math.max(0, bonus) - penalty);
  const split = (feet: number) => {
    const text = formatDistance(feet, unit);
    const i = text.lastIndexOf(" ");
    return i < 0 ? { value: text, sub: "" } : { value: text.slice(0, i), sub: text.slice(i + 1) };
  };
  // Прежняя скорость зачёркнутым рядом больше не печатается: строка
  // появлялась и исчезала вместе с истощением и дёргала весь ряд. Насколько
  // отняли, говорит пометка над именем.
  return split(reduced);
}

/**
 * Лента пулов сверху «Действий» (этап 5, вид — по канвасу Actions): чёрная
 * плашка-инверсия. Пипсы — головы тофу (съеденные блеклые), «3 из 5»
 * читается как «осталось», это боевое число. Ячейки — текстом, трата
 * остаётся в окнах строк. Показывается только то, что тратит хоть одна
 * строка этой карты; пусто — компоненты нет вовсе.
 */
export function DndActionPools({
  actionRows,
  resourceSources,
  abilities,
  resourceUsed,
  resourceBonus,
  shownSlotPips,
  spellSlotsUsed,
  pact,
  pactUsed,
  ownPools,
  onQuickUpdate,
}: {
  actionRows: AttackRow[];
  resourceSources: ClassResourceSource[];
  abilities: DndCharacterData["abilities"];
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  shownSlotPips: number[];
  spellSlotsUsed: number[];
  pact: { count: number; circle: number } | null;
  pactUsed: number;
  /** Свои пулы умений — в ту же ленту, что классовые. */
  ownPools: DndResourceDef[];
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  // Боевые заклинания — строки-заклинания кругов ≥1. Заговоры ячеек не
  // тратят, и ради них ленту не поднимаем.
  const hasCombatSpells = actionRows.some((r) => r.source?.kind === "spell" && r.source.level > 0);
  // Пулы, задетые стоимостями строк. Ключ — тот же, по которому окно строки
  // ищет свой пул для кнопки «Потратить»: классовый по resourceKey, свой —
  // по записи умения.
  const spentKeys = new Set(
    actionRows.flatMap((r) => {
      if (r.source?.kind !== "feature") return [];
      const cost = r.source.feature.cost;
      if (cost?.kind === "resource" && cost.resourceKey) return [cost.resourceKey];
      if (cost?.kind === "uses" && cost.ownResource && typeof r.source.feature.entryId === "number") {
        return [featurePoolKey(r.source.feature.entryId)];
      }
      return [];
    })
  );
  const pools = [...allResources(resourceSources, abilities), ...ownPools].filter(
    (r) => spentKeys.has(r.key) && r.max + (resourceBonus[r.key] ?? 0) > 0
  );
  const slotLeft = shownSlotPips.map((max, i) => max - (spellSlotsUsed[i] ?? 0));
  const showSlots = hasCombatSpells && shownSlotPips.some((max) => max > 0);
  const showPact = hasCombatSpells && pact != null && pact.count > 0;
  // Класс подписываем только многоклассовым — как на «Ресурсах».
  const showClass = showClassSuffix(resourceSources);
  if (!showSlots && !showPact && pools.length === 0) return null;
  return (
    <div className="dnd-pool-band" role="status" aria-label="Остаток боевых ресурсов">
      {showSlots && (
        <span className="dnd-pool-slots">
          <span className="dnd-pool-band-label">Ячейки</span>{" "}
          {shownSlotPips.map((max, i) =>
            max > 0 ? (
              // Ячейки — теми же тофу, что пулы и круги на «Магии» (владелец
              // 2026-09-26): одна система трат на весь лист.
              <span key={i} className="dnd-pool-slot">
                <span aria-hidden="true">{i + 1} круг</span>
                <PoolMeter
                  max={max}
                  left={Math.max(0, slotLeft[i])}
                  label={`Ячейки ${i + 1} круга`}
                  onSetLeft={
                    onQuickUpdate
                      ? (next) => {
                          const used = spellSlotsUsed.slice();
                          used[i] = max - next;
                          onQuickUpdate({ spellSlotsUsed: used });
                        }
                      : undefined
                  }
                />
              </span>
            ) : null
          )}
        </span>
      )}
      {showPact && pact != null && (
        <span className="dnd-pool-slots">
          <span className="dnd-pool-band-label">Договор</span>{" "}
          <span className="dnd-pool-slot">
            {pact.circle} круг ×{Math.max(0, pact.count - pactUsed)}
          </span>
        </span>
      )}
      {pools.map((r) => {
        const max = r.max + (resourceBonus[r.key] ?? 0);
        const used = Math.min(resourceUsed[r.key] ?? 0, max);
        const left = max - used;
        return (
          <span key={r.key} className="dnd-pool-resource">
            {/* Имя и под ним мелко «[длинный отдых]» (владелец 2026-09-26):
                на телефоне два этажа слева, счётчик ровной колонкой справа. */}
            <span className="dnd-pool-band-name">
              <span className="dnd-pool-band-label">
                {r.label}
                {showClass && <span className="dnd-pool-band-muted"> · {r.className}</span>}
              </span>
              <span className="dnd-pool-band-muted dnd-pool-band-recharge">
                [{PROGRESSION_RECHARGE_LABELS[r.recharge].toLowerCase()}]
              </span>
            </span>
            <PoolMeter
              max={max}
              left={left}
              label={r.label}
              onSetLeft={onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined}
            />
            {!poolShowsNumber(max) && (
              <span className="dnd-pool-count">
                {left} из {max}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
