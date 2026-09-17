import type { Catalog } from './repository';
export function parseCatalog(raw: unknown): Catalog;
export function repairSpellLevels(catalog: Catalog, reference: Catalog): Catalog;
