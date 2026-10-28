import { useCallback, useEffect, useState } from "react";
import { readTeleprompterFont, saveTeleprompterFont, teleprompterFontKey, validTeleprompterSize } from "./teleprompterPreferences";

const EVENT = "soyman-cutscene-teleprompter-font";
/** Uses the same per-user browser preference convention as other GM display settings. */
export function useTeleprompterFont(userId: number | null): [number, (value: number) => void] {
  const [saved, setSaved] = useState(() => ({ userId, value: readTeleprompterFont(userId) }));
  const value = saved.userId === userId ? saved.value : readTeleprompterFont(userId);
  useEffect(() => {
    const reload = () => setSaved({ userId, value: readTeleprompterFont(userId) });
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === teleprompterFontKey(userId)) reload(); };
    reload(); window.addEventListener("storage", storage); window.addEventListener(EVENT, reload);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(EVENT, reload); };
  }, [userId]);
  const set = useCallback((next: number) => {
    if (!validTeleprompterSize(next)) return;
    saveTeleprompterFont(userId, next); window.dispatchEvent(new Event(EVENT));
    setSaved({ userId, value: next });
  }, [userId]);
  return [value, set];
}
