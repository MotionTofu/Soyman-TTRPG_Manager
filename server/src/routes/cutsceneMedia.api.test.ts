import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createCutsceneDocument, createCutsceneStep } from "@soyman/shared";
import { db } from "../db/db";
import { attachUser, signToken } from "../services/auth";
import { cutscenesRouter } from "./cutscenes";
import { cutsceneFiles, cutscenePng, cutsceneWav } from "../test/cutsceneFiles";
import { VAULT_ROOT, vaultAbs, vaultRel } from "../services/filesystem";

const app = express(); app.use(express.json()); app.use(attachUser); app.use("/api", cutscenesRouter);
const gm = signToken({ id: 900011, username: "media-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 900012, username: "media-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
const post = (url: string) => request(app).post(`/api${url}`).auth(gm, { type: "bearer" });
const get = (url: string) => request(app).get(`/api${url}`).auth(gm, { type: "bearer" });
async function original() {
  const result = await post("/cutscenes").send({ document: createCutsceneDocument("Cutscene media API") });
  expect(result.status).toBe(201); return result.body;
}

describe("API независимых файлов катсцены", () => {
  it("загружает изображения/аудио и выдаёт готовность и доступ по стабильным ref", async () => {
    const scene = await original();
    const image = await post(`/cutscenes/${scene.id}/media/image/upload`).attach("file", cutscenePng, "test.png");
    const audio = await post(`/cutscenes/${scene.id}/media/audio/upload`).attach("file", cutsceneWav(), "test.wav");
    expect(image.status).toBe(201); expect(audio.status).toBe(201);
    expect(audio.body.durationSeconds).toBe(2);
    const document = { ...scene.document, steps: [{ ...createCutsceneStep("step-with-media"),
      image: { action: "replace", transition: { kind: "cut", durationMs: 0 }, composition: {
        background: image.body.ref, layers: [], title: "", title_secs: 3, fade_ms: 0,
      } },
      audio: { action: "keep" },
    }] };
    const saved = await request(app).put(`/api/cutscenes/${scene.id}`).auth(gm, { type: "bearer" }).send({ document });
    expect(saved.status).toBe(200);
    expect((await post(`/cutscenes/${scene.id}/readiness`).send({})).body.readiness.ready).toBe(true);
    const access = await get(`/cutscenes/${scene.id}/media/${image.body.ref.id}/access`);
    expect(access.status).toBe(200); expect(access.body.ref).toEqual(image.body.ref);
    expect(access.body.url).toMatch(/^\/files\/Cutscenes\/media\//); expect(access.body.expiresAt).toBeTruthy();
    // Cancelling the unused audio upload collects it; saving the image protects it from the same action.
    expect((await request(app).delete(`/api/cutscenes/${scene.id}/media/${audio.body.ref.id}`).auth(gm, { type: "bearer" })).body.removed).toContain(audio.body.ref.id);
    await request(app).delete(`/api/cutscenes/${scene.id}/media/${image.body.ref.id}`).auth(gm, { type: "bearer" });
    expect((await get(`/cutscenes/${scene.id}/media/${image.body.ref.id}/access`)).status).toBe(200);
    const row = db.prepare("SELECT file_path FROM cutscene_media WHERE id = ?").get(image.body.ref.id) as { file_path: string };
    fs.unlinkSync(vaultAbs(row.file_path));
    const readiness = await post(`/cutscenes/${scene.id}/readiness`).send({});
    expect(readiness.body.readiness.issues.some((issue: { stepId: string }) => issue.stepId === "step-with-media")).toBe(true);
  });

  it("копирует из галереи, ресурсов и локального vault без зависимости от исходного контекста", async () => {
    const scene = await original(), files = await cutsceneFiles();
    const campaign = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Cutscene media source')").run().lastInsertRowid);
    const gallery = Number(db.prepare("INSERT INTO gallery_images (owner_type, owner_id, image_path) VALUES ('character', 99999, ?)")
      .run(vaultRel(files.image)).lastInsertRowid);
    const resource = Number(db.prepare("INSERT INTO resources (name, category, campaign_id, file_path) VALUES ('Cutscene audio', 'audio', ?, ?)")
      .run(campaign, vaultRel(files.audio)).lastInsertRowid);
    for (const [kind, source] of [
      ["image", { kind: "gallery", id: gallery }], ["audio", { kind: "resource", id: resource }],
      ["image", { kind: "vault", path: vaultRel(files.image) }],
    ]) {
      const imported = await post(`/cutscenes/${scene.id}/media/import`).send({ kind, source });
      expect(imported.status).toBe(201);
    }
    db.prepare("DELETE FROM gallery_images WHERE id = ?").run(gallery);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaign);
    fs.unlinkSync(files.image); fs.unlinkSync(files.audio);
    const list = await get(`/cutscenes/${scene.id}/media`); expect(list.body).toHaveLength(3);
    for (const item of list.body) expect((await get(`/cutscenes/${scene.id}/media/${item.ref.id}/access`)).status).toBe(200);
  });

  it("не принимает внешние произвольные пути/ссылки, поддельные файлы и чужие ref", async () => {
    const scene = await original(), other = await original();
    expect((await post(`/cutscenes/${scene.id}/media/image/upload`).attach("file", Buffer.from("not png"), "fake.png")).status).toBe(400);
    expect((await post(`/cutscenes/${scene.id}/media/audio/upload`).attach("file", Buffer.from("not mp3"), "fake.mp3")).status).toBe(400);
    expect((await post(`/cutscenes/${scene.id}/media/image/upload`).send({})).status).toBe(400);
    for (const source of [{ kind: "url", url: "https://example.com/test.png" }, { kind: "vault", path: path.join(VAULT_ROOT, "..", "outside.png") }]) {
      expect((await post(`/cutscenes/${scene.id}/media/import`).send({ kind: "image", source })).status).toBe(400);
    }
    const image = await post(`/cutscenes/${scene.id}/media/image/upload`).attach("file", cutscenePng, "test.png");
    expect((await get(`/cutscenes/${other.id}/media/${image.body.ref.id}/access`)).status).toBe(404);
    expect((await post(`/cutscenes/${scene.id}/duplicate`).send({})).status).toBe(201);
    expect(fs.readdirSync(path.join(VAULT_ROOT, ".uploads"))).toEqual([]);
  });

  it("закрыт player-token даже без общего ролевого гейта и не пишет загруженные файлы", async () => {
    const scene = await original();
    const before = (db.prepare("SELECT COUNT(*) n FROM cutscene_media").get() as { n: number }).n;
    for (const [method, url] of [
      ["get", `/cutscenes/${scene.id}/media`], ["post", `/cutscenes/${scene.id}/media/import`],
      ["post", `/cutscenes/${scene.id}/readiness`], ["post", `/cutscenes/${scene.id}/duplicate`],
      ["get", `/cutscenes/${scene.id}/media/unknown/access`], ["delete", `/cutscenes/${scene.id}/media/unknown`],
    ] as ["get" | "post" | "delete", string][]) {
      expect((await request(app)[method](`/api${url}`).auth(player, { type: "bearer" }).send({})).status).toBe(403);
    }
    expect((await request(app).post(`/api/cutscenes/${scene.id}/media/image/upload`).auth(player, { type: "bearer" }).attach("file", cutscenePng, "test.png")).status).toBe(403);
    expect((db.prepare("SELECT COUNT(*) n FROM cutscene_media").get() as { n: number }).n).toBe(before);
  });
});
