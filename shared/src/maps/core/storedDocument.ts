/**
 * Version-aware граница persisted map blob (§14 ТЗ Фазы 2F).
 * Отличает legacy cells v1–v4 от MapDocumentV5 по parsed JSON/version
 * semantics (v === 5), а не по substring. Не затаскивает MapCells в kernel:
 * legacy-ветка возвращает сырую строку для существующего legacy-флоу.
 */

export type StoredMapDocument =
  | { format: "legacy"; raw: string }
  | { format: "v5"; raw: string };

/** Некорректный JSON тоже считается legacy: его отклонит legacy-валидация. */
export function parseStoredMapDocument(cells: string): StoredMapDocument {
  if (typeof cells === "string") {
    try {
      const parsed: unknown = JSON.parse(cells);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { v?: unknown }).v === 5
      ) {
        return { format: "v5", raw: cells };
      }
    } catch {
      // не JSON — legacy corrupt path
    }
  }
  return { format: "legacy", raw: cells };
}
