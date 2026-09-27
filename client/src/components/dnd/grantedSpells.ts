// Выданные заклинания (виды, черты, умения): разбор выдач, пересчёт списка листа,
// снимки записей справочника. Без React — зовут и лист, и визарды.
import type { DndSpellEntry, CompendiumEntry, DndAbilityKey, DndCharacterData, DndFeature } from "../../types";
import { spellSchoolName, SPELL_LEVELS } from "./sheetShared";
import { spellTimingFromData } from "./dndFeatures";
import type { DndCheck, DndEffect, DndCost } from "./effects";
import { loadDndSpellIndex } from "./dndCompendium";
import { readResource } from "../../data/imperative";
import { totalCharacterLevel } from "./AbilityScores";
import { type ClassSlotSource, isRoundUpCaster, computeSpellSlots, highestCircle } from "./dndSlots";
import type { ClassProgression } from "./progression";

type DndSpellSnapshot = Pick<
  DndSpellEntry,
  | "nameOriginal"
  | "concentration"
  | "ritual"
  | "school"
  | "castingTime"
  | "castingTiming"
  | "castingTimingOther"
  | "range"
  | "duration"
  | "componentV"
  | "componentS"
  | "componentM"
  | "materialComponent"
  | "checks"
  | "effects"
  | "category"
  | "attackSave"
  | "damage"
  | "healing"
  | "upcast"
>;

export function spellSnapshotFromEntry(entry: CompendiumEntry): DndSpellSnapshot {
  return {
    nameOriginal: entry.name_original?.trim() || undefined,
    concentration: !!entry.data.concentration,
    ritual: !!entry.data.ritual,
    school: spellSchoolName(entry.data.school),
    castingTime: typeof entry.data.casting_time === "string" ? entry.data.casting_time : undefined,
    ...spellTimingFromData(entry.data),
    range: typeof entry.data.range === "string" ? entry.data.range : undefined,
    duration: typeof entry.data.duration === "string" ? entry.data.duration : undefined,
    componentV: !!entry.data.component_v,
    componentS: !!entry.data.component_s,
    componentM: !!entry.data.component_m,
    materialComponent: typeof entry.data.material_component === "string" ? entry.data.material_component : undefined,
    checks: (entry.data.checks as DndCheck[] | undefined) ?? [],
    effects: (entry.data.effects as DndEffect[] | undefined) ?? [],
    category: typeof entry.data.category === "string" ? entry.data.category : undefined,
    attackSave: typeof entry.data.attack_save === "string" ? entry.data.attack_save : undefined,
    damage: typeof entry.data.damage === "string" ? entry.data.damage : undefined,
    healing: typeof entry.data.healing === "string" ? entry.data.healing : undefined,
    upcast: typeof entry.data.upcast === "string" ? entry.data.upcast : undefined,
  };
}

// One pick in a species/subclass's "Обретаемые заклинания" list — grantLevel
// is the character (species) or class (subclass) level at which it's
// obtained, not the spell's own circle/level.
interface GrantedSpellDef {
  id: number;
  name: string;
  /** Английское имя заклинания — запасной ключ, когда `id` не сходится. */
  original: string;
  grantLevel: number;
  /** «Не в счёт лимита» — «Починка» Артефактора и заклинания подкласса. */
  outsideLimit: boolean;
  /** Раз в долгий отдых без ячейки (заклинания черт). */
  freeCast: boolean;
  /** «Адепты»: приходит, когда у персонажа есть ячейки этого круга. */
  slotCircle: number | null;
}

// Имена в списке приезжают из импорта в виде «Лечащее слово [Healing Word]»,
// поэтому оригинал достаётся прямо из имени, даже когда отдельного поля нет.
function splitGrantedName(raw: string): { name: string; original: string } {
  const m = /^(.*?)\s*\[(.+)\]\s*$/.exec(raw ?? "");
  return m ? { name: m[1].trim(), original: m[2].trim() } : { name: (raw ?? "").trim(), original: "" };
}

function parseGrantedSpellDefs(entry: CompendiumEntry): GrantedSpellDef[] {
  const raw = Array.isArray(entry.data.granted_spells)
    ? (entry.data.granted_spells as {
        id: number;
        name: string;
        grantLevel?: number;
        original?: string;
        outsideLimit?: boolean;
        freeCast?: boolean;
        slotCircle?: number;
      }[])
    : [];
  // Заклинания подкласса по правилам 5.5 всегда подготовлены и не занимают
  // мест среди подготовленных, поэтому «вне лимита» здесь — умолчание, а не
  // исключение; снять его можно только явным `outsideLimit: false`.
  return raw.map((s) => {
    const split = splitGrantedName(s.name);
    return {
      id: s.id,
      name: split.name,
      original: (s.original ?? "").trim() || split.original,
      grantLevel: typeof s.grantLevel === "number" && s.grantLevel > 0 ? s.grantLevel : 1,
      outsideLimit: s.outsideLimit !== false,
      freeCast: s.freeCast === true,
      slotCircle: typeof s.slotCircle === "number" && s.slotCircle > 0 ? s.slotCircle : null,
    };
  });
}

