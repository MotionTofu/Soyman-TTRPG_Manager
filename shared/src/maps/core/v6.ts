/** V6 extends V5 geometry without changing the V5 reader/writer contract. */
import { canonicalizeMapDocument } from "./canonicalize";
import { parseMapDocument, type ParseResult } from "./parse";
import { projectMapDocumentForPlayer } from "./playerProjection";
import type { EntityId, GameplayEntity, GameplayLayer, MapDocumentV5, MapRecordV5, MapLayer, Vec2 } from "./types";
import { validateMapDocument, type ValidationIssue } from "./validate";

export interface TokenSourceRef { kind: "being" | "location" | "compendium_entry"; uid: string }
export type TokenVisualRef =
  | { type: "builtin"; key: "being" | "location" }
  | { type: "asset"; assetId: string }
  | { type: "entity-avatar"; source: TokenSourceRef };
// Gallery selection requires stable image identities; it is not accepted yet.
export interface GameplayToken {
  id: EntityId;
  kind: "token";
  position: Vec2;
  size: number;
  rotation: number;
  sourceRef: TokenSourceRef | null;
  appearance: { shape: "circle" | "diamond"; visual: TokenVisualRef };
  label: { mode: "source" } | { mode: "custom"; text: string };
  playerVisibility: "private" | "public";
}
export type GameplayEntityV6 = GameplayEntity | GameplayToken;
export interface GameplayLayerV6 extends Omit<GameplayLayer, "items"> { items: GameplayEntityV6[] }
export type MapLayerV6 = Exclude<MapLayer, GameplayLayer> | GameplayLayerV6;
export type MapDrawingStyle = "blueprint" | "paper-ink" | "comic-punk";
export const MAP_WATER_LOOKS = ["comic", "pond", "sea", "soft"] as const;
export type MapWaterLook = typeof MAP_WATER_LOOKS[number];
/** Рецепт жидкости, заведённый Мастером на этой карте. Материал в слое — `village-<key>-<глубина>`; правка рецепта
 * перекрашивает всё, что им накрашено. Готовые рецепты (вода, лава…) живут в клиенте и здесь не хранятся. */
