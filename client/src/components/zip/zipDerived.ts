// @ts-nocheck
export function mod(val: number): number {
  return Math.floor((val - 10) / 2);
}
export function parseNum(s: string | undefined, fallback = 10): number {
  const n = parseInt(String(s ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}
export function bestMod(t: number, l: number, r: number): number {
  return Math.max(mod(t), mod(l), mod(r));
}
export function resilienceMax(best: number, level: number, d6Bonuses: number[] = []): number {
  const sum = d6Bonuses.reduce((a, b) => a + b, 0);
  return 10 + best + sum;
}
export function defenseCalc(
  lovMod: number,
  armorEquipped: number,
  hasTalent: (n: string) => boolean,
  razMod: number,
  telMod: number,
  misc: number
): number {
  let base = 10;
  if (hasTalent("Каскадёр") && armorEquipped === 0) {
    base += 2 * lovMod;
  } else if (hasTalent("Несокрушимый")) {
    base += telMod;
  } else {
    base += lovMod;
  }
  if (hasTalent("Боевое чутьё")) base += razMod;
  base += armorEquipped + misc;
  return base;
}
export function carryLimit(telMod: number, hasNosilshchik: boolean, atletika: number, hasBackpack: boolean): number {
  return 10 + telMod + (hasNosilshchik ? atletika : 0) + (hasBackpack ? 2 : 0);
}
export function languagesCount(razMod: number): number {
  return 2 + Math.max(0, razMod);
}
export function encumbrance(used: number, limit: number): { overloaded: boolean; excess: number; penalty: number; move: string } {
  const excess = Math.max(0, used - limit);
  return {
    overloaded: excess > 0,
    excess,
    penalty: -excess,
    move: excess > 0 ? "Рядом/Близко" : "Близко/Неподалёку",
  };
}
export function levelFromXp(xp: number): number {
  if (xp < 10) return 1;
  return Math.floor(xp / 10) + 1;
}
export function hasTalentByName(talents: { name: string }[], name: string): boolean {
  return talents.some((t) => t.name === name);
}
