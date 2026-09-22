import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAB_SYNC_CHANNEL,
  TAB_SYNC_VERSION,
  createTabSync,
  isTabSyncSupported,
  characterUpdated,
  characterDeleted,
  decideRemoteUpdate,
} from '../app/tab-sync.mjs';

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 1000) {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw Error('timed out waiting for event');
    await tick();
  }
}

test('invalidation: commit event reaches the other tab with ids only, never data', async () => {
  if (!isTabSyncSupported()) return;
  const seenA = [];
  const seenB = [];
  const a = createTabSync({ onEvent: (m) => seenA.push(m) });
  const b = createTabSync({ onEvent: (m) => seenB.push(m) });
  try {
    assert.notEqual(a.senderId, b.senderId);
    a.publish(characterUpdated(12, 5));
    const event = await waitFor(() => seenB[0]);
    assert.equal(event.version, TAB_SYNC_VERSION);
    assert.equal(event.type, 'character-updated');
    assert.equal(event.characterId, 12);
    assert.equal(event.revision, 5);
    assert.equal(typeof event.senderId, 'string');
    for (const key of ['content', 'portrait', 'catalog', 'hitPointsCurrent', 'notes', 'resources']) {
      assert.ok(!(key in event), `event must not carry ${key}`);
    }
    // No echo: the sender never reacts to itself (loop protection).
    await tick(50);
    assert.equal(seenA.length, 0);
    // Foreign garbage on the channel is ignored. Echo suppression is
    // per-tab: B ignores only B's own senderId.
    const raw = new BroadcastChannel(TAB_SYNC_CHANNEL);
    try {
      raw.postMessage({ hello: 'noise' });
      raw.postMessage({ version: 999, senderId: 'x', type: 'character-updated', characterId: 1, revision: 1 });
      raw.postMessage({ version: 1, senderId: b.senderId, type: 'character-updated', characterId: 1, revision: 1 });
      raw.postMessage({ version: 1, senderId: 'x', type: 'something-else', characterId: 1, revision: 1 });
      await tick(50);
      assert.equal(seenB.length, 1);
    } finally {
      raw.close();
    }
  } finally {
    a.close();
    b.close();
  }
});

test('delete event reaches the other tab without echo', async () => {
  if (!isTabSyncSupported()) return;
  const seenA = [];
  const seenB = [];
  const a = createTabSync({ onEvent: (m) => seenA.push(m) });
  const b = createTabSync({ onEvent: (m) => seenB.push(m) });
  try {
    a.publish(characterDeleted(12));
    const event = await waitFor(() => seenB[0]);
    assert.equal(event.type, 'character-deleted');
    assert.equal(event.characterId, 12);
    await tick(50);
    assert.equal(seenA.length, 0);
  } finally {
    a.close();
    b.close();
  }
});

test('remote-update policy: adopt, defer, ignore', () => {
  const base = { hasPendingSave: false, hasUnsavedFailure: false, knownRevision: 4 };
  assert.equal(decideRemoteUpdate({ ...base, remoteRevision: 5 }), 'adopt');
  assert.equal(decideRemoteUpdate({ ...base, remoteRevision: 4 }), 'ignore');
  assert.equal(decideRemoteUpdate({ ...base, remoteRevision: 3 }), 'ignore');
  assert.equal(decideRemoteUpdate({ ...base, remoteRevision: NaN }), 'ignore');
  // A local save in flight: never swap state mid-write, re-read after settle.
  assert.equal(decideRemoteUpdate({ ...base, hasPendingSave: true, remoteRevision: 5 }), 'defer');
  // Our own save failed and holds unsaved work: adopting the winner would
  // wipe its only copy, so the error banner and manual reload win.
  assert.equal(decideRemoteUpdate({ ...base, hasUnsavedFailure: true, remoteRevision: 5 }), 'ignore');
  assert.equal(
    decideRemoteUpdate({ ...base, hasPendingSave: true, hasUnsavedFailure: true, remoteRevision: 5 }),
    'ignore'
  );
});

test('unsupported browsers get a silent no-op', () => {
  const real = globalThis.BroadcastChannel;
  try {
    // @ts-expect-error testing the fallback
    delete globalThis.BroadcastChannel;
    assert.equal(isTabSyncSupported(), false);
    const sync = createTabSync({ onEvent: () => { throw Error('must never fire'); } });
    assert.equal(sync.supported, false);
    assert.doesNotThrow(() => {
      sync.publish(characterUpdated(1, 1));
      sync.close();
    });
  } finally {
    globalThis.BroadcastChannel = real;
  }
  assert.equal(isTabSyncSupported(), true);
});
