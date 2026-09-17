import { describe, it, expect } from 'vitest';
import { selectedStartingSet } from './startingSetChoice';
describe('starting equipment alternatives', () => {
  const sets = [{ label: 'A' }, { label: 'B' }];
  it('defaults to one option and respects B', () => {
    expect(selectedStartingSet(sets, {})).toBe(sets[0]);
    expect(selectedStartingSet(sets, { A: false, B: true })).toBe(sets[1]);
  });
  it('repairs old multiple and empty selections deterministically', () => {
    expect(selectedStartingSet(sets, { A: true, B: true })).toBe(sets[0]);
    expect(selectedStartingSet(sets, { A: false, B: false })).toBe(sets[0]);
    expect(selectedStartingSet([], {})).toBeUndefined();
  });
  it('keeps class and background choices independent', () => {
    const background = [{ label: 'Background A' }, { label: 'Background B' }];
    const saved = { A: false, B: true, 'Background A': true, 'Background B': false };
    expect(selectedStartingSet(sets, saved)).toBe(sets[1]);
    expect(selectedStartingSet(background, saved)).toBe(background[0]);
  });
});
