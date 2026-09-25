import type { Catalog } from './repository';
export function serializeArtifact(value: unknown): string;
export function parseCatalog(raw: unknown): Catalog;
export function repairSpellLevels(catalog: Catalog, reference: Catalog): Catalog;
export function relinkProficiencies<T extends { proficiencies?: unknown }>(content: T | null | undefined, entries: { id: number; name: string; kind: string }[]): T | null;
export function mentionIndexPayload(entries: any[] | null | undefined): { owners: Record<string, { code: string; name: string }>; entities: Record<string, [number, string, string | null][]> };
export function creatureCardPayload(entry: any, avatarUrl: string | null | undefined): any;
export function searchEntries(entries: any[], query: string, kinds?: string[] | null, limit?: number): any[];
