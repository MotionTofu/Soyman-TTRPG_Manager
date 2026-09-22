import type { Catalog } from './repository';
export const RELEASE_SCHEMA_VERSION: 2;
export const CORE_FORMAT: 'soyman-catalog-core';
export const PREVIEWS_FORMAT: 'soyman-catalog-previews';
export const MANIFEST_FORMAT: 'soyman-catalog-manifest';
export const CORE_VERSION: 1;
export const PREVIEWS_VERSION: 1;
export const MANIFEST_VERSION: 1;
export interface CatalogReleaseOptions {
  catalogId: string;
  catalogVersion: string;
  system?: string;
  language?: string;
  releasedAt: string;
}
export interface CatalogCore {
  format: 'soyman-catalog-core';
  version: 1;
  catalogId: string;
  metadata: {
    schemaVersion: 2;
    id: string;
    system: string;
    language: string;
    catalogVersion: string;
    releasedAt: string;
    contentHash: string;
  };
  system: Catalog['system'];
  sections: Catalog['sections'];
  entries: Catalog['entries'];
}
export interface CatalogPreviews {
  format: 'soyman-catalog-previews';
  version: 1;
  catalogId: string;
  images: Record<string, string>;
}
export interface CatalogManifest {
  format: 'soyman-catalog-manifest';
  version: 1;
  current: string;
  catalogs: Record<string, {
    schemaVersion: 2;
    system: string;
    language: string;
    catalogVersion: string;
    releasedAt: string;
    core: { url: string; sha256: string; bytes: number };
    previews: { url: string; sha256: string; bytes: number };
  }>;
}
export function validateCatalogVersion(value: unknown): string;
export function makeCatalogId(options: { system?: string; language?: string; catalogVersion: string }): string;
export function coreFileName(catalogId: string): string;
export function previewsFileName(catalogId: string): string;
export function stripEntryMedia(entry: Catalog['entries'][number]): Catalog['entries'][number];
export function serializeArtifact(value: unknown): string;
export function hashArtifact(bytes: string | Uint8Array): string;
export function hashCatalogContent(content: { system: unknown; sections: unknown; entries: unknown }): string;
export function buildCatalogCore(catalog: Catalog, options: CatalogReleaseOptions): CatalogCore;
export function buildCatalogPreviews(catalog: Catalog, options: { catalogId: string }): CatalogPreviews;
export function buildCatalogManifest(options: {
  catalogId: string;
  metadata: CatalogCore['metadata'];
  coreFile: string;
  coreHash: string;
  coreBytes: number;
  previewsFile: string;
  previewsHash: string;
  previewsBytes: number;
}): CatalogManifest;
