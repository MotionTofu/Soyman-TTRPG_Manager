import { useEffect, useMemo, useState } from "react";
import type {
  CompendiumEntry,
  DndAbilityKey,
  DndAbilityScores,
  DndCharacterData,
  DndFeature,
  DndSkillProfLevel,
  DndSpellEntry,
} from "../../types";
import type { DndEffect } from "./effects";
import type { SourceGrants } from "./dndGrants";
import type { SkillRow } from "./useDndSkills";

/**
 * Выбор при взятии черты (гриллинг черт 2026-09-24): +1 к характеристике,
 * список и характеристика заклинаний, сопротивление, навыки, компетентность,
 * инструменты, приём оружия, заклинания.
 *
 * Один блок на три места — визард (черта происхождения), повышение уровня
 * (шаг «Черта») и окно на листе, когда черту добавили руками. Разбор выдач —
 * `dndGrants.ts`; здесь только выбор и запись в лист.
 */

export interface FeatPick {
  ability?: DndAbilityKey;
  spellList?: number;
  spellAbility?: DndAbilityKey;
  resistances: string[];
  skills: string[];
  skillOrExpertise: string[];
  expertise: string[];
  tools: number[];
  mastery: number[];
  /** Индекс выбора в `grants.spellChoices` → id заклинаний. */
  spells: Record<number, number[]>;
}

export const EMPTY_FEAT_PICK: FeatPick = {
  resistances: [],
  skills: [],
  skillOrExpertise: [],
  expertise: [],
  tools: [],
  mastery: [],
  spells: {},
};

export interface FeatCtx {
  abilities: DndAbilityScores;
  saves: Record<DndAbilityKey, boolean>;
  skills: Record<string, DndSkillProfLevel>;
  pb: number;
  /** Списки, уже взятые другими «Посвящёнными» — второй не берёт тот же (Q5). */
  takenLists: number[];
  /** Выбор черты, у которой «Знаток магии» берёт список и характеристику. */
  listSource?: { spellList?: number; spellAbility?: DndAbilityKey };
  knownSpellIds: number[];
  masteredNames: string[];
  profNames: string[];
}

/** Части выбора. Визард показывает навыки, инструменты и заклинания своими
 *  шагами, поэтому просит только остальное. */
export type FeatPart = "ability" | "spellList" | "spellAbility" | "resist" | "skills" | "tools" | "mastery" | "spells";
export const ALL_PARTS: FeatPart[] = ["ability", "spellList", "spellAbility", "resist", "skills", "tools", "mastery", "spells"];

const MENTAL: DndAbilityKey[] = ["int", "wis", "cha"];

/** Сопротивление на выбор — эффект записи черты. */
export function resistanceChoice(entry: CompendiumEntry | null | undefined): { options: string[]; count: number } | null {
  const effects = (entry?.data.effects as DndEffect[] | undefined) ?? [];
  const e = effects.find((x) => x.type === "resistance" && x.options?.length);
  return e ? { options: e.options!.map((o) => o.name), count: e.count ?? 1 } : null;
}

/** Выбор нужен? — у черты есть что выбирать (Q9: «не выбрано» на листе). */
export function featNeedsChoice(entry: CompendiumEntry | null | undefined, g: SourceGrants): boolean {
  return (
    !!g.abilityIncrease ||
    g.spellListChoice.length > 0 ||
    g.spellAbilityChoice ||
    !!resistanceChoice(entry) ||
    !!g.skillChoice ||
    !!g.skillOrExpertise ||
    g.expertiseChoice > 0 ||
    !!g.toolChoice ||
    g.masteryChoice > 0 ||
    g.spellChoices.length > 0
  );
}

export function featSpellList(g: SourceGrants, pick: FeatPick, ctx: FeatCtx): number | undefined {
  if (g.spellListChoice.length) return pick.spellList;
  if (g.spellListFrom != null) return ctx.listSource?.spellList;
  return undefined;
}

export function featSpellAbility(g: SourceGrants, pick: FeatPick, ctx: FeatCtx): DndAbilityKey | undefined {
  if (g.spellAbilityFromIncrease) return pick.ability;
  if (g.spellAbilityChoice) return pick.spellAbility;
  if (g.spellListFrom != null) return ctx.listSource?.spellAbility;
  return undefined;
}

export function spellChoiceCount(c: SourceGrants["spellChoices"][number], ctx: FeatCtx): number {
  return c.countFromPb ? ctx.pb : c.count;
}

