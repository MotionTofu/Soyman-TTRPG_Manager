import type { LitmChallengeState, LitmLimitState } from "./conflict";
import { reduceLimit } from "./conflict";
import { giveStatus, reduceStatus, sameStatus, type LitmStatus } from "./status";

export const COMPOUND_EFFECTS = {
  orderCharge: { label: "Приказать отряду атаковать", profile: "Battlefield Leader" },
  leadCharge: { label: "Лично повести атаку", profile: "Battlefield Leader" },
  healAlly: { label: "Исцелить товарища", profile: "Frontier Healer" },
  healSelf: { label: "Исцелить себя", profile: "Frontier Healer" },
  revive: { label: "Вернуть в строй", profile: "Frontier Healer" },
  ward: { label: "Наложить оберег", profile: "Frontier Healer" },
} as const;

export type CompoundEffect = keyof typeof COMPOUND_EFFECTS;
export type CompoundTarget = { kind: "row" | "hero"; id: number };
export type Injury = { kind: "status" | "limit"; name: string };
export const VITALITY = "жизненная-сила";

export const BOOK_POLAR_LIMITS: Record<string, { name: string; sides: NonNullable<LitmLimitState["sides"]> }> = {
  Kraken: { name: "Сбежать или проглотить", sides: [
    { status: "сбежать", outcome: "При *сбежать-5* судно уходит." },
    { status: "проглотить", outcome: "При *проглотить-5* кракен уничтожает судно, и гибнет множество моряков (**Дурные вести**)." },
  ] },
  "Raiding Longboat": { name: "Сбежать или настичь", sides: [
    { status: "сбежать", outcome: "При *сбежать-3* преследуемое судно уходит." },
    { status: "настичь", outcome: "При *настичь-3* налётчики готовы к абордажу. **Новый вызов**: кровожадные грабители со *щитами* (с. 139)." },
  ] },
  "Outlaw Overlord": { name: "Исполнить / сорвать замысел", sides: [
    { status: "замысел", outcome: "При *замысел-4* владыка осуществляет план." },
    { status: "срыв", outcome: "При *срыв-4* Герои срывают план владыки." },
  ] },
};

export function reduceInjury(state: LitmChallengeState, injury: Injury, amount: number): LitmChallengeState | null {
  if (injury.kind === "limit") {
    const index = state.limits.findIndex((l) => sameStatus(l.name, injury.name) && l.marks.length);
    return index < 0 ? null : reduceLimit(state, index, amount);
  }
  const statuses = healStatuses(state.statuses, injury, amount);
  return statuses ? { ...state, statuses } : null;
}

export function healStatuses(statuses: LitmStatus[], injury: Injury, amount: number): LitmStatus[] | null {
  return injury.kind === "status" && statuses.some((s) => sameStatus(s.name, injury.name))
    ? reduceStatus(statuses, injury.name, amount) : null;
}

export function charge(state: LitmChallengeState, tier: number): LitmChallengeState {
  return { ...state, statuses: giveStatus(state.statuses, "в-атаке", tier) };
}

/** Старые записи могли сохранить название всего Предела или одну сторону. */
export function legacyLimitSide(limit: LitmLimitState, sides: NonNullable<LitmLimitState["sides"]>): string | undefined {
  const aliases: Record<string, string[]> = {
    сбежать: ["сбежал", "уходит", "оторваться"],
    проглотить: ["проглочен", "проглатывает", "заглатывает"],
    настичь: ["настиг", "догоняет", "догнать"],
    замысел: ["исполнить", "исполнить замысел", "исполняет замысел"],
    срыв: ["сорвать", "сорвать замысел", "срывает замысел"],
  };
  return sides.find(({ status }) => [status, ...(aliases[status] ?? [])].some((alias) => sameStatus(limit.status, alias)))?.status;
}

export function updateRibbonLimit(old: LitmLimitState, profile: LitmLimitState, side?: string): LitmLimitState | null {
  if (!profile.sides?.length) return { ...old, turns: profile.turns, note: profile.note };
  const status = old.marks.length ? (side ?? legacyLimitSide(old, profile.sides)) : "";
  if (old.marks.length && !profile.sides.some((s) => sameStatus(s.status, status ?? ""))) return null;
  return { ...old, turns: profile.turns, note: profile.note, sides: profile.sides, status: status ?? "" };
}
