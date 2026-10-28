import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { selectedPreviewDocument, createCutsceneDocument } from "@soyman/shared";
import { db } from "../db/db";
import { attachUser, signToken } from "../services/auth";
import { mediaCutscene } from "../test/cutsceneFiles";
import { saveCutscene } from "../services/cutscenes";
import { accessCutsceneMedia, collectCutsceneMedia } from "../services/cutsceneMedia";
import { publishPlayerDisplay, readPlayerDisplay, readPlayerFrame } from "../services/playerDisplay";
import { readCutsceneUsage } from "../services/cutsceneUsage";
import { cutscenePreviewsRouter } from "./cutscenePreviews";
const app = express(); app.use(express.json()); app.use(attachUser); app.use("/api/cutscene-previews", cutscenePreviewsRouter);
const gm = signToken({ id: 92007, username: "preview-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 93007, username: "preview-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
const owner = { runId: "temporary-preview", controllerId: "workshop" };
const api = (route: string, body?: unknown, bearer = gm) => body === undefined
  ? request(app).get(`/api/cutscene-previews${route}`).auth(bearer, { type: "bearer" })
  : request(app).post(`/api/cutscene-previews${route}`).auth(bearer, { type: "bearer" }).send(body);
async function fixture() {
  const data = await mediaCutscene();
  const body = { owner, cutsceneId: data.original.id, document: selectedPreviewDocument(data.original.document, "first") };
  const response = await api("/start", body); expect(response.status).toBe(201);
  return { ...data, body, state: response.body };
}
beforeEach(() => {
  db.exec("DELETE FROM cutscene_preview_state; DELETE FROM player_display_state; DELETE FROM cutscene_media_holds WHERE holder_kind IN ('snapshot','frame','music')");
});
afterEach(() => vi.restoreAllMocks());
describe("временное состояние мастерской", () => {
  it("доступно только Мастеру", async () => {
    expect((await api("/active", undefined, player)).status).toBe(403);
    expect((await request(app).get("/api/cutscene-previews/active")).status).toBe(401);
  });
  it("не создаёт историю запуска; другой владелец и устаревшая ревизия отклоняются", async () => {
    const { body } = await fixture();
    expect((db.prepare("SELECT COUNT(*) n FROM cutscene_runs").get() as { n: number }).n).toBe(0);
    expect((await api("/start", { ...body, owner: { ...owner, controllerId: "other" } })).status).toBe(409);
    expect((await api("/update", { owner: { ...owner, controllerId: "other" }, revision: 1 })).status).toBe(409);
    expect((await api("/update", { owner, revision: 9 })).status).toBe(409);
  });
  it("удерживает медиа черновика после изменения оригинала и до подтверждения возврата", async () => {
    const { original, image } = await fixture();
    saveCutscene(original.id, createCutsceneDocument("Очищен")); collectCutsceneMedia();
    expect(() => accessCutsceneMedia(original.id, image.ref.id)).not.toThrow();
    expect(readCutsceneUsage(original.id).places.some(place => place.key === "preview")).toBe(true);
    expect((await api("/acknowledge", { owner })).status).toBe(409);
    expect((await api("/stop", { owner })).status).toBe(200);
    collectCutsceneMedia(); expect(() => accessCutsceneMedia(original.id, image.ref.id)).not.toThrow();
    expect((await api("/acknowledge", { owner })).status).toBe(200);
    collectCutsceneMedia(); expect(() => accessCutsceneMedia(original.id, image.ref.id)).toThrow();
  });
  it("статический вывод не захватывает звук; возвращает прежний кадр и не передаёт секреты игрокам", async () => {
    const prior = publishPlayerDisplay({ source: { kind: "black" }, context: { kind: "library" }, display: {}, visibleLayerIds: [], playKey: "prior" }).snapshot;
    await fixture();
    const response = await api("/update", { owner, revision: 1, window: { wasOpen: true, openedByRun: false, screenId: null, windowId: "window" }, publish: true, playKey: "frame" });
    expect(response.status).toBe(200); expect(response.body.audio).toBeNull();
    const frame = JSON.stringify(readPlayerFrame());
    expect(frame).not.toContain("Приватная заметка"); expect(frame).not.toContain("controllerId"); expect(frame).not.toContain('"audio"');
    expect((await api("/stop", { owner })).status).toBe(200);
    expect(readPlayerDisplay().snapshot).toEqual(prior); expect(readPlayerDisplay().owner).toBeNull();
  });
  it("после пропажи владельца не возобновляет превью, а оставляет возврат для одного нового контроллера", async () => {
    await fixture(); const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    expect((await api("/heartbeat", { owner })).body.phase).toBe("returning");
    const claimed = await api("/claim-return", { owner, controllerId: "reloaded" }); expect(claimed.status).toBe(200);
    expect((await api("/claim-return", { owner, controllerId: "second" })).status).toBe(409);
    expect((await api("/acknowledge", { owner })).status).toBe(409);
    expect((await api("/acknowledge", { owner: claimed.body.owner })).status).toBe(200);
  });
  it("проверяет границы файла на сервере", async () => {
    const { state } = await fixture(), document = structuredClone(state.document);
    document.steps[0].audio.command.endSeconds = 9999;
    expect((await api("/update", { owner, revision: 1, document })).status).toBe(400);
  });
});
