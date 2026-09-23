import type { Character, Catalog } from './repository';
export function candidateCatalog(character: unknown, catalog: unknown): {
  problems: string[];
  externalAssets: string[];
  candidate: { system: unknown; sections: unknown[]; entries: unknown[] };
};
export function portablePayload(character: Character, catalog: Catalog | null): any;
export function renderPortable(template: string, payload: any): string;
export function gmPayload(character: Character, catalog: Catalog | null): any;
export function portableFileName(name: string | null | undefined): string;
