import type { DndCharacterData, InitiativeEntry } from "../types";
import {
  advanceEffects,
  newEffectId,
  type EffectDuration,
  type Expired,
  type NestEffect,
} from "./effects";
import { parseConditions, parseNestState, type NestState } from "./nestState";

/**
 * Что правит одно действие с эффектами (шаг 3): состояния гнёзд, поля строк
 * (состояния чудовищ — колонкой строки) и листы персонажей. Собирается здесь
 * без записи; пишет `useCombat` одной правкой очереди и патчами листов.
 */
export type SheetEdit = (data: DndCharacterData) => Partial<DndCharacterData> | null;

export interface EffectPlan {
  states: Map<number, NestState>;
  fields: Map<number, Partial<InitiativeEntry>>;
  sheets: Map<number, SheetEdit[]>;
}

export function emptyPlan(): EffectPlan {
  return { states: new Map(), fields: new Map(), sheets: new Map() };
}

/** Персонаж, чьё гнездо пишет лист (двойник — нет, Q43). */
export function sheetCharacterId(entry: InitiativeEntry): number | null {
  return entry.entity_type === "character" && entry.entity_id != null && !parseNestState(entry).double
    ? entry.entity_id
    : null;
}

function stateOf(plan: EffectPlan, entry: InitiativeEntry): NestState {
  return plan.states.get(entry.id) ?? parseNestState(entry);
}

function addSheet(plan: EffectPlan, characterId: number, edit: SheetEdit) {
  plan.sheets.set(characterId, [...(plan.sheets.get(characterId) ?? []), edit]);
}

function editRowConditions(plan: EffectPlan, entry: InitiativeEntry, edit: (list: string[]) => string[]) {
  const fields = plan.fields.get(entry.id) ?? {};
  const next = edit(parseConditions(fields.conditions ?? entry.conditions));
  plan.fields.set(entry.id, { ...fields, conditions: JSON.stringify(next) });
}

/** Правки одного листа подряд: каждая видит лист после предыдущей. */
export function composeSheetEdits(edits: SheetEdit[]): SheetEdit {
  return (data) => {
    let cur = data;
    const out: Partial<DndCharacterData> = {};
    for (const edit of edits) {
      const f = edit(cur);
      if (!f) continue;
      Object.assign(out, f);
      cur = { ...cur, ...f };
    }
    return Object.keys(out).length ? out : null;
  };
}

const fighters = (entries: InitiativeEntry[]) => entries.filter((e) => e.kind === "creature");

/** Убрать эффекты по условию из всех гнёзд; вернуть убранное. */
export function removeWhere(
  entries: InitiativeEntry[],
  plan: EffectPlan,
  pred: (rowId: number, e: NestEffect) => boolean
): Expired[] {
  const removed: Expired[] = [];
  for (const entry of fighters(entries)) {
    const st = stateOf(plan, entry);
    const effects = st.effects ?? [];
    const kept = effects.filter((e) => !pred(entry.id, e));
    if (kept.length === effects.length) continue;
    for (const e of effects) if (!kept.includes(e)) removed.push({ rowId: entry.id, effect: e });
    const ids = new Set(kept.map((e) => e.id));
    plan.states.set(entry.id, { ...st, effects: kept, repeatDue: (st.repeatDue ?? []).filter((id) => ids.has(id)) });
  }
  return removed;
}

/**
 * Следы убранных эффектов (их в `plan.states` уже нет): состояния, пришедшие
 * с эффектом (Q56), запись «Наложено на меня» (Q55), концентрация
 * заклинателя, если на ней больше ничего не держится (Q54).
 * `keepLong` — «Конец боя» (Q58): часовые и дольше остаются на листе.
 */
