// Optional automatic runs of the existing sync engine (phase D1.4).
//
// This module decides only WHEN to sync — never how. Push/pull/conflict/
// tombstone/CAS/artifact decisions stay inside the D1.2/D1.3 engine; here
// is just: debounce, one-in-flight, coalescing, rerun, trigger policy.
//
// Framework-free and dependency-free (no DndCharacterData, no artifacts,
// no IndexedDB) so node:test covers it with a fake scheduler — no real
// 1.5s timer waits. The host (main.tsx) injects:
//   schedule(fn, ms) -> { cancel() }  — timer (setTimeout in prod)
//   now() -> ms                       — clock
//   isOnline() -> boolean             — connectivity probe
//   run(interactive) -> Promise<*>    — one engine pass; interactive runs
//     show errors/modals, background runs stay passive (host decides).
//
// Contract with the host:
// - enabled gates AUTO triggers (commit/online/visible), never request()
//   itself: the manual button calls request() directly and works when
//   auto-sync is off, after errors and after offline periods.
// - request() returns a promise of the executed run's result; concurrent
//   callers coalesce into runs, never parallel.
// - background runs that find no network resolve { skipped: 'offline' }
//   instead of failing; interactive runs always attempt the network.
// - conflicts are reported through run results; the orchestrator never
//   resolves, retries or re-fires because of them.

export const AUTO_SYNC_DEBOUNCE_MS = 1500;
export const AUTO_SYNC_FOCUS_THROTTLE_MS = 20000;

export function createAutoSync({ schedule, now, isOnline, run }) {
  if (typeof schedule !== 'function' || typeof now !== 'function'
    || typeof isOnline !== 'function' || typeof run !== 'function') {
    throw Error('auto-sync needs schedule/now/isOnline/run');
  }
  let enabled = false;
  let timer = null;
  let inFlight = false;
  let waiters = [];
  let lastRunAt = 0;

  async function execute() {
    inFlight = true;
    try {
      for (;;) {
        const batch = waiters;
        waiters = [];
        // Manual requests ride along as interactive: the run shows errors
        // and conflict UI exactly like a pressed button.
        const interactive = batch.some((w) => w.interactive);
        lastRunAt = now();
        if (!interactive && !isOnline()) {
          const skipped = { skipped: 'offline' };
          batch.forEach((w) => w.resolve(skipped));
        } else {
          try {
            const result = await run(interactive);
            batch.forEach((w) => w.resolve(result));
          } catch (e) {
            batch.forEach((w) => w.reject(e));
          }
        }
        // A commit that landed mid-run (or a manual press) guarantees one
        // more pass so fresh changes are never lost to a raced debounce.
        // New request() calls during a run always land in waiters
        // (inFlight stays true until the loop exits), so the loop sees them.
        if (waiters.length === 0) break;
      }
    } finally {
      inFlight = false;
    }
  }

  function requestSync(options = {}) {
    const interactive = options.interactive === true;
    const immediate = options.immediate === true;
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject, interactive });
      if (inFlight) return;
      if (immediate) {
        if (timer) { timer.cancel(); timer = null; }
        void execute();
        return;
      }
      if (timer) timer.cancel();
      timer = schedule(() => { timer = null; void execute(); }, AUTO_SYNC_DEBOUNCE_MS);
    });
  }

  return {
    setEnabled(value) {
      enabled = value === true;
      if (!enabled && timer) { timer.cancel(); timer = null; }
      if (!enabled) waiters = [];
    },
    isEnabled: () => enabled,
    // Durable LOCAL commit observed (repository notifies with origin).
    // Remote-origin commits and bare BC receives never reach here.
    notifyCommit(origin) {
      if (!enabled || origin !== 'local') return;
      void requestSync({ immediate: false }).catch(() => {});
    },
    notifyOnline() {
      if (!enabled) return;
      void requestSync({ immediate: true }).catch(() => {});
    },
    // Focus/visibility trigger, throttled so fast Alt+Tab flapping does not
    // spray the network. Shares the clock with run starts: a recent run
    // (mount sync, commit sync) suppresses the trigger.
    notifyVisible() {
      if (!enabled) return;
      if (now() - lastRunAt < AUTO_SYNC_FOCUS_THROTTLE_MS) return;
      void requestSync({ immediate: true }).catch(() => {});
    },
    request: requestSync,
  };
}
