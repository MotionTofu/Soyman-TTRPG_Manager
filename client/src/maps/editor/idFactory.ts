import { randomUUID } from "../../utils/uuid";

// Editor-level stable ID factory (Фаза 2G, §31).
// Mutation Core IDs не генерирует: новый ID всегда приходит извне.
// Production — UUID; tests — детерминированный счётчик (injectable).

export type IdFactory = () => string;

/** Production: UUID v4, в том числе по HTTP в локальной сети. */
export function createUuidIdFactory(): IdFactory {
  return randomUUID;
}

/** Tests: предсказуемые `prefix-1, prefix-2, ...`. */
export function createDeterministicIdFactory(prefix = "e"): IdFactory {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
