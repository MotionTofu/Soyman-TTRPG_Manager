import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createCutsceneDocument, createCutsceneStep, projectCutscenePlayerFrame, resolveCutsceneStep } from "@soyman/shared";
import { db } from "../db/db";
import { attachUser, signToken } from "../services/auth";
import { createCutscene, saveCutscene } from "../services/cutscenes";
import { importCutsceneMedia, collectCutsceneMedia } from "../services/cutsceneMedia";
import { cutsceneFiles } from "../test/cutsceneFiles";
import { publishSessionDisplay, readPlayerDisplay } from "../services/playerDisplay";
import { playerDisplayRouter } from "./playerDisplay";
import { migratePlayerDisplay } from "../db/playerDisplay";

const app = express(); app.use(express.json()); app.use(attachUser); app.use("/api/presentation", playerDisplayRouter);
const gm = signToken({ id: 92004, username: "display-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 92005, username: "display-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
const owner = { runId: "run-04", controllerId: "controller-04" };
const api = (method: "get" | "put" | "post", path: string, bearer = gm) => request(app)[method](`/api/presentation${path}`).auth(bearer, { type: "bearer" });
const display = { rotation: 90, fit: "cover", zoom: 2, pan_x: 0.2, pan_y: -0.1, screen_w: 1920, screen_h: 1080 };
const black = () => ({ source: { kind: "black" }, context: { kind: "library" }, display, visibleLayerIds: [], playKey: "black-04" });
beforeEach(() => {
  db.prepare("DELETE FROM player_display_state").run();
  db.prepare("DELETE FROM cutscene_media_holds WHERE holder_kind = 'frame' AND holder_key = 'player-display'").run();
});

describe("единый экран игроков", () => {
  it("отличает отсутствие показа от чёрного и сохраняет снимок после повторной миграции", async () => {
    expect((await api("get", "/state")).body.snapshot).toBeNull();
    expect((await api("put", "/state").send({ snapshot: black() })).status).toBe(200);
    migratePlayerDisplay(db.prepare("SELECT 1").database);
    const state = (await api("get", "/state")).body;
    expect(state.snapshot).toEqual(black()); expect(state.revision).toBe(1);
    expect((await api("get", "/frame")).body.display).toEqual(display);
    await api("put", "/state").send({ snapshot: null });
    expect((await api("get", "/state")).body.snapshot).toBeNull();
  });

  it("без сессии показывает сцену, обложку и карту, сохраняет параметры возврата", async () => {
    const campaignId = Number(db.prepare("INSERT INTO campaigns (name, cover_title) VALUES ('Display API campaign', 'Cover')").run().lastInsertRowid);
    const sceneId = Number(db.prepare("INSERT INTO story_scenes (name, presentation_title) VALUES ('Display API scene', 'Scene')").run().lastInsertRowid);
    const mapId = Number(db.prepare("INSERT INTO maps (name, grid, scale) VALUES ('Display API map', 'square', 'locality')").run().lastInsertRowid);
    for (const source of [{ kind: "scene", sceneId }, { kind: "cover", campaignId }, { kind: "map", mapId }]) {
      const snapshot = { ...black(), source, playKey: source.kind };
      expect((await api("put", "/state").send({ snapshot })).status).toBe(200);
      expect((await api("get", "/state")).body.snapshot).toEqual(snapshot);
      const frame = (await api("get", "/frame")).body;
      expect(frame.content.kind).toBe(source.kind === "map" ? "map" : "composition");
    }
  });

  it("возврат может переопределить переход источника, повторное чтение сохраняет это решение", async () => {
    const snapshot = black();
    await api("put", "/state").send({ snapshot, transition: { kind: "fade", durationMs: 500 } });
    expect((await api("get", "/frame")).body.transition).toEqual({ kind: "fade", durationMs: 500 });
    await api("put", "/state").send({ snapshot, transition: { kind: "cut", durationMs: 0 } });
    expect((await api("get", "/frame")).body.transition).toEqual({ kind: "cut", durationMs: 0 });
  });

  it("проецирует кадр через shared, не выдаёт текст/звук/имена и удерживает файлы после правки оригинала", async () => {
    const original = createCutscene(createCutsceneDocument("Display API cutscene"));
    const files = await cutsceneFiles();
    const media = await importCutsceneMedia(original.id, "image", files.image, "Private image label");
    const step = { ...createCutsceneStep("private-step"), text: { action: "replace" as const, text: "PRIVATE NARRATION" }, notes: "PRIVATE NOTES",
      image: { action: "replace" as const, transition: { kind: "black" as const, durationMs: 1000 },
        composition: { background: media.ref as { kind: "image"; id: string }, layers: [], title: "Player caption", title_secs: 3, fade_ms: 0 } } };
    const document = { ...original.document, steps: [step] }; saveCutscene(original.id, document);
    const frame = projectCutscenePlayerFrame(resolveCutsceneStep(document, step.id)!);
    const snapshot = { ...black(), source: { kind: "cutscene", cutsceneId: original.id, frame } };
    expect((await api("put", "/state").send({ snapshot })).status).toBe(200);
    const projection = await api("get", "/frame");
    expect(projection.body.transition).toEqual({ kind: "black", durationMs: 1000 });
    expect(projection.body.content.data.title).toBe("Player caption");
    for (const privateValue of ["PRIVATE NARRATION", "PRIVATE NOTES", "Private image label", "audio", "document", "file_path"]) {
      expect(JSON.stringify(projection.body)).not.toContain(privateValue);
    }
    saveCutscene(original.id, createCutsceneDocument("Display API edited")); collectCutsceneMedia(original.id);
    expect((await api("get", "/frame")).status).toBe(200);
    await api("put", "/state").send({ snapshot: null });
    expect(db.prepare("SELECT id FROM cutscene_media WHERE id = ?").get(media.ref.id)).toBeUndefined();
  });

  it("захват не даёт стороннему пульту заменить кадр, resize разрешён, устаревший владелец отклонён", async () => {
    await api("put", "/state").send({ snapshot: black() });
    await api("put", "/ownership").send({ owner });
    expect((await api("put", "/state").send({ snapshot: null })).status).toBe(409);
    expect((await api("put", "/ownership").send({ owner: { ...owner, controllerId: "other" } })).status).toBe(409);
    const resize = await api("put", "/viewport").send({ screen_w: 800, screen_h: 600, rotation: 180, source: { kind: "map", mapId: 1 } });
    expect(resize.body.snapshot.source.kind).toBe("black"); expect(resize.body.snapshot.display.rotation).toBe(90);
    expect(resize.body.snapshot.display.screen_w).toBe(800);
    await api("put", "/ownership").send({ owner, release: true });
    expect((await api("put", "/state").send({ snapshot: null, owner })).status).toBe(409);
    expect((await api("put", "/state").send({ snapshot: null })).status).toBe(200);
  });

  it("сессионный адаптер сохраняет камеру своего кадра, пропускает репетицию и reload-алиас не заменяет текущий показ", async () => {
    const campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Display adapter')").run().lastInsertRowid);
    const sessionId = Number(db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-25')").run(campaignId).lastInsertRowid);
    db.prepare("INSERT INTO session_show_state (session_id, mode, shown, display) VALUES (?, 'cover', 1, ?)")
      .run(sessionId, JSON.stringify({ ...display, frame: "cover::" }));
    publishSessionDisplay(sessionId);
    expect(readPlayerDisplay().snapshot?.display.zoom).toBe(2);
    await api("put", "/state").send({ snapshot: black() });
    await api("post", `/session/${sessionId}`).send({ ifEmpty: true });
    expect(readPlayerDisplay().snapshot?.context?.kind).toBe("library");
    db.prepare("UPDATE sessions SET live_mode = 'rehearsal' WHERE id = ?").run(sessionId);
    publishSessionDisplay(sessionId);
    expect(readPlayerDisplay().snapshot?.context?.kind).toBe("library");
  });

  it("отказ в файле/структуре не трогает последний кадр и все маршруты закрыты игрокам", async () => {
    await api("put", "/state").send({ snapshot: black() });
    const previous = readPlayerDisplay();
    for (const snapshot of [{ ...black(), source: { kind: "scene", sceneId: 999999 } }, { ...black(), display: { rotation: 45 } },
      { ...black(), source: { kind: "cutscene", cutsceneId: 1, frame: {} } }]) {
      expect((await api("put", "/state").send({ snapshot })).status).toBe(400);
      expect(readPlayerDisplay()).toEqual(previous);
    }
    for (const [method, path] of [["get", "/frame"], ["get", "/state"], ["put", "/state"], ["put", "/viewport"],
      ["put", "/ownership"], ["post", "/session/1"]] as const) expect((await api(method, path, player).send({})).status).toBe(403);
    expect((await request(app).get("/api/presentation/frame")).status).toBe(401);
  });
});
