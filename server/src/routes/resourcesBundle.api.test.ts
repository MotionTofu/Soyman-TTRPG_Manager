import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { db } from "../db/db";
import { signToken } from "../services/auth";
import { vaultAbs } from "../services/filesystem";

let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('bundle-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "bundle-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

function packageZip(name = "Атлас.md", target = "assets/карта мира.png") {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(`# Атлас\n\n![Карта](<${target}>)\n`, "utf8"));
  zip.addFile("assets/карта мира.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64"));
  return zip.toBuffer();
}

async function importZip(bytes: Buffer) {
  return request(server.app).post("/api/resources/markdown-bundle").auth(gm, { type: "bearer" })
    .field("name", "Атлас мира").field("scope", "global")
    .attach("file", bytes, { filename: "комплект.zip", contentType: "application/zip" });
}

describe("Markdown ZIP bundles", () => {
  it("imports, exports and reimports Cyrillic attachments with independent UIDs", async () => {
    const first = await importZip(packageZip());
    expect(first.status).toBe(201);
    const read = await request(server.app).get(`/api/resources/${first.body.id}/markdown-content`).auth(gm, { type: "bearer" });
    expect(read.body.content).toMatch(/soyman:resource\/[0-9a-f-]{36}/);
    const uid = /soyman:resource\/([0-9a-f-]{36})/.exec(read.body.content)![1];
    const linked = await request(server.app).get(`/api/resources/resolve?uids=${uid}`).auth(gm, { type: "bearer" });
    expect(linked.body[0].name).toBe("карта мира.png");
    const exportResult = await request(server.app).get(`/api/resources/${first.body.id}/markdown-bundle`).auth(gm, { type: "bearer" }).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(exportResult.status).toBe(200);
    const exported = new AdmZip(exportResult.body as Buffer);
    const markdown = exported.getEntries().find(entry => entry.entryName.endsWith(".md"))!.getData().toString("utf8");
    expect(markdown).toContain("assets/%D0%BA%D0%B0%D1%80%D1%82%D0%B0%20%D0%BC%D0%B8%D1%80%D0%B0.png");
    expect(exported.getEntry("assets/карта мира.png")).toBeTruthy();
    const second = await importZip(exportResult.body as Buffer);
    expect(second.status).toBe(201);
    const again = await request(server.app).get(`/api/resources/${second.body.id}/markdown-content`).auth(gm, { type: "bearer" });
    expect(again.body.content).not.toContain(uid);
    expect(again.body.content).toContain("soyman:resource/");
    const template=(await request(server.app).get('/api/workbooks/templates').auth(gm,{type:'bearer'})).body[0];
    const workbook=(await request(server.app).post('/api/workbooks/instances').auth(gm,{type:'bearer'}).send({template_id:template.id,title:'Тетрадь для восстановления'})).body;
    const book=(await request(server.app).get('/api/book-library/books').auth(gm,{type:'bearer'}).query({source_type:'resource',source_id:first.body.id})).body.books[0];
    await request(server.app).put(`/api/workbooks/books/${book.id}`).auth(gm,{type:'bearer'}).send({template_key:workbook.template.key,instance_id:workbook.id});
    const backup = await request(server.app).post("/api/backup").auth(gm, { type: "bearer" }).send({});
    expect(backup.status).toBe(200);
    const snapshot = new AdmZip(backup.body.path as string);
    expect(snapshot.getEntry("app.db")).toBeTruthy();
    expect(snapshot.getEntries().filter(entry => entry.entryName.startsWith("RPG-Vault/") && !entry.isDirectory).length).toBeGreaterThanOrEqual(4);
    const restored = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-bundle-restore-"));
    snapshot.extractAllTo(restored);
    const restoredDb = new Database(path.join(restored, "app.db"), { readonly: true });
    try {
      expect(restoredDb.prepare('SELECT uid,title,author_user_id,template_id FROM workbook_instances WHERE id=?').get(workbook.id)).toEqual({uid:workbook.uid,title:workbook.title,author_user_id:workbook.author_user_id,template_id:workbook.template_id});
      expect(restoredDb.prepare('SELECT instance_id FROM workbook_book_selection WHERE book_id=? AND author_user_id=?').get(book.id,workbook.author_user_id)).toEqual({instance_id:workbook.id});
      expect(restoredDb.prepare('SELECT key FROM library_books WHERE id=?').get(book.id)).toEqual({key:book.key});
      expect(restoredDb.pragma('foreign_key_check')).toEqual([]);
      const restoredDoc = restoredDb.prepare("SELECT file_path FROM resources WHERE uid = ?").get(first.body.uid) as { file_path: string };
      const restoredImage = restoredDb.prepare("SELECT file_path FROM resources WHERE uid = ?").get(uid) as { file_path: string };
      for (const item of [restoredDoc, restoredImage]) {
        const relative = path.relative(vaultAbs(""), vaultAbs(item.file_path));
        expect(fs.existsSync(path.join(restored, "RPG-Vault", relative))).toBe(true);
      }
    } finally { restoredDb.close(); }
  });

  it("rejects traversal, missing attachments, symbolic links and untrusted internal links", async () => {
    expect((await importZip(packageZip("Атлас.md", "../карта.png"))).status).toBe(400);
    expect((await importZip(packageZip("Атлас.md", "missing.png"))).status).toBe(400);
    expect((await importZip(packageZip("Атлас.md", "soyman:resource/11111111-1111-1111-1111-111111111111"))).status).toBe(400);
    const zip = new AdmZip();
    zip.addFile("Атлас.md", Buffer.from("![x](assets/link.png)"));
    zip.addFile("assets/link.png", Buffer.from("elsewhere"));
    zip.getEntry("assets/link.png")!.header.attr = (0o120777 << 16) >>> 0;
    expect((await importZip(zip.toBuffer())).status).toBe(400);
    expect((await request(server.app).post("/api/resources/markdown-bundle").attach("file", packageZip(), "bundle.zip")).status).toBe(401);
    const player = signToken({ id: 999, username: "reader", role: "player", playerId: 1, isAdmin: false, tokenVersion: 0 });
    expect((await request(server.app).post("/api/resources/markdown-bundle").auth(player, { type: "bearer" }).attach("file", packageZip(), "bundle.zip")).status).toBe(403);
  });

  it("rewrites links in a linked Markdown file as part of the same bundle", async () => {
    const zip = new AdmZip();
    zip.addFile("Книга.md", Buffer.from("[Глава](chapters/Глава.md)"));
    zip.addFile("chapters/Глава.md", Buffer.from("# Глава\n\n![Карта](images/карта.png)"));
    zip.addFile("chapters/images/карта.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64"));
    const imported = await importZip(zip.toBuffer());
    expect(imported.status).toBe(201);
    const exported = await request(server.app).get(`/api/resources/${imported.body.id}/markdown-bundle`).auth(gm, { type: "bearer" }).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(exported.status).toBe(200);
    const output = new AdmZip(exported.body as Buffer);
    const chapter = output.getEntry("assets/Глава.md")?.getData().toString("utf8");
    expect(chapter).toContain("%D0%BA%D0%B0%D1%80%D1%82%D0%B0.png");
    expect((await importZip(exported.body as Buffer)).status).toBe(201);
  });

  it("restores export after unarchiving and rejects a missing attachment", async () => {
    const imported = await importZip(packageZip());
    expect(imported.status).toBe(201);
    const md = await request(server.app).get(`/api/resources/${imported.body.id}/markdown-content`).auth(gm, { type: "bearer" });
    const uid = /soyman:resource\/([0-9a-f-]{36})/.exec(md.body.content)![1];
    const image = db.prepare("SELECT id, file_path FROM resources WHERE uid = ?").get(uid) as { id: number; file_path: string };
    expect(fs.existsSync(vaultAbs(image.file_path))).toBe(true);
    expect(fs.existsSync(vaultAbs(imported.body.file_path))).toBe(true);
    await request(server.app).delete(`/api/resources/${image.id}`).auth(gm, { type: "bearer" });
    expect((await request(server.app).get(`/api/resources/${imported.body.id}/markdown-bundle`).auth(gm, { type: "bearer" })).status).toBe(409);
    expect((await request(server.app).put(`/api/resources/${image.id}/restore`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((await request(server.app).get(`/api/resources/${imported.body.id}/markdown-bundle`).auth(gm, { type: "bearer" })).status).toBe(200);
    fs.unlinkSync(vaultAbs(image.file_path));
    expect((await request(server.app).get(`/api/resources/${imported.body.id}/markdown-bundle`).auth(gm, { type: "bearer" })).status).toBe(409);
  });
});
