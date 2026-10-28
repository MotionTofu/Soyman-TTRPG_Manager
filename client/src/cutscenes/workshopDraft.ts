import type { CutsceneDocument, CutsceneStep, CutsceneComposition } from "@shared/cutscenes/types";
import { createCutsceneStep, createCutsceneVisualTransition } from "@shared/cutscenes/defaults";

export type DraftPath = readonly string[];
export const sameDraft = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const identified = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every(row => record(row) && typeof row.id === "string");
const starts = (path: DraftPath, prefix: DraftPath) => prefix.every((part, i) => path[i] === part);

export function workshopValueAt(value: unknown, path: DraftPath): unknown {
  for (const part of path) value = Array.isArray(value) ? value.find(row => record(row) && row.id === part) : record(value) ? value[part] : undefined;
  return value;
}
export function withWorkshopValue<T>(value: T, path: DraftPath, replacement: unknown): T {
  if (!path.length) return replacement as T;
  const [head,...tail] = path;
  if (Array.isArray(value)) return value.map(row => record(row) && row.id === head ? withWorkshopValue(row,tail,replacement) : row) as T;
  return { ...value,[head]:withWorkshopValue(record(value) ? value[head] : undefined,tail,replacement) } as T;
}

/** Three-way merge by stable step/layer identity. Only local edits and the active field win over remote values. */
export function mergeWorkshopDraft<T>(base: T, local: T, remote: T, focus: DraftPath | null = null, path: DraftPath = []): T {
  if (focus && starts(path, focus)) return local;
  const containsFocus = !!focus && starts(focus, path);
  if (sameDraft(base, local) && !containsFocus) return remote;
  if (identified(base) && identified(local) && identified(remote)) {
    const before = new Map(base.map(row => [row.id, row])), ours = new Map(local.map(row => [row.id, row])), theirs = new Map(remote.map(row => [row.id, row]));
    const localOrder = local.map(row => row.id), remoteOrder = remote.map(row => row.id);
    const order = sameDraft(base.map(row => row.id), localOrder) ? remoteOrder : [...localOrder, ...remoteOrder.filter(id => !before.has(id) && !ours.has(id))];
    // A remotely deleted row with local changes/focus must remain under the user's hands.
    for (const row of local) if (!order.includes(row.id) && (!sameDraft(before.get(row.id), row) || (focus && starts(focus, [...path, row.id])))) order.push(row.id);
    return order.flatMap(id => {
      const b = before.get(id), l = ours.get(id), r = theirs.get(id);
      if (!l) return b ? [] : r ? [r] : [];
      if (!r) return !b || !sameDraft(b, l) || (focus && starts(focus, [...path, id])) ? [l] : [];
      return [mergeWorkshopDraft(b, l, r, focus, [...path, id])];
    }) as T;
  }
  if (record(base) && record(local) && record(remote)) {
    // Discriminated commands are atomic when their kind changes. Never combine fields of incompatible variants.
    for (const tag of ["action", "mode"]) if (base[tag] !== local[tag] || base[tag] !== remote[tag]) return local;
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      merged[key] = mergeWorkshopDraft(base[key], local[key], remote[key], focus, [...path, key]);
    }
    return merged as T;
  }
  return local;
}

export const emptyComposition = (): CutsceneComposition => ({ background: null, layers: [], title: "", title_secs: 3, fade_ms: 600 });
export const workshopId = () => crypto.randomUUID();
export function duplicateWorkshopStep(step: CutsceneStep): CutsceneStep {
  return { ...step, id: workshopId(),
    image: step.image.action === "replace" ? { ...step.image, composition: { ...step.image.composition,
      layers: step.image.composition.layers.map(layer => ({ ...layer, id: workshopId() })) } } : step.image,
    audio: step.audio.action === "replace" ? { ...step.audio, command: { ...step.audio.command, id: workshopId() } } : step.audio };
}
export function moveWorkshopStep(document: CutsceneDocument, id: string, targetId: string): CutsceneDocument {
  const steps = [...document.steps], from = steps.findIndex(step => step.id === id), to = steps.findIndex(step => step.id === targetId);
  if (from < 0 || to < 0 || from === to) return document;
  steps.splice(to, 0, ...steps.splice(from, 1)); return { ...document, steps };
}
export function imageWorkshopStep(image: CutsceneComposition["background"]): CutsceneStep {
  return { ...createCutsceneStep(workshopId()), image: { action: "replace", composition: { ...emptyComposition(), background: image }, transition: createCutsceneVisualTransition() } };
}
