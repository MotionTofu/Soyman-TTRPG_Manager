import type { DndCombatDuration, DndRepeatSaveAt } from "@shared/dnd/effects";
import type { DndAbilityKey } from "../types";

/**
 * Эффект в гнезде цели (боевой режим, шаг 3, Q51–Q62). Лежит в
 * `NestState.effects` строки ЦЕЛИ; заклинатель — ссылкой на свою строку.
 * У персонажа-цели строка держит отсчёт и заклинателя, а сам эффект ещё
 * пишется в лист — «Наложено на меня» (Q55, Q66).
 */
export interface NestEffect {
  id: string;
  name: string;
  /** Запись справочника — заклинание; у действия чудовища и «своего» нет. */
  entryId?: number | null;
  casterId: number | null;
  casterName: string;
  /** Отсчёт раундов: −1 в начале хода заклинателя, на нуле эффект кончается (Q53). */
  rounds?: number | null;
  /** Конец не по счёту: ход цели, ход наложившего, бой, долгий отдых (час и дольше, Q58). */
  until?: "target_turn_end" | "caster_turn_end" | "combat" | "rest";
  /** Для «до конца хода»: нужный ход начался — кончится вместе с ним. */
  armed?: boolean;
  /** На концентрации заклинателя: срыв снимает эффект со всех целей (Q54). */
  conc?: boolean;
  /** Состояния, пришедшие с эффектом, — уходят вместе с ним (Q56). */
  conditions?: string[];
  /** Прибавка к КЗ числом — показ у чудовища «15 + 2 Щит веры» (Q56). */
  ac?: number;
  /** Повтор спасброска: плашка в гнезде цели (Q60). */
  repeat?: { ability: DndAbilityKey; dc: number | null; at: DndRepeatSaveAt[] } | null;
}

export const ABILITY_SHORT: Record<DndAbilityKey, string> = {
  str: "Сил",
  dex: "Лов",
  con: "Тел",
  int: "Инт",
  wis: "Мдр",
  cha: "Хар",
};

export const REPEAT_AT_LABELS: Record<DndRepeatSaveAt, string> = {
  turn_end: "в конце хода цели",
  turn_start: "в начале хода цели",
  on_damage: "при уроне",
};

const RU_ABILITY: Record<string, DndAbilityKey> = {
  Сила: "str",
  Ловкость: "dex",
  Телосложение: "con",
  Интеллект: "int",
  Мудрость: "wis",
  Харизма: "cha",
};

/** Характеристика спасброска заклинания («Мудрость») — ключом. */
export function abilityKey(name: string | undefined): DndAbilityKey | null {
  return (name && RU_ABILITY[name.trim()]) || null;
}

export type EffectDuration = { rounds: number } | { until: NonNullable<NestEffect["until"]> };

/**
 * Длительность заклинания по тексту записи (Q53, Q58): минута — 10 раундов,
 * 10 минут — 100; дольше 10 минут или без числа — до конца боя; час и дольше
 * — ещё и остаётся на листе до долгого отдыха. null — мгновенное, в окне не
 * показывается.
 */
export function spellDuration(text: string | undefined): EffectDuration | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim() || /мгновенн/.test(t)) return null;
  const r = t.match(/(\d+)\s*раунд/);
  if (r) return { rounds: Number(r[1]) };
  const m = t.match(/(\d+)\s*минут/);
  if (m) return Number(m[1]) <= 10 ? { rounds: Number(m[1]) * 10 } : { until: "combat" };
  if (/час|дн[яейи]|день|сут/.test(t)) return { until: "rest" };
  return { until: "combat" };
}

/** Длительность действия чудовища («Накладывает»); не сказано — до конца боя. */
export function actionDuration(d: DndCombatDuration | null | undefined): EffectDuration {
  if (!d) return { until: "combat" };
  return "rounds" in d ? { rounds: d.rounds } : { until: d.until };
}

export function durationLabel(e: Pick<NestEffect, "rounds" | "until">): string {
  if (e.rounds != null) return `${e.rounds} р.`;
  if (e.until === "target_turn_end") return "до конца хода цели";
  if (e.until === "caster_turn_end") return "до конца хода наложившего";
  if (e.until === "rest") return "до долгого отдыха";
  return "до конца боя";
}

export function newEffectId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Строка очереди для расчёта: id и эффекты/ждущие повторы её гнезда. */
export interface EffectRow {
  id: number;
  effects: NestEffect[];
  repeatDue: string[];
}

export interface Expired {
  rowId: number;
  effect: NestEffect;
}

/**
 * Смена хода с `fromId` на `toId` (Q53, Q60): конец хода уходящего, затем
 * начало хода пришедшего. Возвращает только изменившиеся строки и
 * кончившиеся эффекты — снять их состояния, записи листа и концентрацию
 * должен вызывающий (это уже не чистая часть).
 */
export function advanceEffects(
  rows: EffectRow[],
  fromId: number | null,
  toId: number
): { changed: Map<number, EffectRow>; expired: Expired[] } {
  const changed = new Map<number, EffectRow>();
  const expired: Expired[] = [];
  for (const row of rows) {
    const due = new Set(row.repeatDue);
    const kept: NestEffect[] = [];
    let touched = false;
    for (const original of row.effects) {
      let e = original;
      let ends = false;
      // Конец хода уходящего.
      if (fromId != null) {
        if (e.armed && e.until === "target_turn_end" && row.id === fromId) ends = true;
        if (e.armed && e.until === "caster_turn_end" && e.casterId === fromId) ends = true;
        if (!ends && row.id === fromId && e.repeat?.at.includes("turn_end")) due.add(e.id);
      }
      // Начало хода пришедшего.
      if (!ends) {
        if (e.casterId === toId && e.rounds != null) {
          e = { ...e, rounds: e.rounds - 1 };
          if (e.rounds! <= 0) ends = true;
        }
        if ((e.until === "target_turn_end" && row.id === toId) || (e.until === "caster_turn_end" && e.casterId === toId))
          e = e.armed ? e : { ...e, armed: true };
        if (!ends && row.id === toId && e.repeat?.at.includes("turn_start")) due.add(e.id);
      }
      if (ends) {
        expired.push({ rowId: row.id, effect: original });
        touched = true;
        continue;
      }
      if (e !== original) touched = true;
      kept.push(e);
    }
    const ids = new Set(kept.map((e) => e.id));
    const repeatDue = [...due].filter((id) => ids.has(id));
    if (touched || repeatDue.length !== row.repeatDue.length || repeatDue.some((id, i) => id !== row.repeatDue[i]))
      changed.set(row.id, { id: row.id, effects: kept, repeatDue });
  }
  return { changed, expired };
}

/** Урон по цели (Q60): эффекты с повтором «при уроне» ждут плашки. */
export function dueOnDamage(effects: NestEffect[], repeatDue: string[]): string[] {
  const due = new Set(repeatDue);
  for (const e of effects) if (e.repeat?.at.includes("on_damage")) due.add(e.id);
  return [...due];
}

/** Кончилось на этом ходу — строка «Закончилось» (Q57): эффект, заклинатель, цели. */
export interface EndedLine {
  name: string;
  casterName: string;
  targets: string[];
}

export function endedLines(expired: Expired[], nameOf: (rowId: number) => string): EndedLine[] {
  const out = new Map<string, EndedLine>();
  for (const { rowId, effect } of expired) {
    const key = `${effect.casterId}:${effect.name}`;
    const line = out.get(key) ?? { name: effect.name, casterName: effect.casterName, targets: [] };
    line.targets.push(nameOf(rowId));
    out.set(key, line);
  }
  return [...out.values()];
}
