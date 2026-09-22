// Optional device sync, client side (phase D1.1).
//
// Framework-free so node:test covers the pure parts. Only transports sync
// metadata (space/device/pairing) — never character data. The deviceToken
// lives in the IndexedDB settings key 'sync' (see repository) and must never
// reach portable HTML, character backups, BroadcastChannel, console or
// error messages: this module never logs credentials and error mapping
// keeps server texts only.

export const SYNC_PAIR_HASH_PREFIX = '#pair=';

// Normalized sync API base: http(s), no trailing slash, no path tricks.
// Throws a plain Error (UI message) on anything else — never localhost or a
// production domain is hardcoded anywhere.
export function normalizeApiBase(input) {
  const text = typeof input === 'string' ? input.trim().replace(/\/+$/, '') : '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Error('Укажите адрес сервера SoyMan, например http://192.168.1.5:3001');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
    throw Error('Укажите адрес сервера SoyMan, например http://192.168.1.5:3001');
  }
  return url.toString().replace(/\/+$/, '');
}

export function isSyncCredential(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) return false;
  for (const key of ['apiBase', 'spaceId', 'deviceId', 'deviceToken']) {
    if (typeof value[key] !== 'string' || !value[key]) return false;
  }
  try {
    normalizeApiBase(value.apiBase);
  } catch {
    return false;
  }
  return true;
}

// Pairing link: the API base travels as a plain query param (not secret),
// the one-time token in the URL fragment (never sent to the static host,
// never in referrers). Built from the live location: no hardcoded origin,
// subpath-safe.
export function buildPairingLink({ appOrigin, appPath, apiBase, pairingToken }) {
  return `${appOrigin}${appPath}?api=${encodeURIComponent(apiBase)}${SYNC_PAIR_HASH_PREFIX}${encodeURIComponent(pairingToken)}`;
}

// Returns { apiBase, pairingToken } or null when this URL carries no invite.
export function parsePairingLink(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const apiBase = url.searchParams.get('api');
  const hash = url.hash || '';
  if (!apiBase || !hash.startsWith(SYNC_PAIR_HASH_PREFIX)) return null;
  const pairingToken = decodeURIComponent(hash.slice(SYNC_PAIR_HASH_PREFIX.length));
  if (!pairingToken) return null;
  try {
    normalizeApiBase(apiBase);
  } catch {
    return null;
  }
  return { apiBase: normalizeApiBase(apiBase), pairingToken };
}

function syncErrorMessage(status, body) {
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error;
  if (status === 401) return 'Нет доступа. Проверьте подключение синхронизации.';
  if (status === 409) return 'Конфликт синхронизации: версия на сервере новее.';
  if (status === 410) return 'Ссылка для подключения устарела.';
  if (status === 413) return 'Слишком большой запрос.';
  if (status === 429) return 'Слишком много попыток, попробуйте позже.';
  return 'Не удалось выполнить запрос синхронизации.';
}

export async function syncFetch(apiBase, path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Error('NETWORK_UNREACHABLE');
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = Error(syncErrorMessage(response.status, parsed));
    if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') error.code = parsed.code;
    throw error;
  }
  return parsed ?? {};
}

export function createSyncSpace(apiBase) {
  return syncFetch(apiBase, '/api/sync/spaces', { method: 'POST', body: {} });
}

export function createPairing(apiBase, credential) {
  return syncFetch(apiBase, '/api/sync/pairings', { method: 'POST', token: credential.deviceToken, body: {} });
}

export function exchangePairing(apiBase, pairingToken) {
  return syncFetch(apiBase, '/api/sync/pair/exchange', { method: 'POST', body: { pairingToken } });
}

export function fetchSyncStatus(apiBase, credential) {
  return syncFetch(apiBase, '/api/sync/status', { token: credential.deviceToken });
}

export function disconnectSyncDevice(apiBase, credential) {
  return syncFetch(apiBase, '/api/sync/devices/disconnect', { method: 'POST', token: credential.deviceToken, body: {} });
}

export function listRemoteCharacters(apiBase, credential) {
  return syncFetch(apiBase, '/api/sync/characters', { token: credential.deviceToken });
}

export function fetchRemoteSnapshot(apiBase, credential, characterUid) {
  return syncFetch(apiBase, `/api/sync/characters/${encodeURIComponent(characterUid)}`, {
    token: credential.deviceToken,
  });
}

export function pushRemoteSnapshot(apiBase, credential, characterUid, body) {
  return syncFetch(apiBase, `/api/sync/characters/${encodeURIComponent(characterUid)}`, {
    method: 'PUT',
    token: credential.deviceToken,
    body,
  });
}

// Immutable content-addressed artifacts (phase D1.3): catalog slices and
// portraits referenced from v2 character documents by SHA-256. HEAD is the
// existence probe (no batch endpoint — pushes check at most two hashes, and
// meta-known hashes skip the network entirely); PUT is idempotent; GET
// returns the canonical payload the server itself hashed.
function artifactErrorMessage(status) {
  if (status === 401) return 'Нет доступа. Проверьте подключение синхронизации.';
  if (status === 404) return 'Артефакт не найден на сервере.';
  if (status === 413) return 'Слишком большой запрос.';
  if (status === 429) return 'Слишком много попыток, попробуйте позже.';
  return 'Не удалось выполнить запрос синхронизации.';
}

export async function headArtifact(apiBase, credential, hash) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/sync/artifacts/${encodeURIComponent(hash)}`, {
      method: 'HEAD',
      headers: credential ? { Authorization: `Bearer ${credential.deviceToken}` } : {},
    });
  } catch {
    throw Error('NETWORK_UNREACHABLE');
  }
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw Error(artifactErrorMessage(response.status));
}

export function putArtifact(apiBase, credential, hash, kind, payload) {
  return syncFetch(apiBase, `/api/sync/artifacts/${encodeURIComponent(hash)}`, {
    method: 'PUT',
    token: credential.deviceToken,
    body: { kind, payload },
  });
}

export function fetchArtifact(apiBase, credential, hash) {
  return syncFetch(apiBase, `/api/sync/artifacts/${encodeURIComponent(hash)}`, {
    token: credential.deviceToken,
  });
}

// Read-only character shares for the GM (phase D2.1). Management is
// device-authed (same Bearer as sync); the issued shareToken authorizes
// exactly one public snapshot. The raw token is shown once and kept in
// local settings — the server stores only its hash.
export function listShares(apiBase, credential) {
  return syncFetch(apiBase, '/api/sync/shares', { token: credential.deviceToken });
}

export function createShare(apiBase, credential, characterUid, payload) {
  return syncFetch(apiBase, '/api/sync/shares', {
    method: 'POST',
    token: credential.deviceToken,
    body: { characterUid, payload },
  });
}

export function updateShare(apiBase, credential, characterUid, payload) {
  return syncFetch(apiBase, `/api/sync/shares/${encodeURIComponent(characterUid)}`, {
    method: 'PUT',
    token: credential.deviceToken,
    body: { payload },
  });
}

export function revokeShare(apiBase, credential, characterUid) {
  return syncFetch(apiBase, `/api/sync/shares/${encodeURIComponent(characterUid)}`, {
    method: 'DELETE',
    token: credential.deviceToken,
  });
}
