export interface CatalogMetadata {
  schemaVersion: 2;
  id: string;
  system: string;
  language: string;
  catalogVersion: string;
  releasedAt: string;
  contentHash: string;
  previews?: {
    installed: boolean;
    sha256?: string;
  };
}
export interface ManagedStore {
  get(key: string): Promise<import('./repository').Catalog | undefined>;
  has(key: string): Promise<boolean>;
  install(record: import('./repository').Catalog, key: string, makeCurrent: boolean): Promise<unknown>;
  getPreviews(catalogId: string): Promise<import('./repository').CatalogPreviewRecord | undefined>;
  savePreviews(record: import('./repository').CatalogPreviewRecord): Promise<unknown>;
  listRecords(): Promise<Array<import('./repository').CatalogRecord>>;
  deleteCatalog(key: string): Promise<unknown>;
  getCurrent(): Promise<string | undefined>;
  setCurrent(key: string): Promise<unknown>;
}
export interface ManagerDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchBytes(url: string): Promise<Uint8Array>;
  digestSha256(bytes: Uint8Array): Promise<string>;
  store: ManagedStore;
}
export type EnsureStatus = 'ready' | 'installed' | 'local';
export function catalogError(code: string, detail?: string): Error & { code: string };
export const MANIFEST_URL: 'catalog/manifest.json';
export const MANIFEST_FORMAT: 'soyman-catalog-manifest';
export const MANIFEST_VERSION: 1;
export const CORE_FORMAT: 'soyman-catalog-core';
export const CORE_VERSION: 1;
export const PREVIEWS_FORMAT: 'soyman-catalog-previews';
export const PREVIEWS_VERSION: 1;
export const RELEASE_SCHEMA_VERSION: 2;
export function validateManifest(data: unknown): { catalogId: string; entry: Record<string, any> };
export function validateCoreRelease(
  core: unknown, catalogId: string, entry: Record<string, any>, digestSha256: (bytes: Uint8Array) => Promise<string>,
): Promise<{
  catalog: import('./repository').Catalog;
  metadata: CatalogMetadata;
}>;
export function loadManifest(deps: ManagerDeps, url?: string): Promise<{ catalogId: string; entry: Record<string, any> }>;
export function fetchVerifiedCore(
  deps: ManagerDeps, catalogId: string, entry: Record<string, any>, manifestBase?: string,
): Promise<{ catalog: import('./repository').Catalog; metadata: CatalogMetadata }>;
export function decideInstall(installed: unknown, catalogId: string, entry: Record<string, any>): 'up-to-date' | 'install';
export function ensureCurrentCatalog(deps: ManagerDeps, manifestUrl?: string): Promise<{ status: EnsureStatus; catalogId: string }>;
export type PreviewStatus = 'ready' | 'installed' | 'skipped';
export function validatePreviewsPackage(
  pkg: unknown, catalogId: string, installed: import('./repository').Catalog,
): Record<string, string>;
export function mergePreviews(
  catalog: import('./repository').Catalog, images: Record<string, string>,
): import('./repository').Catalog;
export function splitManagedPreviews(key: string, catalog: unknown): {
  core: import('./repository').Catalog;
  previews: import('./repository').CatalogPreviewRecord;
} | null;
export function ensureCatalogPreviews(deps: ManagerDeps, catalogId: string, manifestUrl?: string): Promise<{
  status: PreviewStatus;
  catalogId: string;
  reason?: string;
  count?: number;
}>;
export function isManagedRecord(key: string, catalog: unknown): boolean;
export function selectGarbageCatalogKeys(options: {
  records: Array<import('./repository').CatalogRecord>;
  characters: Array<{ catalogKey?: string | null }>;
  currentKey?: string | null;
}): string[];
export function garbageCollectCatalogs(deps: ManagerDeps & {
  listCharacters(): Promise<Array<{ catalogKey?: string | null }>>;
}): Promise<{ deleted: string[] }>;
