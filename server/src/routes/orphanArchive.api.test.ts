import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { VAULT_ROOT } from "../services/filesystem";
import { signToken } from "../services/auth";

// Сироты уходят в архив как любой файл: в `_Archive` с записью archived_files,
// а запись архива без файла «Здоровье» показывает среди битых путей и убирает.
let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('orphan-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "orphan-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("архив сирот и записи архива без файла", () => {
  it("сирота попадает в список архива и не в отдельную папку", async () => {
    fs.mkdirSync(path.join(VAULT_ROOT, "Loose"), { recursive: true });
    fs.writeFileSync(path.join(VAULT_ROOT, "Loose", "lost.png"), "png");
    const r = await request(server.app).post("/api/health/orphan/archive").auth(gm, { type: "bearer" }).send({ paths: ["Loose/lost.png"] });
    expect(r.body).toMatchObject({ moved: 1, errors: [] });
    expect(fs.existsSync(path.join(VAULT_ROOT, "Loose", "lost.png"))).toBe(false);
    expect(fs.existsSync(path.join(VAULT_ROOT, "_Archive", "orphans"))).toBe(false);
    const list = (await request(server.app).get("/api/archived-files").auth(gm, { type: "bearer" })).body as { original_owner_type: string; original_name: string; file_url: string }[];
    const row = list.find((f) => f.original_name === "lost.png")!;
    expect(row.original_owner_type).toBe("orphan");
    expect(row.file_url.split("?")[0]).toBe("/files/_Archive/lost.png");
  });

  it("запись без файла видна среди битых путей и убирается; с файлом — нет", async () => {
    const missing = Number(db.prepare(`INSERT INTO archived_files (original_owner_type, original_owner_id, original_name, archive_path, size)
      VALUES ('location_map', 1, 'карта', ?, 1)`).run(path.join("_Archive", "gone.jpg")).lastInsertRowid);
    const scan = (await request(server.app).get("/api/health/scan").auth(gm, { type: "bearer" })).body as { brokenPaths: { table: string; id: number }[] };
    expect(scan.brokenPaths.some((b) => b.table === "archived_files" && b.id === missing)).toBe(true);
    const clear = await request(server.app).post("/api/health/path/clear").auth(gm, { type: "bearer" })
      .send({ table: "archived_files", column: "archive_path", id: missing });
    expect(clear.status).toBe(200);
    expect(db.prepare("SELECT id FROM archived_files WHERE id = ?").get(missing)).toBeUndefined();

    const kept = (db.prepare("SELECT id FROM archived_files WHERE original_name = 'lost.png'").get() as { id: number }).id;
    const refused = await request(server.app).post("/api/health/path/clear").auth(gm, { type: "bearer" })
      .send({ table: "archived_files", column: "archive_path", id: kept });
    expect(refused.status).toBe(409);
    expect(db.prepare("SELECT id FROM archived_files WHERE id = ?").get(kept)).toBeDefined();
  });
});
