import { cantripsAtLevel, preparedAtLevel, spellSlotsAtLevel, pactSlotsAtLevel, classPreparedFormula, formulaPreparedLimit, type ClassProgression } from './progression';

// Explicit choices override these defaults. The class progression is the
// source of daily preparation limits, including pact magic and formulas.
export function classSpellPicks(data: Record<string, unknown>, level: number, modifier: number) {
  const progression = data.progression as ClassProgression | undefined;
  const slots = spellSlotsAtLevel(progression, level) || [];
  const pact = pactSlotsAtLevel(progression, level);
  const topCircle = Math.max(pact?.circle || 0, ...slots.map((n, i) => n > 0 ? i + 1 : 0), 0);
  const formula = classPreparedFormula(data);
  return {
    cantrips: cantripsAtLevel(progression, level) || 0,
    prepared: topCircle > 0 ? (formula ? formulaPreparedLimit(formula, level, modifier) : preparedAtLevel(progression, level) || 0) : 0,
    topCircle,
  };
}

// Starting book plus two researched spells at each later wizard level.
// Separate groups retain the circle limit at the level of acquisition.
export function wizardBookPicks(data: Record<string, unknown>, level: number) {
  return Array.from({ length: level }, (_, i) => ({
    level: i + 1, count: i === 0 ? 6 : 2,
    topCircle: classSpellPicks(data, i + 1, 0).topCircle,
  })).filter(group => group.topCircle > 0);
}
