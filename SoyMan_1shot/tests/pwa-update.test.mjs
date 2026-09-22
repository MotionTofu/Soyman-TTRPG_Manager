import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldNotifyForWaiting,
  shouldNotifyForInstalled,
  createControllerChangeHandler,
  applyUpdateSafely,
} from '../app/pwa/update.mjs';
import {
  readStorageStatus,
  requestPersistentStorage,
  shouldAdviseBackup,
  storageProtectionText,
  formatLocalBytes,
  storageApiKind,
} from '../app/pwa/storage.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(path.join(root, p), 'utf8');

test('waiting SW at load notifies only controlled tabs; first install stays silent', () => {
  assert.equal(shouldNotifyForWaiting({ hasWaiting: true, hasController: true }), true);
  assert.equal(shouldNotifyForWaiting({ hasWaiting: true, hasController: false }), false);
  assert.equal(shouldNotifyForWaiting({ hasWaiting: false, hasController: true }), false);
});

test('installed worker via updatefound notifies only controlled tabs; SW skips waiting only on message', () => {
  assert.equal(shouldNotifyForInstalled({ hasController: true }), true);
  assert.equal(shouldNotifyForInstalled({ hasController: false }), false);
  const sw = readText('../app/pwa/sw.js');
  assert.ok(sw.includes("event.data?.type === 'SKIP_WAITING'"));
  const installBlock = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.ok(!installBlock.includes('skipWaiting'));
});

test('update applies via SKIP_WAITING and controllerchange reloads exactly once, only when initiated', async () => {
  const posted = [];
  let reloads = 0;
  let initiated = false;
  const onControllerChange = createControllerChangeHandler({
    reload: () => { reloads += 1; },
    isUpdateInitiated: () => initiated,
  });
  // First-install claim fires controllerchange too: no reload without a user gesture.
  assert.equal(onControllerChange(), false);
  assert.equal(reloads, 0);
  const result = await applyUpdateSafely({
    hasWaitingWorker: true,
    postSkipWaiting: (msg) => posted.push(msg),
    waitForSafe: async () => ({ ok: true }),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }]);
  initiated = true;
  assert.equal(onControllerChange(), true);
  assert.equal(onControllerChange(), false);
  assert.equal(reloads, 1);
});

test('pending save gates the update: blocked while unsaved, proceeds after the queue flushes', async () => {
  const posted = [];
  const blocked = await applyUpdateSafely({
    hasWaitingWorker: true,
    postSkipWaiting: (msg) => posted.push(msg),
    waitForSafe: async () => ({ ok: false, reason: 'unsaved-changes' }),
  });
  assert.deepEqual(blocked, { ok: false, reason: 'unsaved-changes' });
  assert.deepEqual(posted, []);
  let flushed = false;
  const saveQueue = Promise.resolve().then(() => { flushed = true; });
  const proceed = await applyUpdateSafely({
    hasWaitingWorker: true,
    postSkipWaiting: (msg) => posted.push(msg),
    waitForSafe: async () => { await saveQueue; return { ok: true }; },
  });
  assert.equal(flushed, true);
  assert.deepEqual(proceed, { ok: true });
  assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }]);
  const gone = await applyUpdateSafely({
    hasWaitingWorker: false,
    postSkipWaiting: (msg) => posted.push(msg),
    waitForSafe: async () => ({ ok: true }),
  });
  assert.deepEqual(gone, { ok: false, reason: 'no-waiting-worker' });
  assert.equal(posted.length, 1);
});

test('storage persist/estimate map to a neutral status; backup nudge only when evictable with characters', async () => {
  const on = await readStorageStatus({
    persisted: async () => true,
    persist: async () => true,
    estimate: async () => ({ usage: 24 * 1024 * 1024, quota: 1024 ** 3 }),
  });
  assert.deepEqual(on, { supported: true, persisted: true, usageText: 'Использовано локально: ~24 МБ' });
  assert.equal(storageProtectionText(on), 'Защита хранения: включена');
  assert.equal(shouldAdviseBackup({ supported: on.supported, persisted: on.persisted, hasCharacters: true }), false);

  const exposed = await readStorageStatus({
    persisted: async () => false,
    persist: async () => false,
    estimate: async () => { throw Error('denied'); },
  });
  assert.deepEqual(exposed, { supported: true, persisted: false, usageText: null });
  assert.equal(storageProtectionText(exposed), 'Браузер может очищать данные при нехватке места');
  assert.equal(shouldAdviseBackup({ supported: exposed.supported, persisted: exposed.persisted, hasCharacters: true }), true);
  assert.equal(shouldAdviseBackup({ supported: exposed.supported, persisted: exposed.persisted, hasCharacters: false }), false);

  assert.deepEqual(
    await requestPersistentStorage({ persisted: async () => false, persist: async () => { throw Error('denied'); } }),
    { ok: false },
  );

  const legacy = await readStorageStatus(undefined);
  assert.deepEqual(legacy, { supported: false, persisted: null, usageText: null });
  assert.equal(storageProtectionText(legacy), 'Защита хранения: зависит от браузера');
  assert.equal(storageApiKind({}), 'unsupported');
  assert.equal(formatLocalBytes(NaN), null);
});
