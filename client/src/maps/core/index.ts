// Публичный API Map Core V2 (§56 ТЗ). Внутренние helpers не экспортируются.

export type {
  AssetPackRef,
  AssetRef,
  EntityId,
  GameplayDoor,
  GameplayEntity,
  GameplayFinish,
  GameplayLayer,
  GameplayMarker,
  GameplayRoom,
  GameplayStart,
  GameplayTrap,
  JsonObject,
  LabelLayer,
  LayerId,
  MapDocumentV5,
  MapGrid,
  MapGridConfig,
  MapLabel,
  MapLayer,
  MapObject,
  MapPath,
  MapProvenance,
  MapRecordV5,
  MapScale,
  MapWorld,
  MaterialRef,
  ObjectLayer,
  PathGeometry,
  PathLayer,
  ScatterArea,
  ScatterLayer,
  ScatterProfileRef,
  ShapeGeometry,
  SoyMapV2Envelope,
  SplineNode,
  StyleRef,
  TerrainCellEntry,
  TerrainCellLayer,
  TerrainLayer,
  TerrainMask,
  TerrainMaskChunk,
  TerrainMaskLayer,
  Vec2,
  VisualRef,
} from "./types";

export {
  BUILTIN_PLAIN_MATERIAL,
  BUILTIN_RIVER_STYLE,
  BUILTIN_ROAD_STYLE,
  LEGACY_TERRAIN_MATERIAL_KEYS,
  TERRAIN_MATERIAL_KEY_PREFIX,
  builtinMaterial,
  isMaterialRef,
  isScatterProfileRef,
  isStyleRef,
  isVisualRef,
  terrainMaterialKey,
} from "./refs";

export {
  LEGACY_FINISH_ID,
  LEGACY_LAYER_IDS,
  LEGACY_LAYER_SKELETON,
  LEGACY_START_ID,
  legacyDoorId,
  legacyLabelId,
  legacyLayerId,
  legacyMarkerId,
  legacyPathId,
  legacyRoomId,
  legacyTrapId,
} from "./ids";

export type { LegacyLayerSkeleton } from "./ids";

export { isJsonValue } from "./json";
export type { JsonArray, JsonPrimitive, JsonValue } from "./json";

export {
  isValidMapDocument,
  validateMapDocument,
  type ValidationIssue,
} from "./validate";

export { canonicalizeMapDocument } from "./canonicalize";
export { serializeMapDocument } from "./serialize";
export { parseMapDocument, type ParseResult } from "./parse";

export {
  migrateLegacyMap,
  type LegacyMapInput,
  type LegacyMigrationResult,
  type LegacyMigrationWarning,
} from "./migrateLegacy";

export { projectMapDocumentForPlayer } from "./playerProjection";

export {
  buildSoyMapV2,
  importSoyMapV1,
  parseSoyMapV2,
  type LegacyV1Import,
  type LegacyV1ImportMeta,
  type SoyMapV2Meta,
} from "./exchangeV2";

export {
  compareLegacySemantics,
  type LegacyAuditInput,
  type SemanticEquivalenceIssue,
} from "./semanticEquivalence";

export {
  auditLoadedMapShadow,
  formatShadowAuditSummary,
  runLegacyShadowAudit,
  type LegacyShadowAuditResult,
  type LoadedMapAuditArgs,
  type ShadowAuditStats,
  type ShadowAuditStatus,
  type ShadowAuditTiming,
} from "./shadowAudit";
