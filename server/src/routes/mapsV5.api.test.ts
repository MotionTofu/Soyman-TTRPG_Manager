// V5 persistence boundary tests (Фаза 2F): save → DB → GM load →
// player load через настоящий роутер на временной базе. Тот же приём,
// что maps.api.test.ts (динамические импорты после DB_DIR).
// Shared kernel импортируется из собранного dist — та же реализация,
// что использует route (не дубликат).

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  serializeMapDocument,
  validateMapDocument,
  parseMapDocument,
  type MapDocumentV5,
} from "@soyman/shared";

let app: express.Express;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-v5-api-test-"));
  process.env.DB_DIR = tmpDir;
  process.env.VAULT_ROOT = tmpDir;
  const { mapsRouter } = await import("./maps");
  const { apiRoleGate } = await import("../services/playerAccess");

  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const role = (req.headers as Record<string, string>)["x-test-role"] === "player" ? "player" : "gm";
    (req as Record<string, unknown>)["user"] = role === "gm" ? { role, playerId: null } : { role, playerId: 42 };
    next();
  });
  app.use("/api", apiRoleGate as unknown as express.RequestHandler);
  app.use("/api/maps", mapsRouter);
}, 120000);

const gm = { "x-test-role": "gm" };
const player = { "x-test-role": "player" };

function gmFixture(): MapDocumentV5 {
  return {
    v: 5,
    world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [],
    layers: [
      {
        id: "lyr-terrain",
        name: "Terrain",
        kind: "terrain",
        visible: true,
        locked: false,
        opacity: 1,
        representation: "cells",
        defaultMaterial: { type: "builtin", key: "terrain/plain" },
        cells: [{ x: 1, y: 1, material: { type: "builtin", key: "terrain/forest" } }],
      },
      {
        id: "lyr-road",
        name: "Roads",
        kind: "path",
        visible: true,
        locked: false,
        opacity: 1,
        paths: [
          {
            id: "road-1",
            kind: "road",
            geometry: { type: "cell-network", cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }] },
            width: 1,
            styleRef: { type: "builtin", key: "road" },
          },
        ],
      },
      {
        id: "lyr-gameplay",
        name: "Gameplay",
        kind: "gameplay",
        visible: true,
        locked: false,
        opacity: 1,
        items: [
          {
            id: "room-1",
            kind: "room",
            geometry: { type: "rect", x: 4, y: 4, w: 2, h: 2 },
            roomType: "treasury",
            name: "Кладовая",
          },
          {
            id: "door-a",
            kind: "door",
            position: { x: 4.5, y: 4 },
            orientation: 0,
            doorKind: "door",
            secret: false,
            pairedDoorId: "door-b",
          },
          {
            id: "door-b",
            kind: "door",
            position: { x: 5.5, y: 6 },
            orientation: 180,
            doorKind: "secret",
            secret: true,
            pairedDoorId: "door-a",
          },
          {
            id: "door-c",
            kind: "door",
            position: { x: 1.5, y: 5 },
            orientation: 90,
            doorKind: "trapped",
            secret: false,
            pairedDoorId: null,
          },
          { id: "trap-1", kind: "trap", position: { x: 2, y: 2 }, trapKind: "pit" },
          { id: "start-1", kind: "start", position: { x: 0.5, y: 7.5 } },
        ],
      },
      {
        id: "lyr-labels",
        name: "Labels",
        kind: "label",
        visible: true,
        locked: false,
        opacity: 1,
        items: [{ id: "label-1", position: { x: 1.5, y: 1.5 }, text: "Лес" }],
      },
    ],
  };
}

