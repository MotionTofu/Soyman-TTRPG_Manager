import { createGameplayToken, putGameplayToken, type GameplayToken, type MapDocumentV6, type TokenSourceRef, type Vec2 } from "@shared/maps/core";
import { quantize, requireEditableLayer } from "./editorCommands";

export type PlacementSource = { type: TokenSourceRef["kind"]; id: number };
export type TokenPresentation = { sourceRef: TokenSourceRef; id: number | null; name: string; state: "active" | "missing"; portrait_url: string | null };
export type ResolvedTokenSource = TokenPresentation & { id: number; state: "active"; visual: GameplayToken["appearance"]["visual"] };
export const tokenSourceKey = (ref: TokenSourceRef) => `${ref.kind}:${ref.uid.toLowerCase()}`;

/** Ignore display fields from search/bag: only the server resolves identity. */
export function placementSource(value: unknown): PlacementSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return (source.type === "being" || source.type === "location" || source.type === "compendium_entry" && (source.kind === undefined || source.kind === "monster")) && typeof source.id === "number" && Number.isSafeInteger(source.id) && source.id > 0
    ? { type: source.type, id: source.id } : null;
}
export function parsePlacementPayload(raw: string): PlacementSource | null {
  if (raw.length > 32768) return null;
  try { return placementSource(JSON.parse(raw)); } catch { return null; }
}
export function tokenTarget(document: MapDocumentV6, activeId: string): string {
  const active = document.layers.find((layer) => layer.id === activeId);
  // A selected gameplay layer is an explicit target; never bypass its lock.
  const layer = active?.kind === "gameplay" ? active : [...document.layers].reverse().find((entry) => entry.kind === "gameplay" && entry.visible && !entry.locked);
  requireEditableLayer(document, layer?.id ?? "", "gameplay");
  return layer!.id;
}
export function placeToken(document: MapDocumentV6, layerId: string, id: string, source: ResolvedTokenSource, position: Vec2, snap: boolean) {
  requireEditableLayer(document, layerId, "gameplay");
  const token = createGameplayToken(id, source.sourceRef, quantize(document, position, snap));
  return putGameplayToken(document, layerId, { ...token, appearance: { ...token.appearance, visual: source.visual } });
}
