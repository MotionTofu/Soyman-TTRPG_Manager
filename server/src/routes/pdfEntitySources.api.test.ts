import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;
let player: string;
let resourceId: number;
let settingId: number;
let systemId: number;
let sectionId: number;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const token = (name: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)")
      .run(name, role).lastInsertRowid);
    return signToken({ id, username: name, role, playerId: null, isAdmin: false, tokenVersion: 0 });
  };
  gm = token("pdf-entity-gm", "gm");
  player = token("pdf-entity-player", "player");
  const pdf = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
    .field("name", "Источник").field("scope", "global")
    .attach("file", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"), "source.pdf");
  expect(pdf.status).toBe(201);
  resourceId = pdf.body.id;
  const setting = await request(server.app).post("/api/settings").auth(gm, { type: "bearer" }).send({ name: "Мир для PDF" });
  expect(setting.status).toBe(201);
  settingId = setting.body.id;
  const system = await request(server.app).post("/api/systems").auth(gm, { type: "bearer" }).send({ name: "Система для PDF" });
  expect(system.status).toBe(201);
  systemId = system.body.id;
  const section = await request(server.app).post(`/api/systems/${systemId}/sections`).auth(gm, { type: "bearer" })
    .send({ name: "Предметы", kind: "equipment" });
  expect(section.status).toBe(201);
  sectionId = section.body.id;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
});

describe("PDF sources of entities", () => {
  it("prefills an unambiguous setting linked to a global PDF", async () => {
    const before = await request(server.app).get(`/api/pdf-entity-sources/context/${resourceId}`).auth(gm, { type: "bearer" });
    expect(before.body).toMatchObject({ setting_id: null, system_id: null });
    expect((await request(server.app).post(`/api/resources/${resourceId}/settings`).auth(gm, { type: "bearer" })
      .send({ setting_id: settingId })).status).toBe(200);
    const after = await request(server.app).get(`/api/pdf-entity-sources/context/${resourceId}`).auth(gm, { type: "bearer" });
    expect(after.body.setting_id).toBe(settingId);
  });

  it("creates and edits every agreed entity kind, then links the selected field and page", async () => {
    const cases = [
      { kind: "being", path: "/api/setting-beings", field: "history" },
      { kind: "location", path: "/api/setting-locations", field: "description" },
      { kind: "community", path: "/api/setting-communities", field: "goals" },
      { kind: "artifact", path: "/api/artifacts", field: "power" },
      { kind: "item", path: `/api/systems/${systemId}/entries`, edit: "/api/systems/entries", field: "description" },
      { kind: "magic_item", path: `/api/systems/${systemId}/entries`, edit: "/api/systems/entries", field: "description" },
    ] as const;
    for (const [index, item] of cases.entries()) {
      const created = await request(server.app).post(item.path).auth(gm, { type: "bearer" })
        .send(index < 4 ? { name: `PDF карточка ${index}`, setting_id: settingId } :
          { name: `PDF карточка ${index}`, section_id: sectionId, kind: item.kind });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const editPath = `${"edit" in item ? item.edit : item.path}/${created.body.id}`;
      const edited = await request(server.app).put(editPath).auth(gm, { type: "bearer" })
        .send({ [item.field]: "Редактируемый текст из PDF" });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body[item.field]).toBe("Редактируемый текст из PDF");
      const linked = await request(server.app).post("/api/pdf-entity-sources").auth(gm, { type: "bearer" })
        .send({ resource_id: resourceId, target_kind: item.kind, target_id: created.body.id,
          field_name: item.field, page_number: index + 2, quote: `Цитата ${index}` });
      expect(linked.status, JSON.stringify(linked.body)).toBe(201);
      expect(linked.body).toMatchObject({ target_kind: item.kind, target_id: created.body.id,
        target_name: `PDF карточка ${index}`, page_number: index + 2,
        quote: `Цитата ${index}`, resource_name: "Источник", needs_reattach: 0 });
      const cardSources = await request(server.app)
        .get(`/api/pdf-entity-sources/entity/${item.kind}/${created.body.id}`).auth(gm, { type: "bearer" });
      expect(cardSources.body).toHaveLength(1);
    }
    const all = await request(server.app).get(`/api/pdf-entity-sources/resource/${resourceId}`).auth(gm, { type: "bearer" });
    expect(all.body).toHaveLength(6);
    expect((await request(server.app).get(`/api/pdf-entity-sources/resource/${resourceId}`).auth(player, { type: "bearer" })).status).toBe(403);
    db.prepare("UPDATE resources SET file_sha256 = 'replaced' WHERE id = ?").run(resourceId);
    const stale = await request(server.app).get(`/api/pdf-entity-sources/resource/${resourceId}`).auth(gm, { type: "bearer" });
    expect(stale.body.every((row: { needs_reattach: number }) => row.needs_reattach === 1)).toBe(true);
    const itemId = (db.prepare("SELECT id FROM compendium_entries WHERE system_id = ? AND kind = 'item' LIMIT 1")
      .get(systemId) as { id: number }).id;
    db.prepare("DELETE FROM compendium_entries WHERE id = ?").run(itemId);
    expect((db.prepare("SELECT 1 FROM pdf_entity_sources WHERE target_kind = 'item' AND target_id = ?")
      .get(itemId))).toBeUndefined();
  });

  it("rejects invalid fields and mismatched compendium kinds", async () => {
    const item = db.prepare("SELECT id FROM compendium_entries WHERE kind = 'magic_item' LIMIT 1").get() as { id: number };
    const base = { resource_id: resourceId, target_kind: "item", target_id: item.id,
      field_name: "description", page_number: 1, quote: "Текст" };
    expect((await request(server.app).post("/api/pdf-entity-sources").auth(gm, { type: "bearer" })
      .send({ ...base, field_name: "name" })).status).toBe(400);
    expect((await request(server.app).post("/api/pdf-entity-sources").auth(gm, { type: "bearer" })
      .send(base)).status).toBe(404);
    expect((await request(server.app).post("/api/pdf-entity-sources").auth(gm, { type: "bearer" })
      .send({ ...base, page_number: null })).status).toBe(400);
  });
});