export const MAP_LIQUID_PATTERNS = ["ripple", "cracks", "bubbles", "mist", "smooth"] as const;
export const MAP_LIQUID_RIMS = ["foam", "none", "scorch", "wet", "hatch"] as const;
export interface MapLiquidRecipe {
  /** own1…own7 */ key: string; name: string;
  /** Глубина, середина, блик: #rrggbb. */ tones: [string, string, string];
  /** Подвижность 0…2, крупность рисунка 0,25…4, видимость дна 0…1, свечение 0…1. */
  pace: number; size: number; bed: number; glow: number;
  pattern: typeof MAP_LIQUID_PATTERNS[number]; rim: typeof MAP_LIQUID_RIMS[number];
  /** По жидкости ходят: переправа не нужна. */ solid: boolean;
  /** Берег (гриллинг 2026-10-15, В6): ширина перехода 0…1 и рваность 0…1. Нет — как у воды. */ shore?: number; ragged?: number;
  /** Жидкость набора ассетов (В12): код вещи набора. Значения выше — снимок рецепта набора: редактор подтягивает правки
   * набора, а игроки и всё, что наборов не читает, рисуют по снимку. */ ref?: string;
}
const LIQUID_RANGES = [["pace", 0, 2], ["size", 0.25, 4], ["bed", 0, 1], ["glow", 0, 1]] as const;
function liquidIssue(value: unknown, taken: Set<unknown>): string | null {
  if (!record(value)) return "expected a recipe";
  if (typeof value.key !== "string" || !/^own[1-7]$/.test(value.key) || taken.has(value.key)) return "key must be a unique own1..own7";
  taken.add(value.key);
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 40) return "name must be 1..40 characters";
  if (!Array.isArray(value.tones) || value.tones.length !== 3 || value.tones.some(tone => typeof tone !== "string" || !/^#[0-9a-f]{6}$/i.test(tone))) return "tones must be three #rrggbb";
  for (const [key, min, max] of LIQUID_RANGES) { const n = value[key]; if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return `${key} must be ${min}..${max}`; }
  if (!(MAP_LIQUID_PATTERNS as readonly unknown[]).includes(value.pattern)) return "unknown pattern";
  if (!(MAP_LIQUID_RIMS as readonly unknown[]).includes(value.rim)) return "unknown rim";
  if (value.ref !== undefined && (typeof value.ref !== "string" || !/^[0-9a-z-]{1,64}$/i.test(value.ref))) return "ref must be a pack item code";
  for (const key of ["shore", "ragged"] as const) { const n = value[key]; if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) return `${key} must be 0..1`; }
  return typeof value.solid === "boolean" ? null : "solid must be boolean";
}
export interface MapDocumentV6 extends Omit<MapDocumentV5, "v" | "layers"> {
  v: 6; layers: MapLayerV6[];
  /** Map presentation is independent of generated geometry and app theme. */
  appearance?: { style: MapDrawingStyle;
    /** Поля вокруг карты, клеток: докуда доходит камера и что попадает в картинку. Без поля камера свободна. */
    frame?: number;
    /** Живая вода вместо воды-картинки и её вид. Без поля вода остаётся картинкой. */
    water?: MapWaterLook;
    /** Скорость живой воды, 0…3 (без поля — 1) и крупность пиксельных видов, точек на клетку 4…16 (без поля — 8). */
    waterSpeed?: number; waterPixels?: number;
    /** Отмель: на скольких клетках от берега вода набирает свою глубину, 0…6 (без поля — 0, отмели нет). */
    waterShoal?: number;
    /** Подключённые наборы карты: каталог редактора показывает только их. Нет списка — подключено всё подходящее. */
    packs?: string[];
    /** Свои жидкости карты, до семи. */
    liquids?: MapLiquidRecipe[] };
}
export interface MapRecordV6 extends Omit<MapRecordV5, "document"> { revision: number; document: MapDocumentV6 }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isTokenSourceRef(v: unknown): v is TokenSourceRef {
  return record(v) && (v.kind === "being" || v.kind === "location" || v.kind === "compendium_entry") && typeof v.uid === "string" && uuid.test(v.uid);
}
export function sameTokenSource(a: TokenSourceRef | null, b: TokenSourceRef | null): boolean {
  return a === null ? b === null : b !== null && a.kind === b.kind && a.uid.toLowerCase() === b.uid.toLowerCase();
}
export function validateGameplayToken(value: unknown, path = "token"): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const bad = (field: string, message: string, code = "token.invalid") => errors.push({ code, path: `${path}.${field}`, message });
  if (!record(value)) return [{ code: "token.invalid", path, message: "expected token object" }];
  if (value.kind !== "token") bad("kind", "expected token");
  if (typeof value.id !== "string" || !value.id.trim()) bad("id", "expected stable non-empty ID");
  if (!record(value.position) || !finite(value.position.x) || !finite(value.position.y)) bad("position", "expected finite world coordinates");
  if (!finite(value.size) || value.size <= 0) bad("size", "expected positive diameter");
  if (!finite(value.rotation)) bad("rotation", "expected finite rotation");
  if (value.sourceRef !== null && !isTokenSourceRef(value.sourceRef)) bad("sourceRef", "expected being/location/compendium_entry UID or null");
  if (!record(value.label) || (value.label.mode !== "source" && value.label.mode !== "custom")) bad("label", "expected source/custom label");
  else if (value.label.mode === "custom" && (typeof value.label.text !== "string" || value.label.text.length > 200)) bad("label.text", "expected text up to 200 characters");
  else if (value.label.mode === "source" && value.sourceRef === null) bad("label", "detached token requires custom label");
  if (value.playerVisibility !== "private" && value.playerVisibility !== "public") bad("playerVisibility", "expected private/public");
  if (!record(value.appearance) || !["circle", "diamond"].includes(value.appearance.shape as string)) bad("appearance.shape", "expected circle/diamond");
  const visual = record(value.appearance) ? value.appearance.visual : null;
  if (!record(visual)) bad("appearance.visual", "expected logical visual ref");
  else if (visual.type === "builtin") {
    if (visual.key !== "being" && visual.key !== "location") bad("appearance.visual.key", "unknown silhouette");
  } else if (visual.type === "asset") {
    if (typeof visual.assetId !== "string" || !visual.assetId.trim() ||
      /\\|^(?:https?|file|data|blob):|^[a-z]:|^\/|:\/|(^|\/)\.\.(\/|$)/i.test(visual.assetId)) bad("appearance.visual.assetId", "expected logical asset ID, not URL/path");
  } else if (visual.type === "entity-avatar") {
    if (!isTokenSourceRef(visual.source) || !isTokenSourceRef(value.sourceRef) || !sameTokenSource(visual.source, value.sourceRef)) bad("appearance.visual.source", "avatar must belong to linked source");
  } else bad("appearance.visual.type", "unsupported token visual", "token.unsupported");
  return errors;
}

