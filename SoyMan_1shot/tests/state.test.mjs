import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/state.js';
const { seeds, validate, pack, scriptJSON } = globalThis.OneShotState;
test('state round trip preserves counters and manual content independently', () => {
  const c = structuredClone(seeds.mage); c.hp = 4; c.slots = 1; c.notes = 'Заметка'; c.items.push({ kind: 'spell', name: 'Ручное', description: 'Описание' });
  assert.deepEqual(validate(JSON.parse(JSON.stringify(pack(c)))), c);
  assert.equal(seeds.mage.hp, 16);
});
test('rejects invalid versions and counters without changing source', () => {
  assert.throws(() => validate({ formatVersion: 2, character: seeds.mage }));
  assert.throws(() => validate(pack({ ...seeds.mage, hp: -1 })));
  assert.throws(() => validate(pack({ ...seeds.mage, slots: 99 })));
});
test('embedded user text cannot terminate a script', () => {
  const input = { notes: '</script><script>alert(1)</script>\u2028' };
  const encoded = scriptJSON(input); assert.ok(!encoded.includes('<')); assert.deepEqual(JSON.parse(encoded), input);
});
