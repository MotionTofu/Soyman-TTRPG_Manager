import { creatureInitiativeModifier, deriveSheet } from "@shared/dnd/derive";
import { write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { parseDndStatblock } from "../components/EntityPreviewModal";
import { rollDiceFormula } from "../components/dnd/diceRoll";
import { ensureEntries, getCachedEntry } from "../components/dnd/entryCache";
import { liveEffectEntryIds, withLiveEffects } from "../components/dnd/dndFeatures";
import { INITIATIVE_EPITHETS, loadUseEpithets } from "../initiativeTrackerPrefs";
import type { DndCharacterData, DndCreatureData, DndCreatureHitPoints, InitiativeEntry, Statblock } from "../types";
import type { useCombat } from "./useCombat";

/**
 * Встать в бой — общее для трекера (перетаскивание, мешок) и панели
 * «Добавить в бой» боевого режима (Q37–Q44): модификатор инициативы, хиты
 * и имя считаются одинаково, откуда бы боец ни пришёл.
 */

/** Кого можно поставить в очередь: у них бывает D&D-статблок. */
export const COMBAT_TYPES = ["being", "character", "compendium_entry"];

export function rollCreatureHp(hp: DndCreatureHitPoints): number | null {
  if (hp.diceCount && hp.dieSize) {
    const bonus = hp.bonus ?? 0;
    return rollDiceFormula(`${hp.diceCount}к${hp.dieSize}${bonus >= 0 ? "+" : ""}${bonus}`);
  }
  return hp.formula ? rollDiceFormula(hp.formula) : null;
}

export interface StatblockInfo {
  initiativeModifier: number;
  maxHp: number | null;
  currentHp: number | null;
  /** КЗ персонажа по листу — для снимка двойника (Q43); у существ null. */
  ac: number | null;
  /** Хиты на листе сейчас — для снимка тестового прогона (Q70); у существ null. */
  sheetHp?: { current: number; temp: number };
}

// Всё, что нужно новому бойцу из его D&D-статблока, — одним чтением.
//
// Модификатор инициативы, а НЕ голая Ловкость. У существа 5.5 инициатива
// объявлена своим числом («Инициатива +5 (15)»), и оно не обязано совпадать
// с модификатором Ловкости — для этого в статблоке `initiativeBonus`. У
// персонажа число и КЗ — из общего правила листа (`deriveSheet`), а не
// считаются здесь заново. Хиты существа бросаются костями хитов.
export async function resolveStatblockInfo(type: string, id: number): Promise<StatblockInfo> {
  const empty = { initiativeModifier: 0, maxHp: null, currentHp: null, ac: null };
  if (!COMBAT_TYPES.includes(type)) return empty;
  try {
    const rows = await readResource<Statblock[]>(`/statblocks?owner_type=${type}&owner_id=${id}`);
    const dnd = rows.find((s) => s.format === "dnd_character" || s.format === "dnd_creature");
    if (!dnd) return empty;
    const parsed = parseDndStatblock(dnd);
    if (dnd.format === "dnd_creature") {
      const creature = parsed as DndCreatureData;
      const max = rollCreatureHp(creature.hitPoints);
      return { initiativeModifier: creatureInitiativeModifier(creature), maxHp: max, currentHp: max, ac: null };
    }
    const character = parsed as DndCharacterData;
    // Эффекты умений лист хранит ссылкой (`entryId`), поэтому записи
    // догружаются здесь — иначе «Бдительный» был бы в листе, а в очереди
    // боя нет.
    await ensureEntries(liveEffectEntryIds(character));
    const sheet = deriveSheet(withLiveEffects(character, getCachedEntry));
    const max = Number(character.hitPointMax) || null;
    return {
      initiativeModifier: sheet.initiative.value,
      maxHp: max,
      currentHp: max,
      ac: sheet.armorClass.value,
      sheetHp: { current: Number(character.hitPointsCurrent) || 0, temp: Number(character.hitPointsTemp) || 0 },
    };
  } catch {
    return empty;
  }
}

/** Имя для ещё одного такого же: «Гоблин (2)» или эпитет, если включены. */
export function pickName(baseName: string, names: readonly string[]): string {
  const sameBase = names.filter((n) => n === baseName || n.endsWith(` ${baseName}`) || n.startsWith(`${baseName} (`));
  if (sameBase.length === 0) return baseName;
  if (!loadUseEpithets()) {
    let k = sameBase.length + 1;
    while (names.includes(`${baseName} (${k})`)) k += 1;
    return `${baseName} (${k})`;
  }
  const usedEpithets = new Set(
    sameBase
      .filter((n) => n.endsWith(` ${baseName}`))
      .map((n) => n.slice(0, -(baseName.length + 1)))
  );
  const available = INITIATIVE_EPITHETS.filter((ep) => !usedEpithets.has(ep));
  if (available.length === 0) return `${baseName} (${sameBase.length + 1})`;
  return `${available[Math.floor(Math.random() * available.length)]} ${baseName}`;
}

type Combat = ReturnType<typeof useCombat>;

/** Кого ставим: запись с D&D-статблоком; `double` — двойник персонажа (Q43). */
export interface Source {
  type: "character" | "being" | "compendium_entry";
  id: number;
  name: string;
  double?: boolean;
}

/**
 * Поставить в бой N штук (Q39). Каждый — своей строкой: хиты бросаются
 * каждому, имена нумеруются. Инициативы нет (Q44): «?» в ярлыке, ход
 * пропускается, пока её не бросят.
 */
export async function addFighters(combat: Combat, sessionId: number, src: Source, count: number): Promise<string | null> {
  const names = combat.entries.map((e) => e.name);
  let last: string | null = null;
  for (let k = 0; k < count; k += 1) {
    const info = await resolveStatblockInfo(src.type, src.id);
    const name = pickName(src.double ? `Двойник: ${src.name}` : src.name, names);
    names.push(name);
    const body = {
      session_id: sessionId,
      entity_type: src.type,
      entity_id: src.id,
      name,
      // `dex_modifier` держит итоговый модификатор инициативы (addToCombat.ts).
      dex_modifier: info.initiativeModifier,
      max_hp: info.maxHp,
      current_hp: info.currentHp,
      // Двойник — снимок листа: КЗ здесь, хиты и Ловкость в колонках строки;
      // лист игрока он не трогает.
      ...(src.double ? { state: { double: { ac: info.ac } } } : {}),
    };
    const ok = await combat.change(`«${name}» не встал в бой`, () => write.post("/initiative-entries", body), {
      retry: false,
      note: `«${name}» встал в бой`,
    });
    if (!ok) break;
    last = name;
  }
  return last;
}

/** Ещё такой же (Q42): та же запись — новым бойцом; персонаж — двойником. */
export function addSameAgain(combat: Combat, sessionId: number, entry: InitiativeEntry) {
  const type = entry.entity_type;
  if ((type === "character" || type === "being" || type === "compendium_entry") && entry.entity_id != null) {
    // Основа имени — у самого короткого бойца той же записи: у «Жадный
    // Бандит» и «Двойник: Эрвин (2)» эпитет и номер — не часть имени.
    const kin = combat.entries
      .filter((e) => e.entity_type === type && e.entity_id === entry.entity_id)
      .map((e) => baseName(e.name.replace(/^.*Двойник: /, "")));
    const name = kin.reduce((a, b) => (b.length < a.length ? b : a), baseName(entry.name.replace(/^.*Двойник: /, "")));
    void addFighters(combat, sessionId, { type, id: entry.entity_id, name, double: type === "character" }, 1);
    return;
  }
  // Боец без записи (вписан руками) — копия имени и хитов.
  const name = pickName(baseName(entry.name), combat.entries.map((e) => e.name));
  void combat.change(
    `«${name}» не встал в бой`,
    () =>
      write.post("/initiative-entries", {
        session_id: sessionId,
        name,
        kind: entry.kind,
        dex_modifier: entry.dex_modifier,
        max_hp: entry.max_hp,
        current_hp: entry.max_hp,
      }),
    { retry: false, note: `«${name}» встал в бой` }
  );
}

/** «Гоблин (3)» → «Гоблин»: номер даёт pickName заново. */
function baseName(name: string): string {
  return name.replace(/ \(\d+\)$/, "");
}