// Resolves granted-spell picks to full spell entries (for circle/level + the
// same meta snapshot other spells carry), tagged with sourceParentId +
// always-prepared, ready to slot into cantrips or spellsByLevel[level-1].
//
// `id` — быстрый путь, но не единственный: он не переживает переустановку
// модуля справочника (в базе владельца все 288 ссылок вели в пустоту, и
// подкласс молча не приносил ни одного заклинания). Когда id промахнулся,
// ссылка сводится по `name_original`, как и владения навыками. Индекс
// заклинаний тянется лениво — только если промах случился.
async function fetchGrantedSpells(
  grantedSpells: GrantedSpellDef[],
  sourceParentId: number,
  systemId: number | null,
  ability?: DndAbilityKey
): Promise<{ level: number; entry: DndSpellEntry }[]> {
  const results: { level: number; entry: DndSpellEntry }[] = [];
  let index: Map<string, CompendiumEntry> | null = null;

  async function byName(g: GrantedSpellDef): Promise<CompendiumEntry | undefined> {
    if (!systemId) return undefined;
    if (!index) {
      index = new Map();
      for (const e of await loadDndSpellIndex(systemId)) {
        if (e.name_original) index.set(e.name_original.trim().toLowerCase(), e);
        const key = e.name.trim().toLowerCase();
        if (!index.has(key)) index.set(key, e);
      }
    }
    return (
      (g.original ? index.get(g.original.toLowerCase()) : undefined) ?? index.get(g.name.toLowerCase())
    );
  }

  for (const g of grantedSpells) {
    let full: CompendiumEntry | undefined;
    try {
      full = await readResource<CompendiumEntry>(`/systems/entries/${g.id}`);
    } catch {
      full = undefined;
    }
    if (!full || full.kind !== "spell") full = await byName(g);
    if (!full) continue;
    results.push({
      level: full.level ?? 0,
      entry: {
        entryId: full.id,
        name: full.name,
        prepared: 2,
        sourceParentId,
        outsideLimit: g.outsideLimit,
        ...(g.freeCast ? { freeCast: true } : {}),
        ...(ability ? { ability } : {}),
        ...spellSnapshotFromEntry(full),
      },
    });
  }
  return results;
}

// Долгий отдых возвращает бесплатные сотворения черт. Патч только с тем,
// что изменилось, — у листа без таких заклинаний он пустой.
export function restoreFreeCasts(
  value: Pick<DndCharacterData, "cantrips" | "spellsByLevel">
): Partial<Pick<DndCharacterData, "cantrips" | "spellsByLevel">> {
  const reset = (s: DndSpellEntry) => (s.freeCastUsed ? { ...s, freeCastUsed: false } : s);
  const any = [...value.cantrips, ...value.spellsByLevel.flat()].some((s) => s.freeCastUsed);
  if (!any) return {};
  return { cantrips: value.cantrips.map(reset), spellsByLevel: value.spellsByLevel.map((lvl) => lvl.map(reset)) };
}

// Strips every granted spell (any sourceParentId) from cantrips and every
// spell-level array, keeping hand-added spells (no sourceParentId)
// untouched. Used as the first step of a full recompute — see
// recomputeGrantedSpells below.
function stripGrantedSpells(
  cantrips: DndSpellEntry[],
  spellsByLevel: DndSpellEntry[][]
): { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][] } {
  const strip = (spells: DndSpellEntry[]) => spells.filter((s) => s.sourceParentId == null);
  return { cantrips: strip(cantrips), spellsByLevel: spellsByLevel.map(strip) };
}

// Adds newly-fetched granted spells into cantrips/spellsByLevel, growing
// spellSlotLevels if a granted spell's level would otherwise be hidden.
function addGrantedSpells(
  base: { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number },
  granted: { level: number; entry: DndSpellEntry }[]
): { cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number } {
  let cantrips = base.cantrips;
  const spellsByLevel = base.spellsByLevel.map((lvl) => lvl.slice());
  let spellSlotLevels = base.spellSlotLevels;
  for (const { level, entry } of granted) {
    if (level <= 0) {
      cantrips = [...cantrips, entry];
    } else if (level <= SPELL_LEVELS) {
      spellsByLevel[level - 1] = [...spellsByLevel[level - 1], entry];
      spellSlotLevels = Math.max(spellSlotLevels, level);
    }
  }
  return { cantrips, spellsByLevel, spellSlotLevels };
}

