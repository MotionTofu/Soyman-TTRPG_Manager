import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;
let player: string;
let settingId: number;
let key: string;

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const fragment = (clientId: string) => ({
  client_id: clientId,
  url: "https://example.org/atlas/observatory",
  page_title: "Полевые записи — Старая обсерватория",
  heading: "Старая обсерватория",
  text: "Обсерватория стоит на **скальном** выступе над старой дорогой.",
  captured_at: "2026-11-05T12:40:00.000Z",
});

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const token = (name: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)")
      .run(name, role).lastInsertRowid);
    return signToken({ id, username: name, role, playerId: null, isAdmin: false, tokenVersion: 0 });
  };
  gm = token("web-capture-gm", "gm");
  player = token("web-capture-player", "player");
  const setting = await request(server.app).post("/api/settings").auth(gm, { type: "bearer" }).send({ name: "Мир для захвата" });
  expect(setting.status).toBe(201);
  settingId = setting.body.id;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
});

describe("web capture from the browser extension", () => {
  it("pairs once by a code from the GM settings, from an extension origin", async () => {
    expect((await request(server.app).post("/api/web-capture/pairings").auth(player, { type: "bearer" })).status).toBe(403);
    const issued = await request(server.app).post("/api/web-capture/pairings").auth(gm, { type: "bearer" });
    expect(issued.status).toBe(201);
    expect(issued.body.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);

    const wrong = await request(server.app).post("/api/web-capture/ext/pair").set("Origin", EXT_ORIGIN).send({ code: "AAA-AAA" });
    expect(wrong.status).toBe(401);

    // Код вводят руками: регистр и дефис не важны.
    const paired = await request(server.app).post("/api/web-capture/ext/pair").set("Origin", EXT_ORIGIN)
      .send({ code: issued.body.code.toLowerCase().replace("-", " "), label: "Chrome" });
    expect(paired.status).toBe(201);
    expect(paired.headers["access-control-allow-origin"]).toBe(EXT_ORIGIN);
    key = paired.body.key;

    const again = await request(server.app).post("/api/web-capture/ext/pair").send({ code: issued.body.code });
    expect(again.status).toBe(401);
    const keys = await request(server.app).get("/api/web-capture/keys").auth(gm, { type: "bearer" });
    expect(keys.body).toEqual([expect.objectContaining({ label: "Chrome" })]);
    expect(JSON.stringify(keys.body)).not.toContain(key);
  });

  it("puts a fragment into the inbox once, however often the queue resends it", async () => {
    expect((await request(server.app).post("/api/web-capture/ext/inbox").send(fragment("frag-0001"))).status).toBe(401);
    // Ключ расширения — не вход Мастера: остальной API ему закрыт.
    expect((await request(server.app).get("/api/settings").auth(key, { type: "bearer" })).status).toBe(401);
    const first = await request(server.app).post("/api/web-capture/ext/inbox").set("Origin", EXT_ORIGIN).auth(key, { type: "bearer" }).send(fragment("frag-0001"));
    expect(first.status).toBe(201);
    const repeat = await request(server.app).post("/api/web-capture/ext/inbox").auth(key, { type: "bearer" }).send(fragment("frag-0001"));
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ id: first.body.id, duplicate: true });
    expect((await request(server.app).post("/api/web-capture/ext/inbox").auth(key, { type: "bearer" })
      .send({ ...fragment("frag-0002"), url: "file:///C:/secret.txt" })).status).toBe(400);
    const status = await request(server.app).get("/api/web-capture/ext/status").auth(key, { type: "bearer" });
    expect(status.body).toEqual({ connected: true, inbox: 1 });
    expect((await request(server.app).get("/api/web-capture/inbox").auth(player, { type: "bearer" })).status).toBe(403);
    const inbox = await request(server.app).get("/api/web-capture/inbox").auth(gm, { type: "bearer" });
    expect(inbox.body).toEqual([expect.objectContaining({ id: first.body.id, heading: "Старая обсерватория", captured_at: "2026-11-05T12:40:00.000Z" })]);
  });

  it("attaches the source to a new entity and takes the fragment out of the inbox in one step", async () => {
    const [item] = (await request(server.app).get("/api/web-capture/inbox").auth(gm, { type: "bearer" })).body;
    const location = await request(server.app).post("/api/setting-locations").auth(gm, { type: "bearer" })
      .send({ name: "Старая обсерватория", setting_id: settingId });
    expect(location.status).toBe(201);
    expect((await request(server.app).post(`/api/web-capture/inbox/${item.id}/attach`).auth(gm, { type: "bearer" })
      .send({ target_kind: "location", target_id: location.body.id, field_name: "behavior" })).status).toBe(400);
    const attached = await request(server.app).post(`/api/web-capture/inbox/${item.id}/attach`).auth(gm, { type: "bearer" })
      .send({ target_kind: "location", target_id: location.body.id, field_name: "description" });
    expect(attached.status).toBe(201);
    expect(attached.body).toMatchObject({ url: item.url, quote: item.text, page_title: item.page_title, captured_at: item.captured_at });
    expect((await request(server.app).get("/api/web-capture/inbox").auth(gm, { type: "bearer" })).body).toEqual([]);
    expect((await request(server.app).post(`/api/web-capture/inbox/${item.id}/attach`).auth(gm, { type: "bearer" })
      .send({ target_kind: "location", target_id: location.body.id, field_name: "description" })).status).toBe(404);

    const sources = await request(server.app).get(`/api/web-capture/sources/entity/location/${location.body.id}`).auth(gm, { type: "bearer" });
    expect(sources.body).toHaveLength(1);
    db.prepare("DELETE FROM setting_locations WHERE id = ?").run(location.body.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM web_entity_sources WHERE target_kind = 'location' AND target_id = ?")
      .get(location.body.id)).toEqual({ n: 0 });
  });

  it("stops accepting fragments once the GM disconnects the extension", async () => {
    const [row] = (await request(server.app).get("/api/web-capture/keys").auth(gm, { type: "bearer" })).body;
    expect((await request(server.app).delete(`/api/web-capture/keys/${row.id}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((await request(server.app).get("/api/web-capture/ext/status").auth(key, { type: "bearer" })).status).toBe(401);
  });
});