/** Самая высокая из Инт/Мдр/Хар — умолчание выбора характеристики (Q2). */
export function bestMental(abilities: DndAbilityScores): DndAbilityKey {
  return MENTAL.reduce((best, k) => ((abilities[k] ?? 10) > (abilities[best] ?? 10) ? k : best), "int" as DndAbilityKey);
}

export function defaultFeatPick(g: SourceGrants, ctx: FeatCtx): FeatPick {
  return { ...EMPTY_FEAT_PICK, ...(g.spellAbilityChoice ? { spellAbility: bestMental(ctx.abilities) } : {}) };
}

export function featPickMissing(
  entry: CompendiumEntry | null | undefined,
  g: SourceGrants,
  pick: FeatPick,
  ctx: FeatCtx,
  parts: FeatPart[] = ALL_PARTS
): string[] {
  const out: string[] = [];
  const has = (p: FeatPart) => parts.includes(p);
  if (has("ability") && g.abilityIncrease && !pick.ability) out.push(g.saveFromAbility ? "+1 и спасбросок" : "+1 к характеристике");
  if (has("spellList") && g.spellListChoice.length && !pick.spellList) out.push("список заклинаний");
  if (has("spellAbility") && g.spellAbilityChoice && !pick.spellAbility) out.push("заклинательная характеристика");
  const rc = resistanceChoice(entry);
  if (has("resist") && rc && pick.resistances.length < rc.count) out.push("сопротивление");
  if (has("skills")) {
    if (g.skillChoice && pick.skills.length < g.skillChoice.count) out.push("навыки");
    if (g.skillOrExpertise && pick.skillOrExpertise.length < g.skillOrExpertise.count) out.push("навык");
    if (g.expertiseChoice > 0 && pick.expertise.length < g.expertiseChoice) out.push("компетентность");
  }
  if (has("tools") && g.toolChoice && pick.tools.length < g.toolChoice.count) out.push("инструменты");
  if (has("mastery") && g.masteryChoice > 0 && pick.mastery.length < g.masteryChoice) out.push("приём оружия");
  if (has("spells")) {
    g.spellChoices.forEach((c, i) => {
      if ((pick.spells[i] ?? []).length < spellChoiceCount(c, ctx)) out.push(c.level === 0 ? "заговоры" : "заклинания");
    });
  }
  // Список «Знатока магии» берётся у «Посвящённого» — без него выбирать не из чего.
  if (g.spellListFrom != null && !ctx.listSource?.spellList) out.push("нужна черта «Посвящённый в магию» с выбранным списком");
  return [...new Set(out)];
}

/** Заклинания-кандидаты одного выбора. */
export function spellCandidates(
  spellIndex: CompendiumEntry[],
  c: SourceGrants["spellChoices"][number],
  classIds: number[]
): CompendiumEntry[] {
  return spellIndex.filter((e) => {
    if ((e.level ?? 0) !== (c.level ?? e.level ?? 0)) return false;
    if (c.ritual && !e.data.ritual) return false;
    if (c.names?.length && !c.names.some((n) => n === e.name || n === e.name_original)) return false;
    if (classIds.length) {
      const lists = Array.isArray(e.data.classes) ? (e.data.classes as { id?: number }[]) : [];
      if (!lists.some((x) => x.id != null && classIds.includes(x.id))) return false;
    }
    if (c.schools.length) {
      const school = (e.data.school as { name?: string } | undefined)?.name ?? "";
      if (!c.schools.includes(school)) return false;
    }
    return true;
  });
}

export function choiceClassIds(c: SourceGrants["spellChoices"][number], g: SourceGrants, pick: FeatPick, ctx: FeatCtx): number[] {
  const list = featSpellList(g, pick, ctx);
  return list != null ? [list] : c.classIds;
}

/** Контекст выбора по листу. `except` — черта, которую сейчас выбирают. */
export function featCtxFrom(
  value: DndCharacterData,
  pb: number,
  featEntryId: number,
  opts: { except?: DndFeature; listSourceId?: number | null } = {}
): FeatCtx {
  const { except, listSourceId } = opts;
  const others = value.feats.filter((f) => f !== except);
  const source = listSourceId != null ? others.find((f) => f.entryId === listSourceId) : undefined;
  return {
    abilities: value.abilities,
    saves: value.savingThrowProfs,
    skills: value.skillProfs,
    pb,
    takenLists: others
      .filter((f) => f.entryId === featEntryId)
      .map((f) => f.choices?.spellList)
      .filter((x): x is number => x != null),
    listSource: source?.choices,
    knownSpellIds: [...value.cantrips, ...value.spellsByLevel.flat()]
      .map((s) => s.entryId)
      .filter((x): x is number => x != null),
    masteredNames: value.masteredWeapons.map((w) => w.name),
    profNames: value.proficiencies.map((p) => p.name),
  };
}

