export interface SafeResult {
  ok: boolean;
  reason?: string;
}
export function shouldNotifyForWaiting(options: { hasWaiting: boolean; hasController: boolean }): boolean;
export function shouldNotifyForInstalled(options: { hasController: boolean }): boolean;
export interface ReloadGuard {
  onControllerChange(): boolean;
  readonly reloaded: boolean;
}
export function createReloadGuard(options: { reload(): void }): ReloadGuard;
export function createControllerChangeHandler(options: {
  reload(): void;
  isUpdateInitiated(): boolean;
}): () => boolean;
export function applyUpdateSafely(options: {
  hasWaitingWorker: boolean;
  postSkipWaiting(message: { type: 'SKIP_WAITING' }): void;
  waitForSafe(): Promise<SafeResult>;
}): Promise<SafeResult>;
