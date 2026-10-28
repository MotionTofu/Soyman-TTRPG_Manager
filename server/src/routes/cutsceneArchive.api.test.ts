import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCutsceneDocument, type CutsceneAudioReturnSnapshot, type CutsceneRunState } from "@soyman/shared";
import { db } from "../db/db";
import { migrateCutsceneRuns } from "../db/cutsceneRuns";
import { attachUser, signToken } from "../services/auth";
import { apiRoleGate } from "../services/playerAccess";
import { mediaCutscene } from "../test/cutsceneFiles";
import { createCutscene, saveCutscene } from "../services/cutscenes";
import { duplicateCutscene } from "../services/cutsceneDuplicate";
import { recoverCutscenePurges } from "../services/cutsceneDeletion";
import { collectCutsceneMedia, retainCutsceneMedia } from "../services/cutsceneMedia";
import { readCutsceneMusic } from "../services/cutsceneRuns";
import { publishPlayerDisplay } from "../services/playerDisplay";
import { vaultAbs } from "../services/filesystem";
import { archiveRouter } from "./archive";
import { cutscenesRouter } from "./cutscenes";
import { cutsceneRunsRouter } from "./cutsceneRuns";

const app = express(); app.use(express.json()); app.use(attachUser); app.use("/api", apiRoleGate);
app.use("/api", cutscenesRouter); app.use("/api/archive", archiveRouter); app.use("/api/cutscene-runs", cutsceneRunsRouter);
const token = (role: "gm" | "player") => signToken({ id: 95015, username: "archive15", role, playerId: null, isAdmin: false, tokenVersion: 0 });
const api = (method: "get" | "post" | "put" | "delete", url: string, role: "gm" | "player" = "gm") => request(app)[method]("/api" + url).auth(token(role), { type: "bearer" });
const purge = (id: number) => api("delete", `/archive/cutscene/${id}`);
const usage = (id: number) => api("get", `/cutscenes/${id}/usage`);
const archive = (id: number) => api("delete", `/cutscenes/${id}`);
const owner = (run: CutsceneRunState) => ({ runId: run.snapshot.runId, controllerId: run.snapshot.ownership.controllerId });
const audio = (): CutsceneAudioReturnSnapshot => ({ scope: "all", background: { kind: "queue", queue: [], index: null,
  positionSeconds: 0, state: "stopped", volume: 1, repeat: "off", shuffle: false, activePlaylistId: null },
  ambient: { source: null, positionSeconds: 0, state: "stopped" }, weather: { source: null, positionSeconds: 0, state: "stopped" },
  setId: null, duckingId: null, silence: false, volumes: { master: 1, background: 1, ambient: 1, weather: 1, stinger: 1 }, automation: { combat: null, sceneSet: null } });
async function start(id: number, mode: "live" | "rehearsal" = "live", context: object = { kind: "library" }) {
  return api("post", "/cutscene-runs").send({ cutsceneId: id, controllerId: "archive15-controller", mode, context,
    returnState: { audio: audio(), window: { wasOpen: true, openedByRun: false, screenId: null } } });
}
async function commit(run: CutsceneRunState): Promise<CutsceneRunState> {
  const response = await api("put", `/cutscene-runs/${run.snapshot.runId}/checkpoint`).send({ owner: owner(run), revision: run.revision,
    checkpoint: { ...run.checkpoint, phase: "playing", stepId: "first" } });
  expect(response.status).toBe(200); return response.body;
}
async function finish(run: CutsceneRunState, keep = false) {
  const action = run.snapshot.version.document.steps[0].audio;
  return api("post", `/cutscene-runs/${run.snapshot.runId}/finish`).send({ owner: owner(run), revision: run.revision, kind: "complete",
    ...(keep && action.action === "replace" ? { music: { kind: "cutscene", cutsceneId: run.snapshot.version.cutsceneId,
      runId: run.snapshot.runId, command: action.command, positionSeconds: .5, state: "playing", volume: action.command.volume } } : {}) });
}
beforeEach(() => {
  db.exec(`DELETE FROM cutscene_run_uses; DELETE FROM cutscene_runs; DELETE FROM cutscene_music_uses; DELETE FROM cutscene_music_state;
    DELETE FROM player_display_state; DELETE FROM cutscene_media_holds WHERE holder_kind IN ('snapshot', 'frame', 'music')`);
});
afterEach(() => { vi.restoreAllMocks(); db.exec("DROP TRIGGER IF EXISTS archive15_refuse_delete"); recoverCutscenePurges(); });

