// Local library helpers (character lifecycle phase).
//
// Pure, framework-free so node:test covers the rules without IndexedDB:
// visibility filtering, copy naming, duplicate payload shape, draft policy.
// The repository (repository.ts) and the home list (main.tsx) share these —
// no second implementation of the same rule.
export function displayName(character) {
  return character?.content?.characterName || character?.name || 'Персонаж';
}

export function isArchived(character) {
  return !!character?.archivedAt;
}

export function activeCharacters(characters) {
  return (characters || []).filter((c) => !isArchived(c));
}

export function archivedCharacters(characters) {
  return (characters || []).filter(isArchived);
}

export function isDraft(character) {
  return !character?.content;
}

// Draft shells have no finished sheet; duplicating one would fork an
// unfinished wizard state, so the UI hides "Создать копию" for drafts.
export function canDuplicate(character) {
  return !!character?.content;
}

// LocalStorage key of the wizard draft for one character shell. Mirrors
// DndCharacterWizard (`dnd-wizard-draft:${ownerType}:${ownerId}` with
// ownerType 'character'); deleted together with exactly that character only.
export function wizardDraftKey(characterId) {
  return `dnd-wizard-draft:character:${characterId}`;
}

// "Мордекай" -> "Мордекай — копия" -> "Мордекай — копия 2" … — first free name
// against display names. No filesystem-grade uniqueness, just no accidental
// twins in one list.
export function copyNameFor(base, characters) {
  const clean = typeof base === 'string' && base.trim() ? base.trim() : 'Персонаж';
  const taken = new Set((characters || []).map(displayName));
  let candidate = `${clean} — копия`;
  for (let n = 2; taken.has(candidate) && n < 1000; n++) candidate = `${clean} — копия ${n}`;
  return candidate;
}

// Appends an operation to a serial promise chain WITHOUT poisoning it: the
// returned chain never rejects (later operations still run in order), while
// outcome settles exactly like the operation itself. Lets one caller await
// its own durable commit (level-up finish) while fire-and-forget callers
// keep using the chain as before.
export function chainSaveOperation(chain, operation) {
  let resolveOutcome, rejectOutcome;
  const outcome = new Promise((resolve, reject) => { resolveOutcome = resolve; rejectOutcome = reject; });
  const next = chain.then(async () => {
    try {
      resolveOutcome(await operation());
    } catch (e) {
      rejectOutcome(e);
    }
  });
  return { chain: next, outcome };
}

// Independent logical character: same sheet/portrait/catalog pin, but a new
// local id (assigned by the store), a fresh characterUid, initial revision
// and never archived. The caller also renames content.characterName to name.
export function buildDuplicatePayload(original, name, characterUid) {
  return {
    name,
    content: structuredClone(original.content),
    portrait: original.portrait ?? null,
    catalogKey: original.catalogKey ?? null,
    revision: 0,
    characterUid,
    archivedAt: null,
  };
}
