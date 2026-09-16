import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import childProcess from "node:child_process";
import { db } from "../db/db";
import { VAULT_ROOT } from "../services/filesystem";
import { signToken } from "../services/auth";
import { signPath, verifySignedUrl } from "../services/signedUrl";

// Patch the native object too: the production entrypoint can reach this
// built-in through CommonJS. No test may actually launch the file explorer.
const reveal = vi.spyOn(childProcess, "execFile").mockImplementation(() => ({}) as childProcess.ChildProcess);
let server: typeof import("../index");
let gm: string;
let player: string;
let resourceId: number;
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "soyman-boundary-"));

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const pid = Number(db.prepare("INSERT INTO players (name) VALUES ('Boundary player')").run().lastInsertRowid);
  for (const role of ["gm", "player"] as const) {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES (?, 'test-only', ?, ?)")
      .run(`boundary-${role}`, role, role === "player" ? pid : null).lastInsertRowid);
    const token = signToken({ id, username: `boundary-${role}`, role, playerId: role === "player" ? pid : null, isAdmin: false, tokenVersion: 0 });
    if (role === "gm") gm = token; else player = token;
  }
  resourceId = Number(db.prepare("INSERT INTO resources (name, file_path) VALUES ('Boundary resource', 'keep.txt')").run().lastInsertRowid);
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("real server administrative boundaries", () => {
  it("leaves only the liveness endpoint public", async () => {
    expect((await request(server.app).get("/api/health")).body).toEqual({ ok: true });
    expect((await request(server.app).get("/api/storages")).status).toBe(401);
    expect((await request(server.app).get("/api/storages").auth(player, { type: "bearer" })).status).toBe(403);
    expect((await request(server.app).get("/api/storages").auth(gm, { type: "bearer" })).status).toBe(200);
  });

  for (const role of ["anonymous", "player"] as const) {
    it(`rejects all destructive service requests from ${role} before side effects`, async () => {
      const destination = path.join(temp(), "must-not-exist");
      const cases: ["post" | "delete", string, object][] = [
        ["post", "/api/health/path/clear", { table: "resources", column: "file_path", id: resourceId }],
        ["post", "/api/health/open-folder", { path: VAULT_ROOT }],
        ["post", "/api/health/orphan/archive", { paths: ["keep.txt"] }],
        ["post", "/api/storages", { name: "denied", folderPath: destination }],
        ["post", "/api/storages/default/activate", {}],
        ["delete", "/api/storages/default", {}],
        ["post", "/api/storages/import-backup", {}],
        ["delete", "/api/archived-files/999", {}],
      ];
      for (const [method, url, body] of cases) {
        let req = request(server.app)[method](url).send(body);
        if (role === "player") req = req.auth(player, { type: "bearer" });
        expect((await req).status, url).toBe(role === "player" ? 403 : 401);
      }
      expect(fs.existsSync(destination)).toBe(false);
      expect(db.prepare("SELECT file_path FROM resources WHERE id = ?").get(resourceId)).toEqual({ file_path: "keep.txt" });
      expect(reveal).not.toHaveBeenCalled();
    });
  }

  it("allows GM operations but rejects paths outside vault including a junction", async () => {
    const external = temp();
    const file = path.join(external, "keep.txt");
    fs.writeFileSync(file, "keep");
    const junction = path.join(VAULT_ROOT, "outside-link");
    fs.symlinkSync(external, junction, "junction");
    for (const target of [file, path.join(VAULT_ROOT, "..", "outside"), `${VAULT_ROOT}-other`, junction]) {
      expect((await request(server.app).post("/api/health/open-folder").auth(gm, { type: "bearer" }).send({ path: target })).status).toBe(400);
    }
    const aid = Number(db.prepare(`INSERT INTO archived_files
      (original_owner_type, original_owner_id, original_name, archive_path, size) VALUES ('resource', 1, 'test', ?, 4)`)
      .run(path.join(junction, "keep.txt")).lastInsertRowid);
    expect((await request(server.app).delete(`/api/archived-files/${aid}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe("keep");
    expect((await request(server.app).post("/api/health/path/clear").auth(gm, { type: "bearer" })
      .send({ table: "resources", column: "file_path", id: resourceId })).status).toBe(200);
  });

  it("rejects a real ZIP with traversal and a symlink including permission bits", async () => {
    for (const kind of ["traversal", "symlink"]) {
      const zip = new AdmZip();
      zip.addFile(kind === "traversal" ? "%2e%2e/escape.txt" : "RPG-Vault/link", Buffer.from("outside"));
      if (kind === "symlink") zip.getEntries()[0].header.attr = (0o120777 << 16) >>> 0;
      const destination = path.join(temp(), "import");
      const response = await request(server.app).post("/api/storages/import-backup").auth(gm, { type: "bearer" })
        .field("name", "rejected").field("folderPath", destination).attach("file", zip.toBuffer(), "test.zip");
      expect(response.status).toBe(400);
      expect(fs.existsSync(destination)).toBe(false);
    }
  });

  it("never overwrites a nonempty destination and imports/activates a valid backup", async () => {
    const snapshot = path.join(temp(), "app.db");
    db.prepare("VACUUM INTO ?").run(snapshot);
    const backupDb = new Database(snapshot);
    backupDb.prepare("INSERT INTO systems (name) VALUES ('Imported isolation test')").run();
    backupDb.close();
    const activeVault = VAULT_ROOT;
    const zip = new AdmZip();
    zip.addLocalFile(snapshot);
    zip.addFile("RPG-Vault/imported.txt", Buffer.from("backup file"));
    const occupied = temp();
    fs.writeFileSync(path.join(occupied, "keep.txt"), "keep");
    const send = (destination: string) => request(server.app).post("/api/storages/import-backup").auth(gm, { type: "bearer" })
      .field("name", "Backup test").field("folderPath", destination).attach("file", zip.toBuffer(), "test.zip");
    expect((await send(occupied)).status).toBe(409);
    expect(fs.readFileSync(path.join(occupied, "keep.txt"), "utf8")).toBe("keep");
    const destination = path.join(temp(), "new-storage");
    const response = await send(destination);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(fs.readFileSync(path.join(destination, "RPG-Vault/imported.txt"), "utf8")).toBe("backup file");
    expect(fs.existsSync(path.join(destination, "RPG-Vault/Systems/Imported isolation test"))).toBe(true);
    expect(fs.existsSync(path.join(activeVault, "Systems/Imported isolation test"))).toBe(false);
    const signed = new URL("http://test" + signPath("/files/imported.txt"));
    const previous = (await request(server.app).get("/api/storages").auth(gm, { type: "bearer" })).body.activeId;
    try {
      expect((await request(server.app).post(`/api/storages/${response.body.id}/activate`).auth(gm, { type: "bearer" })).status).toBe(200);
      expect((await request(server.app).get("/api/storages").auth(gm, { type: "bearer" })).status).toBe(200);
      expect(verifySignedUrl(signed.pathname, signed.searchParams.get("sig")!, signed.searchParams.get("exp")!)).toBe(true);
    } finally {
      expect((await request(server.app).post(`/api/storages/${previous}/activate`).auth(gm, { type: "bearer" })).status).toBe(200);
    }
    expect((await request(server.app).delete(`/api/storages/${response.body.id}`).auth(gm, { type: "bearer" })).status).toBe(200);
  });

  it("rejects a corrupt database before creating the destination", async () => {
    const zip = new AdmZip();
    zip.addFile("app.db", Buffer.from("not a database"));
    const destination = path.join(temp(), "bad-import");
    const response = await request(server.app).post("/api/storages/import-backup").auth(gm, { type: "bearer" })
      .field("name", "Corrupt").field("folderPath", destination).attach("file", zip.toBuffer(), "test.zip");
    expect(response.status).toBe(500);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("preserves intentional external resource reveal", async () => {
    const external = path.join(temp(), "track.mp3");
    fs.writeFileSync(external, "test audio");
    const id = Number(db.prepare("INSERT INTO resources (name, category, file_path) VALUES ('External', 'audio', ?)").run(external).lastInsertRowid);
    expect((await request(server.app).post(`/api/resources/${id}/reveal`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect(reveal).toHaveBeenCalled();
  });
});
