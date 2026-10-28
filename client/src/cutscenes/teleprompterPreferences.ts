import { CUTSCENE_DEFAULTS } from "@shared/cutscenes/defaults";

export function teleprompterFontKey(userId: number | null): string | null {
  return userId !== null && Number.isSafeInteger(userId) && userId > 0 ? `soyman.cutscene.teleprompter.font-size.${userId}` : null;
}
export function validTeleprompterSize(value: number): boolean { return Number.isFinite(value) && value > 0; }
export function readTeleprompterFont(userId: number | null): number {
  const key = teleprompterFontKey(userId);
  try {
    const value = key && typeof window !== "undefined" ? Number(localStorage.getItem(key)) : 0;
    return validTeleprompterSize(value) ? value : CUTSCENE_DEFAULTS.fontSizePx;
  } catch { return CUTSCENE_DEFAULTS.fontSizePx; }
}
export function saveTeleprompterFont(userId: number | null, value: number): void {
  const key = teleprompterFontKey(userId);
  if (!key || !validTeleprompterSize(value)) return;
  try { localStorage.setItem(key, String(value)); } catch { /* Personal controls remain usable without browser storage. */ }
}
