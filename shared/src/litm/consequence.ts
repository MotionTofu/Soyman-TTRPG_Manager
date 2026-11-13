/** Могущество источника Последствий и Героя сравнивают в подходящем аспекте (A175, B33). */
export const MIGHT_STEPS = ["origin", "adventure", "greatness"] as const;
export type MightStep = typeof MIGHT_STEPS[number];

export function consequenceAdjustment(source: MightStep | "", hero: MightStep | "", livingLegend = false) {
  const steps = source && hero ? MIGHT_STEPS.indexOf(source) - MIGHT_STEPS.indexOf(hero) : 0;
  return { tiers: steps === 1 && livingLegend ? 2 : steps * 3, tags: Math.sign(steps) * (Math.abs(steps) === 2 ? 3 : 1) };
}

export function consequenceTier(base: number, adjustment: number, max = Infinity): number {
  return Math.max(0, Math.min(max, base + adjustment));
}
