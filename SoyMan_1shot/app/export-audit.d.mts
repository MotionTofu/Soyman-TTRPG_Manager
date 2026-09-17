import type { Character, Catalog } from './repository';
export function auditExport(character: Character, catalog: Catalog | null): {
  format: string; version: number; entryCount: number; totalEntryCount: number;
  counts: Record<string, number>; problems: string[]; externalAssets: string[];
  candidate: Catalog;
};
