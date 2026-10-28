import { z } from "zod";
import { parseCutsceneDocument, checkCutsceneReadiness, resolveCutsceneStep, projectCutscenePlayerFrame,
  type CutscenePreviewState, type CutsceneDocument, type CutsceneMediaRef } from "@soyman/shared";
import { db } from "../db/db";
import { registeredCutsceneRun } from "../db/cutsceneRuns";
import { readCutscene } from "./cutscenes";
import { CutsceneRequestError } from "./cutsceneErrors";
import { runInput, runOwnerInput, returnAudioInput } from "./cutsceneRunInput";
import { documentMediaRefs, retainCutsceneMedia, releaseCutsceneMedia, accessCutsceneMedia } from "./cutsceneMedia";
import { returnRefs } from "./cutsceneRuns";
import { claimPlayerDisplay, readPlayerDisplay, publishPlayerDisplay, releasePlayerDisplay, DEFAULT_DISPLAY } from "./playerDisplay";

const key = z.string().trim().min(1).max(200);
const documentInput = z.unknown().transform((raw, ctx): CutsceneDocument => {
  const parsed = parseCutsceneDocument(raw);
  if (!parsed.ok || parsed.value.steps.length !== 1) { ctx.addIssue({ code: "custom", message: "Нужна корректная проекция выбранного шага" }); return z.NEVER; }
  return parsed.value;
});
const startInput = z.object({ owner: runOwnerInput, cutsceneId: z.number().int().positive().safe(), document: documentInput }).strict();
const updateInput = z.object({ owner: runOwnerInput, revision: z.number().int().positive(), document: documentInput.optional(),
  audio: returnAudioInput.optional(), publish: z.boolean().optional(), playKey: key.optional(), animate: z.boolean().optional(),
  visualPlayback: z.object({ elapsedMs: z.number().finite().nonnegative(), startedAt: z.number().finite().nonnegative().nullable() }).strict().optional(),
  window: z.object({ wasOpen: z.boolean(), openedByRun: z.boolean(), screenId: key.nullable(), windowId: key.nullable().optional() }).optional(),
}).strict();
const ownerInput = z.object({ owner: runOwnerInput }).strict();
const hold = (value: CutscenePreviewState) => ({ kind: "snapshot" as const, key: `preview:${value.owner.runId}` });
const same = (a: CutscenePreviewState["owner"], b: CutscenePreviewState["owner"]) => a.runId === b.runId && a.controllerId === b.controllerId;
const conflict = (message: string): never => { throw new CutsceneRequestError(409, message); };
function read(): CutscenePreviewState | null {
  const row = db.prepare("SELECT state FROM cutscene_preview_state WHERE id=1").get() as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}
