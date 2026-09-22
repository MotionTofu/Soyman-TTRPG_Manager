export const SYNC_PAIR_HASH_PREFIX: '#pair=';
export interface SyncCredentialLike {
  version: 1;
  apiBase: string;
  spaceId: string;
  deviceId: string;
  deviceToken: string;
  linkedAt?: string;
}
export function normalizeApiBase(input: unknown): string;
export function isSyncCredential(value: unknown): boolean;
export function buildPairingLink(options: {
  appOrigin: string;
  appPath: string;
  apiBase: string;
  pairingToken: string;
}): string;
export function parsePairingLink(href: string): { apiBase: string; pairingToken: string } | null;
export function syncFetch(
  apiBase: string,
  path: string,
  options?: { token?: string; method?: string; body?: unknown },
): Promise<any>;
export function createSyncSpace(apiBase: string): Promise<{ spaceId: string; deviceId: string; deviceToken: string }>;
export function createPairing(
  apiBase: string,
  credential: { deviceToken: string },
): Promise<{ pairingToken: string; expiresAt: string }>;
export function exchangePairing(
  apiBase: string,
  pairingToken: string,
): Promise<{ spaceId: string; deviceId: string; deviceToken: string }>;
export function fetchSyncStatus(
  apiBase: string,
  credential: { deviceToken: string },
): Promise<{ connected: boolean; spaceId: string; deviceId: string }>;
export function disconnectSyncDevice(apiBase: string, credential: { deviceToken: string }): Promise<{ ok: boolean }>;
export interface RemoteCharacterEntry {
  characterUid: string;
  revision: number;
  deleted: boolean;
  updatedAt: string;
}
export function listRemoteCharacters(
  apiBase: string,
  credential: { deviceToken: string },
): Promise<RemoteCharacterEntry[]>;
export interface RemoteSnapshot {
  characterUid: string;
  revision: number;
  deleted: boolean;
  updatedAt: string;
  payload: any;
}
export function fetchRemoteSnapshot(apiBase: string, credential: { deviceToken: string }, characterUid: string): Promise<RemoteSnapshot>;
export function pushRemoteSnapshot(
  apiBase: string,
  credential: { deviceToken: string },
  characterUid: string,
  body: { baseRevision: number; payload?: unknown; deleted?: boolean },
): Promise<{ characterUid: string; revision: number; deleted: boolean }>;
export interface SyncArtifactRecord {
  hash: string;
  kind: 'catalog' | 'portrait';
  bytes: number;
  payload: any;
  stored?: boolean;
}
export function headArtifact(apiBase: string, credential: { deviceToken: string }, hash: string): Promise<boolean>;
export function putArtifact(
  apiBase: string,
  credential: { deviceToken: string },
  hash: string,
  kind: 'catalog' | 'portrait',
  payload: unknown,
): Promise<SyncArtifactRecord>;
export function fetchArtifact(
  apiBase: string,
  credential: { deviceToken: string },
  hash: string,
): Promise<SyncArtifactRecord>;
