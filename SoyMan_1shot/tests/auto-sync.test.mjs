// Auto-sync orchestrator (phase D1.4): debounce, one-in-flight, rerun,
// triggers. Fake scheduler — no real 1.5s waits. The engine itself is not
// under test here (D1.2/D1.3 cover it); only WHEN it runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutoSync,
  AUTO_SYNC_DEBOUNCE_MS,
  AUTO_SYNC_FOCUS_THROTTLE_MS,
} from '../app/auto-sync.mjs';

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
};

function harness({ online = true, runImpl } = {}) {
  let now = 1000000;
  let onlineFlag = online;
  const timers = new Map();
  let seq = 0;
  const calls = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const api = createAutoSync({
    schedule: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return { cancel: () => { timers.delete(id); } };
    },
    now: () => now,
    isOnline: () => onlineFlag,
    run:
      runImpl ??
      (async (interactive) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls.push({ interactive, at: now });
        await Promise.resolve();
        concurrent -= 1;
        return { conflicts: [] };
      }),
  });
  return {
    api,
    calls,
    stats: () => ({ maxConcurrent, pendingTimers: timers.size }),
    setOnline: (v) => { onlineFlag = v; },
    tick: async (ms) => {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id] of due) timers.delete(id);
      for (const [, t] of due) t.fn();
      await flush();
    },
  };
}

test('debounce coalesces commits; mid-run commit reruns once, never parallel', async () => {
  // Controllable in-flight run.
  let release;
  const gate = new Promise((r) => { release = r; });
  let started = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const h = harness({
    runImpl: async () => {
      started += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (started === 1) await gate;
      concurrent -= 1;
      return { conflicts: [] };
    },
  });
  h.api.setEnabled(true);
  h.api.notifyCommit('local');
  h.api.notifyCommit('local');
  h.api.notifyCommit('local');
  await h.tick(AUTO_SYNC_DEBOUNCE_MS - 1);
  assert.equal(started, 0);
  await h.tick(1);
  assert.equal(started, 1);
  // Commit while the first sync is in flight: no second run in parallel,
  // exactly one rerun after completion.
  h.api.notifyCommit('local');
  await flush();
  assert.equal(started, 1);
  release();
  await flush(20);
  assert.equal(started, 2);
  assert.equal(maxConcurrent, 1);
  await h.tick(AUTO_SYNC_DEBOUNCE_MS * 2);
  assert.equal(started, 2);
});

test('toggle/offline/online: off stays silent, on syncs, offline skips, manual always works', async () => {
  const h = harness();
  // OFF: commits schedule nothing.
  h.api.notifyCommit('local');
  await h.tick(AUTO_SYNC_DEBOUNCE_MS * 2);
  assert.equal(h.calls.length, 0);
  // ON + online event: immediate background sync.
  h.api.setEnabled(true);
  h.api.notifyOnline();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].interactive, false);
  // Offline commit: debounce fires but no network attempt happens.
  h.setOnline(false);
  h.api.notifyCommit('local');
  await h.tick(AUTO_SYNC_DEBOUNCE_MS * 2);
  assert.equal(h.calls.length, 1);
  // Reconnect: online trigger syncs.
  h.setOnline(true);
  h.api.notifyOnline();
  await flush();
  assert.equal(h.calls.length, 2);
  // Manual request works even with auto disabled, and runs interactively.
  h.api.setEnabled(false);
  const result = await h.api.request({ immediate: true, interactive: true });
  assert.deepEqual(result, { conflicts: [] });
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].interactive, true);
});

test('remote-origin commits never trigger; focus trigger is throttled', async () => {
  const h = harness();
  h.api.setEnabled(true);
  // A pulled character landing through the repository (sync-remote origin)
  // or a bare cross-tab notice must not schedule network sync.
  h.api.notifyCommit('sync-remote');
  h.api.notifyCommit(undefined);
  await h.tick(AUTO_SYNC_DEBOUNCE_MS * 2);
  assert.equal(h.calls.length, 0);
  h.api.notifyCommit('local');
  await h.tick(AUTO_SYNC_DEBOUNCE_MS);
  assert.equal(h.calls.length, 1);
  // A commit sync just ran, so an immediate foreground return is correctly
  // throttled; past the window it syncs, and flapping inside coalesces.
  await h.tick(AUTO_SYNC_FOCUS_THROTTLE_MS);
  h.api.notifyVisible();
  await flush();
  assert.equal(h.calls.length, 2);
  h.api.notifyVisible();
  h.api.notifyVisible();
  await flush();
  assert.equal(h.calls.length, 2);
  // After the throttle window a foreground return syncs again.
  await h.tick(AUTO_SYNC_FOCUS_THROTTLE_MS);
  h.api.notifyVisible();
  await flush();
  assert.equal(h.calls.length, 3);
});

test('conflicted run never auto-resolves; later commits still sync', async () => {
  const seen = [];
  const h = harness({
    runImpl: async (interactive) => {
      seen.push(interactive);
      return { conflicts: [{ uid: 'x', kind: 'both-changed' }] };
    },
  });
  h.api.setEnabled(true);
  const first = await h.api.request({ immediate: true });
  assert.equal(first.conflicts.length, 1);
  // The conflict itself schedules nothing extra and resolves nothing:
  // exactly one run happened, always non-interactive here.
  await h.tick(AUTO_SYNC_DEBOUNCE_MS * 2);
  assert.deepEqual(seen, [false]);
  // Other characters keep flowing: the next commit still syncs (the host
  // shows the passive banner and the existing resolve flow from the result).
  h.api.notifyCommit('local');
  await h.tick(AUTO_SYNC_DEBOUNCE_MS);
  assert.deepEqual(seen, [false, false]);
});
