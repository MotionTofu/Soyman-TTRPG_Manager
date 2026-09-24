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

// Card of the home library (grilling 2026-09-24): which catalog entries may
// give the card its art, most specific first — subclass, class, species. The
// portrait beats all of them and the card back ends the chain; both are the
// caller's, since neither is a catalog entry.
const isId = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v !== '');
export function cardArtIds(content, draft) {
  if (content) {
    const classes = Array.isArray(content.classes) ? content.classes : [];
    return [...classes.map((c) => c?.subclassId), ...classes.map((c) => c?.classId), content.raceId].filter(isId);
  }
  if (draft && typeof draft === 'object') return [draft.subclassId, draft.classId, draft.speciesId].filter(isId);
  return [];
}

// "Воин 3 · Плут 2 · Эльф": every class with its level (a multiclass needs
// both), species last. Empty parts drop out instead of leaving a stray dot.
export function cardCaption(content) {
  const classes = (Array.isArray(content?.classes) ? content.classes : [])
    .filter((c) => c?.className)
    .map((c) => (c.level ? `${c.className} ${c.level}` : c.className));
  return [...classes, content?.raceName].filter(Boolean).join(' · ');
}

// A draft knows ids only; names come from the catalog via nameOf.
export function draftCaption(draft, nameOf) {
  if (!draft || typeof draft !== 'object') return '';
  return [draft.classId, draft.speciesId].filter(isId).map(nameOf).filter(Boolean).join(' · ');
}

// Wizard draft as stored by DndCharacterWizard, or null when absent/broken.
export function parseWizardDraft(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
