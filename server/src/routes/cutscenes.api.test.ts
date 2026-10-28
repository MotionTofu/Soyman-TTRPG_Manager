import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  createCutsceneAudioCommand, createCutsceneDocument, createCutsceneStep, type CutsceneDocument,
} from "@soyman/shared";
import { db } from "../db/db";
import { attachUser, signToken } from "../services/auth";
import { apiRoleGate } from "../services/playerAccess";
import { kindOf } from "../db/entityKinds";
import { archiveRouter } from "./archive";
import { cutscenesRouter } from "./cutscenes";
import { documentMediaRefs } from "../services/cutsceneMedia";

function application(withGate = true) {
  const app = express();
  app.use(express.json());
  app.use(attachUser);
  if (withGate) app.use("/api", apiRoleGate);
  app.use("/api", cutscenesRouter);
  app.use("/api/archive", archiveRouter);
  return app;
}
const app = application();
const gm = signToken({ id: 900001, username: "cutscene-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
const player = signToken({ id: 900002, username: "cutscene-player", role: "player", playerId: 42, isAdmin: false, tokenVersion: 0 });
let campaigns: number[];
let session: number;

beforeEach(() => {
  db.exec("DELETE FROM cutscene_media_holds; DELETE FROM cutscene_media; DELETE FROM session_cutscenes; DELETE FROM campaign_cutscenes; DELETE FROM cutscenes");
  campaigns = ["Cutscene API A", "Cutscene API B"].map(name =>
    Number(db.prepare("INSERT INTO campaigns (name) VALUES (?)").run(name).lastInsertRowid));
  session = Number(db.prepare("INSERT INTO sessions (campaign_id, date, title) VALUES (?, '2026-10-25', 'Cutscene API session')")
    .run(campaigns[0]).lastInsertRowid);
});

function fullDocument(): CutsceneDocument {
  return {
    ...createCutsceneDocument("Прибытие"), description: "За стенами города",
    steps: [{
      ...createCutsceneStep("first"), notes: "Приватная заметка",
      image: { action: "replace", transition: { kind: "black", durationMs: 1300 }, composition: {
        background: { kind: "image", id: "independent-background" }, title: "Город", title_secs: 4, fade_ms: 300,
        layers: [{ id: "layer", name: "Слой", position: 0, x_pct: 10, y_pct: 20, w_pct: 30, h_pct: 40,
          visible: false, image: { kind: "image", id: "independent-layer" } }],
      } },
      audio: { action: "replace", command: {
        ...createCutsceneAudioCommand("music", { kind: "audio", id: "independent-track" }),
        startSeconds: 3, endSeconds: 12, volume: 0.4,
        transition: { mode: "sequential", fadeOutMs: 321, fadeInMs: 654 },
        loop: { enabled: true, transition: { mode: "sequential", fadeOutMs: 456, fadeInMs: 789 } },
      } },
      text: { action: "replace", text: "## Текст ведущего\n\n**Прочитать**" },
    }, createCutsceneStep("second")],
  };
}
async function create(document = createCutsceneDocument("Черновик")) {
  const result = await request(app).post("/api/cutscenes").auth(gm, { type: "bearer" }).send({ document: { ...document, steps: [] } });
  expect(result.status).toBe(201);
  if (document.steps.length) {
    stageDocumentMedia(result.body.id, document);
    const saved = await put(`/api/cutscenes/${result.body.id}`, { document });
    expect(saved.status).toBe(200);
    return saved.body;
  }
  return result.body;
}
// Storage/roundtrip tests do not probe file bytes; real imports/readiness are covered in cutsceneMedia tests.
function stageDocumentMedia(id: number, document: CutsceneDocument) {
  for (const ref of documentMediaRefs(document)) {
    db.prepare(`INSERT INTO cutscene_media (id, cutscene_id, kind, file_path, name, mime, state, created_at)
      VALUES (?, ?, ?, ?, 'fixture', 'test/fixture', 'ready', 'date')`)
      .run(ref.id, id, ref.kind, `Cutscenes/media/${ref.id}`);
    db.prepare("INSERT INTO cutscene_media_holds VALUES ('staging', ?, ?)").run(String(id), ref.id);
  }
}
const get = (url: string) => request(app).get(url).auth(gm, { type: "bearer" });
const put = (url: string, body: object) => request(app).put(url).auth(gm, { type: "bearer" }).send(body);

describe("общий оригинал катсцены", () => {
  it("сохраняет пустой черновик и весь документ без потери настроек", async () => {
    const draft = await create();
    expect(draft.document.steps).toEqual([]);
    const document = fullDocument();
    stageDocumentMedia(draft.id, document);
    const saved = await put(`/api/cutscenes/${draft.id}`, { document });
    expect(saved.status).toBe(200);
    expect(saved.body.savedVersion).not.toBe(draft.savedVersion);
    expect(saved.body.createdAt).toBe(draft.createdAt);
    expect((await get(`/api/cutscenes/${draft.id}`)).body).toEqual(saved.body);
    expect(saved.body.document).toEqual(document);
  });

  it("не пишет ничего при невалидном документе", async () => {
    const draft = await create();
    for (const document of [
      { ...fullDocument(), name: " " }, { ...fullDocument(), version: 2 },
      { ...fullDocument(), unexpected: "поле" },
      { ...fullDocument(), steps: [createCutsceneStep("same"), createCutsceneStep("same")] },
    ]) {
      expect((await put(`/api/cutscenes/${draft.id}`, { document })).status).toBe(400);
      expect((await get(`/api/cutscenes/${draft.id}`)).body).toEqual(draft);
    }
    expect((await request(app).post("/api/cutscenes").auth(gm, { type: "bearer" }).send({})).status).toBe(400);
  });

  it("ищет по русскому названию/описанию, фильтрует архив и сортирует", async () => {
    const a = await create({ ...createCutsceneDocument("Альфа"), description: "ДОРОГА" });
    const b = await create(createCutsceneDocument("Ярмарка"));
    db.prepare("UPDATE cutscenes SET archived_at = '2026-10-25', updated_at = '2099-01-01' WHERE id = ?").run(b.id);
    expect((await get("/api/cutscenes?search=дорога")).body.map((r: { id: number }) => r.id)).toEqual([a.id]);
    expect((await get("/api/cutscenes?archive=all&sort=name&order=desc")).body.map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    expect((await get("/api/cutscenes?archive=archived")).body.map((r: { id: number }) => r.id)).toEqual([b.id]);
    expect((await get("/api/cutscenes?archive=all")).body[0].id).toBe(b.id);
    expect((await get("/api/cutscenes")).body[0]).not.toHaveProperty("document");
    for (const query of ["sort=bogus", "order=bogus", "archive=bogus", "campaignId=0", "archive[]=all"]) {
      expect((await get(`/api/cutscenes?${query}`)).status).toBe(400);
    }
  });

  it("подключает защищённое окончательное удаление через общий архив", async () => {
    const item = await create();
    db.prepare("UPDATE cutscenes SET archived_at = '2026-10-25' WHERE id = ?").run(item.id);
    expect(kindOf("cutscene")?.archivable).toBe(true);
    expect((await request(app).delete(`/api/archive/cutscene/${item.id}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((await get(`/api/cutscenes/${item.id}`)).status).toBe(404);
  });
});

describe("независимые подборки и план сессии", () => {
  it("два контекста видят правки одного оригинала; план не меняет подборки", async () => {
    const first = await create();
    const second = await create(createCutsceneDocument("Второй"));
    for (const id of campaigns) expect((await put(`/api/campaigns/${id}/cutscenes`, { cutsceneIds: [first.id] })).status).toBe(200);
    expect((await put(`/api/sessions/${session}/cutscenes`, { cutsceneIds: [second.id, first.id] })).status).toBe(200);
    const document = { ...first.document, name: "Общее новое имя" };
    await put(`/api/cutscenes/${first.id}`, { document });
    for (const id of campaigns) {
      const list = (await get(`/api/campaigns/${id}/cutscenes`)).body;
      expect(list.map((r: { name: string }) => r.name)).toEqual([document.name]);
      expect((await get(`/api/cutscenes?campaignId=${id}`)).body).toEqual(list);
    }
    const plan = `/api/sessions/${session}/cutscenes`;
    expect((await get(plan)).body.map((r: { id: number }) => r.id)).toEqual([second.id, first.id]);
    await request(app).delete(`/api/campaigns/${campaigns[0]}/cutscenes/${first.id}`).auth(gm, { type: "bearer" });
    expect((await get(plan)).body.map((r: { id: number }) => r.id)).toEqual([second.id, first.id]);
    expect((await get(`/api/campaigns/${campaigns[0]}/cutscenes`)).body).toEqual([]);
    expect((await get(`/api/campaigns/${campaigns[1]}/cutscenes`)).body).toHaveLength(1);
  });

  it("сохраняет порядок, отклоняет дубликат/отсутствующую ссылку без частичной записи", async () => {
    const a = await create(), b = await create();
    const url = `/api/sessions/${session}/cutscenes`;
    await put(url, { cutsceneIds: [a.id, b.id] });
    for (const [cutsceneIds, status] of [[[b.id, b.id], 400], [[b.id, 99999999], 404], [[-1], 400]] as const) {
      expect((await put(url, { cutsceneIds })).status).toBe(status);
      expect((await get(url)).body.map((r: { id: number }) => r.id)).toEqual([a.id, b.id]);
    }
    await put(url, { cutsceneIds: [b.id, a.id] });
    expect((await get(url)).body.map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    expect((await request(app).delete(`${url}/${b.id}`).auth(gm, { type: "bearer" })).status).toBe(204);
    expect((await get(url)).body.map((r: { id: number }) => r.id)).toEqual([a.id]);
    expect(db.prepare("SELECT position FROM session_cutscenes WHERE session_id = ?").all(session)).toEqual([{ position: 0 }]);
  });

  it("архивный оригинал доступен в привязках; удаление контекста не удаляет его", async () => {
    const item = await create();
    await put(`/api/campaigns/${campaigns[0]}/cutscenes`, { cutsceneIds: [item.id] });
    await put(`/api/sessions/${session}/cutscenes`, { cutsceneIds: [item.id] });
    db.prepare("UPDATE cutscenes SET archived_at = '2026-10-25' WHERE id = ?").run(item.id);
    expect((await get(`/api/campaigns/${campaigns[0]}/cutscenes`)).body).toHaveLength(1);
    expect((await get(`/api/sessions/${session}/cutscenes`)).body).toHaveLength(1);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaigns[0]);
    expect((await get(`/api/cutscenes/${item.id}`)).status).toBe(200);
    expect(db.prepare("SELECT * FROM campaign_cutscenes").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM session_cutscenes").all()).toEqual([]);
  });
});

describe("приватность катсцен", () => {
  it.each([true, false])("player-token закрыт на каждом маршруте, общий гейт: %s", async withGate => {
    const target = application(withGate);
    const item = await create(fullDocument());
    for (const [method, url, body] of [
      ["get", "/api/cutscenes", {}], ["get", `/api/cutscenes/${item.id}`, {}],
      ["post", "/api/cutscenes", { document: fullDocument() }],
      ["put", `/api/cutscenes/${item.id}`, { document: fullDocument() }],
      ...["campaigns", "sessions"].flatMap(context => {
        const id = context === "campaigns" ? campaigns[0] : session;
        const url = `/api/${context}/${id}/cutscenes`;
        return [["get", url, {}], ["put", url, { cutsceneIds: [item.id] }], ["delete", `${url}/${item.id}`, {}]];
      }),
    ] as ["get" | "post" | "put" | "delete", string, object][]) {
      const result = await request(target)[method](url).auth(player, { type: "bearer" }).send(body);
      expect(result.status).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain("Приватная заметка");
      expect((await request(target)[method](url).send(body)).status).toBe(401);
    }
    expect((await get(`/api/cutscenes/${item.id}`)).body.document).toEqual(fullDocument());
  });
});
