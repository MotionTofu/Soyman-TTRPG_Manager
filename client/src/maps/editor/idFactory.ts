// Editor-level stable ID factory (Фаза 2G, §31).
// Mutation Core IDs не генерирует: новый ID всегда приходит извне.
// Production — UUID; tests — детерминированный счётчик (injectable).

export type IdFactory = () => string;

/** Production: uuid. Падает только если платформа без crypto.randomUUID. */
export function createUuidIdFactory(): IdFactory {
  // Запасной путь без Math.random в Core: время + счётчик сессии
  // (коллизии между сессиями ловит global ID check).
  let n = 0;
  return () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `e-${Date.now().toString(36)}-${(n++).toString(36)}`;
  };
}

/** Tests: предсказуемые `prefix-1, prefix-2, ...`. */
export function createDeterministicIdFactory(prefix = "e"): IdFactory {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
