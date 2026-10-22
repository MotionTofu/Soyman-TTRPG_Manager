import { useSyncExternalStore } from "react";
import type { EndedLine } from "./effects";

/**
 * Открыт ли боевой режим пульта (Q2) и какое гнездо показать.
 *
 * Трекер живёт в правой панели, режим — в основной области пульта; общего
 * предка с состоянием у них нет. Значение не хранится на сервере: это вид,
 * а не бой. Пока его никто не трогал, режим открыт ровно тогда, когда идёт
 * бой — открытый пульт посреди боя (перезагрузка) встаёт сразу в режим.
 */
const open = new Map<number, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCombatModeOpen(sessionId: number, value: boolean): void {
  open.set(sessionId, value);
  emit();
}

export function useCombatModeOpen(sessionId: number, combatActive: boolean): boolean {
  useSyncExternalStore(subscribe, () => version);
  return open.get(sessionId) ?? combatActive;
}

/**
 * «Закончилось: …» в полосе раунда (Q57) — что кончилось на последней смене
 * хода. Вид, а не данные: в лог боя оно уйдёт на шаге 4.
 */
const ended = new Map<number, EndedLine[]>();

export function setEndedEffects(sessionId: number, lines: EndedLine[]): void {
  ended.set(sessionId, lines);
  emit();
}

const NO_LINES: EndedLine[] = [];
export function useEndedEffects(sessionId: number): EndedLine[] {
  useSyncExternalStore(subscribe, () => version);
  return ended.get(sessionId) ?? NO_LINES;
}

/** «Щелчок по строке показывает гнездо на ленте» — трекер просит, лента слушает. */
const focusListeners = new Set<(entryId: number) => void>();

export function requestNestFocus(entryId: number): void {
  for (const l of focusListeners) l(entryId);
}

export function onNestFocus(listener: (entryId: number) => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}