function save(value: CutscenePreviewState): CutscenePreviewState {
  db.prepare("INSERT INTO cutscene_preview_state(id,cutscene_id,state) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET cutscene_id=excluded.cutscene_id,state=excluded.state")
    .run(value.cutsceneId, JSON.stringify(value));
  return value;
}
function owned(raw: unknown): CutscenePreviewState {
  const input = runInput(ownerInput, raw), current = read();
  if (!current || !same(current.owner, input.owner)) return conflict("Предпросмотр принадлежит другому окну");
  return current;
}
function returnMedia(value: CutscenePreviewState): CutsceneMediaRef[] {
  if (value.audio) return returnRefs({ audio: value.audio, presentation: value.presentation,
    window: value.window ?? { wasOpen: false, openedByRun: false, screenId: null } });
  const s = value.presentation?.source;
  return s?.kind === "cutscene" && s.frame.composition
    ? [...(s.frame.composition.background ? [s.frame.composition.background] : []), ...s.frame.composition.layers.map(layer => layer.image)] : [];
}
function retain(value: CutscenePreviewState): void {
  const refs = documentMediaRefs(value.document);
  // Every working media ref must belong to this original; return refs may belong to a previous show.
  const checks = refs.map(ref => {
    const access = accessCutsceneMedia(value.cutsceneId, ref.id);
    if (access.ref.kind !== ref.kind) throw new CutsceneRequestError(400, "Неверный тип материала");
    const media = db.prepare("SELECT duration_seconds FROM cutscene_media WHERE id=?").get(ref.id) as { duration_seconds: number | null };
    return { ref, status: "ready" as const, durationSeconds: media.duration_seconds };
  });
  const readiness = checkCutsceneReadiness(value.document, checks);
  const invalid = readiness.ready ? [] : readiness.issues.filter(issue => issue.code !== "readiness.empty");
  if (invalid.length) throw new CutsceneRequestError(400, "Шаг не готов к предпросмотру", invalid);
  retainCutsceneMedia(hold(value), [...refs, ...returnMedia(value)]);
}
function finish(current: CutscenePreviewState): CutscenePreviewState {
  if (current.phase === "returning") return current;
  if (current.external) {
    const owner = readPlayerDisplay().owner;
    if (owner && same(owner, current.owner)) {
      publishPlayerDisplay(current.presentation, current.owner, { kind: "cut", durationMs: 0 });
      releasePlayerDisplay(current.owner);
    }
  }
  return save({ ...current, phase: "returning", external: false, revision: current.revision + 1 });
}
/** A missing heartbeat stops the temporary session; return data remains until audio is acknowledged. */
export function readCutscenePreview(): CutscenePreviewState | null {
  return db.transaction(() => {
    const current = read();
    return current?.phase === "active" && Date.now() - current.updatedAt > 30_000 ? finish(current) : current;
  })();
}
export function startCutscenePreview(raw: unknown): CutscenePreviewState {
  const input = runInput(startInput, raw);
  return db.transaction(() => {
    const current = readCutscenePreview();
    if (current) return conflict(`Предпросмотр уже открыт: ${readCutscene(current.cutsceneId).document.name}`);
    if (registeredCutsceneRun(db.prepare("SELECT 1").database)) return conflict("Сначала завершите настоящий показ");
    if (readCutscene(input.cutsceneId).archivedAt) return conflict("Восстановите катсцену из архива");
    const value: CutscenePreviewState = { ...input, phase: "active", revision: 1, updatedAt: Date.now(),
      external: false, audio: null, presentation: null, window: null, visualPlayback: { elapsedMs: 0, startedAt: null } };
    retain(value); return save(value);
  }).immediate();
}
export function updateCutscenePreview(raw: unknown): CutscenePreviewState {
  const input = runInput(updateInput, raw);
  return db.transaction(() => {
    const current = owned({ owner: input.owner });
    if (current.phase !== "active" || current.revision !== input.revision) return conflict("Предпросмотр уже изменён или останавливается");
    if (input.audio && (current.audio || input.audio.scope !== "all")) return conflict("Снимок возврата звука уже зафиксирован или имеет неверный захват");
    if (input.window && (input.window.wasOpen && input.window.openedByRun)) throw new CutsceneRequestError(400, "Существующее окно нельзя считать новым");
    let next: CutscenePreviewState = { ...current, document: input.document ?? current.document, audio: input.audio ?? current.audio,
      visualPlayback: input.visualPlayback ?? current.visualPlayback, revision: current.revision + 1, updatedAt: Date.now() };
    if (input.window && !current.external) {
      next = { ...next, presentation: readPlayerDisplay().snapshot, window: input.window, external: true };
      claimPlayerDisplay(current.owner);
    }
    retain(next);
    if (input.publish && next.external) {
      const step = resolveCutsceneStep(next.document, next.document.steps[0].id)!;
      publishPlayerDisplay({ source: { kind: "cutscene", cutsceneId: next.cutsceneId, frame: projectCutscenePlayerFrame(step) },
        context: { kind: "library" }, visibleLayerIds: [], display: DEFAULT_DISPLAY,
        playKey: input.playKey ?? `preview:${next.owner.runId}` }, next.owner,
      input.animate ? step.image.transition : { kind: "cut", durationMs: 0 });
    }
    return save(next);
  }).immediate();
}
export function heartbeatCutscenePreview(raw: unknown): CutscenePreviewState {
  return db.transaction(() => { readCutscenePreview(); const current = owned(raw); return save({ ...current, updatedAt: Date.now() }); })();
}
export function stopCutscenePreview(raw: unknown): CutscenePreviewState {
  return db.transaction(() => finish(owned(raw))).immediate();
}
export function acknowledgeCutscenePreview(raw: unknown): { ok: true } {
  return db.transaction(() => {
    const current = owned(raw);
    if (current.phase !== "returning") return conflict("Сначала остановите предпросмотр");
    releaseCutsceneMedia(hold(current)); db.prepare("DELETE FROM cutscene_preview_state WHERE id=1").run();
    return { ok: true as const };
  }).immediate();
}
/** Compare-and-swap cleanup ownership prevents two reloaded hosts restoring the same audio. */
export function claimCutscenePreviewReturn(raw: unknown): CutscenePreviewState {
  const input = runInput(z.object({ owner: runOwnerInput, controllerId: key }).strict(), raw);
  return db.transaction(() => {
    const current = owned({ owner: input.owner });
    if (current.phase !== "returning") return conflict("Предпросмотр ещё работает в другом окне");
    return save({ ...current, owner: { ...current.owner, controllerId: input.controllerId }, updatedAt: Date.now(), revision: current.revision + 1 });
  }).immediate();
}
