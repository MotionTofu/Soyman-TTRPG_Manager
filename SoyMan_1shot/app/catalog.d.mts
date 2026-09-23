import type { Catalog } from './repository';
export function serializeArtifact(value: unknown): string;
export function parseCatalog(raw: unknown): Catalog;
export function repairSpellLevels(catalog: Catalog, reference: Catalog): Catalog;
export function creatureCardPayload(entry: any, avatarUrl: string | null | undefined): any;
export function searchEntries(entries: any[], query: string, kinds?: string[] | null, limit?: number): any[];