/** Substitute tokens only for V5 invariant checking; never persist this view. */
function invariantView(doc: Record<string, unknown>): unknown {
  return { ...doc, v: 5, layers: Array.isArray(doc.layers) ? doc.layers.map((layer) => {
    if (!record(layer) || layer.kind !== "gameplay" || !Array.isArray(layer.items)) return layer;
    return { ...layer, items: layer.items.map((item) => record(item) && item.kind === "token"
      ? { id: item.id, kind: "start", position: item.position } : item) };
  }) : doc.layers };
}
export function validateMapDocumentV6(doc: unknown): ValidationIssue[] {
  if (!record(doc)) return [{ code: "root.not-object", path: "", message: "expected document" }];
  const errors = validateMapDocument(invariantView(doc));
  if (doc.v !== 6) errors.push({ code: "version.invalid", path: "v", message: "expected v === 6" });
  if (doc.appearance !== undefined && (!record(doc.appearance) || !["blueprint", "paper-ink", "comic-punk"].includes(doc.appearance.style as string))) {
    errors.push({ code: "appearance.unsupported", path: "appearance.style", message: "unsupported drawing style" });
  }
  const frame = record(doc.appearance) ? doc.appearance.frame : undefined;
  if (frame !== undefined && (typeof frame !== "number" || !Number.isFinite(frame) || frame < 0 || frame > 100)) {
    errors.push({ code: "appearance.bad-frame", path: "appearance.frame", message: "frame must be 0..100 cells" });
  }
  const water = record(doc.appearance) ? doc.appearance.water : undefined;
  if (water !== undefined && !(MAP_WATER_LOOKS as readonly unknown[]).includes(water)) {
    errors.push({ code: "appearance.bad-water", path: "appearance.water", message: "unknown water look" });
  }
  for (const [key, min, max] of [["waterSpeed", 0, 3], ["waterPixels", 4, 16], ["waterShoal", 0, 6]] as const) {
    const value = record(doc.appearance) ? doc.appearance[key] : undefined;
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max))
      errors.push({ code: "appearance.bad-water", path: `appearance.${key}`, message: `expected ${min}..${max}` });
  }
  const packs = record(doc.appearance) ? doc.appearance.packs : undefined;
  if (packs !== undefined && (!Array.isArray(packs) || !packs.length || packs.length > 32 || new Set(packs).size !== packs.length
    || packs.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(id))))
    errors.push({ code: "appearance.bad-packs", path: "appearance.packs", message: "expected 1..32 unique pack ids" });
  const liquids = record(doc.appearance) ? doc.appearance.liquids : undefined;
  if (liquids !== undefined) {
    if (!Array.isArray(liquids) || liquids.length > 7) errors.push({ code: "appearance.bad-liquid", path: "appearance.liquids", message: "expected up to 7 recipes" });
    else { const taken = new Set<unknown>(); liquids.forEach((item, i) => { const issue = liquidIssue(item, taken); if (issue) errors.push({ code: "appearance.bad-liquid", path: `appearance.liquids[${i}]`, message: issue }); }); }
  }
  if (Array.isArray(doc.layers)) doc.layers.forEach((layer, li) => {
    if (record(layer) && layer.kind === "gameplay" && Array.isArray(layer.items)) layer.items.forEach((item, ei) => {
      if (record(item) && item.kind === "token") errors.push(...validateGameplayToken(item, `layers[${li}].items[${ei}]`));
    });
  });
  return errors;
}
const canonRef = (ref: TokenSourceRef): TokenSourceRef => ({ kind: ref.kind, uid: ref.uid.toLowerCase() });
export function canonicalizeGameplayToken(t: GameplayToken): GameplayToken {
  const v = t.appearance.visual;
  return {
    id: t.id, kind: "token", position: { x: t.position.x, y: t.position.y }, size: t.size, rotation: t.rotation,
    sourceRef: t.sourceRef ? canonRef(t.sourceRef) : null,
    appearance: { shape: t.appearance.shape, visual: v.type === "builtin" ? { type: v.type, key: v.key }
      : v.type === "asset" ? { type: v.type, assetId: v.assetId } : { type: v.type, source: canonRef(v.source) } },
    label: t.label.mode === "source" ? { mode: "source" } : { mode: "custom", text: t.label.text },
    playerVisibility: t.playerVisibility,
  };
}
export function upgradeMapDocumentV5(doc: MapDocumentV5): MapDocumentV6 {
  return { ...canonicalizeMapDocument(doc), v: 6 };
}
const canonAppearance = (doc: MapDocumentV6) => doc.appearance
  ? { appearance: { style: doc.appearance.style, ...(doc.appearance.frame !== undefined ? { frame: doc.appearance.frame } : {}),
    ...(doc.appearance.water !== undefined ? { water: doc.appearance.water } : {}),
    ...(doc.appearance.waterSpeed !== undefined ? { waterSpeed: doc.appearance.waterSpeed } : {}),
    ...(doc.appearance.waterPixels !== undefined ? { waterPixels: doc.appearance.waterPixels } : {}),
    ...(doc.appearance.waterShoal !== undefined ? { waterShoal: doc.appearance.waterShoal } : {}),
    ...(doc.appearance.packs ? { packs: [...doc.appearance.packs] } : {}),
    ...(doc.appearance.liquids?.length ? { liquids: [...doc.appearance.liquids].sort((a, b) => a.key < b.key ? -1 : 1).map(item => ({ key: item.key, name: item.name,
      tones: [...item.tones] as [string, string, string], pace: item.pace, size: item.size, bed: item.bed, glow: item.glow, pattern: item.pattern, rim: item.rim, solid: item.solid,
      ...(item.shore !== undefined ? { shore: item.shore } : {}), ...(item.ragged !== undefined ? { ragged: item.ragged } : {}), ...(item.ref !== undefined ? { ref: item.ref } : {}) })) } : {}) } } : {};
