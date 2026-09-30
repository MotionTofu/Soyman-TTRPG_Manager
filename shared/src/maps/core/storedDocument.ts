/**
 * Version-aware граница persisted map blob (§14 ТЗ Фазы 2F).
 * Отличает legacy v1–v4, V5, V6, opaque future versions и corrupt JSON.
 * Проверяется до любой миграции, проекции и сохранения:
 * legacy-ветка возвращает сырую строку для существующего legacy-флоу.
 */

export type StoredMapDocument =
  | { format: "legacy"; version: number; raw: string }
  | { format: "v5"; version: 5; raw: string }
  | { format: "v6"; version: 6; raw: string }
  | { format: "unsupported"; version: number | null; raw: string }
  | { format: "corrupt"; raw: string };

/** Raw сохраняется побайтово, unsupported никогда не попадает в legacy. */
export function parseStoredMapDocument(cells: string): StoredMapDocument {
  if (typeof cells === "string") {
    try {
      const parsed: unknown = JSON.parse(cells);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const version = (parsed as { v?: unknown }).v;
        if (version === 5) return { format: "v5", version, raw: cells };
        if (version === 6) return { format: "v6", version, raw: cells };
        if (version === 1 || version === 2 || version === 3 || version === 4) return { format: "legacy", version, raw: cells };
        return { format: "unsupported", version: typeof version === "number" && Number.isSafeInteger(version) ? version : null, raw: cells };
      }
    } catch {
      // не JSON — legacy corrupt path
    }
  }
  return { format: "corrupt", raw: cells };
}

export const MAP_VERSION_HEADER = "X-Soyman-Map-Max-Version";
/** Missing/malformed declarations grant only the old V5 capability. */
export function mapClientMaxVersion(header: unknown): number {
  return typeof header === "string" && /^[1-9]\d*$/.test(header) && Number.isSafeInteger(Number(header))
    ? Number(header) : 5;
}
