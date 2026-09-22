export const TAB_SYNC_CHANNEL: 'soyman-1shot-tab-sync-v1';
export const TAB_SYNC_VERSION: 1;
export interface TabSyncUpdatedEvent {
  version: 1;
  senderId: string;
  type: 'character-updated';
  characterId: number;
  revision: number;
}
export interface TabSyncDeletedEvent {
  version: 1;
  senderId: string;
  type: 'character-deleted';
  characterId: number;
}
export type TabSyncEvent = TabSyncUpdatedEvent | TabSyncDeletedEvent;
export interface TabSync {
  supported: boolean;
  senderId: string | null;
  publish(event: { type: 'character-updated'; characterId: number; revision: number } | { type: 'character-deleted'; characterId: number }): void;
  close(): void;
}
export function isTabSyncSupported(): boolean;
export function createTabSync(options?: { onEvent?: (event: TabSyncEvent) => void }): TabSync;
export function characterUpdated(characterId: number, revision: number): { type: 'character-updated'; characterId: number; revision: number };
export function characterDeleted(characterId: number): { type: 'character-deleted'; characterId: number };
export function decideRemoteUpdate(options: {
  hasPendingSave: boolean;
  hasUnsavedFailure: boolean;
  knownRevision: number;
  remoteRevision: number;
}): 'adopt' | 'defer' | 'ignore';
