import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  captureCutsceneVersion, checkCutsceneReadiness, projectCutscenePlayerFrame, resolveCutsceneStep,
  type CutsceneAudioReturnSnapshot, type CutsceneMediaRef, type CutsceneMusicState, type CutsceneRetainedMusicSnapshot,
  type CutsceneReturnSnapshot, type CutsceneRunCheckpoint, type CutsceneRunFinishResult, type CutsceneRunOwner,
  type CutsceneRunState, type CutsceneRuntimeUsage, type CutsceneVersionSnapshot,
} from "@soyman/shared";
import { db } from "../db/db";
import { hasCutscenePreview } from "../db/cutscenePreviews";
import { accessCutsceneMedia, documentMediaRefs, releaseCutsceneMedia, retainCutsceneMedia } from "./cutsceneMedia";
import { CutsceneRequestError } from "./cutsceneErrors";
import { readCutsceneUsage } from "./cutsceneUsage";
import { readCutscene, requireCutsceneContext } from "./cutscenes";
import { claimPlayerDisplay, DEFAULT_DISPLAY, publishPlayerDisplay, readPlayerDisplay, releasePlayerDisplay, transferPlayerDisplay } from "./playerDisplay";
import { finishRunInput, recoverRunInput, releaseMusicInput, runInput, startRunInput, updateRunInput } from "./cutsceneRunInput";

interface RunRow {
  run_id: string; cutscene_id: number; mode: "live" | "rehearsal"; launch_context: string;
  version: string; return_state: string; audio_scope: "music" | "all"; controller_id: string;
  checkpoint: string; revision: number; created_at: string; updated_at: string; ended_at: string | null;
}
const MUSIC_HOLD = { kind: "music", key: "cutscene-music" } as const;
const snapshotHold = (runId: string) => ({ kind: "snapshot" as const, key: runId });
const bad = (message: string): never => { throw new CutsceneRequestError(400, message); };
const conflict = (message: string): never => { throw new CutsceneRequestError(409, message); };
function row(runId: string): RunRow {
  const result = db.prepare("SELECT * FROM cutscene_runs WHERE run_id = ?").get(runId) as RunRow | undefined;
  if (!result) throw new CutsceneRequestError(404, "Запуск катсцены не найден");
  return result;
}
function captured(original: Parameters<typeof captureCutsceneVersion>[0]): CutsceneVersionSnapshot {
  const parsed = captureCutsceneVersion(original);
  if (!parsed.ok) throw new CutsceneRequestError(400, "Не удалось зафиксировать версию катсцены", parsed.issues);
  return parsed.value;
}
function state(value: RunRow): CutsceneRunState {
  const { finishResult: _finishResult, ...checkpoint } = JSON.parse(value.checkpoint);
  const version = JSON.parse(value.version) as CutsceneVersionSnapshot;
  return { snapshot: { runId: value.run_id, mode: value.mode, context: JSON.parse(value.launch_context),
    version: captured({ id: version.cutsceneId, savedVersion: version.savedVersion, document: version.document }),
    returnState: JSON.parse(value.return_state), ownership: { runId: value.run_id, controllerId: value.controller_id,
      display: value.mode === "live", audioScope: value.audio_scope } }, checkpoint,
    revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at, endedAt: value.ended_at };
}
export function readCutsceneRun(runId: string): CutsceneRunState { return state(row(runId)); }
export function readActiveCutsceneRun(): CutsceneRunState | null {
  const active = db.prepare("SELECT * FROM cutscene_runs WHERE ended_at IS NULL").get() as RunRow | undefined;
  return active ? state(active) : null;
}
function writable(runId: string, owner: CutsceneRunOwner, revision: number): RunRow {
  const value = row(runId);
  if (value.ended_at || owner.runId !== runId || owner.controllerId !== value.controller_id || revision !== value.revision) {
    return conflict("Запуск уже изменён или управляется другим окном");
  }
  return value;
}
function audioRefs(audio: CutsceneAudioReturnSnapshot): CutsceneMediaRef[] {
  const sources = [
    ...(audio.background.kind === "cutscene" ? [{ kind: "cutscene" as const, audio: audio.background.command.audio }] : audio.background.queue.map(item => item.source)),
    ...(audio.scope === "all" ? [audio.ambient.source, audio.weather.source] : []),
    ...(audio.automation?.combat?.previous.queue.map(item => item.source) ?? []),
  ];
  return sources.flatMap(source => source?.kind === "cutscene" ? [source.audio] : []);
}
export function returnRefs(saved: CutsceneReturnSnapshot): CutsceneMediaRef[] {
  const source = saved.presentation?.source;
  const composition = source?.kind === "cutscene" ? source.frame.composition : null;
  return [...audioRefs(saved.audio), ...(composition ? [
    ...(composition.background ? [composition.background] : []), ...composition.layers.map(layer => layer.image),
  ] : [])];
}
function originalIds(refs: readonly CutsceneMediaRef[], explicit: readonly number[] = []): number[] {
  const ids = new Set(explicit);
  for (const ref of refs) {
    const media = db.prepare("SELECT cutscene_id FROM cutscene_media WHERE id = ? AND kind = ?").get(ref.id, ref.kind) as { cutscene_id: number } | undefined;
    if (!media) return bad("Материал снимка недоступен");
    ids.add(media.cutscene_id);
  }
  return [...ids];
}
function audioOriginalIds(audio: CutsceneAudioReturnSnapshot): number[] {
  const explicit = audio.background.kind === "cutscene" ? [audio.background.cutsceneId] : [];
  if (audio.background.kind === "cutscene") {
    const media = db.prepare("SELECT cutscene_id FROM cutscene_media WHERE id = ? AND kind = 'audio'").get(audio.background.command.audio.id) as { cutscene_id: number } | undefined;
    if (!media || media.cutscene_id !== audio.background.cutsceneId) return bad("Материал фонового фрагмента принадлежит другой катсцене");
  }
  return originalIds(audioRefs(audio), explicit);
}
function readyVersion(version: CutsceneVersionSnapshot): void {
  const checks = documentMediaRefs(version.document).map(ref => {
    try {
      accessCutsceneMedia(version.cutsceneId, ref.id);
      const media = db.prepare("SELECT kind, duration_seconds FROM cutscene_media WHERE id = ?").get(ref.id) as { kind: string; duration_seconds: number | null };
      if (media.kind !== ref.kind) throw new Error("Media kind differs");
      return { ref, status: "ready" as const, durationSeconds: media.duration_seconds };
    } catch { return { ref, status: "missing" as const, durationSeconds: null }; }
  });
  const readiness = checkCutsceneReadiness(version.document, checks);
  if (!readiness.ready) throw new CutsceneRequestError(400, "Катсцена не готова к запуску", readiness.issues);
}

