import type { InitiativeEntry } from "../types";
import { rollDiceFormula } from "../components/dnd/diceRoll";
import type { NestEffect } from "./effects";

/**
 * Состояние гнезда боевого режима — JSON в `initiative_entries.state` (Q13).
 *
 * Хиты, временные, состояния и «повержен» живут своими колонками строки, как
 * жили в трекере; здесь — то, чего у трекера не было. У персонажа с листом
 * отсюда берётся только реакция (Q29): остальное он читает и пишет в лист.
 */
export interface NestState {
  /** Реакция потрачена; возвращается в начале своего хода (Q29). */
  reactionSpent?: boolean;
  /** Потрачено из запаса «N в день» — по имени действия или заклинания. */
  uses?: Record<string, number>;
  /** Потрачено очков легендарных действий; возвращаются в начале своего хода. */
  legendaryUsed?: number;
  /** Легендарные «раз в ход», уже взятые: свободны снова в начале своего хода. */
  legendaryLocked?: string[];
  /** Потрачено легендарной устойчивости. */
  resistanceUsed?: number;
  /** Перезарядка: не готовое действие бросает к6 в начале своего хода (Q26). */
  recharge?: Record<string, { ready: boolean; min: number; roll?: number }>;
  /** Бой в логове: запасы «в логове» вместо обычных (Q49). */
  inLair?: boolean;
  /** Заметка узкого гнезда логова, окружения, своего события (Q4). */
  note?: string;
  /** Концентрация чудовища — имя заклинания. У персонажа она в листе. */
  concentration?: string;
  /** Ждёт ответа «Удержал / Сорвалась»: СЛ испытания Телосложения (Q26). */
  concentrationCheck?: number;
  /** Двойник персонажа (Q43): снимок листа при добавлении, лист не трогает. */
  double?: { ac: number | null };
  /** Эффекты НА этом бойце (шаг 3, effects.ts). */
  effects?: NestEffect[];
  /** Эффекты, по которым ждёт плашка «Повтор» (Q60). */
  repeatDue?: string[];
  /** Свои счётчики гнезда (Q59); запомненные в статблоке ведёт MonsterPools. */
  counters?: { name: string; max: number; used: number }[];
}

export function parseNestState(entry: Pick<InitiativeEntry, "state">): NestState {
  try {
    const v = JSON.parse(entry.state || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as NestState) : {};
  } catch {
    return {};
  }
}

/**
 * Начало хода (Q26): реакция, легендарные очки и замки «до своего хода»
 * возвращаются, не готовая перезарядка бросает к6. Возвращает новое состояние
 * и броски — их покажет гнездо (в лог боя они уйдут на шаге 4).
 */
export function startOfTurn(state: NestState): { state: NestState; changed: boolean } {
  const next: NestState = { ...state };
  let changed = false;
  if (next.reactionSpent) {
    next.reactionSpent = false;
    changed = true;
  }
  if (next.legendaryUsed) {
    next.legendaryUsed = 0;
    changed = true;
  }
  if (next.legendaryLocked?.length) {
    next.legendaryLocked = [];
    changed = true;
  }
  if (next.recharge) {
    const recharge: NestState["recharge"] = {};
    for (const [name, r] of Object.entries(next.recharge)) {
      if (r.ready) {
        recharge[name] = r;
        continue;
      }
      const roll = rollDiceFormula("1к6") ?? 1;
      recharge[name] = { ready: roll >= r.min, min: r.min, roll };
      changed = true;
    }
    next.recharge = recharge;
  }
  return { state: next, changed };
}

/** СЛ испытания концентрации от урона: 10 или половина урона, что больше, не выше 30. */
export function concentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

/** Палитра и хэш — те же, что у состояний в InitiativeTracker.tsx. */
const CONDITION_COLORS = [
  "#c0392b", "#c9a227", "#2f8f7a", "#4a90a4", "#8a5fb0",
  "#c97b4a", "#5c8f3a", "#a35fa0", "#3a6fa0", "#a0503a",
];
export function colorForCondition(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CONDITION_COLORS[Math.abs(hash) % CONDITION_COLORS.length];
}

export function parseConditions(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export type NestFlag = "now" | "next" | "wait" | null;

export function nestFlag(entry: InitiativeEntry, currentId: number | null, nextId: number | null): NestFlag {
  if (entry.dead === true || entry.dead === 1) return null;
  if (entry.id === currentId) return "now";
  if (entry.id === nextId) return "next";
  if (entry.initiative == null && entry.kind === "creature") return "wait";
  return null;
}