// Recomputes every species/subclass "Обретаемые заклинания" grant against
// the character's current levels: species grants use the character's total
// level (sum of every class row), subclass grants use that class row's own
// level. Strips all previously-granted spells first, then re-adds only the
// ones currently qualified for — so this one function handles picking a new
// species/subclass, leveling up (newly unlocked grants appear) and leveling
// down (grants above the new level disappear) uniformly. Called after any
// change to raceId, a class's subclassId, or a class's level.
export async function recomputeGrantedSpells(
  value: Pick<DndCharacterData, "raceId" | "classes" | "cantrips" | "spellsByLevel" | "spellSlotLevels" | "systemId"> &
    Partial<Pick<DndCharacterData, "feats">>
): Promise<{ cantrips: DndSpellEntry[]; spellsByLevel: DndSpellEntry[][]; spellSlotLevels: number }> {
  // Бесплатное сотворение, уже потраченное, переживает пересчёт: иначе
  // смена уровня возвращала бы точку без долгого отдыха.
  const usedFree = new Set(
    [...value.cantrips, ...value.spellsByLevel.flat()]
      .filter((s) => s.sourceParentId != null && s.freeCastUsed)
      .map((s) => `${s.sourceParentId}:${s.entryId}`)
  );
  let { cantrips, spellsByLevel } = stripGrantedSpells(value.cantrips, value.spellsByLevel);
  let spellSlotLevels = value.spellSlotLevels;

  async function grantFrom(entryId: number, characterLevel: number, opts: { topCircle?: number; ability?: DndAbilityKey } = {}) {
    try {
      const entry = await readResource<CompendiumEntry>(`/systems/entries/${entryId}`);
      const eligible = parseGrantedSpellDefs(entry).filter(
        (d) => d.grantLevel <= characterLevel && (d.slotCircle == null || d.slotCircle <= (opts.topCircle ?? 0))
      );
      if (eligible.length === 0) return;
      const granted = (await fetchGrantedSpells(eligible, entryId, value.systemId, opts.ability)).map((g) =>
        usedFree.has(`${entryId}:${g.entry.entryId}`) ? { ...g, entry: { ...g.entry, freeCastUsed: true } } : g
      );
      ({ cantrips, spellsByLevel, spellSlotLevels } = addGrantedSpells(
        { cantrips, spellsByLevel, spellSlotLevels },
        granted
      ));
    } catch {
      /* entry missing — nothing to grant */
    }
  }

  const totalLevel = totalCharacterLevel(value.classes);
  if (value.raceId) await grantFrom(value.raceId, totalLevel);
  for (const c of value.classes) {
    // Класс участвует в переборе наравне с подклассом: «Починку» Артефактор
    // знает сам, а не через подкласс, и до этого она не приходила никак —
    // сколько её ни вписывай в запись класса, перебор до неё не доходил.
    if (c.classId != null) await grantFrom(c.classId, c.level || 0);
    if (c.subclassId != null) await grantFrom(c.subclassId, c.level || 0);
  }

  // Черты (гриллинг черт 2026-09-24): «Затронутые», метки, «Адепты».
  // «Адепты» дают заклинание круга N, когда у персонажа есть ячейки этого
  // круга, — отсюда высший круг по таблицам классов.
  const feats = (value.feats ?? []).filter((f) => f.entryId != null);
  if (feats.length > 0) {
    const sources: ClassSlotSource[] = [];
    for (const c of value.classes) {
      if (c.classId == null || !(c.level > 0)) continue;
      const cls = await readResource<CompendiumEntry>(`/systems/entries/${c.classId}`).catch(() => null);
      const sub = c.subclassId != null ? await readResource<CompendiumEntry>(`/systems/entries/${c.subclassId}`).catch(() => null) : null;
      sources.push({
        level: c.level,
        progression: cls?.data.progression as ClassProgression | undefined,
        subProgression: sub?.data.progression as ClassProgression | undefined,
        roundUp: isRoundUpCaster(cls?.data as Record<string, unknown> | undefined),
      });
    }
    const slots = computeSpellSlots(sources);
    const topCircle = Math.max(highestCircle(slots.slots), slots.pact?.circle ?? 0);
    for (const f of feats) {
      await grantFrom(f.entryId as number, totalLevel, { topCircle, ability: f.choices?.spellAbility });
    }
  }

  return { cantrips, spellsByLevel, spellSlotLevels };
}

// Хранимая запись + живые поля из компендиума. Лист держит только entryId,
// имя и свою пометку подготовки; всё остальное — школа, время, компоненты,
// броски, эффекты — берётся из компендиума при отрисовке. Сохранённый ранее
// снапшот остаётся запасным путём: он используется, когда записи нет в кэше
// (её ещё не догрузили, она удалена или заклинание вписано руками без ссылки).
export function resolveSpell(
  s: DndSpellEntry,
  get: (id: number | null | undefined) => CompendiumEntry | undefined
): DndSpellEntry {
  const entry = get(s.entryId);
  return entry ? { ...s, ...spellSnapshotFromEntry(entry) } : s;
}

export function resolveFeature(
  f: DndFeature,
  get: (id: number | null | undefined) => CompendiumEntry | undefined
): DndFeature {
  const entry = get(f.entryId);
  if (!entry) return f;
  return {
    ...f,
    // Пустое описание в листе (черта, связанная по имени, ручная строка) —
    // текстом из справочника; своё, вписанное игроком, остаётся.
    description: f.description?.trim() ? f.description : entry.description ?? "",
    ...spellTimingFromData(entry.data),
    checks: (entry.data.checks as DndCheck[] | undefined) ?? [],
    effects: (entry.data.effects as DndEffect[] | undefined) ?? [],
    cost: entry.data.cost as DndCost | undefined,
  };
}
