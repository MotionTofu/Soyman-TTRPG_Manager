// Строгий parser V5 (§14 ТЗ): JSON/unknown → структура → v === 5 →
// invariants → typed MapDocumentV5. Пользовательский файл с ошибками
// возвращает ValidationIssue[], а не бросает исключения наружу.

import { canonicalizeMapDocument } from "./canonicalize";
import type { MapDocumentV5 } from "./types";
import { validateMapDocument, type ValidationIssue } from "./validate";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] };

function err(code: string, path: string, message: string): ParseResult<MapDocumentV5> {
  return { ok: false, errors: [{ code, path, message }] };
}

export function parseMapDocument(raw: string | unknown): ParseResult<MapDocumentV5> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err("json.syntax", "", "not valid JSON");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err("root.not-object", "", "document must be an object");
  }
  const issues = validateMapDocument(parsed);
  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }
  return { ok: true, value: canonicalizeMapDocument(parsed as MapDocumentV5) };
}