export function canonicalizeMapDocumentV6(doc: MapDocumentV6): MapDocumentV6 {
  const base = canonicalizeMapDocument(invariantView(doc as unknown as Record<string, unknown>) as MapDocumentV5);
  return { ...base, v: 6, ...canonAppearance(doc), layers: base.layers.map((layer, i) => {
    const original = doc.layers[i];
    if (layer.kind !== "gameplay" || original.kind !== "gameplay") return layer;
    return { ...layer, items: layer.items.map((item, j) => original.items[j].kind === "token"
      ? canonicalizeGameplayToken(original.items[j] as GameplayToken) : item) };
  }) };
}
export function parseMapDocumentV6(raw: unknown): ParseResult<MapDocumentV6> {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return { ok: false, errors: [{ code: "json.syntax", path: "", message: "not valid JSON" }] }; }
  }
  const errors = validateMapDocumentV6(value);
  return errors.length ? { ok: false, errors } : { ok: true, value: canonicalizeMapDocumentV6(value as MapDocumentV6) };
}
export function serializeMapDocumentV6(doc: MapDocumentV6): string { return JSON.stringify(canonicalizeMapDocumentV6(doc)); }
export function tokensOf(doc: MapDocumentV6): GameplayToken[] {
  return doc.layers.flatMap((l) => l.kind === "gameplay" ? l.items.filter((e): e is GameplayToken => e.kind === "token") : []);
}
/** Caller supplies a fresh ID; the kernel has no platform/UUID dependency. */
export function createGameplayToken(id: string, sourceRef: TokenSourceRef, position: Vec2): GameplayToken {
  const token: GameplayToken = { id, kind: "token", position: { ...position }, size: 1, rotation: 0, sourceRef,
    appearance: { shape: sourceRef.kind === "location" ? "diamond" : "circle", visual: { type: "builtin", key: sourceRef.kind === "location" ? "location" : "being" } },
    label: { mode: "source" }, playerVisibility: "private" };
  if (validateGameplayToken(token).length) throw new Error("invalid token");
  return canonicalizeGameplayToken(token);
}
export function putGameplayToken(doc: MapDocumentV6, layerId: string, token: GameplayToken): MapDocumentV6 {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "gameplay" || layer.locked || !layer.visible) throw new Error("token target layer unavailable");
  if (layer.items.some((e) => e.id === token.id && e.kind !== "token")) throw new Error("ID belongs to another entity");
  const next: MapDocumentV6 = { ...doc, layers: doc.layers.map((l) => l === layer
    ? { ...layer, items: layer.items.some((e) => e.id === token.id) ? layer.items.map((e) => e.id === token.id ? token : e) : [...layer.items, token] } : l) };
  if (validateMapDocumentV6(next).length) throw new Error("invalid token document");
  return canonicalizeMapDocumentV6(next);
}
export function removeGameplayToken(doc: MapDocumentV6, id: string): MapDocumentV6 {
  return { ...doc, layers: doc.layers.map((l) => l.kind === "gameplay" && !l.locked
    ? { ...l, items: l.items.filter((e) => e.kind !== "token" || e.id !== id) } : l) };
}
export function detachGameplayToken(t: GameplayToken, label: string): GameplayToken {
  const detached: GameplayToken = { ...t, sourceRef: null, label: { mode: "custom", text: label }, appearance: {
    ...t.appearance, visual: t.appearance.visual.type === "entity-avatar"
      ? { type: "builtin", key: t.sourceRef?.kind === "location" ? "location" : "being" } : t.appearance.visual } };
  if (validateGameplayToken(detached).length) throw new Error("invalid detached token");
  return canonicalizeGameplayToken(detached);
}
/** Player projection: V5 secrecy and fog rules, plus only public tokens.
 * Tokens leave detached: no source UID, the label already resolved by the
 * caller (null = source unavailable → neutral label), no source portrait. */
