import { audioAuthority } from "./audioOwnership";

const listeners = new Set<() => void>();
/** Ordinary playback replaces music left by a completed cutscene in this GM host. */
export function ordinaryBackgroundIntent(): void {
  if (!audioAuthority.owns("background")) listeners.forEach(listener => listener());
}
export function onOrdinaryBackgroundIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
