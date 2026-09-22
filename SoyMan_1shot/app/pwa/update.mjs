// PWA update helpers (phase A2.3).
//
// Framework-free so node:test covers the flow without a browser. The React
// shell (app/main.tsx) wires these to navigator.serviceWorker; all DOM and
// service-worker access stays there, all decisions live here.
//
// Flow: a waiting SW means a new shell is staged. Notify only when a
// controller already exists (a fresh first install has no controller and must
// stay silent). Applying posts SKIP_WAITING to the waiting worker; the
// resulting controllerchange reloads exactly once via the guard below.
// skipWaiting is never called automatically — only from the explicit user
// action that flows through applyUpdateSafely.

// A waiting worker staged at page load is an update only when this tab is
// already controlled. First install (no controller) stays silent.
export function shouldNotifyForWaiting({ hasWaiting, hasController }) {
  return Boolean(hasWaiting && hasController);
}

// installing -> installed via updatefound is an update only when this tab is
// already controlled. First install (no controller) stays silent.
export function shouldNotifyForInstalled({ hasController }) {
  return Boolean(hasController);
}

// Reload-once guard for controllerchange. Without it, repeated
// controllerchange events (multi-tab, re-activation) reload in a loop.
export function createReloadGuard({ reload }) {
  let reloaded = false;
  return {
    onControllerChange() {
      if (reloaded) return false;
      reloaded = true;
      reload();
      return true;
    },
    get reloaded() {
      return reloaded;
    },
  };
}

// Page wiring for controllerchange. Reloads only when THIS tab initiated the
// update via applyUpdateSafely below — never on first-install claim (which
// also fires controllerchange) and never for a neighbour tab that did not
// ask. Other tabs pick the new SW up on their next natural navigation.
export function createControllerChangeHandler({ reload, isUpdateInitiated }) {
  const guard = createReloadGuard({ reload });
  return function onControllerChange() {
    if (!isUpdateInitiated()) return false;
    return guard.onControllerChange();
  };
}

// Applies a staged update only from an explicit user gesture and only after
// the caller confirms a safe state (pending character writes flushed via the
// existing save queue — no second save system here). Never reloads directly:
// the waiting worker activates and controllerchange performs the single
// reload through createReloadGuard.
export async function applyUpdateSafely({ hasWaitingWorker, postSkipWaiting, waitForSafe }) {
  if (!hasWaitingWorker) return { ok: false, reason: 'no-waiting-worker' };
  const gate = await waitForSafe();
  if (!gate.ok) return gate;
  postSkipWaiting({ type: 'SKIP_WAITING' });
  return { ok: true };
}
