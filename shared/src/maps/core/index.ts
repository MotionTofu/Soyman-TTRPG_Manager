/**
 * Shared V5 Document Kernel: canonical types/validation/parsing/
 * serialization/projection — один источник истины для client и server.
 * Client-only части (migration, mutations, selection, render, audit)
 * сюда не входят и живут в client/src/maps/core/.
 */
export * from "./literals";
export * from "./json";
export * from "./types";
export * from "./refs";
export * from "./validate";
export * from "./canonicalize";
export * from "./serialize";
export * from "./parse";
export * from "./playerProjection";
export * from "./storedDocument";