describe("архив и защищённое удаление катсцен", () => {
  it("не удаляет активный оригинал окончательно", async () => {
    const item = createCutscene(createCutsceneDocument("Не архив")); expect((await purge(item.id)).status).toBe(400);
    expect((await api("get", `/cutscenes/${item.id}`)).status).toBe(200);
  });
  it("архив скрывает каталог, сохраняя документ, версию, медиа и существующие ссылки", async () => {
    const { original, image } = await mediaCutscene(), campaign = Number(db.prepare("INSERT INTO campaigns(name) VALUES ('Архив 15 кампания')").run().lastInsertRowid);
    db.prepare("INSERT INTO campaign_cutscenes VALUES (?,?)").run(campaign, original.id);
    expect((await archive(original.id)).status).toBe(200);
    expect((await api("get", "/cutscenes")).body.some((row: { id: number }) => row.id === original.id)).toBe(false);
    expect((await api("get", `/campaigns/${campaign}/cutscenes`)).body[0].archivedAt).toBeTruthy();
    const archived = (await api("get", `/cutscenes/${original.id}`)).body;
    expect(archived.document).toEqual(original.document); expect(archived.savedVersion).toBe(original.savedVersion);
    expect((await api("get", `/cutscenes/${original.id}/media/${image.ref.id}/access`)).status).toBe(200);
    expect((await api("get", "/archive")).body.some((row: { type: string; id: number }) => row.type === "cutscene" && row.id === original.id)).toBe(true);
    expect((await api("put", `/cutscenes/${original.id}/restore`)).body.archivedAt).toBeNull();
  });
  it("называет подборку и план, не удаляя ссылки прямым DELETE", async () => {
    const item = createCutscene(createCutsceneDocument("Связанная"));
    const c = Number(db.prepare("INSERT INTO campaigns(name) VALUES ('Называемая кампания')").run().lastInsertRowid);
    const s = Number(db.prepare("INSERT INTO sessions(campaign_id,date,title) VALUES (?,'2026-10-26','Называемая сессия')").run(c).lastInsertRowid);
    db.prepare("INSERT INTO campaign_cutscenes VALUES (?,?)").run(c, item.id); db.prepare("INSERT INTO session_cutscenes VALUES (?,?,0)").run(s, item.id);
    await archive(item.id); const result = await purge(item.id); expect(result.status).toBe(409);
    expect(result.body.error).toContain("Называемая кампания"); expect(result.body.error).toContain("Называемая сессия");
    expect((await usage(item.id)).body.places.map((place: { kind: string }) => place.kind)).toEqual(["campaign", "session"]);
    expect(db.prepare("SELECT 1 FROM session_cutscenes WHERE cutscene_id = ?").get(item.id)).toBeDefined();
  });
  it("архив запускается из сохранённой подборки, но не из общей библиотеки или чужого контекста", async () => {
    const { original } = await mediaCutscene(), c = Number(db.prepare("INSERT INTO campaigns(name) VALUES ('Привязанный архив')").run().lastInsertRowid);
    await archive(original.id); expect((await start(original.id)).status).toBe(409);
    expect((await start(original.id, "live", { kind: "campaign", campaignId: c })).status).toBe(409);
    db.prepare("INSERT INTO campaign_cutscenes VALUES (?,?)").run(c, original.id);
    expect((await start(original.id, "live", { kind: "campaign", campaignId: c })).status).toBe(201);
  });
  it("архив запускается из независимого плана без подборки кампании", async () => {
    const { original } = await mediaCutscene(), c = Number(db.prepare("INSERT INTO campaigns(name) VALUES ('Только план')").run().lastInsertRowid);
    const s = Number(db.prepare("INSERT INTO sessions(campaign_id,date) VALUES (?,'2026-10-26')").run(c).lastInsertRowid);
    db.prepare("INSERT INTO session_cutscenes VALUES (?,?,0)").run(s, original.id); await archive(original.id);
    expect((await start(original.id, "rehearsal", { kind: "session", sessionId: s, campaignId: c })).status).toBe(201);
  });
  it.each(["live", "rehearsal"] as const)("сохранённый %s защищает после потери окна и повторной инициализации", async mode => {
    const { original } = await mediaCutscene(), response = await start(original.id, mode); expect(response.status).toBe(201);
    await archive(original.id); migrateCutsceneRuns(db.prepare("SELECT 1").database);
    const result = await purge(original.id); expect(result.status).toBe(409);
    expect((await usage(original.id)).body.places.some((place: { kind: string }) => place.kind === mode)).toBe(true);
  });
  it("защищает материал другого оригинала в снимке возврата, даже после правки текущего документа", async () => {
    const a = await mediaCutscene(), b = await mediaCutscene();
    const started = await start(a.original.id); const committed = await commit(started.body); const doc = committed.snapshot.version.document;
    const keep = saveCutscene(a.original.id, { ...doc, settings: { ...doc.settings, finish: { ...doc.settings.finish, image: "keep", audio: "silence" } } });
    // Publish a valid retained source outside a run; the next run must retain it in its return snapshot.
    expect((await finish(committed)).status).toBe(200);
    const { projectCutscenePlayerFrame, resolveCutsceneStep } = await import("@soyman/shared");
    publishPlayerDisplay({ source: { kind: "cutscene", cutsceneId: keep.id, frame: projectCutscenePlayerFrame(resolveCutsceneStep(keep.document, "first")!) }, context: null, display: {}, visibleLayerIds: [], playKey: "return-a" });
    expect((await start(b.original.id, "rehearsal")).status).toBe(201);
    saveCutscene(a.original.id, createCutsceneDocument("Новая пустая версия")); await archive(a.original.id); collectCutsceneMedia();
    expect((await purge(a.original.id)).status).toBe(409);
    expect((await usage(a.original.id)).body.places.some((place: { kind: string }) => place.kind === "rehearsal")).toBe(true);
  });
  it("оставленные кадр и музыка запрещают удаление по отдельности, пока не освобождены оба", async () => {
    const fixture = await mediaCutscene(), doc = fixture.original.document;
    saveCutscene(fixture.original.id, { ...doc, settings: { ...doc.settings, finish: { ...doc.settings.finish, image: "keep", audio: "keep" } } });
    const run = await commit((await start(fixture.original.id)).body); expect((await finish(run, true)).status).toBe(200); await archive(fixture.original.id);
    expect((await usage(fixture.original.id)).body.places.map((place: { kind: string }) => place.kind)).toEqual(["frame", "music"]);
    publishPlayerDisplay(null); expect((await purge(fixture.original.id)).status).toBe(409);
    const music = readCutsceneMusic(); expect((await api("post", "/cutscene-runs/music/release").send({ runId: music.runId, revision: music.revision })).status).toBe(200);
    expect((await purge(fixture.original.id)).status).toBe(200);
  });
  it("отдельное удержание старой версии и подготовка дубликата не обходят защиту", async () => {
    const { original, image } = await mediaCutscene(); retainCutsceneMedia({ kind: "snapshot", key: "duplicate:archive15" }, [image.ref]); await archive(original.id);
    expect((await purge(original.id)).status).toBe(409); expect((await usage(original.id)).body.places.some((place: { kind: string }) => place.kind === "preparation")).toBe(true);
  });
  it("после снятия связей удаляет оригинал и его файлы, сохраняя независимый дубликат", async () => {
    const { original } = await mediaCutscene(), copy = await duplicateCutscene(original.id);
    const rows = (id: number) => db.prepare("SELECT file_path FROM cutscene_media WHERE cutscene_id = ?").all(id) as { file_path: string }[];
    const sourceFiles = rows(original.id), copyFiles = rows(copy.id); await archive(original.id);
    expect((await purge(original.id)).status).toBe(200); expect(sourceFiles.every(row => !fs.existsSync(vaultAbs(row.file_path)))).toBe(true);
    expect(copyFiles.every(row => fs.existsSync(vaultAbs(row.file_path)))).toBe(true); expect((await api("get", `/cutscenes/${copy.id}`)).body.document).toEqual(copy.document);
  });
  it("отказ SQL возвращает переименованные файлы и откатывает документ и удержания", async () => {
    const { original } = await mediaCutscene(), rows = db.prepare("SELECT file_path FROM cutscene_media WHERE cutscene_id = ?").all(original.id) as { file_path: string }[];
    await archive(original.id); db.exec(`CREATE TRIGGER archive15_refuse_delete BEFORE DELETE ON cutscenes WHEN OLD.id = ${original.id} BEGIN SELECT RAISE(ABORT,'archive15'); END`);
    expect((await purge(original.id)).status).toBe(500); expect(rows.every(row => fs.existsSync(vaultAbs(row.file_path)))).toBe(true);
    expect((await api("post", `/cutscenes/${original.id}/readiness`)).body.readiness.ready).toBe(true);
  });
  it("отказ переименования не оставляет половину файлов удалёнными", async () => {
    const { original } = await mediaCutscene(); await archive(original.id); const rename = fs.renameSync.bind(fs); let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (++calls === 2) throw Error("locked"); rename(from, to); });
    expect((await purge(original.id)).status).toBe(500);
    expect((await api("post", `/cutscenes/${original.id}/readiness`)).body.readiness.ready).toBe(true);
  });
  it("незавершённая очистка после коммита повторяется из журнала", async () => {
    const { original } = await mediaCutscene(); await archive(original.id); const unlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation(file => { if (String(file).endsWith(".file")) throw Error("locked"); unlink(file); });
    expect((await purge(original.id)).status).toBe(200); vi.restoreAllMocks(); recoverCutscenePurges();
    expect(fs.readdirSync(vaultAbs("Cutscenes/media")).filter(name => name.startsWith(".purge-"))).toEqual([]);
  });
  it("после аварии до коммита возвращает файл существующего оригинала", async () => {
    const { original } = await mediaCutscene(), row = db.prepare("SELECT file_path FROM cutscene_media WHERE cutscene_id = ? LIMIT 1").get(original.id) as { file_path: string };
    const root = vaultAbs("Cutscenes/media"), token = randomUUID(), entry = { original: path.basename(row.file_path), staged: `.purge-${token}-0.file` };
    fs.writeFileSync(path.join(root, `.purge-${token}.json`), JSON.stringify({ id: original.id, token, files: [entry] }));
    fs.renameSync(vaultAbs(row.file_path), path.join(root, entry.staged)); recoverCutscenePurges();
    expect(fs.existsSync(vaultAbs(row.file_path))).toBe(true); expect((await api("post", `/cutscenes/${original.id}/readiness`)).body.readiness.ready).toBe(true);
  });
  it("отказывает игроку во всех новых приватных операциях", async () => {
    const item = createCutscene(createCutsceneDocument("Приватный архив"));
    for (const [method, url] of [["get", `/cutscenes/${item.id}/usage`], ["get", `/archive/cutscene/${item.id}/impact`], ["delete", `/archive/cutscene/${item.id}`], ["delete", `/cutscenes/${item.id}`], ["put", `/cutscenes/${item.id}/restore`]] as const) expect((await api(method, url, "player")).status).toBe(403);
  });
});