export function detachRemoved(
  entries: InitiativeEntry[],
  plan: EffectPlan,
  removed: Expired[],
  options: { keepLong?: boolean } = {}
): void {
  for (const { rowId, effect } of removed) {
    const entry = entries.find((e) => e.id === rowId);
    if (!entry) continue;
    const characterId = sheetCharacterId(entry);
    if (options.keepLong && effect.until === "rest" && characterId != null) continue;
    const remaining = stateOf(plan, entry).effects ?? [];
    // ponytail: состояние, бывшее у цели ещё до эффекта, уйдёт вместе с ним;
    // помнить «было ли до» — когда за столом это начнёт мешать.
    const drop = (effect.conditions ?? []).filter((c) => !remaining.some((r) => r.conditions?.includes(c)));
    if (characterId != null) {
      const sameName = remaining.some((r) => r.name === effect.name);
      addSheet(plan, characterId, (d) => {
        const fields: Partial<DndCharacterData> = {};
        if (drop.some((c) => d.conditions.includes(c))) fields.conditions = d.conditions.filter((c) => !drop.includes(c));
        if (!sameName && d.receivedSpells?.some((r) => r.name === effect.name))
          fields.receivedSpells = d.receivedSpells.filter((r) => r.name !== effect.name);
        return Object.keys(fields).length ? fields : null;
      });
    } else if (drop.length) {
      editRowConditions(plan, entry, (list) => list.filter((c) => !drop.includes(c)));
    }
  }

  const seen = new Set<string>();
  for (const { effect } of removed) {
    if (!effect.conc || effect.casterId == null) continue;
    if (options.keepLong && effect.until === "rest") continue;
    const key = `${effect.casterId}:${effect.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const still = fighters(entries).some((en) =>
      (stateOf(plan, en).effects ?? []).some((e) => e.conc && e.casterId === effect.casterId && e.name === effect.name)
    );
    if (still) continue;
    const caster = entries.find((e) => e.id === effect.casterId);
    if (!caster) continue;
    endConcentration(plan, caster, effect.name);
  }
}

/** Концентрация заклинателя кончилась (если она на этом заклинании). */
function endConcentration(plan: EffectPlan, caster: InitiativeEntry, name: string | null) {
  const characterId = sheetCharacterId(caster);
  if (characterId != null) {
    addSheet(plan, characterId, (d) =>
      d.concentration && (name == null || d.concentration === name) ? { concentration: "", concentrationOnOther: "" } : null
    );
    const st = stateOf(plan, caster);
    if (st.concentrationCheck != null) plan.states.set(caster.id, { ...st, concentrationCheck: undefined });
    return;
  }
  const st = stateOf(plan, caster);
  if (name == null || st.concentration === name)
    plan.states.set(caster.id, { ...st, concentration: undefined, concentrationCheck: undefined });
}

export interface ApplyInput {
  name: string;
  entryId: number | null;
  casterId: number;
  casterName: string;
  duration: EffectDuration;
  conc: boolean;
  conditions: string[];
  ac: number;
  repeat: NestEffect["repeat"];
  targets: number[];
}

/**
 * Наложить (Q51–Q56): эффект в гнездо каждой цели, её состояния — в строку
 * или лист, у персонажа — запись «Наложено на меня». Концентрация: прежняя
 * заклинателя уходит со всеми своими эффектами, новая встаёт на её место.
 */
export function planApply(entries: InitiativeEntry[], input: ApplyInput): EffectPlan {
  const plan = emptyPlan();
  const caster = entries.find((e) => e.id === input.casterId) ?? null;
  if (input.conc && caster) {
    const removed = removeWhere(entries, plan, (_, e) => !!e.conc && e.casterId === caster.id);
    detachRemoved(entries, plan, removed);
  }
  for (const id of input.targets) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) continue;
    const effect: NestEffect = {
      id: newEffectId(),
      name: input.name,
      entryId: input.entryId,
      casterId: input.casterId,
      casterName: input.casterName,
      ...("rounds" in input.duration ? { rounds: input.duration.rounds } : { until: input.duration.until }),
      ...(input.conc ? { conc: true } : {}),
      ...(input.conditions.length ? { conditions: input.conditions } : {}),
      ...(input.ac ? { ac: input.ac } : {}),
      ...(input.repeat ? { repeat: input.repeat } : {}),
    };
    const st = stateOf(plan, entry);
    plan.states.set(id, { ...st, effects: [...(st.effects ?? []), effect] });
    const characterId = sheetCharacterId(entry);
    if (characterId != null) {
      addSheet(plan, characterId, (d) => {
        const fields: Partial<DndCharacterData> = {};
        const add = input.conditions.filter((c) => !d.conditions.includes(c));
        if (add.length) fields.conditions = [...d.conditions, ...add];
        // Заклинание — в «Наложено на меня»: по записи лист считает его эффекты (КЗ «Щита веры»).
        if (input.entryId != null && !d.receivedSpells?.some((r) => r.name === input.name))
          fields.receivedSpells = [...(d.receivedSpells ?? []), { name: input.name, entryId: input.entryId }];
        return Object.keys(fields).length ? fields : null;
      });
    } else if (input.conditions.length) {
      editRowConditions(plan, entry, (list) => [...list, ...input.conditions.filter((c) => !list.includes(c))]);
    }
  }
  if (input.conc && caster) {
    const characterId = sheetCharacterId(caster);
    if (characterId != null) {
      // Своё действие заклинание несёт через «Наложено на меня», а не через
      // концентрацию — иначе на себе оно посчиталось бы дважды.
      addSheet(plan, characterId, () => ({ concentration: input.name, concentrationOnOther: input.name }));
    } else {
      const st = stateOf(plan, caster);
      plan.states.set(caster.id, { ...st, concentration: input.name, concentrationCheck: undefined });
    }
  }
  return plan;
}

/** ✕ на чипе, «Прошёл» на плашке — эффект уходит с одной цели. */
export function planRemove(entries: InitiativeEntry[], rowId: number, effectId: string): EffectPlan {
  const plan = emptyPlan();
  detachRemoved(entries, plan, removeWhere(entries, plan, (id, e) => id === rowId && e.id === effectId));
  return plan;
}

/** Срыв концентрации (кнопка, 0 хитов, ✕): её эффекты уходят со всех целей (Q54). */
export function planBreakConcentration(entries: InitiativeEntry[], caster: InitiativeEntry): EffectPlan {
  const plan = emptyPlan();
  detachRemoved(entries, plan, removeWhere(entries, plan, (_, e) => !!e.conc && e.casterId === caster.id));
  endConcentration(plan, caster, null);
  return plan;
}

/** Смена хода вперёд: отсчёт, концы ходов, плашки повтора; кончившееся — со следами. */
export function planTurn(
  entries: InitiativeEntry[],
  fromId: number | null,
  toId: number
): { plan: EffectPlan; expired: Expired[] } {
  const plan = emptyPlan();
  const rows = fighters(entries).map((e) => {
    const st = parseNestState(e);
    return { id: e.id, effects: st.effects ?? [], repeatDue: st.repeatDue ?? [] };
  });
  const { changed, expired } = advanceEffects(rows, fromId, toId);
  for (const [id, row] of changed) {
    const entry = entries.find((e) => e.id === id)!;
    plan.states.set(id, { ...parseNestState(entry), effects: row.effects, repeatDue: row.repeatDue });
  }
  detachRemoved(entries, plan, expired);
  return { plan, expired };
}

/** «Конец боя» (Q58): эффекты боя уходят, часовые и дольше остаются на листе; счётчики гнёзд — тоже. */
export function planEndCombat(entries: InitiativeEntry[]): EffectPlan {
  const plan = emptyPlan();
  detachRemoved(entries, plan, removeWhere(entries, plan, () => true), { keepLong: true });
  for (const entry of fighters(entries)) {
    const st = stateOf(plan, entry);
    if (st.counters?.length || st.repeatDue?.length || st.effects)
      plan.states.set(entry.id, { ...st, effects: undefined, counters: undefined, repeatDue: undefined });
  }
  return plan;
}

/** Что уйдёт и что останется по «Концу боя» — для окна подтверждения. */
export function endCombatSummary(entries: InitiativeEntry[]): { gone: string[]; kept: string[] } {
  const gone = new Set<string>();
  const kept = new Set<string>();
  for (const entry of fighters(entries)) {
    for (const e of parseNestState(entry).effects ?? []) {
      if (e.until === "rest" && sheetCharacterId(entry) != null) kept.add(`${e.name} — ${entry.name}`);
      else gone.add(e.name);
    }
  }
  return { gone: [...gone], kept: [...kept] };
}
