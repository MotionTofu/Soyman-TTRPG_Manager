import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createCutsceneStep } from "@soyman/shared";
import { attachUser, signToken } from "../services/auth";
import { apiRoleGate } from "../services/playerAccess";
import { cutscenesRouter } from "./cutscenes";
import { mediaCutscene } from "../test/cutsceneFiles";
import { saveCutscene } from "../services/cutscenes";
import { db } from "../db/db";

const app = express(); app.use(express.json(), attachUser); app.use("/api", apiRoleGate, cutscenesRouter);
const gm = signToken({ id: 900001, username: "cutscene-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 900002, username: "cutscene-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
const get = (id: number) => request(app).get(`/api/cutscenes/${id}/thumbnail`).set("Authorization", `Bearer ${gm}`);
describe("миниатюра каталога катсцен", () => {
  it("берёт первый визуальный кадр после текста и не отдаёт текст, заметки или звук", async () => {
    const f = await mediaCutscene(), text = { ...createCutsceneStep("intro"), text: { action: "replace" as const, text: "Secret narration" }, notes: "Secret notes" };
    saveCutscene(f.original.id, { ...f.original.document, steps: [text, ...f.original.document.steps] });
    const result = await get(f.original.id); expect(result.status).toBe(200); expect(result.body.background_url).toBeTruthy();
    expect(result.body.layers).toEqual([]); expect(JSON.stringify(result.body)).not.toMatch(/Secret|Приватная|command|audio/);
  });
  it("пропускает композицию только со скрытыми слоями", async () => {
    const f = await mediaCutscene(), first = f.original.document.steps[0];
    if (first.image.action !== "replace") throw Error("fixture");
    const hidden = { ...createCutsceneStep("hidden"), image: { ...first.image, composition: { ...first.image.composition, background: null } } };
    saveCutscene(f.original.id, { ...f.original.document, steps: [hidden, first] });
    const result = await get(f.original.id); expect(result.status).toBe(200); expect(result.body.background_url).toBeTruthy();
  });
  it("слой без фона сохраняет геометрию в существующем PresentationData", async () => {
    const f = await mediaCutscene(), first = f.original.document.steps[0];
    if (first.image.action !== "replace") throw Error("fixture");
    saveCutscene(f.original.id, { ...f.original.document, steps: [{ ...first, image: { ...first.image, composition: {
      ...first.image.composition, background: null, layers: first.image.composition.layers.map(layer => ({ ...layer, visible: true, name: "Secret layer" })),
    } } }] });
    const result = await get(f.original.id); expect(result.status).toBe(200); expect(result.body.background_url).toBeNull();
    expect(result.body.layers[0]).toMatchObject({ name: "", x_pct: 0, y_pct: 0, w_pct: 50, h_pct: 50, has_button: 0 });
    expect(result.body.layers[0].image_url).toBeTruthy();
  });
  it("без изображения возвращает null вместо выдуманной картинки", async () => {
    const f = await mediaCutscene();
    saveCutscene(f.original.id, { ...f.original.document, steps: f.original.document.steps.map(step => ({ ...step, image: { action: "clear", transition: { kind: "cut", durationMs: 0 } } })) });
    const result = await get(f.original.id); expect(result.status).toBe(200); expect(result.body).toBeNull();
  });
  it("недоступный файл первого кадра не подменяется другим кадром", async () => {
    const f = await mediaCutscene(); db.prepare("UPDATE cutscene_media SET file_path = file_path || ? WHERE id = ?").run(".missing", f.image.ref.id);
    expect((await get(f.original.id)).status).toBe(404);
  });
  it("защищён и от player-role, и от анонимного запроса", async () => {
    expect((await request(app).get("/api/cutscenes/1/thumbnail")).status).toBe(401);
    expect((await request(app).get("/api/cutscenes/1/thumbnail").set("Authorization", `Bearer ${player}`)).status).toBe(403);
    expect((await get(999999999)).status).toBe(404);
  });
});
