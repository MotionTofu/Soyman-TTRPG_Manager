import type { Character, Catalog } from './repository';
export function portablePayload(character: Character, catalog: Catalog | null): any;
export function renderPortable(template: string, payload: any): string;
