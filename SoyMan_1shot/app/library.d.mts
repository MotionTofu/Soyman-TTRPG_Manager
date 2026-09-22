export function displayName(character: { content?: { characterName?: string } | null; name?: string } | null | undefined): string;
export function isArchived(character: { archivedAt?: string | null } | null | undefined): boolean;
export function activeCharacters<T extends { archivedAt?: string | null }>(characters: T[] | null | undefined): T[];
export function archivedCharacters<T extends { archivedAt?: string | null }>(characters: T[] | null | undefined): T[];
export function isDraft(character: { content?: unknown } | null | undefined): boolean;
export function canDuplicate(character: { content?: unknown } | null | undefined): boolean;
export function wizardDraftKey(characterId: number): string;
export function copyNameFor(
  base: string,
  characters: Array<{ content?: { characterName?: string } | null; name?: string }>,
): string;
export function chainSaveOperation<T>(
  chain: Promise<unknown>,
  operation: () => Promise<T>,
): { chain: Promise<void>; outcome: Promise<T> };
export interface DuplicatePayload {
  name: string;
  content: import('@shared/dnd/types').DndCharacterData;
  portrait: string | null;
  catalogKey: string | null;
  revision: 0;
  characterUid: string;
  archivedAt: null;
}
export function buildDuplicatePayload(
  original: import('./repository').Character,
  name: string,
  characterUid: string,
): DuplicatePayload;
