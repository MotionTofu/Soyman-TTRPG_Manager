import type { DndCharacterData } from "../../types";

// Resumable level-up draft (C2): explicit versioned shape with only the
// meaningful selections. The wizard owns WHAT to persist, the host owns
// WHERE (1shot: localStorage; main SoyMan: nothing yet — all props optional).
//
// Never serialized: refs, DOM/tooltip/animation state, transient errors,
// catalog objects (entry IDs re-resolve against the live catalog), systemId.

export interface LevelUpDraftSelections {
  clsIdx: number;
  step: string;
  hpMode: "roll" | "average" | "manual";
  rolled: number | null;
  manualTotal: string;
  miscText: string;
  subclassId: number | null;
  featId: number | null;
  asiPrimary: string | null;
  asiSecondary: string | null;
}

// Progression-relevant base the draft depends on. Runtime-only fields
// (HP/current, resources, notes, death saves, …) are deliberately excluded:
// their change must NOT invalidate a draft.
export interface LevelUpBaseSignature {
  totalLevel: number;
  classes: { classId: number | null; className: string; level: number; subclassId: number | null }[];
  featNames: string[];
  abilities: DndCharacterData["abilities"];
  featureEntryIds: number[];
  hpLumpPresent: boolean;
  hpMiscPerLevel: number;
}

export interface LevelUpDraftIdentity {
  characterId: number;
  characterUid: string | null;
  catalogKey: string | null;
}

export interface LevelUpDraft {
  version: 1;
  identity: LevelUpDraftIdentity;
  base: LevelUpBaseSignature;
  targetLevel: number;
  updatedAt: string;
  state: LevelUpDraftSelections;
}

export interface LevelUpDraftHost {
  identity: LevelUpDraftIdentity | null;
  initial?: LevelUpDraft | null;
  onChange?: (draft: LevelUpDraft) => void;
  onClear?: () => void;
}

export function getLevelUpBaseSignature(value: DndCharacterData): LevelUpBaseSignature {
  return {
    totalLevel: value.classes.reduce((n, c) => n + (c.level || 0), 0),
    classes: value.classes.map((c) => ({
      classId: c.classId ?? null,
      className: c.className ?? "",
      level: c.level || 0,
      subclassId: c.subclassId ?? null,
    })),
    featNames: value.feats.map((f) => f.name).sort(),
    abilities: { ...value.abilities },
    featureEntryIds: [
      ...value.classFeatures.map((f) => f.entryId),
      ...value.speciesFeatures.map((f) => f.entryId),
    ]
      .filter((id): id is number => typeof id === "number")
      .sort((a, b) => a - b),
    hpLumpPresent: value.hpLump != null,
    hpMiscPerLevel: value.hpMiscPerLevel ?? 0,
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The stored draft still applies to this character: same progression base
// (a level taken elsewhere, changed subclass/feats/abilities all invalidate)
// and same identity. UID is tolerant one way: a draft stamped before the
// character ever got a UID (old records) still matches once it has one.
export function isCompatibleLevelUpDraft(
  draft: LevelUpDraft | null | undefined,
  base: LevelUpBaseSignature,
  identity: LevelUpDraftIdentity | null | undefined
): boolean {
  if (!draft || draft.version !== 1 || !identity) return false;
  if (draft.identity.characterId !== identity.characterId) return false;
  if ((draft.identity.catalogKey ?? null) !== (identity.catalogKey ?? null)) return false;
  const du = draft.identity.characterUid ?? null;
  const iu = identity.characterUid ?? null;
  if (du !== null && iu !== null && du !== iu) return false;
  if (!sameJson(draft.base, base)) return false;
  if (draft.targetLevel !== base.totalLevel + 1) return false;
  return true;
}

// Resume must never open a step that no longer exists (dynamic Подкласс /
// Черта steps depend on live selections): unknown ids fall back to first.
export function sanitizeLevelUpStep(step: string | null | undefined, validSteps: string[]): string {
  if (step && validSteps.includes(step)) return step;
  return validSteps[0];
}