describe("maps V5 API", () => {
  let v5id = 0;
  let canonical = "";

  it("stores a dense terrain mask and sends it to the player view", async () => {
    const doc = gmFixture();
    const values = Array(256).fill(0) as number[];
    values[17] = 1;
    doc.layers.push({
      id: "dense-terrain", name: "Detailed terrain", kind: "terrain", representation: "mask",
      visible: true, locked: false, opacity: 1,
      defaultMaterial: { type: "builtin", key: "terrain/plain" },
      mask: { origin: { x: 0, y: 0 }, sampleSize: 0.25,
        materials: [{ type: "builtin", key: "terrain/forest" }],
        chunks: [{ id: "dense-chunk", cx: 0, cy: 0, payload: { encoding: "palette-index-v1", values } }] },
    });
    const created = await request(app).post("/api/maps").set(gm).send({ name: "Маска рельефа", scale: "locality", document: doc });
    expect(created.status).toBe(201);
    const mapId = created.body.id as number;
    const gmLoaded = await request(app).get(`/api/maps/${mapId}`).set(gm);
    expect(gmLoaded.body.cells).toBe(serializeMapDocument(doc));
    await request(app).put(`/api/maps/${mapId}`).set(gm).send({ player_visible: 1 });
    const playerLoaded = await request(app).get(`/api/maps/${mapId}/player-view`).set(player);
    expect(playerLoaded.status).toBe(200);
    const parsed = parseMapDocument(playerLoaded.body.cells);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mask = parsed.value.layers.find((layer) => layer.id === "dense-terrain");
    expect(mask && mask.kind === "terrain" && mask.representation === "mask" ? mask.mask.chunks[0].payload : null)
      .toEqual({ encoding: "palette-index-v1", values });
  });

  it("выдаёт карте только её изображения, а каталог оставляет мастеру", async () => {
    const { db } = await import("../db/db");
    const { VAULT_ROOT } = await import("../services/filesystem");
    const uid = "d611dafe-48fe-445a-944d-cac4d8d9ec5b";
    const otherUid = "d611dafe-48fe-445a-944d-cac4d8d9ec5c";
    fs.writeFileSync(path.join(VAULT_ROOT, "map-tree.png"), "image bytes");
    fs.writeFileSync(path.join(VAULT_ROOT, "other.png"), "image bytes");
    const insert = db.prepare(`INSERT INTO resources (uid, name, type, scope, file_path, category, tags)
      VALUES (?, ?, 'link', 'global', ?, 'image', '')`);
    insert.run(uid, "Дерево", "map-tree.png");
    insert.run(otherUid, "Чужой ресурс", "other.png");
    const doc = gmFixture();
    doc.assetPacks.push({ id: "soyman-resource-images", version: "1" });
    doc.layers.push({
      id: "map-objects", kind: "object", name: "Objects", visible: true, locked: false, opacity: 1,
      items: [{ id: "image-one", transform: { position: { x: 2, y: 2 }, rotation: 0, scale: { x: 1, y: 1 } },
        visual: { type: "asset", assetId: `soyman-resource-images:${uid}` } }],
    });
    const made = await request(app).post("/api/maps").set(gm).send({ name: "Объектная карта", scale: "locality", document: doc });
    expect(made.status).toBe(201);
    const mapId = made.body.id as number;
    const catalog = await request(app).get("/api/maps/asset-catalog").set(gm);
    expect(catalog.status).toBe(200);
    expect(catalog.body.some((asset: { uid: string }) => asset.uid === uid)).toBe(true);
    expect((await request(app).get("/api/maps/asset-catalog").set(player)).status).toBe(403);
    db.prepare("UPDATE maps SET player_visible = 1 WHERE id = ?").run(mapId);
    const visible = await request(app).get(`/api/maps/${mapId}/assets`).set(player);
    expect(visible.status).toBe(200);
    expect(visible.body.map((asset: { uid: string }) => asset.uid)).toEqual([uid]);
    expect(visible.body[0].file_url).toContain("/files/map-tree.png");
    const fogged = { ...doc, exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }] } };
    expect((await request(app).put(`/api/maps/${mapId}`).set(gm).send({ document: fogged })).status).toBe(200);
    const hiddenAssets = await request(app).get(`/api/maps/${mapId}/assets`).set(player);
    expect(hiddenAssets.status).toBe(200);
    expect(hiddenAssets.body).toEqual([]);
    const screenAssets = await request(app).get(`/api/maps/${mapId}/assets?player_view=1`).set(gm);
    expect(screenAssets.status).toBe(200);
    expect(screenAssets.body).toEqual([]);
    db.prepare("UPDATE maps SET player_visible = 0 WHERE id = ?").run(mapId);
    expect((await request(app).get(`/api/maps/${mapId}/assets`).set(player)).status).toBe(404);
  });

  it("POST document → 201, хранится canonical", () => {
    return request(app)
      .post("/api/maps")
      .set(gm)
      .send({ name: "V5 карта", scale: "locality", document: gmFixture() })
      .then((res) => {
        expect(res.status).toBe(201);
        canonical = serializeMapDocument(gmFixture());
        expect(res.body.cells).toBe(canonical);
        expect(res.body.grid).toBe("square");
        expect(res.body.width).toBe(8);
        expect(res.body.height).toBe(8);
        v5id = res.body.id;
      });
  });

  it("cells + document вместе → 400", async () => {
    const res = await request(app)
      .post("/api/maps")
      .set(gm)
      .send({ name: "x", scale: "locality", cells: "{}", document: gmFixture() });
    expect(res.status).toBe(400);
  });

  it("GM load → тот же canonical", async () => {
    const res = await request(app).get(`/api/maps/${v5id}`).set(gm);
    expect(res.status).toBe(200);
    expect(res.body.cells).toBe(canonical);
  });

  it("второй экран получает проекцию V5 даже для закрытой карты", async () => {
    const shown = await request(app).get(`/api/maps/${v5id}/player-view`).set(gm);
    expect(shown.status).toBe(200);
    expect(shown.body.thumbnail).toBeNull();
    expect(shown.body.cells).not.toContain('"doorKind":"secret"');
    expect(shown.body.cells).not.toContain('"kind":"trap"');
    expect(shown.body.cells).not.toContain('"roomType":"treasury"');
    expect((await request(app).get(`/api/maps/${v5id}/player-view`).set(player)).status).toBe(404);
    expect((await request(app).get(`/api/maps/${v5id}`).set(gm)).body.cells).toBe(canonical);
  });

  it("player load → projected V5, секретное не утекает", async () => {
    const gmThumbnail = "data:image/png;base64,iVBORw0KGgo=";
    await request(app).put(`/api/maps/${v5id}`).set(gm).send({ player_visible: 1, thumbnail: gmThumbnail });
    const res = await request(app).get(`/api/maps/${v5id}`).set(player);
    expect(res.status).toBe(200);
    expect(res.body.thumbnail).toBeNull();
    expect((await request(app).get(`/api/maps/${v5id}`).set(gm)).body.thumbnail).toBe(gmThumbnail);
    const raw: string = res.body.cells;
    // Security invariant (§26 ТЗ): ни secret/trap/trapped в ответе.
    expect(raw).not.toContain('"doorKind":"secret"');
    expect(raw).not.toContain('"kind":"trap"');
    expect(raw).not.toContain('"doorKind":"trapped"');
    const parsed = parseMapDocument(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateMapDocument(parsed.value)).toEqual([]);
    const gameplay = parsed.value.layers.find((l) => l.id === "lyr-gameplay");
    // trap-1 и secret door-b удалены; остальное на месте.
    expect(gameplay && gameplay.kind === "gameplay" && gameplay.items.map((e) => e.id).sort()).toEqual(
      ["door-a", "door-c", "room-1", "start-1"],
    );
    // Выжившая дверь: пара с удалённой secret обнулена; trapped стала обычной.
    const doors =
      gameplay && gameplay.kind === "gameplay"
        ? gameplay.items.filter((e) => e.kind === "door")
        : [];
    const doorA = doors.find((d) => d.id === "door-a");
    const doorC = doors.find((d) => d.id === "door-c");
    expect(doorA && doorA.kind === "door" && doorA.pairedDoorId).toBeNull();
    expect(doorC && doorC.kind === "door" && doorC.doorKind).toBe("door");
    // Комната: тип empty, имя сохранено.
    const room =
      gameplay && gameplay.kind === "gameplay" ? gameplay.items.find((e) => e.kind === "room") : undefined;
    expect(room && room.kind === "room" && room.roomType).toBe("empty");
    expect(room && room.kind === "room" && room.name).toBe("Кладовая");
    // Label на месте.
    const labels = parsed.value.layers.find((l) => l.id === "lyr-labels");
    expect(labels && labels.kind === "label" && labels.items).toHaveLength(1);
  });

  it("fog: player и второй экран не получают содержимое закрытых клеток", async () => {
    const doc = gmFixture();
    doc.exploration = { enabled: true, revealedCells: [{ x: 0, y: 2 }] };
    const created = await request(app).post("/api/maps").set(gm)
      .send({ name: "Карта с туманом", scale: "region", document: doc, player_visible: 1 });
    expect(created.status).toBe(201);
    const mapId = created.body.id as number;
    const rawGm = (await request(app).get(`/api/maps/${mapId}`).set(gm)).body.cells as string;
    expect(rawGm).toContain("terrain/forest");
    expect(rawGm).toContain("Кладовая");
    for (const [path, role] of [[`/api/maps/${mapId}`, player], [`/api/maps/${mapId}/player-view`, gm]] as const) {
      const response = await request(app).get(path).set(role);
      expect(response.status).toBe(200);
      const raw = response.body.cells as string;
      expect(raw).not.toContain("terrain/forest");
      expect(raw).not.toContain("Кладовая");
      expect(raw).not.toContain("door-a");
      const parsed = parseMapDocument(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(validateMapDocument(parsed.value)).toEqual([]);
      expect(parsed.value.exploration?.revealedCells).toEqual([{ x: 0, y: 2 }]);
      const road = parsed.value.layers.find((layer) => layer.id === "lyr-road");
      expect(road && road.kind === "path" && road.paths[0]?.geometry.type === "cell-network"
        ? road.paths[0].geometry.cells : null).toEqual([{ x: 0, y: 2 }]);
    }
  });

  it("GM blob не меняется от player GET; GET не пишет DB", async () => {
    const before = await request(app).get(`/api/maps/${v5id}`).set(gm);
    await request(app).get(`/api/maps/${v5id}`).set(player);
    const after = await request(app).get(`/api/maps/${v5id}`).set(gm);
    expect(after.body.cells).toBe(before.body.cells);
    expect(after.body.cells).toBe(canonical);
    expect(after.body.updated_at).toBe(before.body.updated_at);
  });

  it("PUT document обновляет canonical", async () => {
    const doc = gmFixture();
    const terrain = doc.layers[0];
    if (terrain.kind === "terrain" && terrain.representation === "cells") {
      terrain.cells.push({ x: 0, y: 0, material: { type: "builtin", key: "terrain/hills" } });
    }
    const res = await request(app).put(`/api/maps/${v5id}`).set(gm).send({ document: doc });
    expect(res.status).toBe(200);
    expect(res.body.cells).toBe(serializeMapDocument(doc));
    canonical = res.body.cells;
  });

  it("PUT cells+document → 400; ресайз V5 без document → 400", async () => {
    expect(
      (await request(app).put(`/api/maps/${v5id}`).set(gm).send({ cells: "{}", document: gmFixture() })).status,
    ).toBe(400);
    expect((await request(app).put(`/api/maps/${v5id}`).set(gm).send({ width: 10 })).status).toBe(400);
  });

  it("invalid V5 отклоняется (8 кейсов)", async () => {
    const bad = (mut: (d: MapDocumentV5) => void): Record<string, unknown> => {
      const d = structuredClone(gmFixture()) as unknown as Record<string, unknown>;
      mut(d as unknown as MapDocumentV5);
      return { name: "bad", scale: "locality", document: d };
    };
    const cases: Array<[string, Record<string, unknown>]> = [
      ["duplicate id", bad((d) => {
        const g = d.layers.find((l) => l.id === "lyr-gameplay");
        if (g && g.kind === "gameplay") g.items.push({ ...g.items[0], kind: "trap", trapKind: "pit", position: { x: 0, y: 0 } });
      })],
      ["broken pair", bad((d) => {
        const g = d.layers.find((l) => l.id === "lyr-gameplay");
        const door = g && g.kind === "gameplay" && g.items.find((e) => e.id === "door-a");
        if (door && door.kind === "door") door.pairedDoorId = "ghost";
      })],
      ["bad bounds", bad((d) => {
        d.world.bounds.maxX = d.world.bounds.minX;
      })],
      ["gridless", bad((d) => {
        d.grid = null;
      })],
      ["OOB cell", bad((d) => {
        const t = d.layers[0];
        if (t.kind === "terrain" && t.representation === "cells") {
          t.cells.push({ x: 99, y: 0, material: { type: "builtin", key: "terrain/forest" } });
        }
      })],
      ["bad ref", bad((d) => {
        const t = d.layers[0];
        if (t.kind === "terrain" && t.representation === "cells") {
          (t.cells[0].material as unknown as Record<string, unknown>).key = undefined;
        }
      })],
      ["NaN-equivalent (Infinity→null в JSON)", (() => {
        const d = structuredClone(gmFixture()) as unknown as Record<string, unknown>;
        (d.layers as Record<string, unknown>[])[0] = {
          ...((d.layers as Record<string, unknown>[])[0] as object),
          opacity: Number.POSITIVE_INFINITY,
        };
        return { name: "bad", scale: "locality", document: d };
      })()],
      ["wrong v", { name: "bad", scale: "locality", document: { v: 4, cells: {}, roads: [] } }],
    ];
    for (const [name, body] of cases) {
      const res = await request(app).post("/api/maps").set(gm).send(body);
      expect(res.status, name).toBe(400);
      expect(res.body.error, name).toBeTruthy();
    }
  });

  it("unknown key: принимается, canonical вычищает", async () => {
    const doc = { ...gmFixture(), future: 1 } as unknown as MapDocumentV5;
    const created = await request(app).post("/api/maps").set(gm).send({ name: "V5 unk", scale: "locality", document: doc });
    expect(created.status).toBe(201);
    expect(created.body.cells).not.toContain("future");
    expect(created.body.cells).toBe(serializeMapDocument(gmFixture()));
  });

  it("legacy create по-прежнему работает", async () => {
    const res = await request(app).post("/api/maps").set(gm).send({ name: "Legacy", grid: "hex", scale: "planet" });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body.cells).v).toBe(1);
  });
});