/**
 * Записать выбор в лист: характеристика, спасбросок, навыки, владения,
 * приём, заклинания и сама черта с `choices`. Выданные готовые заклинания
 * черты (`granted_spells`) приходят отдельно — пересчётом
 * `recomputeGrantedSpells` у вызывающего.
 */
export function applyFeatPick(
  value: DndCharacterData,
  entry: CompendiumEntry,
  g: SourceGrants,
  pick: FeatPick,
  ctx: FeatCtx,
  catalogs: { spellIndex: CompendiumEntry[]; tools: CompendiumEntry[]; weapons: CompendiumEntry[]; skills: SkillRow[] },
  opts: { replace?: DndFeature } = {}
): DndCharacterData {
  const next: DndCharacterData = {
    ...value,
    abilities: { ...value.abilities },
    savingThrowProfs: { ...value.savingThrowProfs },
    skillProfs: { ...value.skillProfs },
    proficiencies: [...value.proficiencies],
    masteredWeapons: [...value.masteredWeapons],
    cantrips: [...value.cantrips],
    spellsByLevel: value.spellsByLevel.map((l) => [...l]),
  };
  if (g.abilityIncrease && pick.ability) {
    const k = pick.ability;
    next.abilities[k] = Math.min(g.abilityIncrease.max, (next.abilities[k] ?? 10) + g.abilityIncrease.amount);
    if (g.saveFromAbility) next.savingThrowProfs[k] = true;
  }
  const prof = (key: string) => {
    if ((next.skillProfs[key] ?? 0) < 1) next.skillProfs[key] = 1;
  };
  if (g.allSkills) for (const r of catalogs.skills) prof(r.original);
  for (const k of pick.skills) prof(k);
  for (const k of pick.skillOrExpertise) next.skillProfs[k] = (value.skillProfs[k] ?? 0) >= 1 ? 2 : 1;
  for (const k of pick.expertise) next.skillProfs[k] = 2;

  const addProf = (id: number | null, name: string) => {
    if (name && !next.proficiencies.some((p) => p.name === name)) next.proficiencies.push({ entryId: id, name, abilityKey: null });
  };
  for (const a of g.armorProfs) addProf(a.id, a.name);
  for (const w of g.weaponProfs) addProf(w.id, w.name);
  g.toolIds.forEach((id, i) => addProf(id, g.toolNames[i] ?? ""));
  for (const id of pick.tools) {
    const t = catalogs.tools.find((e) => e.id === id);
    if (t) addProf(t.id, t.name);
  }
  for (const id of pick.mastery) {
    const w = catalogs.weapons.find((e) => e.id === id);
    if (w && !next.masteredWeapons.some((m) => m.name === w.name)) next.masteredWeapons.push({ entryId: w.id, name: w.name });
  }

  const ability = featSpellAbility(g, pick, ctx);
  g.spellChoices.forEach((c, i) => {
    for (const id of pick.spells[i] ?? []) {
      const e = catalogs.spellIndex.find((s) => s.id === id);
      if (!e) continue;
      const rec: DndSpellEntry = {
        entryId: e.id,
        name: e.name,
        prepared: 2,
        outsideLimit: c.outsideLimit,
        ...(c.ability ?? ability ? { ability: c.ability ?? ability } : {}),
        ...(c.freeCast ? { freeCast: true } : {}),
      };
      const lvl = e.level ?? 0;
      if (lvl <= 0) next.cantrips.push(rec);
      else {
        while (next.spellsByLevel.length < lvl) next.spellsByLevel.push([]);
        next.spellsByLevel[lvl - 1].push(rec);
        next.spellSlotLevels = Math.max(next.spellSlotLevels, lvl);
      }
    }
  });

  const choices = {
    ...(pick.ability ? { ability: pick.ability } : {}),
    ...(featSpellList(g, pick, ctx) != null ? { spellList: featSpellList(g, pick, ctx) } : {}),
    ...(ability ? { spellAbility: ability } : {}),
    ...(pick.resistances.length ? { resistances: pick.resistances } : {}),
  };
  const feature: DndFeature = { ...(opts.replace ?? { name: entry.name, description: "" }), entryId: entry.id, choices };
  next.feats = opts.replace ? value.feats.map((f) => (f === opts.replace ? feature : f)) : [...value.feats, feature];
  return next;
}

