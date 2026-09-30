import { canonicalizeMapDocumentV6, detachGameplayToken, parseMapDocumentV6, upgradeMapDocumentV5,
  type MapDocumentV6, type ParseResult } from "@shared/maps/core";
import type { GeneratorParams } from "../generate";
import { buildSoyMapV2, importSoyMapV1, parseSoyMapV2, type SoyMapV2Meta } from "./exchangeV2";

export interface SoyMapV3Envelope extends SoyMapV2Meta {
  format: "soyman-map/3";
  generator?: GeneratorParams;
  document: MapDocumentV6;
}
/** Explicit master backup retains refs; portable/player export is ticket 09. */
export function buildMasterSoyMapV3(meta: SoyMapV2Meta, document: MapDocumentV6, generator?: GeneratorParams): SoyMapV3Envelope {
  const result = parseMapDocumentV6(document);
  if (!result.ok) throw new Error("invalid V6 document");
  return { format: "soyman-map/3", ...meta, ...(generator ? { generator } : {}), document: result.value };
}
export function parseSoyMapV3(raw: unknown): ParseResult<SoyMapV3Envelope> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ code: "envelope.not-object", path: "", message: "expected envelope" }] };
  const env = raw as SoyMapV3Envelope;
  if (env.format !== "soyman-map/3") return { ok: false, errors: [{ code: "envelope.bad-format", path: "format", message: "expected soyman-map/3" }] };
  const parsed = parseMapDocumentV6(env.document);
  if (!parsed.ok) return parsed;
  const doc = parsed.value;
  const old = parseSoyMapV2(buildSoyMapV2(env, { ...doc, v: 5, layers: doc.layers.map((l) =>
    l.kind === "gameplay" ? { ...l, items: l.items.filter((e) => e.kind !== "token") } : l) }, env.generator));
  if (!old.ok) return old;
  return { ok: true, value: { format: "soyman-map/3", name: old.value.name, scale: old.value.scale,
    cellLore: old.value.cellLore, ...(old.value.generator ? { generator: old.value.generator } : {}), document: doc } };
}
/** Import never attaches foreign UIDs or numeric IDs automatically. */
export function importSoyMapV3(raw: unknown): ParseResult<SoyMapV3Envelope> {
  const format = raw && typeof raw === "object" ? (raw as { format?: unknown }).format : null;
  if (format === "soyman-map/1") {
    const old = importSoyMapV1(raw);
    return old.ok ? { ok: true, value: buildMasterSoyMapV3({ name: old.value.meta.name, scale: old.value.meta.scale,
      cellLore: old.value.meta.cellLore }, upgradeMapDocumentV5(old.value.document), old.value.meta.gen) } : old;
  }
  if (format === "soyman-map/2") {
    const old = parseSoyMapV2(raw);
    return old.ok ? { ok: true, value: buildMasterSoyMapV3(old.value, upgradeMapDocumentV5(old.value.document), old.value.generator) } : old;
  }
  const parsed = parseSoyMapV3(raw);
  if (!parsed.ok) return parsed;
  const doc = parsed.value.document;
  return { ok: true, value: { ...parsed.value, document: canonicalizeMapDocumentV6({ ...doc, layers: doc.layers.map((l) =>
    l.kind === "gameplay" ? { ...l, items: l.items.map((e) => e.kind === "token"
      ? detachGameplayToken(e, e.label.mode === "custom" ? e.label.text : "Без связи") : e) } : l) }) } };
}
