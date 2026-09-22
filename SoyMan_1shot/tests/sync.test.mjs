import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeApiBase,
  isSyncCredential,
  buildPairingLink,
  parsePairingLink,
} from '../app/sync.mjs';

const credential = (overrides = {}) => ({
  version: 1,
  apiBase: 'http://192.168.1.5:3001',
  spaceId: 'space-1',
  deviceId: 'device-1',
  deviceToken: 'tok-' + 'x'.repeat(40),
  linkedAt: '2026-09-22T00:00:00.000Z',
  ...overrides,
});

test('api base normalizes http(s) and rejects the rest', () => {
  assert.equal(normalizeApiBase('http://192.168.1.5:3001/'), 'http://192.168.1.5:3001');
  assert.equal(normalizeApiBase('  https://example.com  '), 'https://example.com');
  for (const bad of ['', 'notaurl', 'ftp://x.test', 'javascript:alert(1)']) {
    assert.throws(() => normalizeApiBase(bad));
  }
});

test('pairing link round-trips token in fragment, api in query', () => {
  const link = buildPairingLink({
    appOrigin: 'https://static.example.com',
    appPath: '/1shot/',
    apiBase: 'http://192.168.1.5:3001',
    pairingToken: 'tok+en/with=special',
  });
  assert.ok(link.startsWith('https://static.example.com/1shot/?api='));
  assert.ok(link.includes('#pair='));
  assert.ok(!link.includes('#pair=tok+en'));
  const parsed = parsePairingLink(link);
  assert.deepEqual(parsed, { apiBase: 'http://192.168.1.5:3001', pairingToken: 'tok+en/with=special' });
  assert.equal(parsePairingLink('https://static.example.com/1shot/'), null);
  assert.equal(parsePairingLink('https://static.example.com/1shot/?api=http://x#pair='), null);
  assert.equal(parsePairingLink('not a url'), null);
});

test('credential shape gates storage and status', () => {
  assert.equal(isSyncCredential(credential()), true);
  assert.equal(isSyncCredential(credential({ version: 2 })), false);
  assert.equal(isSyncCredential(credential({ deviceToken: '' })), false);
  assert.equal(isSyncCredential(credential({ apiBase: 'notaurl' })), false);
  assert.equal(isSyncCredential(null), false);
});
