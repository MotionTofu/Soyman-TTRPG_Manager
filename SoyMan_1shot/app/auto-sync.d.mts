export const AUTO_SYNC_DEBOUNCE_MS: 1500;
export const AUTO_SYNC_FOCUS_THROTTLE_MS: 20000;
export interface AutoSyncRequestOptions {
  immediate?: boolean;
  interactive?: boolean;
}
export interface AutoSyncRunResult {
  skipped?: string;
  [key: string]: any;
}
export interface AutoSync {
  setEnabled(value: boolean): void;
  isEnabled(): boolean;
  notifyCommit(origin: unknown): void;
  notifyOnline(): void;
  notifyVisible(): void;
  request(options?: AutoSyncRequestOptions): Promise<AutoSyncRunResult>;
}
export function createAutoSync(options: {
  schedule(fn: () => void, ms: number): { cancel(): void };
  now(): number;
  isOnline(): boolean;
  run(interactive: boolean): Promise<AutoSyncRunResult>;
}): AutoSync;
