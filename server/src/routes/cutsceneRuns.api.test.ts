import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import { createCutsceneDocument, type CutsceneAudioReturnSnapshot, type CutsceneDocument, type CutsceneRetainedMusicSnapshot,
  type CutsceneRunStart, type CutsceneRunState } from "@soyman/shared";
import { db } from "../db/db";
import { attachUser, signToken } from "../services/auth";
import { mediaCutscene } from "../test/cutsceneFiles";
import { createCutscene, saveCutscene } from "../services/cutscenes";
import { collectCutsceneMedia, accessCutsceneMedia } from "../services/cutsceneMedia";
import { readPlayerDisplay, publishPlayerDisplay, claimPlayerDisplay } from "../services/playerDisplay";
import { vaultAbs } from "../services/filesystem";
import { migrateCutsceneRuns } from "../db/cutsceneRuns";
import { cutsceneRunsRouter } from "./cutsceneRuns";
import { playerDisplayRouter } from "./playerDisplay";

const app = express(); app.use(express.json()); app.use(attachUser);
app.use("/api/cutscene-runs", cutsceneRunsRouter); app.use("/api/presentation", playerDisplayRouter);
const gm = signToken({ id: 92007, username: "run-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 93007, username: "run-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
const api = (method: "get" | "put" | "post", route: string, bearer = gm) => request(app)[method](`/api/cutscene-runs${route}`).auth(bearer, { type: "bearer" });
const background = () => ({ kind: "queue" as const, queue: [], index: null, positionSeconds: 0, state: "stopped" as const,
  volume: 0.37, repeat: "track" as const, shuffle: true, activePlaylistId: null });
const audio = (): CutsceneAudioReturnSnapshot => ({ scope: "all", background: background(),
  ambient: { source: { kind: "resource", resourceId: 777 }, positionSeconds: 31, state: "paused" },
  weather: { source: null, positionSeconds: 0, state: "stopped" }, setId: null, duckingId: null, silence: false,
  volumes: { master: .8, background: .6, ambient: .4, weather: .3, stinger: .5 }, automation: { combat: null, sceneSet: null } });
const input = (id: number): CutsceneRunStart => ({ cutsceneId: id, controllerId: "first-window", mode: "live", context: { kind: "library" },
  returnState: { audio: audio(), window: { wasOpen: false, openedByRun: true, screenId: null } } });
const owner = (run: CutsceneRunState) => ({ runId: run.snapshot.runId, controllerId: run.snapshot.ownership.controllerId });
const pathOf = (run: CutsceneRunState) => `/${run.snapshot.runId}`;
async function start(id: number, patch: Partial<CutsceneRunStart> = {}): Promise<CutsceneRunState> {
  const response = await api("post", "/").send({ ...input(id), ...patch }); expect(response.status).toBe(201); return response.body;
}
async function commit(run: CutsceneRunState, stepId = "first"): Promise<CutsceneRunState> {
  const response = await api("put", pathOf(run) + "/checkpoint").send({ owner: owner(run), revision: run.revision,
    checkpoint: { ...run.checkpoint, stepId, phase: "playing", pendingStepId: null, error: null } });
  expect(response.status).toBe(200); return response.body;
}
function music(run: CutsceneRunState): CutsceneRetainedMusicSnapshot {
  const action = run.snapshot.version.document.steps[0].audio; if (action.action !== "replace") throw Error("fixture");
  return { kind: "cutscene", cutsceneId: run.snapshot.version.cutsceneId, runId: run.snapshot.runId,
    command: action.command, positionSeconds: .75, state: "playing", volume: action.command.volume };
}
async function keptFixture() {
  const fixture = await mediaCutscene();
  const document: CutsceneDocument = { ...fixture.original.document, settings: { ...fixture.original.document.settings,
    finish: { ...fixture.original.document.settings.finish, image: "keep", audio: "keep" } } };
  return { ...fixture, original: saveCutscene(fixture.original.id, document) };
}
const finish = (run: CutsceneRunState, kind = "complete", keep?: CutsceneRetainedMusicSnapshot | null) => api("post", pathOf(run) + "/finish")
  .send({ owner: owner(run), revision: run.revision, kind, ...(keep !== undefined ? { music: keep } : {}) });
beforeEach(() => {
  db.exec(`DELETE FROM cutscene_run_uses; DELETE FROM cutscene_runs; DELETE FROM cutscene_music_uses; DELETE FROM cutscene_music_state;
    DELETE FROM player_display_state; DELETE FROM cutscene_media_holds WHERE holder_kind IN ('snapshot', 'frame', 'music')`);
});

describe("серверное состояние запуска катсцены", () => {
  it("приватные операции требуют Мастера", async () => {
    for (const route of ["/active", "/music", "/usage/1", "/unknown"]) {
      expect((await api("get", route, player)).status).toBe(403);
      expect((await request(app).get("/api/cutscene-runs" + route)).status).toBe(401);
    }
  });
  it("фиксирует последнюю сохранённую версию; правка и архив оригинала не меняют запуск и доступ к файлам", async () => {
    const fixture = await mediaCutscene(), run = await start(fixture.original.id);
    expect(run.snapshot.version.savedVersion).toBe(fixture.original.savedVersion);
    expect(run.snapshot.returnState.audio).toEqual(audio()); expect(run.snapshot.context).toEqual({ kind: "library" });
    saveCutscene(fixture.original.id, createCutsceneDocument("Edited after launch"));
    db.prepare("UPDATE cutscenes SET archived_at = 'archived' WHERE id = ?").run(fixture.original.id); collectCutsceneMedia();
    const persisted = (await api("get", pathOf(run))).body;
    expect(persisted.snapshot.version).toEqual(run.snapshot.version);
    expect(() => accessCutsceneMedia(fixture.original.id, fixture.audio.ref.id)).not.toThrow();
    expect(() => accessCutsceneMedia(fixture.original.id, fixture.image.ref.id)).not.toThrow();
    await commit(run);
    const frame = await request(app).get("/api/presentation/frame").auth(gm, { type: "bearer" }); expect(frame.status).toBe(200);
    expect(frame.body.content.data.title).toBe("Титр");
    for (const forbidden of ["Приватная заметка", "**Текст**", '"audio"', '"document"', "returnState", "controllerId", "file_path"]) {
      expect(JSON.stringify(frame.body)).not.toContain(forbidden);
    }
  });
  it("не сохраняет подписанные URL из снимка звука и не разрешает переписать неизменяемую часть", async () => {
    const fixture = await mediaCutscene(), body = input(fixture.original.id);
    const response = await api("post", "/").send({ ...body, returnState: { ...body.returnState, audio: {
      ...body.returnState.audio, background: { ...background(), src: "/files/SECRET?sig=expired", queue: [{ source: { kind: "resource", resourceId: 777 }, name: "Track", src: "SECRET2" }], index: 0, state: "paused" },
    } } });
    expect(response.status).toBe(201); expect(JSON.stringify(response.body)).not.toContain("SECRET");
    expect(() => db.prepare("UPDATE cutscene_runs SET version = '{}' WHERE run_id = ?").run(response.body.snapshot.runId)).toThrow("immutable");
    const overwrite = await api("put", pathOf(response.body) + "/checkpoint").send({ owner: owner(response.body), revision: 1,
      checkpoint: response.body.checkpoint, version: {} }); expect(overwrite.status).toBe(400);
  });
  it("атомарно отклоняет второй старт и удерживает прежний кадр до подтверждения первого шага", async () => {
    const fixture = await mediaCutscene();
    const previous = publishPlayerDisplay({ source: { kind: "black" }, context: { kind: "library" }, display: {}, visibleLayerIds: [], playKey: "prior" });
    const responses = await Promise.all([api("post", "/").send(input(fixture.original.id)), api("post", "/").send(input(fixture.original.id))]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(readPlayerDisplay().snapshot).toEqual(previous.snapshot);
    expect((db.prepare("SELECT COUNT(*) n FROM cutscene_runs WHERE ended_at IS NULL").get() as { n: number }).n).toBe(1);
  });
  it("проверяет и владельца, и ревизию; запоздавшая команда не меняет текущий кадр", async () => {
    const fixture = await mediaCutscene(), first = await start(fixture.original.id), committed = await commit(first);
    const command = { owner: owner(first), revision: first.revision, checkpoint: { ...committed.checkpoint, stepId: "second" } };
    expect((await api("put", pathOf(first) + "/checkpoint").send(command)).status).toBe(409);
    expect((await api("put", pathOf(first) + "/checkpoint").send({ ...command, revision: committed.revision, owner: { ...owner(first), controllerId: "other" } })).status).toBe(409);
    expect((await api("get", pathOf(first))).body.checkpoint.stepId).toBe("first");
  });
  it("recovery переносит управление, сохраняет только подтверждённый шаг на паузе и ограждает от старого окна", async () => {
    const fixture = await mediaCutscene(), committed = await commit(await start(fixture.original.id));
    const preparing = (await api("put", pathOf(committed) + "/checkpoint").send({ owner: owner(committed), revision: committed.revision,
      checkpoint: { ...committed.checkpoint, phase: "preparing", pendingStepId: "second" } })).body as CutsceneRunState;
    const response = await api("post", pathOf(preparing) + "/recover").send({ controllerId: "reloaded-window", revision: preparing.revision });
    expect(response.status).toBe(200); const recovered = response.body as CutsceneRunState;
    expect(recovered.checkpoint).toMatchObject({ phase: "paused", stepId: "first", pendingStepId: null });
    expect(recovered.snapshot.version).toEqual(preparing.snapshot.version); expect(recovered.snapshot.returnState).toEqual(preparing.snapshot.returnState);
    expect(readPlayerDisplay().owner).toEqual(owner(recovered));
    expect((await finish(preparing, "interrupt")).status).toBe(409);
    expect((await request(app).put("/api/presentation/ownership").auth(gm, { type: "bearer" }).send({ owner: owner(preparing), release: true })).status).toBe(409);
    expect((await api("put", pathOf(recovered) + "/checkpoint").send({ owner: owner(recovered), revision: recovered.revision,
      checkpoint: { ...recovered.checkpoint, phase: "playing", stepId: "second" } })).status).toBe(409);
    const resumed = await commit(recovered, "first"), before = readPlayerDisplay().snapshot!.playKey;
    await commit(resumed, "second"); expect(readPlayerDisplay().snapshot!.playKey).toBe(before);
  });
  it("обычная публикация не подменяет замороженный кадр и не освобождает активный запуск", async () => {
    const fixture = await mediaCutscene(), run = await commit(await start(fixture.original.id));
    const snapshot = readPlayerDisplay().snapshot!;
    const body = { ...snapshot, source: { kind: "black" } };
    expect((await request(app).put("/api/presentation/state").auth(gm, { type: "bearer" }).send({ snapshot: body, owner: owner(run) })).status).toBe(409);
    expect((await request(app).put("/api/presentation/state").auth(gm, { type: "bearer" }).send({ snapshot: null, owner: owner(run) })).status).toBe(409);
    expect((await request(app).put("/api/presentation/ownership").auth(gm, { type: "bearer" }).send({ owner: owner(run), release: true })).status).toBe(409);
    expect(readPlayerDisplay().snapshot).toEqual(snapshot);
  });
  it("keep передаёт использование кадру/музыке, замена кадра и остановка музыки освобождают материалы", async () => {
    const fixture = await keptFixture(), run = await commit(await start(fixture.original.id));
    const finished = await finish(run, "complete", music(run)); expect(finished.status).toBe(200);
    saveCutscene(fixture.original.id, createCutsceneDocument("Edited")); collectCutsceneMedia();
    let usage = (await api("get", `/usage/${fixture.original.id}`)).body;
    expect(usage).toMatchObject({ runs: [], frame: true, music: true });
    expect(readPlayerDisplay().owner).toBeNull();
    const black = await request(app).put("/api/presentation/state").auth(gm, { type: "bearer" })
      .send({ snapshot: { source: { kind: "black" }, context: null, display: {}, visibleLayerIds: [], playKey: "replace" } }); expect(black.status).toBe(200);
    usage = (await api("get", `/usage/${fixture.original.id}`)).body; expect(usage.frame).toBe(false); expect(usage.music).toBe(true);
    expect((await api("post", "/music/release").send({ runId: run.snapshot.runId, revision: finished.body.music.revision })).status).toBe(200);
    expect((await api("get", `/usage/${fixture.original.id}`)).body).toMatchObject({ runs: [], frame: false, music: false });
    expect(db.prepare("SELECT id FROM cutscene_media WHERE id IN (?, ?)").all(fixture.image.ref.id, fixture.audio.ref.id)).toEqual([]);
    expect(() => db.prepare("DELETE FROM cutscenes WHERE id = ?").run(fixture.original.id)).not.toThrow();
    expect((await api("get", pathOf(run))).body.snapshot.version.cutsceneId).toBe(fixture.original.id);
  });
  it("следующий запуск удерживает старый кадр и музыку для возврата после правки их оригинала", async () => {
    const first = await keptFixture(), a = await commit(await start(first.original.id));
    const ended = await finish(a, "complete", music(a)); expect(ended.status).toBe(200);
    const second = await mediaCutscene(), before = input(second.original.id), previousAudio = { ...audio(), background: ended.body.music.audio.background };
    const b = await commit(await start(second.original.id, { returnState: { ...before.returnState, audio: previousAudio } }));
    saveCutscene(first.original.id, createCutsceneDocument("Old edited")); collectCutsceneMedia();
    expect((await api("get", `/usage/${first.original.id}`)).body.runs).toEqual([{ runId: b.snapshot.runId, mode: "live" }]);
    const restored = await finish(b, "interrupt"); expect(restored.status).toBe(200);
    expect(readPlayerDisplay().snapshot?.source).toMatchObject({ kind: "cutscene", cutsceneId: first.original.id });
    expect(restored.body.music.audio.background).toMatchObject({ kind: "cutscene", runId: a.snapshot.runId });
    expect(() => accessCutsceneMedia(first.original.id, first.audio.ref.id)).not.toThrow();
  });
  it("устаревшие finish и release не снимают управление и музыку нового запуска", async () => {
    const fixture = await keptFixture(), a = await commit(await start(fixture.original.id));
    const old = await finish(a, "complete", music(a)); const b = await commit(await start(fixture.original.id, { controllerId: "next-window" }));
    expect((await finish(a, "interrupt")).status).toBe(409); expect(readPlayerDisplay().owner).toEqual(owner(b));
    const next = await finish(b, "complete", music(b)); expect(next.status).toBe(200);
    expect((await api("post", "/music/release").send({ runId: a.snapshot.runId, revision: old.body.music.revision })).status).toBe(409);
    expect((await api("get", "/music")).body.runId).toBe(b.snapshot.runId);
  });
  it.each([false, true])("возврат к отсутствующему показу закрывает только созданное запуском окно: wasOpen=%s", async wasOpen => {
    const fixture = await mediaCutscene(), body = input(fixture.original.id);
    const run = await commit(await start(fixture.original.id, { returnState: { ...body.returnState, window: { wasOpen, openedByRun: !wasOpen, screenId: null } } }));
    const response = await finish(run); expect(response.status).toBe(200);
    expect(response.body.closeWindow).toBe(!wasOpen); expect(response.body.display.snapshot).toBeNull();
  });
  it("репетиция захватывает весь звук и сохраняет независимый экран и его владельца", async () => {
    const fixture = await keptFixture();
    publishPlayerDisplay({ source: { kind: "black" }, context: null, display: {}, visibleLayerIds: [], playKey: "unrelated" });
    claimPlayerDisplay({ runId: "other-display", controllerId: "other-window" }); const display = readPlayerDisplay();
    const run = await commit(await start(fixture.original.id, { mode: "rehearsal" }));
    expect(run.snapshot.ownership).toMatchObject({ display: false, audioScope: "all" }); expect(readPlayerDisplay()).toEqual(display);
    expect((await api("post", "/").send(input(fixture.original.id))).status).toBe(409);
    const response = await finish(run); expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ display: null, closeWindow: false, imageResult: "restore", audioResult: "restore" });
    expect(readPlayerDisplay()).toEqual(display);
  });
  it("недоступный материал откатывает создание запуска вместе с удержаниями и владельцем", async () => {
    const fixture = await mediaCutscene();
    const file = db.prepare("SELECT file_path FROM cutscene_media WHERE id = ?").get(fixture.image.ref.id) as { file_path: string };
    fs.unlinkSync(vaultAbs(file.file_path));
    const response = await api("post", "/").send(input(fixture.original.id)); expect(response.status).toBe(400);
    expect(response.body.issues.some((issue: { stepId: string }) => issue.stepId === "first")).toBe(true);
    expect((await api("get", "/active")).body).toBeNull(); expect(readPlayerDisplay().owner).toBeNull();
    expect(db.prepare("SELECT * FROM cutscene_media_holds WHERE holder_kind = 'snapshot'").all()).toEqual([]);
  });
  it("ошибочное завершение не освобождает активный снимок", async () => {
    const fixture = await keptFixture(), run = await commit(await start(fixture.original.id)), keep = music(run);
    const invalid = { ...keep, command: { ...keep.command, volume: .123 } };
    expect((await finish(run, "complete", invalid)).status).toBe(400);
    expect((await api("get", "/active")).body.snapshot.runId).toBe(run.snapshot.runId); expect(readPlayerDisplay().owner).toEqual(owner(run));
    expect(db.prepare("SELECT 1 FROM cutscene_media_holds WHERE holder_kind = 'snapshot' AND holder_key = ?").get(run.snapshot.runId)).toBeDefined();
  });
  it("поздняя ошибка возврата кадра откатывает ended_at и оставляет файлы удержанными", async () => {
    const fixture = await mediaCutscene();
    const sceneId = Number(db.prepare("INSERT INTO story_scenes (name) VALUES ('Run 07 old scene')").run().lastInsertRowid);
    publishPlayerDisplay({ source: { kind: "scene", sceneId }, context: null, display: {}, visibleLayerIds: [], playKey: "old-scene" });
    const run = await commit(await start(fixture.original.id)); db.prepare("DELETE FROM story_scenes WHERE id = ?").run(sceneId);
    expect((await finish(run, "interrupt")).status).toBe(400);
    expect((await api("get", pathOf(run))).body.endedAt).toBeNull(); expect(readPlayerDisplay().owner).toEqual(owner(run));
    expect(() => accessCutsceneMedia(fixture.original.id, fixture.audio.ref.id)).not.toThrow();
  });
  it("checkpoint не хранит историю секунд и не принимает шаги из новой версии оригинала", async () => {
    const fixture = await mediaCutscene(), run = await start(fixture.original.id);
    expect((await api("put", pathOf(run) + "/checkpoint").send({ owner: owner(run), revision: run.revision,
      checkpoint: { ...run.checkpoint, positionSeconds: 1.2 } })).status).toBe(400);
    expect((await api("put", pathOf(run) + "/checkpoint").send({ owner: owner(run), revision: run.revision,
      checkpoint: { ...run.checkpoint, phase: "playing", stepId: "not-in-snapshot" } })).status).toBe(400);
  });
  it("повторная инициализация схемы не освобождает запуск, подтверждённый шаг или файлы", async () => {
    const fixture = await mediaCutscene(), run = await commit(await start(fixture.original.id));
    migrateCutsceneRuns(db.prepare("SELECT 1").database); collectCutsceneMedia();
    expect((await api("get", "/active")).body).toEqual(run); expect((await api("get", `/usage/${fixture.original.id}`)).body.runs).toHaveLength(1);
    expect(() => accessCutsceneMedia(fixture.original.id, fixture.audio.ref.id)).not.toThrow();
  });
  it("пустой, архивный материал и неверный режим снимка не создают активный запуск", async () => {
    const empty = createCutscene(createCutsceneDocument("Empty")); expect((await api("post", "/").send(input(empty.id))).status).toBe(400);
    const fixture = await mediaCutscene(), badAudio = { scope: "music", background: background() };
    expect((await api("post", "/").send({ ...input(fixture.original.id), mode: "rehearsal", returnState: { ...input(fixture.original.id).returnState, audio: badAudio } })).status).toBe(400);
    db.prepare("UPDATE cutscenes SET archived_at = 'archived' WHERE id = ?").run(fixture.original.id);
    expect((await api("post", "/").send(input(fixture.original.id))).status).toBe(409);
  });
  it("повтор завершения после потери ответа возвращает тот же результат без новой записи", async () => {
    const fixture = await keptFixture(), run = await commit(await start(fixture.original.id));
    const first = await finish(run, "complete", music(run)); expect(first.status).toBe(200);
    const second = await finish(run, "complete", music(run)); expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const read = (await api("get", pathOf(run))).body;
    expect(read.checkpoint).not.toHaveProperty("finishResult");
    expect(read.revision).toBe(run.revision + 1);
  });
  it("повтор старого завершения не изменяет уже заменённые результаты", async () => {
    const fixture = await keptFixture(), run = await commit(await start(fixture.original.id));
    const response = await finish(run, "complete", music(run)); expect(response.status).toBe(200);
    await api("post", "/music/release").send({ runId: run.snapshot.runId, revision: response.body.music.revision });
    expect((await finish(run, "complete", music(run))).status).toBe(409);
  });
  it("повтор завершения не обходит нового владельца активного показа", async () => {
    const fixture = await keptFixture(), old = await commit(await start(fixture.original.id));
    expect((await finish(old, "complete", music(old))).status).toBe(200);
    const active = await start(fixture.original.id, { controllerId: "new-host" });
    expect((await finish(old, "complete", music(old))).status).toBe(409);
    expect(readPlayerDisplay().owner).toEqual(owner(active));
  });
  it("идентичность созданного окна переживает серверное восстановление", async () => {
    const fixture = await mediaCutscene(), body = input(fixture.original.id);
    const run = await start(fixture.original.id, { returnState: { ...body.returnState,
      window: { wasOpen: false, openedByRun: true, screenId: "screen-08", windowId: "window-08" } } });
    const response = await api("post", pathOf(run) + "/recover").send({ controllerId: "reload-08", revision: run.revision });
    expect(response.status).toBe(200);
    expect(response.body.snapshot.returnState.window).toEqual({
      wasOpen: false, openedByRun: true, screenId: "screen-08", windowId: "window-08" });
  });

});
