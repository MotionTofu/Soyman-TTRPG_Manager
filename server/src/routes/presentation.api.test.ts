// Сквозной тест API представления: настоящий роутер + временная база.
// DB_DIR и VAULT_ROOT выставляются ДО импорта db (побочный эффект —
// открытие базы), поэтому импорты — динамические внутри beforeAll.
// Живая база и живой vault не затрагиваются никак.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

let app: express.Express;
let sceneId = 0;
let campaignId = 0;
let sessionId = 0;

// Красный PNG 1×1 — валидная картинка для загрузок.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-api-test-"));
  process.env.DB_DIR = tmpDir;
  process.env.VAULT_ROOT = path.join(tmpDir, "vault");
  const { storyRouter } = await import("./story");
  const { campaignsRouter } = await import("./campaigns");
  const { sessionsRouter } = await import("./sessions");
  const { db } = await import("../db/db");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    (req as Record<string, unknown>)["user"] = { role: "gm", playerId: null };
    next();
  });
  app.use("/api/story", storyRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/sessions", sessionsRouter);

  const settingId = Number(
    (db.prepare("INSERT INTO settings (name, folder_path) VALUES ('S', 'Settings/S')").run() as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
  const arcId = Number(
    (db.prepare("INSERT INTO story_arcs (setting_id, name) VALUES (?, 'A')").run(settingId) as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
  sceneId = Number(
    (
      db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, 'Сцена')").run(settingId, arcId) as {
        lastInsertRowid: unknown;
      }
    ).lastInsertRowid
  );
  campaignId = Number(
    (db.prepare("INSERT INTO campaigns (name, folder_path) VALUES ('C', 'Campaigns/C')").run() as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
  sessionId = Number(
    (db.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-09-08')").run(campaignId) as { lastInsertRowid: unknown })
      .lastInsertRowid
  );
}, 120000);

describe("presentation API", () => {
  it("пустая сцена отдаёт дефолты", async () => {
    const res = await request(app).get(`/api/story/scenes/${sceneId}/presentation`);
    expect(res.status).toBe(200);
    expect(res.body.transition).toBe("cut");
    expect(res.body.layers).toEqual([]);
    expect(res.body.background_url).toBeNull();
  });

  it("PUT полей + валидация", async () => {
    const ok = await request(app)
      .put(`/api/story/scenes/${sceneId}/presentation`)
      .send({ transition: "fade", transition_ms: 800, title: "Титр", title_secs: 5, fade_ms: 400 });
    expect(ok.status).toBe(200);
    expect(ok.body.transition).toBe("fade");
    expect(ok.body.title).toBe("Титр");
    expect((await request(app).put(`/api/story/scenes/${sceneId}/presentation`).send({ transition: "slide" })).status).toBe(400);
    expect((await request(app).put(`/api/story/scenes/${sceneId}/presentation`).send({ title_secs: 999 })).status).toBe(400);
  });

  let layerA = 0;
  let layerB = 0;

  it("слои: создание, файл на диске, валидация", async () => {
    const created = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "hero.png")
      .field("name", "Герой");
    expect(created.status).toBe(201);
    expect(created.body.image_url).toMatch(/^\/files\//);
    layerA = created.body.id;
    const noName = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "x.png")
      .field("name", "  ");
    expect(noName.status).toBe(400);
    const badFile = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", Buffer.from("not an image"), "x.txt")
      .field("name", "Мусор");
    expect(badFile.status).toBe(400);
  });

  it("PUT слоя: флаги, геометрия, границы", async () => {
    const ok = await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/${layerA}`).send({
      has_button: 0,
      visible_on_enter: 1,
      x_pct: 10,
      w_pct: 50,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.has_button).toBe(0);
    expect(ok.body.x_pct).toBe(10);
    expect(
      (await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/${layerA}`).send({ x_pct: 150 })).status
    ).toBe(400);
    expect(
      (await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/${layerA}`).send({ w_pct: 0 })).status
    ).toBe(400);
  });

  it("reorder: чужой id и дубли — 400", async () => {
    const created = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "rain.png")
      .field("name", "Дождь");
    expect(created.status).toBe(201);
    layerB = created.body.id;
    const swapped = await request(app)
      .put(`/api/story/scenes/${sceneId}/presentation/layers/reorder`)
      .send({ order: [layerB, layerA] });
    expect(swapped.status).toBe(200);
    expect(swapped.body.map((l: { id: number }) => l.id)).toEqual([layerB, layerA]);
    expect(
      (await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/reorder`).send({ order: [layerA, 999999] })).status
    ).toBe(400);
    expect(
      (await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/reorder`).send({ order: [layerA, layerA] })).status
    ).toBe(400);
  });

  it("DELETE слоя: строка ушла, файл остался", async () => {
    const before = await request(app).get(`/api/story/scenes/${sceneId}/presentation`);
    const row = (before.body.layers as { id: number; image_path: string }[]).find((l) => l.id === layerB);
    expect(row).toBeDefined();
    const vault = process.env.VAULT_ROOT as string;
    const abs = path.join(vault, ...(row as { image_path: string }).image_path.split(/[\\/]/));
    expect(fs.existsSync(abs)).toBe(true);
    expect((await request(app).delete(`/api/story/scenes/${sceneId}/presentation/layers/${layerB}`)).status).toBe(200);
    const after = await request(app).get(`/api/story/scenes/${sceneId}/presentation`);
    expect((after.body.layers as { id: number }[]).some((l) => l.id === layerB)).toBe(false);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it("фон: загрузка и замена", async () => {
    const first = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/background`)
      .attach("file", PNG, "bg.png");
    expect(first.status).toBe(200);
    expect(first.body.background_url).toMatch(/^\/files\//);
    const second = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/background`)
      .attach("file", PNG, "bg2.png");
    expect(second.status).toBe(200);
    expect(second.body.background_url).toMatch(/^\/files\//);
  });

  it("правка из кампании клонирует, оригинал цел", async () => {
    const edit = await request(app)
      .put(`/api/story/scenes/${sceneId}/presentation`)
      .send({ campaign_id: campaignId, transition: "black", title: "Кампанейский" });
    expect(edit.status).toBe(200);
    expect(edit.body.transition).toBe("black");
    const original = await request(app).get(`/api/story/scenes/${sceneId}/presentation`);
    expect(original.body.transition).toBe("fade");
    const over = await request(app).get(`/api/story/scenes/${sceneId}/presentation?campaign_id=${campaignId}`);
    expect(over.body.transition).toBe("black");
    expect(over.body.title).toBe("Кампанейский");
    // Слои кампании едут в копию: у оригинала остался слой A.
    const layered = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "camp.png")
      .field("campaign_id", String(campaignId))
      .field("name", "Кампанейский слой");
    expect(layered.status).toBe(201);
    const origLayers = (await request(app).get(`/api/story/scenes/${sceneId}/presentation`)).body.layers as { name: string }[];
    expect(origLayers.some((l) => l.name === "Кампанейский слой")).toBe(false);
    const overLayers = (
      await request(app).get(`/api/story/scenes/${sceneId}/presentation?campaign_id=${campaignId}`)
    ).body.layers as { name: string }[];
    expect(overLayers.some((l) => l.name === "Кампанейский слой")).toBe(true);
    // Слой оригинала по старому id из копии не правится — клиент перечитывает.
    expect(
      (await request(app).put(`/api/story/scenes/${sceneId}/presentation/layers/${layerA}`).send({ campaign_id: campaignId, name: "Взлом" }))
        .status
    ).toBe(404);
  });

  it("заглавное кампании: CRUD", async () => {
    const empty = await request(app).get(`/api/campaigns/${campaignId}/cover`);
    expect(empty.status).toBe(200);
    expect(empty.body.layers).toEqual([]);
    const put = await request(app).put(`/api/campaigns/${campaignId}/cover`).send({ title: "Кампания", transition: "fade" });
    expect(put.status).toBe(200);
    expect(put.body.title).toBe("Кампания");
    expect((await request(app).put(`/api/campaigns/${campaignId}/cover`).send({ transition: "slide" })).status).toBe(400);
    const layer = await request(app)
      .post(`/api/campaigns/${campaignId}/cover/layers`)
      .attach("file", PNG, "logo.png")
      .field("name", "Логотип");
    expect(layer.status).toBe(201);
    const bg = await request(app).post(`/api/campaigns/${campaignId}/cover/background`).attach("file", PNG, "cbg.png");
    expect(bg.status).toBe(200);
    expect(bg.body.background_url).toMatch(/^\/files\//);
    expect((await request(app).delete(`/api/campaigns/${campaignId}/cover/layers/${layer.body.id}`)).status).toBe(200);
  });

  it("show-state: дефолт, запись, фильтр чужих id, валидация", async () => {
    const def = await request(app).get(`/api/sessions/${sessionId}/show-state`);
    expect(def.status).toBe(200);
    expect(def.body.mode).toBe("black");
    expect(def.body.shown).toBe(0);
    expect((await request(app).put(`/api/sessions/${sessionId}/show-state`).send({ mode: "nope" })).status).toBe(400);
    expect((await request(app).put(`/api/sessions/${sessionId}/show-state`).send({ mode: "scene" })).status).toBe(400);
    expect(
      (await request(app).put(`/api/sessions/${sessionId}/show-state`).send({ mode: "scene", scene_id: 999999 })).status
    ).toBe(400);
    const put = await request(app)
      .put(`/api/sessions/${sessionId}/show-state`)
      .send({ mode: "scene", scene_id: sceneId, visible_layer_ids: [layerA, 999999], shown: 1 });
    expect(put.status).toBe(200);
    expect(put.body.visible_layer_ids).toEqual([layerA]);
    expect(put.body.shown).toBe(1);
    const back = await request(app).get(`/api/sessions/${sessionId}/show-state`);
    expect(back.body.mode).toBe("scene");
    expect(back.body.visible_layer_ids).toEqual([layerA]);
  });

  it("новый слой — по размеру картинки (contain-fit), явная геометрия главнее", async () => {
    // Тестовый PNG 1×1: квадрат в кадре 16:9 → w=56.25, h=100, по центру.
    const fitted = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "sq.png")
      .field("name", "Квадрат");
    expect(fitted.status).toBe(201);
    expect(fitted.body.w_pct).toBeCloseTo(56.25, 2);
    expect(fitted.body.h_pct).toBeCloseTo(100, 2);
    expect(fitted.body.x_pct).toBeCloseTo(21.875, 2);
    expect(fitted.body.y_pct).toBeCloseTo(0, 2);
    const explicit = await request(app)
      .post(`/api/story/scenes/${sceneId}/presentation/layers`)
      .attach("file", PNG, "sq2.png")
      .field("name", "Явный")
      .field("x_pct", "5")
      .field("y_pct", "6")
      .field("w_pct", "7")
      .field("h_pct", "8");
    expect(explicit.status).toBe(201);
    expect(explicit.body.x_pct).toBe(5);
    expect(explicit.body.w_pct).toBe(7);
    await request(app).delete(`/api/story/scenes/${sceneId}/presentation/layers/${fitted.body.id}`);
    await request(app).delete(`/api/story/scenes/${sceneId}/presentation/layers/${explicit.body.id}`);
  });
});

describe("launch show-state", () => {
  let fullA = 0;
  let emptyB = 0;
  let fullC = 0;
  let sess = 0;
  let btnLayer = 0;
  let autoLayer = 0;

  it("готовит сцены и сессию", async () => {
    const { db } = await import("../db/db");
    const arc = (db.prepare("SELECT arc_id FROM story_scenes WHERE id = ?").get(sceneId) as { arc_id: number }).arc_id;
    const setting = (db.prepare("SELECT setting_id FROM story_scenes WHERE id = ?").get(sceneId) as { setting_id: number })
      .setting_id;
    for (const [name, holder] of [["Полная A", "a"], ["Пустая B", "b"], ["Полная C", "c"]] as const) {
      const id = Number(
        (
          db.prepare("INSERT INTO story_scenes (setting_id, arc_id, name) VALUES (?, ?, ?)").run(setting, arc, name) as {
            lastInsertRowid: unknown;
          }
        ).lastInsertRowid
      );
      if (holder === "a") fullA = id;
      if (holder === "b") emptyB = id;
      if (holder === "c") fullC = id;
    }
    const mk = await request(app).post("/api/sessions").send({ campaign_id: campaignId, date: "2026-09-09" });
    expect(mk.status).toBe(201);
    sess = mk.body.id;
    const btn = await request(app)
      .post(`/api/story/scenes/${fullA}/presentation/layers`)
      .attach("file", PNG, "btn.png")
      .field("name", "Кнопочный");
    expect(btn.status).toBe(201);
    btnLayer = btn.body.id;
    const auto = await request(app)
      .post(`/api/story/scenes/${fullA}/presentation/layers`)
      .attach("file", PNG, "auto.png")
      .field("name", "Фоновый")
      .field("has_button", "0");
    expect(auto.status).toBe(201);
    autoLayer = auto.body.id;
    const c = await request(app)
      .post(`/api/story/scenes/${fullC}/presentation/layers`)
      .attach("file", PNG, "c.png")
      .field("name", "Слой C");
    expect(c.status).toBe(201);
  });

  it("запуск сцены с представлением ставит экран в дефолты, shown=0", async () => {
    const launched = await request(app).post(`/api/sessions/${sess}/launch`).send({ scene_id: fullA });
    expect(launched.status).toBe(200);
    const st = await request(app).get(`/api/sessions/${sess}/show-state`);
    expect(st.body.mode).toBe("scene");
    expect(st.body.scene_id).toBe(fullA);
    // Кнопочный скрыт (visible_on_enter=0), фоновый виден (has_button=0).
    expect(st.body.visible_layer_ids).toEqual([autoLayer]);
    expect(st.body.shown).toBe(0);
    expect(st.body.visible_layer_ids).not.toContain(btnLayer);
  });

  it("запуск пустой сцены экран не трогает (висит последний кадр)", async () => {
    await request(app).put(`/api/sessions/${sess}/show-state`).send({ shown: 1 });
    const launched = await request(app).post(`/api/sessions/${sess}/launch`).send({ scene_id: emptyB });
    expect(launched.status).toBe(200);
    const st = await request(app).get(`/api/sessions/${sess}/show-state`);
    expect(st.body.mode).toBe("scene");
    expect(st.body.scene_id).toBe(fullA);
    expect(st.body.shown).toBe(1);
  });

  it("следующая сцена с представлением меняет кадр, shown сохраняется", async () => {
    const launched = await request(app).post(`/api/sessions/${sess}/launch`).send({ scene_id: fullC });
    expect(launched.status).toBe(200);
    const st = await request(app).get(`/api/sessions/${sess}/show-state`);
    expect(st.body.scene_id).toBe(fullC);
    expect(st.body.shown).toBe(1);
  });
});
