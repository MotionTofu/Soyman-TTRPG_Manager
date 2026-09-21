// Единый result/error-контракт V5 mutations (Фаза 2E).
// Валидный no-op отличается от невалидного запроса:
//   { ok: true, changed: false }  — ничего менять не нужно;
//   { ok: false, issues }         — структурно ошибочный запрос.

import type { EntityId, MapDocumentV5 } from "../types";

export interface MutationIssue {
  code: string;
  path: string;
  message: string;
}

export type MutationResult =
  | { ok: true; changed: boolean; document: MapDocumentV5; entityId?: EntityId }
  | { ok: false; issues: MutationIssue[] };

export function mutationError(
  code: string,
  path: string,
  message: string,
): MutationResult {
  return { ok: false, issues: [{ code, path, message }] };
}

/** No-op: тот же reference (важно для будущего History boundary). */
export function noChange(document: MapDocumentV5): MutationResult {
  return { ok: true, changed: false, document };
}

export function changed(
  document: MapDocumentV5,
  entityId?: EntityId,
): MutationResult {
  return entityId === undefined
    ? { ok: true, changed: true, document }
    : { ok: true, changed: true, document, entityId };
}