export function projectMapDocumentV6ForPlayer(doc: MapDocumentV6, sourceName: (ref: TokenSourceRef) => string | null): MapDocumentV6 {
  const shown = new Map(tokensOf(doc).filter((t) => t.playerVisibility === "public").map((t) => [t.id, t]));
  const withoutPrivate: MapDocumentV6 = { ...doc, layers: doc.layers.map((l) => l.kind === "gameplay"
    ? { ...l, items: l.items.filter((e) => e.kind !== "token" || shown.has(e.id)) } : l) };
  // Tokens pass the fog as point entities, the same substitution as validation.
  const projected = projectMapDocumentForPlayer(invariantView(withoutPrivate as unknown as Record<string, unknown>) as MapDocumentV5);
  const next: MapDocumentV6 = { ...projected, v: 6, ...canonAppearance(doc),
    layers: projected.layers.map((layer) => layer.kind !== "gameplay" ? layer : { ...layer, items: layer.items.map((item) => {
      const token = item.kind === "start" ? shown.get(item.id) : undefined;
      return token ? playerToken(token, sourceName) : item;
    }) }) };
  return canonicalizeMapDocumentV6(next);
}
function playerToken(t: GameplayToken, sourceName: (ref: TokenSourceRef) => string | null): GameplayToken {
  const text = t.label.mode === "custom" ? t.label.text : (t.sourceRef && sourceName(t.sourceRef)) || "Метка";
  const v = t.appearance.visual;
  const location = t.sourceRef ? t.sourceRef.kind === "location" : v.type === "builtin" && v.key === "location";
  return { ...t, sourceRef: null, label: { mode: "custom", text: text.slice(0, 200) },
    appearance: { shape: t.appearance.shape, visual: v.type === "asset" ? v : { type: "builtin", key: location ? "location" : "being" } } };
}

/** Upgrade only validated V5 input; legacy migration remains client-owned. */
export function readMapDocumentV6(raw: unknown): ParseResult<MapDocumentV6> {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { return parseMapDocumentV6(raw); } }
  if (record(value) && value.v === 5) {
    const old = parseMapDocument(value);
    return old.ok ? { ok: true, value: upgradeMapDocumentV5(old.value) } : old;
  }
  return parseMapDocumentV6(value);
}
