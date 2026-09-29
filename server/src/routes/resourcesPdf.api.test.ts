import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "fs";
import crypto from "crypto";
import { db } from "../db/db";
import { vaultAbs } from "../services/filesystem";
import { signToken } from "../services/auth";

let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('pdf-test-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "pdf-test-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("PDF resources", () => {
  it("stores a PDF in the vault and serves authenticated byte ranges", async () => {
    const bytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const upload = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Правила").field("scope", "global").attach("file", bytes, "rules.pdf");
    expect(upload.status).toBe(201);
    expect(upload.body.category).toBe("pdf");
    expect(upload.body.file_sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    expect(upload.body.file_url).toMatch(/^\/files\//);
    expect(fs.readFileSync(vaultAbs(upload.body.file_path))).toEqual(bytes);
    const filePath = (upload.body.file_url as string).split("?")[0];
    expect((await request(server.app).get(filePath)).status).toBe(401);
    const range = await request(server.app).get(filePath).auth(gm, { type: "bearer" }).set("Range", "bytes=0-7");
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe(`bytes 0-7/${bytes.length}`);
    expect(range.body).toEqual(bytes.subarray(0, 8));
  });

  it("rejects a renamed non-PDF and does not create a Resource", async () => {
    const before = (db.prepare("SELECT COUNT(*) AS count FROM resources").get() as { count: number }).count;
    const result = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Подделка").field("scope", "global")
      .attach("file", Buffer.from("not a pdf"), { filename: "fake.pdf", contentType: "application/pdf" });
    expect(result.status).toBe(400);
    expect((db.prepare("SELECT COUNT(*) AS count FROM resources").get() as { count: number }).count).toBe(before);
  });

  it("accepts a PDF larger than the former 15 MB image limit", async () => {
    const bytes = Buffer.alloc(16 * 1024 * 1024, 32);
    bytes.write("%PDF-1.7\n", 0, "ascii");
    const result = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Большой PDF").field("scope", "global")
      .attach("file", bytes, { filename: "large.pdf", contentType: "application/pdf" });
    expect(result.status).toBe(201);
    expect(fs.statSync(vaultAbs(result.body.file_path)).size).toBe(bytes.length);
  });

  it("keeps image uploads working", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");
    const result = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
      .field("name", "Картинка").field("scope", "global")
      .attach("file", bytes, { filename: "tiny.png", contentType: "image/png" });
    expect(result.status).toBe(201);
    expect(fs.readFileSync(vaultAbs(result.body.file_path))).toEqual(bytes);
  });
});
