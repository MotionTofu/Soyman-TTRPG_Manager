import { describe, it, expect } from 'vitest';
import { classSpellPicks, wizardBookPicks } from './classSpellPicks';

const progression = {
  columns: [
    { key: 'l', label: 'Уровень', role: 'level' },
    { key: 'c', label: 'Заговоры', role: 'cantrips' },
    { key: 'p', label: 'Подготовлено', role: 'prepared' },
    { key: 's1', label: '1', role: 'slot1' },
    { key: 's2', label: '2', role: 'slot2' },
  ],
  rows: [{ l: '1', c: '3', p: '4', s1: '2', s2: '-' }, { l: '3', c: '3', p: '6', s1: '4', s2: '2' }],
};
describe('class daily spell selection', () => {
  it('uses class level for counts and available circles', () => {
    expect(classSpellPicks({ progression }, 1, 0)).toEqual({ cantrips: 3, prepared: 4, topCircle: 1 });
    expect(classSpellPicks({ progression }, 3, 0)).toEqual({ cantrips: 3, prepared: 6, topCircle: 2 });
  });
  it('does not invent spell choices for a martial class', () => {
    expect(classSpellPicks({}, 1, 3)).toEqual({ cantrips: 0, prepared: 0, topCircle: 0 });
  });
  it('respects formula-based preparation and its minimum', () => {
    expect(classSpellPicks({ progression, prepared_formula: 'mod_plus_half_level' }, 3, 4).prepared).toBe(5);
    expect(classSpellPicks({ progression, prepared_formula: 'mod_plus_half_level' }, 1, -2).prepared).toBe(1);
  });
  it('uses pact slots when ordinary slots are absent', () => {
    const pact = { columns: [{ key: 'l', role: 'level' }, { key: 'n', role: 'pact_slots' }, { key: 's', role: 'pact_level' }, { key: 'p', role: 'prepared' }], rows: [{ l: '3', n: '2', s: '2', p: '4' }] };
    expect(classSpellPicks({ progression: pact }, 3, 2)).toEqual({ cantrips: 0, prepared: 4, topCircle: 2 });
  });
  it('keeps initial wizard spells in the first circle when starting at a higher level', () => {
    const data = { progression: { ...progression, rows: [progression.rows[0], { l: '2', c: '3', p: '5', s1: '3', s2: '-' }, progression.rows[1]] } };
    expect(wizardBookPicks(data, 3)).toEqual([
      { level: 1, count: 6, topCircle: 1 },
      { level: 2, count: 2, topCircle: 1 },
      { level: 3, count: 2, topCircle: 2 },
    ]);
  });
});