/** Готовое умолчание и проверка — хук для мест, где выбор живёт в состоянии. */
export function useFeatPick(g: SourceGrants | null, ctx: FeatCtx | null, resetKey: unknown) {
  const [pick, setPick] = useState<FeatPick>(EMPTY_FEAT_PICK);
  useEffect(() => {
    setPick(g && ctx ? defaultFeatPick(g, ctx) : EMPTY_FEAT_PICK);
    // Сброс только при смене черты: g и ctx пересоздаются каждый рендер.
  }, [resetKey]); // oxlint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => [pick, setPick] as const, [pick]);
}

const ABILITY_WORDS: [RegExp, DndAbilityKey][] = [
  [/сил/i, "str"],
  [/ловк/i, "dex"],
  [/(телосл|выносл)/i, "con"],
  [/интел/i, "int"],
  [/мудр/i, "wis"],
  [/харизм/i, "cha"],
];

const ARMOR_WORDS: [RegExp, string][] = [
  [/л[её]гкими доспехами/i, "Лёгкие доспехи"],
  [/средними доспехами/i, "Средние доспехи"],
  [/т[яё]ж[её]лыми доспехами/i, "Тяжёлые доспехи"],
  [/щитами/i, "Щиты"],
];

const normWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я]+/)
    .filter((w) => w.length > 2);

/**
 * Почему черту взять нельзя (Q20) — или null. Разбираются уровень,
 * «Характеристика 13+», владение доспехами, заклинательство и черта-требование.
 * Всё, что не разобрано, не блокирует: промах парсера не должен прятать черту.
 */
export function featPrereqProblem(
  prereq: string | undefined,
  who: {
    level: number;
    abilities: DndAbilityScores;
    profNames: string[];
    casts: boolean;
    featNames: string[];
  }
): string | null {
  const p = (prereq ?? "").trim();
  if (!p) return null;
  const lvl = /(?:уровень\s*(\d+)\s*\+?|(\d+)(?:-?й)?\s*уровень|(\d+)\+\s*уровень)/i.exec(p);
  const need = lvl ? Number(lvl[1] ?? lvl[2] ?? lvl[3]) : 0;
  if (need && who.level < need) return `с ${need} уровня`;

  for (const ab of p.matchAll(/((?:[А-ЯЁа-яё]+(?:\s*,\s*|\s+или\s+))*[А-ЯЁа-яё]+)\s+(\d+)\s*\+/g)) {
    const keys = ABILITY_WORDS.filter(([re]) => re.test(ab[1])).map(([, k]) => k);
    const min = Number(ab[2]);
    if (keys.length && !keys.some((k) => (who.abilities[k] ?? 10) >= min)) {
      return `нужна ${keys.map((k) => ABILITY_SHORT[k]).join(" или ")} ${min}`;
    }
  }
  for (const [re, name] of ARMOR_WORDS) {
    if (re.test(p) && /владени/i.test(p) && !who.profNames.includes(name)) return `нужно владение: ${name.toLowerCase()}`;
  }
  if (/(сотворение заклинаний|использование заклинаний|spellcasting|магия договора)/i.test(p) && !who.casts) {
    return "нужно умение колдовать";
  }
  const feat = /черта\s+«?([^»,.]+?)»?(?:[,.]|$)/i.exec(p);
  if (feat && !/любая/i.test(p)) {
    const want = normWords(feat[1]);
    const ok = who.featNames.some((n) => {
      const have = normWords(n);
      return want.every((w) => have.includes(w));
    });
    if (want.length && !ok) return `нужна черта «${feat[1].trim()}»`;
  }
  return null;
}

const ABILITY_SHORT: Record<DndAbilityKey, string> = { str: "Сил", dex: "Лов", con: "Тел", int: "Инт", wis: "Мдр", cha: "Хар" };

/** Прибавки к хитам из эффектов `hit_points` записей черт: «Крепкий» +2 за
 *  уровень, «Дар стойкости» +40. Одна формула для визарда, повышения уровня
 *  и листа (гриллинг черт 2026-09-24, Q7). */
export function featHitPoints(entries: (CompendiumEntry | null | undefined)[]): { perLevel: number; flat: number } {
  let perLevel = 0;
  let flat = 0;
  for (const e of entries) {
    for (const fx of (e?.data.effects as DndEffect[] | undefined) ?? []) {
      if (fx.type !== "hit_points") continue;
      perLevel += fx.perLevel ?? 0;
      flat += fx.flat ?? 0;
    }
  }
  return { perLevel, flat };
}
