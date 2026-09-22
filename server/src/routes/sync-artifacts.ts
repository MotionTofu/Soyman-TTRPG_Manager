import { createHash } from "crypto";

// Content-addressed sync artifacts (phase D1.3): immutable catalog slices
// and portraits referenced from v2 character documents by SHA-256.
//
// Canonicalization MUST mirror SoyMan_1shot/app/sync-characters.mjs exactly:
// same logical slice on any device hashes the same. The mirror is pinned by
// shared fixture vectors in syncCharacters.api.test.ts — change one side and
// the vectors fail. Wire payloads ARE the canonical form; the server stores
// them verbatim after re-hashing.

export const SYNC_ARTIFACT_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const SYNC_DOCUMENT_MAX_BYTES = 1024 * 1024;
export const SYNC_CATALOG_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
export const SYNC_PORTRAIT_MAX_BYTES = 15 * 1024 * 1024;

const PORTRAIT_MIMES = new Set(["png", "jpeg", "webp"]);

export function sha256HexText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// Deterministic serialization: recursive key sort with JSON
// undefined-semantics. Mirrors stableStringify in sync-characters.mjs.
export function stableStringify(value: unknown): string | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v) ?? "null").join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => {
      const v = record[k];
      return v !== undefined && typeof v !== "function" && typeof v !== "symbol";
    })
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function sortDeepObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeepObject);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) out[k] = sortDeepObject(record[k]);
    return out;
  }
  return value;
}

export interface CanonicalCatalogSlice {
  system: unknown;
  sections: unknown[];
  entries: unknown[];
}

// Same logical slice → same hash on any device: sections/entries sorted by
// numeric id (display order travels in `position` fields), objects
// key-sorted. Mirrors canonicalCatalogSlice in sync-characters.mjs.
export function canonicalCatalogSlice(slice: {
  system?: unknown;
  sections?: unknown;
  entries?: unknown;
}): CanonicalCatalogSlice {
  const sections = Array.isArray(slice?.sections) ? slice.sections : [];
  const entries = Array.isArray(slice?.entries) ? slice.entries : [];
  const byId = (a: unknown, b: unknown) =>
    (Number((a as { id?: unknown })?.id) || 0) - (Number((b as { id?: unknown })?.id) || 0);
  return {
    system: sortDeepObject(slice?.system ?? null),
    sections: [...sections].map(sortDeepObject).sort(byId),
    entries: [...entries].map(sortDeepObject).sort(byId),
  };
}

export function catalogArtifactHash(canonicalSlice: {
  system?: unknown;
  sections?: unknown;
  entries?: unknown;
}): string {
  return sha256HexText(stableStringify(canonicalCatalogSlice(canonicalSlice)) ?? "null");
}

// Normalized data URL (lowercased mime, stripped base64) or null for
// null/undefined input. Mirrors canonicalPortrait in sync-characters.mjs:
// the app stores FileReader data URLs verbatim, so the same file is already
// the same string on any device — no image re-encoding involved.
export function canonicalPortrait(portrait: unknown): string | null | undefined {
  if (portrait === null || portrait === undefined) return null;
  if (typeof portrait !== "string") return undefined;
  const match = /^\s*data:image\/([^;,]+);base64,([\s\S]+?)\s*$/i.exec(portrait);
  if (!match) return undefined;
  const mime = match[1].toLowerCase();
  if (!PORTRAIT_MIMES.has(mime)) return undefined;
  const base64 = match[2].replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return undefined;
  return `data:image/${mime};base64,${base64}`;
}

export function portraitArtifactHash(canonical: string): string {
  return sha256HexText(canonical);
}

export function isArtifactHash(value: unknown): boolean {
  return typeof value === "string" && SYNC_ARTIFACT_HASH_PATTERN.test(value);
}

// Structural slice checks (ids, section refs, parent closure) — the same
// gate v1 snapshots passed, now applied once at artifact upload instead of
// on every character update.
export function validateCatalogArtifact(payload: unknown): CanonicalCatalogSlice {
  const fail = (message: string): never => {
    throw { status: 422, error: message };
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Повреждённый справочник в снимке.");
  }
  const cat = payload as { sections?: unknown; entries?: unknown };
  if (!Array.isArray(cat.sections) || !Array.isArray(cat.entries)) {
    fail("Повреждённый справочник в снимке.");
  }
  const sectionIds = new Set<number>();
  for (const s of cat.sections as unknown[]) {
    if (!s || typeof s !== "object" || !Number.isSafeInteger((s as { id?: unknown }).id)) {
      fail("Повреждённый справочник в снимке.");
    }
    sectionIds.add((s as { id: number }).id);
  }
  const entryIds = new Set<number>();
  for (const e of cat.entries as unknown[]) {
    if (!e || typeof e !== "object") fail("Повреждённый справочник в снимке.");
    const entry = e as { id?: unknown; section_id?: unknown; parent_id?: unknown };
    if (!Number.isSafeInteger(entry.id) || entryIds.has(entry.id as number)) {
      fail("Повреждённый справочник в снимке.");
    }
    entryIds.add(entry.id as number);
    if (!sectionIds.has(entry.section_id as number)) fail("Повреждённый справочник в снимке.");
  }
  for (const e of cat.entries as { parent_id?: unknown }[]) {
    if (e.parent_id != null && !entryIds.has(e.parent_id as number)) fail("Повреждённый справочник в снимке.");
  }
  return payload as CanonicalCatalogSlice;
}

export function validatePortraitArtifact(payload: unknown): string {
  const fail = (message: string): never => {
    throw { status: 422, error: message };
  };
  const canonical = canonicalPortrait(payload);
  if (canonical === undefined || canonical === null) fail("Некорректный портрет в снимке.");
  const base64 = (canonical as string).split(",", 2)[1] ?? "";
  if (Buffer.from(base64, "base64").length > SYNC_PORTRAIT_MAX_BYTES) {
    fail("Портрет в снимке слишком большой.");
  }
  return canonical as string;
}
