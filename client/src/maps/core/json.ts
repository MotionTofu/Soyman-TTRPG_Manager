// JSON-совместимые значения canonical-модели (ADR-0003 §A.1).
// Persisted model типово не допускает Date/Map/Set/Function/undefined —
// только string/number/boolean/null/array/object.

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = JsonValue[];

export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

// Глубокая runtime-проверка JSON-безопасности (для properties/overrides/
// payload). NaN/Infinity/undefined/function/symbol/bigint — не JSON-safe.
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") return false;
  if (Array.isArray(value)) {
    for (const item of value) if (!isJsonValue(item)) return false;
    return true;
  }
  if (t === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (!isJsonValue(v)) return false;
    }
    return true;
  }
  return false;
}
