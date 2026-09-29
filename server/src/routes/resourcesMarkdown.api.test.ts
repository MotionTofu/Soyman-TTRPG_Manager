import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "fs";
import { db } from "../db/db";
import { vaultAbs } from "../services/filesystem";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('md-test-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "md-test-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("standalone Markdown resources", () => {
  it("resolves stable Resource links and stops resolving archived files", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");
    const image = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Карта").field("scope", "global")
      .attach("file", bytes, { filename: "map.png", contentType: "image/png" });
    expect(image.status).toBe(201);
    expect(image.body.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(image.body.category).toBe("image");
    expect(image.body.markdown_linkable).toBe(true);
    const link = `![Карта](soyman:resource/${image.body.uid})`;
    const document = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Атлас").field("scope", "global")
      .field("category", "markdown").field("content", link);
    expect(document.status).toBe(201);
    expect(document.body.uid).toMatch(/^[0-9a-f-]{36}$/);
    const resolve = () => request(server.app).get(`/api/resources/resolve?uids=${image.body.uid}`).auth(gm, { type: "bearer" });
    const found = await resolve();
    expect(found.status).toBe(200);
    expect(found.body[0].uid).toBe(image.body.uid);
    expect(found.body[0].file_url).toMatch(/^\/files\//);
    expect((await request(server.app).get(`/api/resources/resolve?uids=../private`).auth(gm, { type: "bearer" })).status).toBe(400);
    expect((await request(server.app).get(`/api/resources/resolve?uids=${image.body.uid}`)).status).toBe(401);
    const player = signToken({ id: 999, username: "reader", role: "player", playerId: 1, isAdmin: false, tokenVersion: 0 });
    expect((await request(server.app).get(`/api/resources/resolve?uids=${image.body.uid}`).auth(player, { type: "bearer" })).status).toBe(403);
    const archive = await request(server.app).delete(`/api/resources/${image.body.id}`).auth(gm, { type: "bearer" });
    expect(archive.status).toBe(200);
    expect((await resolve()).body).toEqual([]);
    const restore = await request(server.app).put(`/api/resources/${image.body.id}/restore`).auth(gm, { type: "bearer" });
    expect(restore.status).toBe(200);
    expect((await resolve()).body[0].uid).toBe(image.body.uid);
    db.prepare("UPDATE resources SET file_path = ? WHERE id = ?").run("Resources/images/missing.png", image.body.id);
    expect((await resolve()).body[0].file_url).toBeNull();
    const read = await request(server.app).get(`/api/resources/${document.body.id}/markdown-content`).auth(gm, { type: "bearer" });
    expect(read.body.content).toBe(link);
  });

  it("uploads, reads and edits UTF-8 Markdown without changing a deduplicated peer", async () => {
    const original = "# Мир\n\n[[being@12345678-1234-1234-1234-123456789abc|home|Мирт]]\n";
    const create = () => request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Мир").field("scope", "global")
      .attach("file", Buffer.from(original), { filename: "world.md", contentType: "text/markdown" });
    const first = await create();
    const second = await create();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.type).toBe("markdown");
    expect(first.body.category).toBe("markdown");
    expect(first.body.file_path).not.toBe(second.body.file_path);
    const read = await request(server.app).get(`/api/resources/${first.body.id}/markdown-content`).auth(gm, { type: "bearer" });
    expect(read.body.content).toBe(original);
    expect(read.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const updated = "# Новый мир\n\n- [x] готово\n";
    const save = await request(server.app).put(`/api/resources/${first.body.id}/markdown-content`).auth(gm, { type: "bearer" })
      .send({ content: updated, expected_sha256: read.body.sha256 });
    expect(save.status).toBe(200);
    const stale = await request(server.app).put(`/api/resources/${first.body.id}/markdown-content`).auth(gm, { type: "bearer" })
      .send({ content: "старый черновик", expected_sha256: read.body.sha256 });
    expect(stale.status).toBe(409);
    expect(fs.readFileSync(vaultAbs(first.body.file_path), "utf8")).toBe(updated);
    expect(fs.readFileSync(vaultAbs(second.body.file_path), "utf8")).toBe(original);
  });

  it("creates an empty document and rejects invalid uploads and oversized edits", async () => {
    const created = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Черновик").field("scope", "global").field("category", "markdown").field("content", "");
    expect(created.status).toBe(201);
    expect(created.body.type).toBe("markdown");
    expect(fs.readFileSync(vaultAbs(created.body.file_path), "utf8")).toBe("");
    const invalid = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Бинарный").field("scope", "global")
      .attach("file", Buffer.from([0xff, 0xfe]), { filename: "bad.md", contentType: "text/markdown" });
    expect(invalid.status).toBe(400);
    const large = "x".repeat(1_500_000);
    const withinLimit = await request(server.app).put(`/api/resources/${created.body.id}/markdown-content`)
      .auth(gm, { type: "bearer" }).send({ content: large });
    expect(withinLimit.status).toBe(200);
    expect(fs.readFileSync(vaultAbs(created.body.file_path), "utf8")).toBe(large);
    const tooLarge = await request(server.app).put(`/api/resources/${created.body.id}/markdown-content`)
      .auth(gm, { type: "bearer" }).send({ content: "x".repeat(2 * 1024 * 1024 + 1) });
    expect(tooLarge.status).toBe(400);
  });
});
