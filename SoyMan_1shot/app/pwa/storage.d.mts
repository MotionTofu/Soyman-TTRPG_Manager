export interface StorageLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}
export interface StorageStatus {
  supported: boolean;
  persisted: boolean | null;
  usageText: string | null;
}
export function storageApiKind(storage: unknown): 'supported' | 'unsupported';
export function formatLocalBytes(bytes: unknown): string | null;
export function readStorageStatus(storage: StorageLike | undefined | null): Promise<StorageStatus>;
export function requestPersistentStorage(storage: StorageLike): Promise<{ ok: boolean }>;
export function shouldAdviseBackup(options: {
  supported: boolean;
  persisted: boolean | null;
  hasCharacters: boolean;
}): boolean;
export function storageProtectionText(options: { supported: boolean; persisted: boolean | null }): string;
