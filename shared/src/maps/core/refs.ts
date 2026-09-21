/**
 * Типизированные ссылки на ресурсы (ADR-0003 §A.6–A.9, §G).
 * Object-discriminated: { type: "builtin", key } | { type: "asset", assetId }.
 * Raw URL запрещены. Terrain-коды — из нейтральных literals (не render.ts).
 */

import { MAP_TERRAIN_CODES } from "./literals";

export interface BuiltinRef {
  type: "builtin";
  key: string;
}

export interface AssetRef {
  type: "asset";
  assetId: string;
}

export type MaterialRef = BuiltinRef | AssetRef;
export type VisualRef = BuiltinRef | AssetRef;
export type StyleRef = BuiltinRef | AssetRef;
export type ScatterProfileRef = BuiltinRef | AssetRef;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isMaterialRef(v: unknown): v is MaterialRef {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.type === "builtin") return isNonEmptyString(r.key);
  if (r.type === "asset") return isNonEmptyString(r.assetId);
  return false;
}

export function isVisualRef(v: unknown): v is VisualRef {
  return isMaterialRef(v);
}

export function isStyleRef(v: unknown): v is StyleRef {
  return isMaterialRef(v);
}

export function isScatterProfileRef(v: unknown): v is ScatterProfileRef {
  return isMaterialRef(v);
}

/** snake_case кодов сохраняется один в один после префикса. */
export const TERRAIN_MATERIAL_KEY_PREFIX = "terrain/";

export function terrainMaterialKey(code: string): string {
  return `${TERRAIN_MATERIAL_KEY_PREFIX}${code}`;
}

export const LEGACY_TERRAIN_MATERIAL_KEYS: readonly string[] =
  MAP_TERRAIN_CODES.map((code) => terrainMaterialKey(code));

export const BUILTIN_PLAIN_MATERIAL: MaterialRef = {
  type: "builtin",
  key: terrainMaterialKey("plain"),
};

export function builtinMaterial(code: string): MaterialRef {
  return { type: "builtin", key: terrainMaterialKey(code) };
}

export const BUILTIN_ROAD_STYLE: StyleRef = { type: "builtin", key: "road" };
export const BUILTIN_RIVER_STYLE: StyleRef = { type: "builtin", key: "river" };