export function startCutsceneRun(raw: unknown): CutsceneRunState {
  const input = runInput(startRunInput, raw);
  return db.transaction(() => {
    if (hasCutscenePreview(db.prepare("SELECT 1").database)) return conflict("Сначала остановите предпросмотр и дождитесь возврата звука");
    if (readActiveCutsceneRun()) return conflict("Другой показ или репетиция уже использует звук");
    if (input.context.kind === "campaign") requireCutsceneContext("campaign", input.context.campaignId);
    if (input.context.kind === "session") {
      requireCutsceneContext("session", input.context.sessionId);
      const session = db.prepare("SELECT campaign_id FROM sessions WHERE id = ?").get(input.context.sessionId) as { campaign_id: number | null };
      if (session.campaign_id !== input.context.campaignId) return bad("Сессия не относится к указанной кампании");
    }
    if (input.returnState.window.wasOpen && input.returnState.window.openedByRun) return bad("Окно уже существовало до запуска");
    const original = readCutscene(input.cutsceneId);
    if (original.archivedAt) {
      const context = input.context;
      const bound = context.kind === "campaign"
        ? db.prepare("SELECT 1 FROM campaign_cutscenes WHERE campaign_id = ? AND cutscene_id = ?").get(context.campaignId, input.cutsceneId)
        : context.kind === "session" ? db.prepare("SELECT 1 FROM session_cutscenes WHERE session_id = ? AND cutscene_id = ?").get(context.sessionId, input.cutsceneId) : null;
      if (!bound) return conflict("Архивная катсцена доступна для запуска из существующей подборки или плана");
    }
    const version = captured(original);
    readyVersion(version);
    const scope = input.mode === "rehearsal" ? "all" : version.document.settings.audioScope;
    if (input.returnState.audio.scope !== scope) return bad("Снимок звука не соответствует режиму захвата");
    const runId = randomUUID(), now = new Date().toISOString();
    const saved: CutsceneReturnSnapshot = { ...input.returnState, presentation: readPlayerDisplay().snapshot };
    const refs = [...documentMediaRefs(version.document), ...returnRefs(saved)];
    // Each hold is acquired before releasing anything, in this same immediate transaction.
    retainCutsceneMedia(snapshotHold(runId), refs);
    const uses = originalIds(refs, [input.cutsceneId, ...audioOriginalIds(saved.audio),
      ...(saved.presentation?.source.kind === "cutscene" ? [saved.presentation.source.cutsceneId] : [])]);
    const checkpoint: CutsceneRunCheckpoint = { runId, stepId: null, pendingStepId: null, phase: "ready", textPaused: false, error: null };
    db.prepare(`INSERT INTO cutscene_runs (run_id, cutscene_id, mode, launch_context, version, return_state,
      audio_scope, controller_id, checkpoint, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(runId, input.cutsceneId, input.mode, JSON.stringify(input.context), JSON.stringify(version), JSON.stringify(saved),
        scope, input.controllerId, JSON.stringify(checkpoint), now, now);
    const insertUse = db.prepare("INSERT INTO cutscene_run_uses (run_id, cutscene_id) VALUES (?, ?)");
    for (const id of uses) insertUse.run(runId, id);
    if (input.mode === "live") claimPlayerDisplay({ runId, controllerId: input.controllerId });
    return readCutsceneRun(runId);
  }).immediate();
}

function assertCheckpoint(value: RunRow, checkpoint: CutsceneRunCheckpoint): void {
  const version = JSON.parse(value.version) as CutsceneVersionSnapshot;
  const steps = new Set(version.document.steps.map(step => step.id));
  const previous = JSON.parse(value.checkpoint) as CutsceneRunCheckpoint;
  if (checkpoint.runId !== value.run_id || [checkpoint.stepId, checkpoint.pendingStepId, checkpoint.error?.stepId]
    .some(id => id != null && !steps.has(id))) return bad("Шаг отсутствует в зафиксированной версии запуска");
  if (checkpoint.phase === "playing" && checkpoint.stepId === null) return bad("Не выбран текущий шаг");
  if (checkpoint.stepId !== previous.stepId && checkpoint.phase !== "playing") return bad("Подтверждённый шаг меняется только после подготовки");
  if (checkpoint.phase === "ready" && checkpoint.stepId !== null) return bad("Готовность предшествует первому шагу");
  if (checkpoint.phase === "preparing" && checkpoint.pendingStepId === null) return bad("Не выбран подготавливаемый шаг");
  if (checkpoint.pendingStepId !== null && checkpoint.phase !== "preparing" && checkpoint.phase !== "error") return bad("Ожидающий шаг допустим только при подготовке или ошибке");
  if ((checkpoint.phase === "error") !== (checkpoint.error !== null)) return bad("Состояние ошибки не соответствует фазе");
  if (previous.phase === "paused" && previous.stepId !== null && previous.stepId !== checkpoint.stepId) return conflict("Сначала продолжите показ с общей паузы");
  if (checkpoint.error?.media && !db.prepare(`SELECT 1 FROM cutscene_media_holds h JOIN cutscene_media m ON m.id = h.media_id
    WHERE h.holder_kind = 'snapshot' AND h.holder_key = ? AND m.id = ? AND m.kind = ?`)
    .get(value.run_id, checkpoint.error.media.id, checkpoint.error.media.kind)) return bad("Ошибка относится к чужому материалу");
}
export function updateCutsceneRun(runId: string, raw: unknown): CutsceneRunState {
  const input = runInput(updateRunInput, raw);
  return db.transaction(() => {
    const value = writable(runId, input.owner, input.revision);
    assertCheckpoint(value, input.checkpoint);
    const before = state(value), checkpoint = input.checkpoint;
    db.prepare("UPDATE cutscene_runs SET checkpoint = ?, revision = revision + 1, updated_at = ? WHERE run_id = ?")
      .run(JSON.stringify(checkpoint), new Date().toISOString(), runId);
    if (value.mode === "live" && checkpoint.phase === "playing" && checkpoint.stepId !== before.checkpoint.stepId) {
      const resolved = resolveCutsceneStep(before.snapshot.version.document, checkpoint.stepId!)!;
      const prior = before.checkpoint.stepId ? resolveCutsceneStep(before.snapshot.version.document, before.checkpoint.stepId) : null;
      const display = readPlayerDisplay().snapshot;
      const sameVisual = display?.source.kind === "cutscene" && display.source.cutsceneId === value.cutscene_id &&
        prior !== null && prior.image.sourceStepId === resolved.image.sourceStepId;
      publishPlayerDisplay({ source: { kind: "cutscene", cutsceneId: value.cutscene_id, frame: projectCutscenePlayerFrame(resolved) },
        context: before.snapshot.context, display: display?.display ?? DEFAULT_DISPLAY, visibleLayerIds: [],
        playKey: sameVisual ? display!.playKey : randomUUID() }, input.owner);
    }
    return readCutsceneRun(runId);
  }).immediate();
}
export function recoverCutsceneRun(runId: string, raw: unknown): CutsceneRunState {
  const input = runInput(recoverRunInput, raw);
  return db.transaction(() => {
    const value = row(runId);
    if (value.ended_at || value.revision !== input.revision) return conflict("Запуск уже изменён; перечитайте его состояние");
    if (value.controller_id === input.controllerId) return bad("Для восстановления нужен новый ключ управляющего окна");
    const checkpoint = JSON.parse(value.checkpoint) as CutsceneRunCheckpoint;
    // Only the committed step survives; no in-flight seek, music seconds or scroll history is promoted.
    const paused = { ...checkpoint, pendingStepId: null, phase: "paused", error: null } satisfies CutsceneRunCheckpoint;
    if (value.mode === "live") transferPlayerDisplay({ runId, controllerId: value.controller_id }, { runId, controllerId: input.controllerId });
    db.prepare("UPDATE cutscene_runs SET controller_id = ?, checkpoint = ?, revision = revision + 1, updated_at = ? WHERE run_id = ?")
      .run(input.controllerId, JSON.stringify(paused), new Date().toISOString(), runId);
    return readCutsceneRun(runId);
  }).immediate();
}

export function readCutsceneMusic(): CutsceneMusicState {
  const value = db.prepare("SELECT run_id, audio, revision FROM cutscene_music_state WHERE id = 1").get() as
    { run_id: string | null; audio: string | null; revision: number } | undefined;
  return { runId: value?.run_id ?? null, audio: value?.audio ? JSON.parse(value.audio) : null, revision: value?.revision ?? 0 };
}
function writeMusic(runId: string, audio: CutsceneAudioReturnSnapshot | null): CutsceneMusicState {
  const refs = audio ? audioRefs(audio) : [];
  const uses = audio ? audioOriginalIds(audio) : [];
  retainCutsceneMedia(MUSIC_HOLD, refs);
  db.prepare("DELETE FROM cutscene_music_uses").run();
  for (const id of uses) db.prepare("INSERT INTO cutscene_music_uses (cutscene_id) VALUES (?)").run(id);
  const saved = uses.length ? audio : null;
  db.prepare(`INSERT INTO cutscene_music_state (id, run_id, audio, revision) VALUES (1, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, audio = excluded.audio, revision = revision + 1`)
    .run(saved ? runId : null, saved ? JSON.stringify(saved) : null);
  return readCutsceneMusic();
}
export function releaseCutsceneMusic(raw: unknown): CutsceneMusicState {
  const input = runInput(releaseMusicInput, raw);
  return db.transaction(() => {
    const current = readCutsceneMusic();
    if (!current.audio) return current;
    if (current.runId !== input.runId || current.revision !== input.revision) return conflict("Уже звучит другая переданная музыка");
    return writeMusic(input.runId, null);
  }).immediate();
}
function keptMusic(value: CutsceneRunState, music: CutsceneRetainedMusicSnapshot | null | undefined): CutsceneAudioReturnSnapshot | null {
  if (music === undefined) return bad("Нужно подтвердить конечное звучание или тишину");
  if (music === null) return null;
  const command = value.checkpoint.stepId ? resolveCutsceneStep(value.snapshot.version.document, value.checkpoint.stepId)?.audio.command : null;
  if (music.runId !== value.snapshot.runId || music.cutsceneId !== value.snapshot.version.cutsceneId || !isDeepStrictEqual(command, music.command)) {
    return bad("Переданная музыка не соответствует текущей команде снимка");
  }
  if (music.positionSeconds < command!.startSeconds || (command!.endSeconds !== null && music.positionSeconds > command!.endSeconds)) {
    return bad("Позиция переданной музыки выходит за границы фрагмента");
  }
  const duration = (db.prepare("SELECT duration_seconds FROM cutscene_media WHERE id = ?").get(command!.audio.id) as { duration_seconds: number | null } | undefined)?.duration_seconds;
  if (!duration || music.positionSeconds > (command!.endSeconds ?? duration)) return bad("Позиция переданной музыки выходит за границы файла");
  return music.state === "stopped" ? null : { scope: "music", background: music };
}
export function finishCutsceneRun(runId: string, raw: unknown): CutsceneRunFinishResult {
  const input = runInput(finishRunInput, raw);
  return db.transaction(() => {
    const previous = row(runId);
    if (previous.ended_at) {
      const stored = JSON.parse(previous.checkpoint).finishResult as Omit<CutsceneRunFinishResult, "run"> | undefined;
      const expectedPhase = input.kind === "interrupt" ? "interrupted" : "completed";
      if (!stored || previous.controller_id !== input.owner.controllerId || input.owner.runId !== runId ||
        previous.revision !== input.revision + 1 || state(previous).checkpoint.phase !== expectedPhase ||
        readActiveCutsceneRun() || readCutsceneMusic().revision !== stored.music.revision ||
        (stored.display && readPlayerDisplay().snapshot?.playKey !== stored.display.snapshot?.playKey)) {
        return conflict("Результат этого запуска уже заменён; перечитайте состояние");
      }
      return { ...stored, run: state(previous) };
    }
    const value = writable(runId, input.owner, input.revision), current = state(value);
    if (input.kind === "complete" && current.checkpoint.stepId === null) return conflict("Показ ещё не начал первый шаг");
    const restoring = input.kind === "interrupt" || value.mode === "rehearsal";
    const imageResult = restoring ? "restore" : current.snapshot.version.document.settings.finish.image;
    const audioResult = restoring ? "restore" : current.snapshot.version.document.settings.finish.audio;
    const audio = audioResult === "restore" ? current.snapshot.returnState.audio : audioResult === "keep" ? keptMusic(current, input.music) : null;
    const ended = { ...current.checkpoint, pendingStepId: null, phase: input.kind === "interrupt" ? "interrupted" : "completed", error: null } satisfies CutsceneRunCheckpoint;
    const now = new Date().toISOString();
    // The registered owner is released only inside this transaction, after every target was validated.
    db.prepare("UPDATE cutscene_runs SET checkpoint = ?, ended_at = ?, updated_at = ?, revision = revision + 1 WHERE run_id = ?")
      .run(JSON.stringify(ended), now, now, runId);
    if (value.mode === "live") {
      if (imageResult === "restore") publishPlayerDisplay(current.snapshot.returnState.presentation, input.owner, restoring
        ? { kind: "cut", durationMs: 0 } : current.snapshot.version.document.settings.finish.imageTransition);
      if (imageResult === "black") publishPlayerDisplay({ source: { kind: "black" }, context: current.snapshot.context,
        display: readPlayerDisplay().snapshot?.display ?? DEFAULT_DISPLAY, visibleLayerIds: [], playKey: randomUUID() }, input.owner,
        current.snapshot.version.document.settings.finish.imageTransition);
      releasePlayerDisplay(input.owner);
    }
    const music = writeMusic(runId, audio);
    releaseCutsceneMedia(snapshotHold(runId));
    db.prepare("DELETE FROM cutscene_run_uses WHERE run_id = ?").run(runId);
    const finishResult = { display: value.mode === "live" ? readPlayerDisplay() : null, music,
      imageResult, audioResult, closeWindow: value.mode === "live" && imageResult === "restore" &&
        current.snapshot.returnState.presentation === null && current.snapshot.returnState.window.openedByRun && !current.snapshot.returnState.window.wasOpen };
    // The private checkpoint envelope stores an outcome, not playback seconds. A lost HTTP response can be retried exactly.
    db.prepare("UPDATE cutscene_runs SET checkpoint = ? WHERE run_id = ?").run(JSON.stringify({ ...ended, finishResult }), runId);
    return { ...finishResult, run: readCutsceneRun(runId) };
  }).immediate();
}
export function readCutsceneRuntimeUsage(cutsceneId: number): CutsceneRuntimeUsage {
  const usage = readCutsceneUsage(cutsceneId);
  return { cutsceneId, runs: usage.places.flatMap(place => place.kind === "live" || place.kind === "rehearsal"
    ? [{ runId: place.key.slice(4), mode: place.kind }] : []),
    frame: usage.places.some(place => place.kind === "frame"), music: usage.places.some(place => place.kind === "music") };
}
