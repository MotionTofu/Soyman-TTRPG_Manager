import { tokensOf, sameTokenSource, isTokenSourceRef, type MapDocumentV6, type TokenSourceRef } from "@soyman/shared";
import fs from "fs";
import path from "path";
import { isVaultPath, toFileUrl, vaultAbs } from "./filesystem";
import { db } from "../db/db";
import { kindOf } from "../db/entityKinds";
import { entityNames, refKey } from "./entityNames";
import { uidOf } from "./mentions";

function activeSource(kind: TokenSourceRef["kind"], selector: "id" | "uid", value: string | number) {
  const registry = kindOf(kind);
  if (!registry) return undefined;
  if (kind === "compendium_entry") {
    return db.prepare(`SELECT e.id, e.uid, e.avatar_image_path FROM ${registry.table} e
      JOIN systems s ON s.id = e.system_id WHERE e.${selector} = ? COLLATE NOCASE AND e.kind = 'monster' AND s.archived_at IS NULL`)
      .get(value) as { id: number; uid: string | null; avatar_image_path: string | null } | undefined;
  }
  return db.prepare(`SELECT e.id, e.uid, e.avatar_image_path FROM ${registry.table} e
    JOIN settings s ON s.id = e.setting_id
    WHERE e.${selector} = ? COLLATE NOCASE AND e.archived_at IS NULL AND s.archived_at IS NULL`)
    .get(value) as { id: number; uid: string | null; avatar_image_path: string | null } | undefined;
}

function portrait(kind: TokenSourceRef["kind"], row: NonNullable<ReturnType<typeof activeSource>>) {
  let file = row.avatar_image_path;
  if (!file && kind === "being") {
    file = (db.prepare(`SELECT ce.avatar_image_path FROM setting_beings b JOIN compendium_entries ce ON ce.id = b.base_monster_id
      WHERE b.id = ?`).get(row.id) as { avatar_image_path: string | null } | undefined)?.avatar_image_path ?? null;
  }
  return file && isVaultPath(file) && /\.(png|jpe?g|webp|gif|avif)$/i.test(path.extname(file)) && fs.existsSync(vaultAbs(file)) ? toFileUrl(file) : null;
}

/** Display data is transient and GM-only; never copied into the document. */
export function presentMapTokenSource(ref: TokenSourceRef) {
  const row = activeSource(ref.kind, "uid", ref.uid);
  if (!row) return { sourceRef: ref, state: "missing" as const, id: null, name: "Источник недоступен", portrait_url: null };
  return { sourceRef: ref, state: "active" as const, id: row.id,
    name: entityNames([{ kind: ref.kind, id: row.id }], { preferShort: true }).get(refKey(ref.kind, row.id)) ?? "Без имени",
    portrait_url: portrait(ref.kind, row) };
}

export function presentMapTokenSources(refs: unknown) {
  if (!Array.isArray(refs) || refs.length > 2000 || !refs.every(isTokenSourceRef)) return null;
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.uid.toLowerCase()}`, ref])).values()].map(presentMapTokenSource);
}

/** GM-only caller; numeric IDs are resolved locally and never stored in tokens. */
export function resolveMapTokenSource(kind: unknown, id: unknown) {
  if ((kind !== "being" && kind !== "location" && kind !== "compendium_entry") || typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  const row = activeSource(kind, "id", id);
  if (!row) return null;
  const uid = uidOf(kind, id);
  if (!uid) return null;
  const name = entityNames([{ kind, id }], { preferShort: true }).get(refKey(kind, id)) ?? "Без имени";
  const sourceRef: TokenSourceRef = { kind, uid: uid.toLowerCase() };
  const portrait_url = portrait(kind, row);
  return { sourceRef, id, name, state: "active" as const, portrait_url,
    visual: portrait_url ? { type: "entity-avatar" as const, source: sourceRef } : { type: "builtin" as const, key: kind === "location" ? "location" as const : "being" as const } };
}

/** An orphan exemption is granted only by the persisted token ID AND ref. */
export function validateMapTokenSources(next: MapDocumentV6, previous?: MapDocumentV6): string | null {
  const old = new Map(previous ? tokensOf(previous).map((t) => [t.id, t]) : []);
  for (const token of tokensOf(next)) {
    const ref = token.sourceRef;
    if (!ref) continue;
    if (activeSource(ref.kind, "uid", ref.uid)) continue;
    const persisted = old.get(token.id);
    if (!persisted || !sameTokenSource(persisted.sourceRef, ref)) return `Источник токена ${token.id} отсутствует или находится в архиве`;
  }
  return null;
}
