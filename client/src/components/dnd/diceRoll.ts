// Small dice-notation helper for creature loot ("ЗМ: 3к100+30") — not a
// general-purpose roller for the rest of the app, no such thing exists
// anywhere else in the codebase.
const DICE_RE = /^(\d+)\s*[кdD]\s*(\d+)\s*(?:([+-])\s*(\d+))?$/;

export function parseDiceFormula(formula: string): { count: number; die: number; bonus: number } | null {
  const m = DICE_RE.exec(formula.trim());
  if (!m) return null;
  const bonus = m[3] ? Number(m[3] + m[4]) : 0;
  return { count: Number(m[1]), die: Number(m[2]), bonus };
}

export function averageDiceFormula(formula: string): number | null {
  const p = parseDiceFormula(formula);
  return p ? Math.floor(p.count * (p.die / 2 + 0.5)) + p.bonus : null;
}

export function rollDiceFormula(formula: string): number | null {
  const p = parseDiceFormula(formula);
  if (!p) return null;
  let total = p.bonus;
  for (let i = 0; i < p.count; i++) total += 1 + Math.floor(Math.random() * p.die);
  return total;
}
