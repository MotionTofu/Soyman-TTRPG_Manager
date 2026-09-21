// Публичный API Map Core V2 (§56 ТЗ). Внутренние helpers не экспортируются.

export type {
  AssetPackRef,
  EntityId,
  GameplayDoor,
  GameplayEntity,
  GameplayFinish,
  GameplayLayer,
  GameplayMarker,
  GameplayRoom,
  GameplayStart,
  GameplayTrap,
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
  ObjectLayer,
  PathGeometry,
  PathLayer,
  ScatterArea,
  ScatterLayer,
  ShapeGeometry,
  SoyMapV2Envelope,
  SplineNode,
  TerrainCellEntry,
  TerrainCellLayer,
  TerrainLayer,
  TerrainMask,
  TerrainMaskChunk,
  TerrainMaskLayer,
  Vec2,
} from "./types";

export type {
  AssetRef,
  MaterialRef,
  ScatterProfileRef,
  StyleRef,
  VisualRef,
} from "./refs";

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
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json";

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
  legacyDoorWorldPosition,
  legacyEdgeOrientation,
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

export {
  assessCurrentEditorCompatibility,
  type CompatibilityIssue,
  type EditorCompatibility,
} from "./compatibility";

export {
  clearEditableContent,
  resizeGridDocument,
} from "./mutations/document";

export {
  applyTerrainCellEdits,
  floodTerrainFill,
  readTerrainMaterialAt,
  type TerrainCellEdit,
  type TerrainReadResult,
} from "./mutations/terrain";

export {
  addPathCells,
  createCellNetworkPath,
  removePathCells,
  replacePathCells,
  type CellNetworkPathSpec,
} from "./mutations/paths";

export {
  createGameplayEntity,
  deleteGameplayEntity,
  moveGameplayEntity,
  pairDoors,
  setFinish,
  setStart,
  unpairDoor,
  updateGameplayEntity,
} from "./mutations/gameplay";

export {
  createLabel,
  deleteLabel,
  moveLabel,
  updateLabelText,
  type LabelSpec,
} from "./mutations/labels";

export { translateShape } from "./mutations/geometry";

export {
  hitTestGameplay,
  type V5SelectableKind,
  type V5Selection,
} from "./selection/hitTest";

export type { MutationIssue, MutationResult } from "./mutations/types";
