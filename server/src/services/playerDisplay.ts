import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { registeredCutsceneRun } from "../db/cutsceneRuns";
import { hasCutscenePreview } from "../db/cutscenePreviews";
import {
  createCutsceneDocument, createCutsceneStep, parseCutsceneDocument, projectCutscenePlayerFrame, resolveCutsceneStep,
  type CutsceneLaunchContext, type CutsceneMediaRef, type CutscenePlayerFrame, type CutscenePresentationSnapshot,
  type CutscenePresentationSource, type PlayerDisplayFrame, type PlayerDisplayOwner, type PlayerDisplayState,
  type CutsceneVisualTransition, type PresentationData, type ShowDisplay,
} from "@soyman/shared";
import { db } from "../db/db";
import { readCampaignCover, readScenePresentation } from "../story/presentation";
import { accessCutsceneMedia, releaseCutsceneMedia, retainCutsceneMedia } from "./cutsceneMedia";
import { CutsceneRequestError } from "./cutsceneErrors";

export const DEFAULT_DISPLAY: ShowDisplay = {
  rotation: null, fit: null, zoom: 1, pan_x: 0, pan_y: 0, screen_w: null, screen_h: null,
};
const FRAME_HOLD = { kind: "frame", key: "player-display" } as const;
const fail = (message: string): never => { throw new CutsceneRequestError(400, message); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Ожидался объект");
  return value as Record<string, unknown>;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return fail("Некорректный ID источника");
  return value;
}
function token(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) return fail("Некорректный ключ показа");
  return value;
}
export function parseDisplayOwner(raw: unknown): PlayerDisplayOwner {
  const value = record(raw);
  return { runId: token(value.runId), controllerId: token(value.controllerId) };
}
function sameOwner(a: PlayerDisplayOwner | null, b: PlayerDisplayOwner | null): boolean {
  return a?.runId === b?.runId && a?.controllerId === b?.controllerId;
}
export function readPlayerDisplay(): PlayerDisplayState {
  const row = db.prepare("SELECT snapshot, owner, transition, revision FROM player_display_state WHERE id = 1").get() as
    { snapshot: string | null; owner: string | null; transition: string | null; revision: number } | undefined;
  return { revision: row?.revision ?? 0, snapshot: row?.snapshot ? JSON.parse(row.snapshot) : null,
    owner: row?.owner ? JSON.parse(row.owner) : null, transition: row?.transition ? JSON.parse(row.transition) : null };
}
export function assertPlayerDisplayOwner(owner: PlayerDisplayOwner | null = null): void {
  const registered = registeredCutsceneRun(db.prepare("SELECT 1").database);
  if (registered?.mode === "live" && (owner?.runId !== registered.run_id || owner?.controllerId !== registered.controller_id)) {
    throw new CutsceneRequestError(409, "Показ принадлежит активному запуску катсцены");
  }
  const current = readPlayerDisplay().owner;
  if (current && !sameOwner(current, owner)) throw new CutsceneRequestError(409, "Экран игроков занят катсценой");
}
function store(snapshot: CutscenePresentationSnapshot | null, owner: PlayerDisplayOwner | null,
  transition: CutsceneVisualTransition | null = readPlayerDisplay().transition): PlayerDisplayState {
  db.prepare(`INSERT INTO player_display_state (id, snapshot, owner, transition, revision) VALUES (1, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, owner = excluded.owner,
      transition = excluded.transition, revision = revision + 1`)
    .run(snapshot ? JSON.stringify(snapshot) : null, owner ? JSON.stringify(owner) : null, transition ? JSON.stringify(transition) : null);
  return readPlayerDisplay();
}
export function claimPlayerDisplay(owner: PlayerDisplayOwner): PlayerDisplayState {
  return db.transaction(() => { assertPlayerDisplayOwner(owner); return store(readPlayerDisplay().snapshot, owner); })();
}
export function releasePlayerDisplay(owner: PlayerDisplayOwner): PlayerDisplayState {
  return db.transaction(() => {
    if (registeredCutsceneRun(db.prepare("SELECT 1").database)?.mode === "live") {
      throw new CutsceneRequestError(409, "Сначала завершите активный запуск катсцены");
    }
    assertPlayerDisplayOwner(owner); return store(readPlayerDisplay().snapshot, null);
  })();
}
/** Used by run recovery inside the same outer SQL transaction; no public transfer route. */
export function transferPlayerDisplay(owner: PlayerDisplayOwner, next: PlayerDisplayOwner): PlayerDisplayState {
  assertPlayerDisplayOwner(owner);
  if (!sameOwner(readPlayerDisplay().owner, owner)) throw new CutsceneRequestError(409, "Экран уже передан другому окну");
  return store(readPlayerDisplay().snapshot, next);
}
export function patchPlayerDisplay(raw: unknown, previous: ShowDisplay = DEFAULT_DISPLAY): ShowDisplay {
  const value = record(raw), next = { ...previous };
  if ("rotation" in value) {
    if (value.rotation !== null && ![0, 90, 180, 270].includes(value.rotation as number)) fail("Некорректный поворот");
    next.rotation = value.rotation as ShowDisplay["rotation"];
  }
  if ("fit" in value) {
    if (value.fit !== null && value.fit !== "contain" && value.fit !== "cover") fail("Некорректное вписывание");
    next.fit = value.fit as ShowDisplay["fit"];
  }
  const ranges = { zoom: [0.25, 8], pan_x: [-2, 2], pan_y: [-2, 2], screen_w: [1, 20000], screen_h: [1, 20000] } as const;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!(key in value)) continue;
    const v = value[key];
    if (v === null && (key === "screen_w" || key === "screen_h")) { next[key] = null; continue; }
    if (typeof v !== "number" || !Number.isFinite(v)) fail(`Некорректный параметр ${key}`);
    Object.assign(next, { [key]: Math.min(max, Math.max(min, v as number)) });
  }
  return next;
}
function context(raw: unknown): CutsceneLaunchContext | null {
  if (raw === null) return null;
  const value = record(raw);
  if (value.kind === "library") return { kind: "library" };
  if (value.kind === "campaign") return { kind: "campaign", campaignId: id(value.campaignId) };
  if (value.kind === "session") return { kind: "session", sessionId: id(value.sessionId), campaignId: value.campaignId === null ? null : id(value.campaignId) };
  return fail("Некорректный контекст показа");
}
/** Validate with the authored contract, then explicitly project; discard all GM-only fields. */
function cutsceneFrame(raw: unknown): CutscenePlayerFrame {
  const value = record(raw), stepId = token(value.stepId);
  const composition = value.composition === null ? null : record(value.composition);
  const layers = composition?.layers;
  if (composition && !Array.isArray(layers)) fail("Некорректные слои кадра");
  const step = { ...createCutsceneStep(stepId), image: composition === null
    ? { action: "clear", transition: value.transition }
    : { action: "replace", transition: value.transition, composition: {
      background: composition.background, title: composition.title, title_secs: composition.title_secs, fade_ms: composition.fade_ms,
      layers: (layers as unknown[]).map((rawLayer) => {
        const l = record(rawLayer);
        return { id: l.id, name: "", image: l.image, visible: l.visible, position: l.position,
          x_pct: l.x_pct, y_pct: l.y_pct, w_pct: l.w_pct, h_pct: l.h_pct };
      }),
    } } };
  const parsed = parseCutsceneDocument({ ...createCutsceneDocument("Кадр"), steps: [step] });
  if (parsed.ok === false) return fail("Некорректный кадр катсцены");
  const frame = projectCutscenePlayerFrame(resolveCutsceneStep(parsed.value, stepId)!);
  return { ...frame, sourceStepId: value.sourceStepId === null ? null : token(value.sourceStepId) };
}
function source(raw: unknown): CutscenePresentationSource {
  const value = record(raw);
  switch (value.kind) {
    case "black": return { kind: "black" };
    case "scene": {
      const sceneId = id(value.sceneId);
      if (!readScenePresentation(sceneId)) fail("Сцена не найдена");
      return { kind: "scene", sceneId };
    }
    case "cover": {
      const campaignId = id(value.campaignId);
      if (!readCampaignCover(campaignId)) fail("Кампания не найдена");
      return { kind: "cover", campaignId };
    }
    case "map": {
      const mapId = id(value.mapId);
      if (!db.prepare("SELECT id FROM maps WHERE id = ? AND archived_at IS NULL").get(mapId)) fail("Карта не найдена");
      return { kind: "map", mapId };
    }
    case "cutscene": return { kind: "cutscene", cutsceneId: id(value.cutsceneId), frame: cutsceneFrame(value.frame) };
    default: return fail("Неизвестный источник показа");
  }
}
function refs(frame: CutscenePlayerFrame): CutsceneMediaRef<"image">[] {
  return frame.composition ? [...(frame.composition.background ? [frame.composition.background] : []),
    ...frame.composition.layers.map(l => l.image)] : [];
}
function publicationTransition(raw: unknown): CutsceneVisualTransition | null {
  if (raw == null) return null;
  const value = record(raw);
  if (!["cut", "fade", "black"].includes(value.kind as string) || typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) || value.durationMs < 0) return fail("Некорректный переход показа");
  return { kind: value.kind as CutsceneVisualTransition["kind"], durationMs: value.durationMs };
}
export function publishPlayerDisplay(raw: unknown, owner: PlayerDisplayOwner | null = null, override?: unknown): PlayerDisplayState {
  return db.transaction(() => {
    assertPlayerDisplayOwner(owner);
    if (owner && !readPlayerDisplay().owner) throw new CutsceneRequestError(409, "Управление экраном уже освобождено");
    const transition = publicationTransition(override);
    if (raw === null) {
      if (registeredCutsceneRun(db.prepare("SELECT 1").database)?.mode === "live") throw new CutsceneRequestError(409, "Нельзя убрать активный показ через обычный пульт");
      releaseCutsceneMedia(FRAME_HOLD); return store(null, readPlayerDisplay().owner, transition);
    }
    const value = record(raw), s = source(value.source);
    const snapshot: CutscenePresentationSnapshot = {
      source: s, context: context(value.context), display: patchPlayerDisplay(value.display),
      visibleLayerIds: Array.isArray(value.visibleLayerIds) ? [...new Set(value.visibleLayerIds.filter(v => Number.isSafeInteger(v) && v > 0))] : [],
      playKey: token(value.playKey),
    };
    const registered = registeredCutsceneRun(db.prepare("SELECT 1").database);
    if (registered?.mode === "live") {
      const version = JSON.parse(registered.version), checkpoint = JSON.parse(registered.checkpoint);
      const resolved = checkpoint.stepId ? resolveCutsceneStep(version.document, checkpoint.stepId) : null;
      const expected = resolved ? { kind: "cutscene", cutsceneId: version.cutsceneId, frame: projectCutscenePlayerFrame(resolved) } : null;
      if (!expected || !isDeepStrictEqual(snapshot.source, expected) || !isDeepStrictEqual(snapshot.context, JSON.parse(registered.launch_context))) {
        throw new CutsceneRequestError(409, "Кадр не соответствует зафиксированному шагу запуска");
      }
    }
    if (s.kind === "cutscene") {
      if (!db.prepare("SELECT id FROM cutscenes WHERE id = ?").get(s.cutsceneId)) fail("Катсцена не найдена");
      for (const ref of refs(s.frame)) accessCutsceneMedia(s.cutsceneId, ref.id);
      retainCutsceneMedia(FRAME_HOLD, refs(s.frame), s.cutsceneId);
    } else releaseCutsceneMedia(FRAME_HOLD);
    return store(snapshot, readPlayerDisplay().owner, transition);
  })();
}
/** Resize may report during ownership; it cannot change source/camera or create a show. */
export function reportPlayerViewport(raw: unknown): PlayerDisplayState {
  const value = record(raw);
  return db.transaction(() => {
    const state = readPlayerDisplay();
    if (!state.snapshot) return state;
    const display = patchPlayerDisplay({ screen_w: value.screen_w, screen_h: value.screen_h }, state.snapshot.display);
    const updated = store({ ...state.snapshot, display }, state.owner);
    // Keep the existing pult preview's aspect ratio in sync without changing its source.
    if (state.snapshot.context?.kind === "session") {
      const sid = state.snapshot.context.sessionId;
      const row = db.prepare("SELECT display FROM session_show_state WHERE session_id = ?").get(sid) as { display: string } | undefined;
      if (row) db.prepare("UPDATE session_show_state SET display = ? WHERE session_id = ?")
        .run(JSON.stringify({ ...JSON.parse(row.display), screen_w: display.screen_w, screen_h: display.screen_h }), sid);
    }
    return updated;
  })();
}
/** Adapter for existing pult writes/scene launches. Rehearsals never publish to players. */
export function publishSessionDisplay(sessionId: number, ifEmpty = false): PlayerDisplayState {
  const current = readPlayerDisplay();
  if (ifEmpty && current.snapshot) return current;
  assertPlayerDisplayOwner();
  const session = db.prepare("SELECT campaign_id, live_mode FROM sessions WHERE id = ?").get(sessionId) as
    { campaign_id: number | null; live_mode: string | null } | undefined;
  if (!session) throw new CutsceneRequestError(404, "Сессия не найдена");
  if (session.live_mode === "rehearsal") return current;
  const row = db.prepare("SELECT * FROM session_show_state WHERE session_id = ?").get(sessionId) as
    { mode: string; scene_id: number | null; map_id: number | null; shown: number; display: string; visible_layer_ids: string } | undefined;
  if (!row?.shown) return publishPlayerDisplay(null);
  let selected: CutscenePresentationSource = { kind: "black" };
  if (row.mode === "scene" && row.scene_id) selected = { kind: "scene", sceneId: row.scene_id };
  if (row.mode === "cover" && session.campaign_id) selected = { kind: "cover", campaignId: session.campaign_id };
  if (row.mode === "map" && row.map_id) selected = { kind: "map", mapId: row.map_id };
  const rawDisplay = JSON.parse(row.display || "{}");
  const legacyFrame = `${row.mode}:${row.scene_id ?? ""}:${row.map_id ?? ""}`;
  const display = { ...rawDisplay };
  if (display.frame !== legacyFrame) { display.zoom = 1; display.pan_x = 0; display.pan_y = 0; }
  const same = current.snapshot?.context?.kind === "session" && current.snapshot.context.sessionId === sessionId &&
    JSON.stringify(current.snapshot.source) === JSON.stringify(selected);
  return publishPlayerDisplay({ source: selected, context: { kind: "session", sessionId, campaignId: session.campaign_id },
    display, visibleLayerIds: JSON.parse(row.visible_layer_ids), playKey: same ? current.snapshot!.playKey : crypto.randomUUID() });
}
function safeData(data: PresentationData): PresentationData {
  return { background_path: null, background_url: data.background_url, transition: data.transition, transition_ms: data.transition_ms,
    title: data.title, title_secs: data.title_secs, fade_ms: data.fade_ms,
    layers: data.layers.map(l => ({ id: l.id, name: "", image_path: "", image_url: l.image_url, has_button: l.has_button,
      visible_on_enter: l.visible_on_enter, position: l.position, x_pct: l.x_pct, y_pct: l.y_pct, w_pct: l.w_pct, h_pct: l.h_pct })) };
}
export function readPlayerFrame(): PlayerDisplayFrame {
  const { snapshot, revision, transition } = readPlayerDisplay();
  const previewRow = hasCutscenePreview(db.prepare("SELECT 1").database)
    ? db.prepare("SELECT state FROM cutscene_preview_state WHERE id=1").get() as { state: string } | undefined : undefined;
  const preview = previewRow ? JSON.parse(previewRow.state) : null;
  const base = { revision, playKey: snapshot?.playKey ?? "empty", display: { ...(snapshot?.display ?? DEFAULT_DISPLAY) },
    ...(preview?.external && sameOwner(readPlayerDisplay().owner, preview.owner) ? { visualPlayback: preview.visualPlayback } : {}),
    transition: transition ?? { kind: "cut" as const, durationMs: 0 } };
  if (!snapshot || snapshot.source.kind === "black") return { ...base, content: { kind: "black" } };
  const s = snapshot.source;
  if (s.kind !== "cutscene" && snapshot.context?.kind === "session" &&
    (db.prepare("SELECT live_mode FROM sessions WHERE id = ?").get(snapshot.context.sessionId) as { live_mode: string } | undefined)?.live_mode === "rehearsal") {
    return { ...base, playKey: `${base.playKey}:rehearsal`, transition: { kind: "cut", durationMs: 0 }, content: { kind: "black" } };
  }
  if (s.kind === "map") return { ...base, content: { kind: "map", mapId: s.mapId } };
  if (s.kind === "cutscene") {
    const c = s.frame.composition;
    if (!c) return { ...base, transition: transition ?? s.frame.transition, content: { kind: "black" } };
    const url = (ref: CutsceneMediaRef<"image">) => accessCutsceneMedia(s.cutsceneId, ref.id).url;
    const data: PresentationData = { background_path: null, background_url: c.background ? url(c.background) : null,
      title: c.title, title_secs: c.title_secs, fade_ms: c.fade_ms, transition: s.frame.transition.kind,
      transition_ms: s.frame.transition.durationMs, layers: c.layers.map((l, index) => ({
        id: index + 1, name: "", image_path: "", image_url: url(l.image), has_button: 1, visible_on_enter: +l.visible,
        position: l.position, x_pct: l.x_pct, y_pct: l.y_pct, w_pct: l.w_pct, h_pct: l.h_pct,
      })) };
    return { ...base, transition: transition ?? s.frame.transition, content: { kind: "composition", data,
      visibleLayerIds: c.layers.flatMap((l, i) => l.visible ? [i + 1] : []) } };
  }
  const data = s.kind === "scene" ? readScenePresentation(s.sceneId) : readCampaignCover(s.campaignId);
  return data ? { ...base, transition: transition ?? { kind: data.transition as "cut" | "fade" | "black", durationMs: data.transition_ms },
    content: { kind: "composition", data: safeData(data), visibleLayerIds: [...snapshot.visibleLayerIds] } }
    : { ...base, content: { kind: "black" } };
}
