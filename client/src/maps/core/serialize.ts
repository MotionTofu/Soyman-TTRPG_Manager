// Детерминированный serializer V5 (§13 ТЗ).
// canonicalizeMapDocument строит объекты в фиксированном порядке ключей —
// JSON.stringify после неё детерминирован. Один и тот же canonical doc →
// одна и та же строка. Собственный JSON-encoder не нужен.

import { canonicalizeMapDocument } from "./canonicalize";
import type { MapDocumentV5 } from "./types";

export function serializeMapDocument(doc: MapDocumentV5): string {
  return JSON.stringify(canonicalizeMapDocument(doc));
}
