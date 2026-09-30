import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Database } from "better-sqlite3";
import { createGameplayToken, tokensOf, type MapDocumentV6 } from "@soyman/shared";

let app: express.Express;
let database: Database;
let sourceId: number;
let locationId: number;
let settingId: number;
const gm = { "X-Soyman-Map-Max-Version": "6" };
const player = { ...gm, "x-test-role": "player" };
const uid = "12345678-1234-1234-1234-123456789abc";
function fixture(): MapDocumentV6 {
  return { v: 6, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } }, assetPacks: [],
    layers: [{ id: "gameplay", kind: "gameplay", name: "Test", visible: true, locked: false, opacity: 1,
      items: [createGameplayToken("test-token", { kind: "being", uid }, { x: 1.5, y: 2.5 })] }] };
}
beforeAll(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "maps-v6-api-"));
  process.env.DB_DIR = temp;
  process.env.VAULT_ROOT = temp;
  (await import("../services/filesystem")).setVaultRoot(temp);
  const { db } = await import("../db/db");
  database = db;
  const { mapsRouter } = await import("./maps");
  const { apiRoleGate } = await import("../services/playerAccess");
  app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", (req, _res, next) => {
    (req as unknown as { user: unknown }).user = req.get("x-test-role") === "player"
      ? { role: "player", playerId: 42 } : { role: "gm", playerId: null };
    next();
  });
  app.use("/api", apiRoleGate as express.RequestHandler);
  app.use("/api/maps", mapsRouter);
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Test setting')").run().lastInsertRowid);
  sourceId = Number(db.prepare("INSERT INTO setting_beings (setting_id, name, short_name, uid) VALUES (?, 'Test full name', 'Test short name', ?)").run(settingId, uid).lastInsertRowid);
  locationId = Number(db.prepare("INSERT INTO setting_locations (setting_id, name) VALUES (?, 'Test location')").run(settingId).lastInsertRowid);
}, 120000);
async function create(doc: unknown = fixture()) {
  return request(app).post("/api/maps").set(gm).send({ name: "Test V6 map", scale: "locality", player_visible: true, document: doc });
}
describe("V6 map persistence and gates", () => {
  it("bestiary monsters resolve stable refs and persist, other entry kinds/archived systems cannot create tokens", async () => {
    const systemId = Number(database.prepare("INSERT INTO systems (name) VALUES ('Test map bestiary')").run().lastInsertRowid);
    const sectionId = Number(database.prepare("INSERT INTO system_sections (system_id, name) VALUES (?, 'Test bestiary')").run(systemId).lastInsertRowid);
    const monsterId = Number(database.prepare("INSERT INTO compendium_entries (system_id, section_id, kind, name, short_name) VALUES (?, ?, 'monster', 'Test full monster', 'Test monster')").run(systemId, sectionId).lastInsertRowid);
    const spellId = Number(database.prepare("INSERT INTO compendium_entries (system_id, section_id, kind, name) VALUES (?, ?, 'spell', 'Test spell')").run(systemId, sectionId).lastInsertRowid);
    const made = await create(), url = `/api/maps/${made.body.id}`;
    const resolved = await request(app).post(`${url}/token-source`).set(gm).send({ kind: "compendium_entry", id: monsterId });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ sourceRef: { kind: "compendium_entry" }, name: "Test monster", visual: { type: "builtin", key: "being" } });
    expect(resolved.body.sourceRef.uid).toMatch(/^[0-9a-f-]{36}$/);
    const doc = fixture();
    if (doc.layers[0].kind === "gameplay") doc.layers[0].items.push(createGameplayToken("monster", resolved.body.sourceRef, { x: 4, y: 4 }));
    expect((await request(app).put(url).set(gm).send({ document: doc, expectedRevision: 0 })).status).toBe(200);
    expect((await request(app).post(`${url}/token-presentations`).set(gm).send({ sources: [resolved.body.sourceRef] })).body[0]).toMatchObject({ name: "Test monster", state: "active" });
    expect((await request(app).post(`${url}/token-source`).set(gm).send({ kind: "compendium_entry", id: spellId, entry_kind: "monster" })).status).toBe(400);
    database.prepare("UPDATE systems SET archived_at = datetime('now') WHERE id = ?").run(systemId);
    expect((await request(app).post(`${url}/token-source`).set(gm).send({ kind: "compendium_entry", id: monsterId })).status).toBe(400);
    expect((await request(app).post(`${url}/token-presentations`).set(gm).send({ sources: [resolved.body.sourceRef] })).body[0].state).toBe("missing");
    expect((await request(app).put(url).set(gm).send({ document: doc, expectedRevision: 1 })).status).toBe(200);
    database.prepare("DELETE FROM compendium_entries WHERE id = ?").run(monsterId);
    expect((await request(app).put(url).set(gm).send({ document: doc, expectedRevision: 2 })).status).toBe(200);
    expect((await request(app).get(url).set(player)).status).toBe(409);
  });
  it("V6 archive/restore keeps document and bindings, advances revision and rejects old-client archive", async () => {
    const made = await create();
    expect(made.status).toBe(201);
    const id = made.body.id;
    database.prepare("INSERT INTO map_bindings (map_id, target_type, target_id) VALUES (?, 'location', ?)").run(id, locationId);
    expect((await request(app).delete(`/api/maps/${id}`)).status).toBe(409);
    expect((await request(app).delete(`/api/maps/${id}`).set(gm)).status).toBe(200);
    expect((await request(app).get(`/api/maps/${id}`).set(gm)).status).toBe(404);
    expect((await request(app).put(`/api/maps/${id}/restore`).set(gm)).status).toBe(200);
    const restored = await request(app).get(`/api/maps/${id}`).set(gm);
    expect(restored.body.cells).toBe(made.body.cells);
    expect(restored.body.revision).toBe(2);
    expect(database.prepare("SELECT target_id FROM map_bindings WHERE map_id = ?").get(id)).toEqual({ target_id: locationId });
  });
  it("revision migration leaves existing blobs and map-wide bindings intact", async () => {
    const { openDatabase } = await import("../db/db");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "maps-revision-migration-"));
    const old = openDatabase(temp);
    const raw = ' { "v": 77, "private": "Test existing bytes" } \n';
    const id = Number(old.prepare("INSERT INTO maps (name, grid, scale, cells) VALUES ('Test existing', 'square', 'locality', ?)").run(raw).lastInsertRowid);
    old.prepare("INSERT INTO map_bindings (map_id, target_type, target_id) VALUES (?, 'location', 123)").run(id);
    old.exec("ALTER TABLE maps DROP COLUMN revision");
    old.close();
    const migrated = openDatabase(temp);
    expect(migrated.prepare("SELECT cells, revision FROM maps WHERE id = ?").get(id)).toEqual({ cells: raw, revision: 0 });
    expect(migrated.prepare("SELECT target_type, target_id FROM map_bindings WHERE map_id = ?").get(id)).toEqual({ target_type: "location", target_id: 123 });
    migrated.close();
  });
  it("capability is required before create, round-trip is canonical, load never writes", async () => {
    const rejected = await request(app).post("/api/maps").send({ name: "Test", scale: "locality", document: fixture() });
    expect(rejected.status).toBe(409);
    const made = await create();
    expect(made.status).toBe(201);
    expect(made.body.revision).toBe(0);
    const before = database.prepare("SELECT cells, revision, updated_at FROM maps WHERE id = ?").get(made.body.id);
    const loaded = await request(app).get(`/api/maps/${made.body.id}`).set(gm);
    expect(loaded.status).toBe(200);
    expect(tokensOf(JSON.parse(loaded.body.cells))).toEqual(tokensOf(fixture()));
    expect(database.prepare("SELECT cells, revision, updated_at FROM maps WHERE id = ?").get(made.body.id)).toEqual(before);
    const empty = fixture();
    if (empty.layers[0].kind === "gameplay") empty.layers[0].items = [];
    expect((await request(app).put(`/api/maps/${made.body.id}`).set(gm).send({ document: empty, expectedRevision: 0 })).status).toBe(200);
    expect(database.prepare("SELECT uid FROM setting_beings WHERE id = ?").get(sourceId)).toEqual({ uid });
  });
  it("old clients cannot read any V6 content, assets, thumbnails or overwrite it", async () => {
    const made = await create();
    const id = made.body.id;
    const raw = made.body.cells;
    const encodedId = String(id).split("").map((c) => `%${c.charCodeAt(0).toString(16)}`).join("");
    expect((await request(app).get(`/api/maps/${encodedId}`)).status).toBe(409);
    expect((await request(app).get(`/api/maps/${id}.0`)).status).toBe(404);
    expect((await request(app).get(`/api/maps/${encodedId}/assets`)).status).toBe(409);
    for (const route of ["", "/player-view", "/assets", "/thumbnail"]) {
      const response = await request(app).get(`/api/maps/${id}${route}`);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "map-version-unsupported", requiredVersion: 6 });
      expect(JSON.stringify(response.body)).not.toContain(uid);
    }
    for (const body of [{ cells: '{"v":1,"cells":{},"roads":[]}' }, { clearCells: true }, { width: 10 }, { name: "Changed" }]) {
      expect((await request(app).put(`/api/maps/${id}`).send(body)).status).toBe(409);
    }
    const list = await request(app).get("/api/maps");
    expect(list.body.find((m: { id: number }) => m.id === id)).toMatchObject({ document_unsupported: true, document_version: 6 });
    expect(JSON.stringify(list.body)).not.toContain(uid);
    expect((database.prepare("SELECT cells FROM maps WHERE id = ?").get(id) as { cells: string }).cells).toBe(raw);
  });
  it("future bytes remain opaque, raw recovery is GM-only and no route falls back to legacy", async () => {
    const raw = ' { "v": 77, "private": "Test future secret" } \n';
    const id = Number(database.prepare("INSERT INTO maps (name, grid, scale, width, height, cells, player_visible, thumbnail) VALUES ('Test future', 'square', 'locality', 8, 8, ?, 1, 'private-thumbnail')").run(raw).lastInsertRowid);
    for (const route of ["", "/player-view", "/assets", "/thumbnail"]) {
      for (const headers of [gm, player]) {
        const response = await request(app).get(`/api/maps/${id}${route}`).set(headers);
        expect(response.status).toBe(409);
        expect(JSON.stringify(response.body)).not.toContain("Test future secret");
      }
    }
    expect((await request(app).put(`/api/maps/${id}`).set(gm).send({ name: "overwrite", expectedRevision: 0 })).status).toBe(409);
    const download = await request(app).get(`/api/maps/${id}/raw`);
    expect(download.status).toBe(200);
    expect(download.text).toBe(raw);
    expect((await request(app).get(`/api/maps/${id}/raw`).set(player)).status).toBe(403);
    expect((database.prepare("SELECT cells, revision FROM maps WHERE id = ?").get(id) as { cells: string; revision: number })).toEqual({ cells: raw, revision: 0 });
    const malformed = Number(database.prepare("INSERT INTO maps (name, grid, scale, cells, player_visible) VALUES ('Test opaque version', 'square', 'locality', ?, 1)")
      .run('{"v":{"private":"Test private version"}}').lastInsertRowid);
    const listing = await request(app).get("/api/maps").set(player);
    expect(JSON.stringify(listing.body)).not.toContain("Test private version");
    expect(listing.body.find((m: { id: number }) => m.id === malformed).document_version).toBeNull();
  });
  it("unknown features in a known version cannot become an overwrite fallback", async () => {
    const unknown = { ...fixture(), v: 5 };
    const raw = JSON.stringify(unknown); // V5 never allowed token entities.
    const id = Number(database.prepare("INSERT INTO maps (name, grid, scale, width, height, cells, player_visible) VALUES ('Test unknown feature', 'square', 'locality', 8, 8, ?, 1)").run(raw).lastInsertRowid);
    for (const route of ["", "/assets", "/thumbnail", "/player-view"]) {
      expect((await request(app).get(`/api/maps/${id}${route}`).set(gm)).body.code).toBe("map-version-unsupported");
    }
    expect((await request(app).put(`/api/maps/${id}`).set(gm).send({ document: fixture(), expectedRevision: 0 })).status).toBe(409);
    expect((database.prepare("SELECT cells FROM maps WHERE id = ?").get(id) as { cells: string }).cells).toBe(raw);
  });
  it("V6 requires revision, rejects downgrade, stale windows cannot retry blindly", async () => {
    const made = await create();
    const url = `/api/maps/${made.body.id}`;
    expect((await request(app).put(url).set(gm).send({ document: fixture() })).status).toBe(428);
    const next = fixture();
    tokensOf(next)[0].rotation = 90;
    const saved = await request(app).put(url).set(gm).send({ document: next, expectedRevision: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(1);
    const conflict = await request(app).put(url).set(gm).send({ document: fixture(), expectedRevision: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("map-revision-conflict");
    const old = { ...fixture(), v: 5, layers: [] };
    for (const body of [{ document: old }, { cells: '{}' }, { clearCells: true }, { width: 9 }]) {
      expect((await request(app).put(url).set(gm).send({ ...body, expectedRevision: 1 })).status).toBe(409);
    }
    expect(tokensOf(JSON.parse((await request(app).get(url).set(gm)).body.cells))[0].rotation).toBe(90);
  });
  it("numeric resolution uses the registry/UID service and preferred short names", async () => {
    const made = await create();
    const url = `/api/maps/${made.body.id}/token-source`;
    const result = await request(app).post(url).set(gm).send({ kind: "being", id: sourceId, title: "untrusted" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ sourceRef: { kind: "being", uid }, name: "Test short name" });
    const location = await request(app).post(url).set(gm).send({ kind: "location", id: locationId });
    expect(location.status).toBe(200);
    expect(location.body.sourceRef.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request(app).post(url).set(player).send({ kind: "being", id: sourceId })).status).toBe(403);
    expect((await request(app).post(url).set(gm).send({ kind: "character", id: sourceId })).status).toBe(400);
  });
  it("presentations resolve current names and safe portraits without writing map/source; GM-only and orphan-safe", async () => {
    const made = await create(), url = `/api/maps/${made.body.id}/token-presentations`;
    const before = database.prepare("SELECT cells, revision FROM maps WHERE id = ?").get(made.body.id);
    const missing = { kind: "location", uid: "00000000-0000-4000-8000-000000000000" };
    const refs = [{ kind: "being", uid }, missing];
    const file = path.join(process.env.VAULT_ROOT!, "test-avatar.png"); fs.writeFileSync(file, "test-only-image-placeholder");
    database.prepare("UPDATE setting_beings SET short_name = 'Test renamed', avatar_image_path = ? WHERE id = ?").run(file, sourceId);
    const result = await request(app).post(url).set(gm).send({ sources: [...refs, refs[0]] });
    expect(result.status).toBe(200); expect(result.body).toHaveLength(2);
    expect(result.body[0]).toMatchObject({ sourceRef: refs[0], name: "Test renamed", state: "active", id: sourceId });
    expect(result.body[0].portrait_url).toMatch(/^\/files\/test-avatar\.png/);
    expect(JSON.stringify(result.body)).not.toContain(process.env.VAULT_ROOT!);
    expect(result.body[1]).toMatchObject({ state: "missing", id: null, portrait_url: null });
    expect((await request(app).post(url).set(player).send({ sources: refs })).status).toBe(403);
    expect((await request(app).post(url).send({ sources: refs })).status).toBe(409);
    for (const sources of [[{ kind: "character", uid }], [{ kind: "being", uid: "bad" }], Array(2001).fill(refs[0])]) expect((await request(app).post(url).set(gm).send({ sources })).status).toBe(400);
    database.prepare("UPDATE setting_beings SET archived_at = datetime('now') WHERE id = ?").run(sourceId);
    expect((await request(app).post(url).set(gm).send({ sources: refs })).body[0]).toMatchObject({ state: "missing", id: null, portrait_url: null });
    database.prepare("UPDATE setting_beings SET archived_at = NULL, short_name = 'Test short name', avatar_image_path = NULL WHERE id = ?").run(sourceId);
    expect(database.prepare("SELECT cells, revision FROM maps WHERE id = ?").get(made.body.id)).toEqual(before);
  });
  it("rejects unavailable/new sources, but persisted orphan IDs can move or be deleted", async () => {
    const made = await create();
    const url = `/api/maps/${made.body.id}`;
    database.prepare("UPDATE setting_beings SET archived_at = datetime('now') WHERE id = ?").run(sourceId);
    const next = fixture();
    tokensOf(next)[0].size = 3;
    expect((await request(app).put(url).set(gm).send({ document: next, expectedRevision: 0 })).status).toBe(200);
    const another = fixture();
    const layer = another.layers[0];
    if (layer.kind === "gameplay") layer.items.push(createGameplayToken("new-orphan", { kind: "being", uid }, { x: 3, y: 3 }));
    expect((await request(app).put(url).set(gm).send({ document: another, expectedRevision: 1 })).status).toBe(400);
    expect((await create()).status).toBe(400);
    expect((await request(app).post(`${url}/token-source`).set(gm).send({ kind: "being", id: sourceId })).status).toBe(400);
    database.prepare("DELETE FROM setting_beings WHERE id = ?").run(sourceId);
    expect((await request(app).put(url).set(gm).send({ document: next, expectedRevision: 1 })).status).toBe(200);
    const empty = fixture();
    if (empty.layers[0].kind === "gameplay") empty.layers[0].items = [];
    expect((await request(app).put(url).set(gm).send({ document: empty, expectedRevision: 2 })).status).toBe(200);
    // Restore fixture for later tests; deletion above exercises a real orphan.
    database.prepare("INSERT INTO setting_beings (id, setting_id, name, short_name, uid) VALUES (?, ?, 'Test full name', 'Test short name', ?)").run(sourceId, settingId, uid);
  });
  it("archived owners cannot provide new tokens; players get no unprojected V6", async () => {
    const made = await create();
    database.prepare("UPDATE settings SET archived_at = datetime('now') WHERE id = ?").run(settingId);
    expect((await create()).status).toBe(400);
    database.prepare("UPDATE settings SET archived_at = NULL WHERE id = ?").run(settingId);
    for (const route of ["", "/assets", "/player-view", "/thumbnail"]) {
      const result = await request(app).get(`/api/maps/${made.body.id}${route}`).set(player);
      expect(result.status).toBe(409);
      expect(JSON.stringify(result.body)).not.toContain(uid);
    }
    expect((await request(app).get(`/api/maps/${made.body.id}/player-view`).set(gm)).body.code).toBe("map-presentation-unavailable");
  });
  it("old V5 writes advance revision and a new client cannot overwrite them with stale upgrade", async () => {
    const old = { ...fixture(), v: 5, layers: [] };
    const made = await request(app).post("/api/maps").send({ name: "Test old", scale: "locality", document: old });
    expect(made.status).toBe(201);
    const url = `/api/maps/${made.body.id}`;
    expect((await request(app).put(url).send({ name: "Test old changed" })).body.revision).toBe(1);
    expect((await request(app).put(url).set(gm).send({ document: fixture(), expectedRevision: 0 })).body.code).toBe("map-revision-conflict");
    expect((await request(app).put(url).set(gm).send({ document: fixture(), expectedRevision: 1 })).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(409);
  });
});
