// Cross-tab invalidation (phase C3).
//
// BroadcastChannel is a NOTIFICATION only — never a second source of truth.
// Events carry ids and revisions, never character data (no content, portrait,
// catalog, HP or notes). A receiving tab re-reads the record from IndexedDB,
// which stays the single source of truth. Reads never publish: the flow is
// always commit -> event -> read, so no loop is possible.
//
// This module owns channel mechanics only (create/publish/subscribe/close +
// feature detection). No repository or business logic lives here.
export const TAB_SYNC_CHANNEL = 'soyman-1shot-tab-sync-v1';
export const TAB_SYNC_VERSION = 1;

export function isTabSyncSupported() {
  return typeof BroadcastChannel !== 'undefined';
}

function newSenderId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* non-secure contexts fall through */ }
  return `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

// One instance per tab (created once on mount, closed on unmount). Own
// messages are ignored by senderId so a tab never reacts to itself.
export function createTabSync({ onEvent } = {}) {
  if (!isTabSyncSupported()) return { supported: false, senderId: null, publish() {}, close() {} };
  const senderId = newSenderId();
  const channel = new BroadcastChannel(TAB_SYNC_CHANNEL);
  channel.onmessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== 'object') return;
    if (message.version !== TAB_SYNC_VERSION) return;
    if (!message.senderId || message.senderId === senderId) return;
    if (message.type !== 'character-updated' && message.type !== 'character-deleted') return;
    if (typeof message.characterId !== 'number') return;
    try { onEvent?.(message); } catch { /* a bad subscriber must not break the channel */ }
  };
  return {
    supported: true,
    senderId,
    publish(event) {
      try { channel.postMessage({ version: TAB_SYNC_VERSION, senderId, ...event }); }
      catch { /* transient post failures never break the app */ }
    },
    close() {
      try { channel.close(); } catch { /* already closed */ }
    },
  };
}

export function characterUpdated(characterId, revision) {
  return { type: 'character-updated', characterId, revision };
}

export function characterDeleted(characterId) {
  return { type: 'character-deleted', characterId };
}

// Remote-update policy, pure so node:test covers the matrix:
// - stale or same revision -> ignore (nothing new);
// - our own save failed and holds unsaved work -> ignore (adopting the
//   winner would wipe the only copy of failed edits and lie to the backup
//   prompt; the user reloads manually when ready);
// - a local save is still in flight -> defer (re-read after the queue
//   settles, so we never swap state mid-write);
// - otherwise -> adopt (re-read latest from IndexedDB).
export function decideRemoteUpdate({ hasPendingSave, hasUnsavedFailure, knownRevision, remoteRevision }) {
  if (!Number.isSafeInteger(remoteRevision) || !Number.isSafeInteger(knownRevision)) return 'ignore';
  if (remoteRevision <= knownRevision) return 'ignore';
  if (hasUnsavedFailure) return 'ignore';
  if (hasPendingSave) return 'defer';
  return 'adopt';
}
