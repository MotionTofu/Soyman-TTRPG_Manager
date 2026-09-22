export const SYNC_CHARACTER_FORMAT: 'soyman-sync-character';
export const SYNC_CHARACTER_VERSION: 1;
export const SYNC_CHARACTER_VERSION_V2: 2;
export function syncBundleError(code: string, message?: string): Error & { code: string };
export function sha256HexText(text: string): string;
export function utf8ByteLength(text: string): number;
export function stableStringify(value: unknown): string | undefined;
export function characterSlicePayload(
  character: import('./repository').Character,
  catalog: import('./repository').Catalog,
): { system: unknown; sections: unknown[]; entries: unknown[] };
export function canonicalCatalogSlice(slice: {
  system?: unknown;
  sections?: unknown[];
  entries?: unknown[];
}): { system: unknown; sections: unknown[]; entries: unknown[] };
export function catalogArtifactHash(canonicalSlice: unknown): string;
export function canonicalPortrait(portrait: string | null | undefined): string | null | undefined;
export function portraitArtifactHash(canonical: string): string;
export function isArtifactHash(value: unknown): boolean;
export interface SyncBundleCharacter {
  name: string;
  content: unknown;
  portrait: string | null;
  archivedAt: string | null;
}
export interface SyncBundle {
  format: 'soyman-sync-character';
  version: 1;
  characterUid: string;
  character: SyncBundleCharacter;
  catalog: { system: unknown; sections: unknown[]; entries: unknown[] };
}
export function buildSyncBundle(
  character: import('./repository').Character,
  catalog: import('./repository').Catalog | null | undefined,
  characterUid: string,
): SyncBundle;
export interface ValidatedSyncSnapshot {
  version: 1 | 2;
  characterUid: string;
  name: string;
  content: unknown;
  portrait: string | null;
  archivedAt: string | null;
  catalog: { system: unknown; sections: unknown[]; entries: unknown[] } | null;
  catalogHash: string | null;
  portraitHash: string | null;
}
export function validateSyncSnapshot(snapshot: unknown): ValidatedSyncSnapshot;
export interface SyncV2Document {
  format: 'soyman-sync-character';
  version: 2;
  characterUid: string;
  character: { name: string; content: unknown; archivedAt: string | null };
  artifacts: { catalogHash: string; portraitHash: string | null };
}
export interface SyncV2Parts {
  document: SyncV2Document;
  catalogPayload: { system: unknown; sections: unknown[]; entries: unknown[] };
  portraitPayload: string | null;
  catalogHash: string;
  portraitHash: string | null;
}
export function buildSyncV2Parts(
  character: import('./repository').Character,
  catalog: import('./repository').Catalog | null | undefined,
  characterUid: string,
): SyncV2Parts;
export interface SyncV2Transport {
  headArtifact(hash: string): Promise<boolean>;
  putArtifact(hash: string, kind: 'catalog' | 'portrait', payload: unknown): Promise<{ bytes: number }>;
  putCharacter(uid: string, body: { baseRevision: number; payload: SyncV2Document }): Promise<{ revision: number }>;
}
export interface SyncV2MetaLike {
  catalogHash?: string;
  portraitHash?: string | null;
}
export function pushCharacterV2(
  transport: SyncV2Transport,
  options: { uid: string; base: number; parts: SyncV2Parts; meta?: SyncV2MetaLike | null },
): Promise<{ revision: number; uploadedBytes: number; catalogHash: string; portraitHash: string | null }>;
export interface SyncMetaLike {
  remoteRevision: number;
  lastSyncedLocalRevision: number | null;
  deletedLocally?: boolean;
}
export interface RemoteIndexEntryLike {
  revision: number;
  deleted: boolean;
}
export type SyncDecision =
  | { action: 'push'; base: number }
  | { action: 'pull' }
  | { action: 'noop' }
  | { action: 'conflict'; kind: 'both-changed' | 'remote-deleted-unmatched' | 'remote-deleted-local-changed' | 'local-deleted-remote-changed' }
  | { action: 'push-delete'; base: number }
  | { action: 'pull-delete' }
  | { action: 'ack-tombstone' }
  | { action: 'error-duplicate' };
export function decideCharacterSync(options: {
  local?: import('./repository').Character | null;
  sync?: SyncMetaLike | null;
  remote?: RemoteIndexEntryLike | null;
  duplicateCount?: number;
}): SyncDecision;
