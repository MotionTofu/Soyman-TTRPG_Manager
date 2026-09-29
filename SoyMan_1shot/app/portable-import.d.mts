// 1shot layer over the shared portable contract (phase B2.1).
// Format parsing comes from @soyman/shared/dist; only the 1shot-specific
// deep catalog validation (parseCatalog) changes the payload shape.
export {
  portableError,
  isCharacterUid,
  isSupportedPortrait,
  extractPortablePayload,
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
} from '../../shared/src/portable/parse';
export const PORTABLE_MAX_HTML_BYTES: number;
export interface ValidatedPortableImport {
  name: string;
  content: unknown;
  portrait: string | null;
  catalog: import('./repository').Catalog;
  characterUid: string | null;
  notes: import('../../shared/src/portable/parse').PortableNote[];
}
export function validatePortablePayload(payload: unknown): ValidatedPortableImport;
export function parsePortableHtml(htmlText: string): ValidatedPortableImport;
export interface LocalCharacterRef {
  id: number;
  name: string;
  characterUid?: string | null;
  content?: { characterName?: string } | null;
}
export type PortableDecision =
  | { action: 'create' }
  | { action: 'confirm'; match: LocalCharacterRef }
  | { action: 'conflict'; matches: LocalCharacterRef[] };
export function decidePortableImport(options: {
  characterUid: string | null;
  characters: LocalCharacterRef[];
}): PortableDecision;
export function shouldReuseCatalogSlice(options: {
  catalogKey: string | null;
  catalog: unknown;
  referencedByCount: number;
  isCurrent: boolean;
}): boolean;
export function buildCharacterUpdate(
  local: import('./repository').Character,
  imported: { name: string; content: import('@shared/dnd/types').DndCharacterData; portrait: string | null; catalogKey: string },
): import('./repository').Character;
