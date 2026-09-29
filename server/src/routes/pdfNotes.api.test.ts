import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { db } from "../db/db";
import { signToken } from "../services/auth";
import { vaultAbs, vaultRel } from "../services/filesystem";

let server: typeof import("../index");
let resourceId: number;
let gm: string;
let otherGm: string;
let player: string;
let originalHash: string;
const anchor = [{ page: 1, rects: [{ x: 0.12, y: 0.24, w: 0.3, h: 0.04 }] }];

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const user = (username: string, role: "gm" | "player") => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'test-only', ?)")
      .run(username, role).lastInsertRowid);
    return signToken({ id, username, role, playerId: null, isAdmin: false, tokenVersion: 0 });
  };
  gm = user("pdf-notes-gm", "gm");
  otherGm = user("pdf-notes-other", "gm");
  player = user("pdf-notes-player", "player");
  const bytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  originalHash = createHash("sha256").update(bytes).digest("hex");
  const upload = await request(server.app).post("/api/resources").auth(gm, { type: "bearer" })
    .field("name", "Заметки к книге").field("scope", "global").attach("file", bytes, "notes.pdf");
  expect(upload.status).toBe(201);
  resourceId = upload.body.id;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("PDF notes", () => {
  it("backfills a checksum for PDF resources uploaded before note support", async () => {
    db.prepare("UPDATE resources SET file_sha256 = NULL WHERE id = ?").run(resourceId);
    const response = await request(server.app).get(`/api/resources/${resourceId}/pdf-notes`).auth(gm, { type: "bearer" });
    expect(response.status).toBe(200);
    expect((db.prepare("SELECT file_sha256 FROM resources WHERE id = ?").get(resourceId) as { file_sha256: string }).file_sha256).toBe(originalHash);
  });

  it("persists quoted and general notes with page-relative anchors", async () => {
    const path = `/api/resources/${resourceId}/pdf-notes`;
    const quoted = await request(server.app).post(path).auth(gm, { type: "bearer" })
      .send({ body: "Важная мысль", quote: "Текст PDF", anchors: anchor, context_before: "До", context_after: "После" });
    expect(quoted.status).toBe(201);
    expect(quoted.body).toMatchObject({ page_number: 1, quote: "Текст PDF", body: "Важная мысль", anchors: anchor, file_sha256: originalHash, needs_reattach: false });
    const general = await request(server.app).post(path).auth(gm, { type: "bearer" })
      .send({ body: "Мысль о книге" });
    expect(general.status).toBe(201);
    expect(general.body).toMatchObject({ page_number: null, quote: "", anchors: [] });

    const list = await request(server.app).get(path).auth(gm, { type: "bearer" });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.map((note: { id: string }) => note.id)).toContain(quoted.body.id);
    expect((await request(server.app).get(path).auth(otherGm, { type: "bearer" })).body).toEqual([]);
    expect((await request(server.app).get(path).auth(player, { type: "bearer" })).status).toBe(403);

    const edited = await request(server.app).put(`${path}/${quoted.body.id}`).auth(gm, { type: "bearer" })
      .send({ body: "Исправленная мысль" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: "Исправленная мысль", quote: "Текст PDF", anchors: anchor, file_sha256: originalHash });
    expect((await request(server.app).put(`${path}/${quoted.body.id}`).auth(otherGm, { type: "bearer" }).send({ body: "Чужая правка" })).status).toBe(404);

    db.prepare("UPDATE resources SET file_sha256 = ? WHERE id = ?").run("changed-pdf-hash", resourceId);
    const stale = await request(server.app).get(path).auth(gm, { type: "bearer" });
    expect(stale.body.find((note: { id: string }) => note.id === quoted.body.id).needs_reattach).toBe(true);
    expect(stale.body.find((note: { id: string }) => note.id === general.body.id).needs_reattach).toBe(false);
    const reattached = await request(server.app).put(`${path}/${quoted.body.id}`).auth(gm, { type: "bearer" })
      .send({ quote: "Новая цитата", anchors: [{ page: 2, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }] }] });
    expect(reattached.body).toMatchObject({ needs_reattach: false, page_number: 2, quote: "Новая цитата", file_sha256: "changed-pdf-hash" });
    expect((await request(server.app).delete(`${path}/${general.body.id}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((await request(server.app).get(path).auth(gm, { type: "bearer" })).body).toHaveLength(1);
  });

  it("rejects broken quote geometry and malformed edits", async () => {
    const path = `/api/resources/${resourceId}/pdf-notes`;
    expect((await request(server.app).post(path).auth(gm, { type: "bearer" })
      .send({ body: "Oops", quote: "Text", anchors: [{ page: 1, rects: [{ x: 0.9, y: 0.2, w: 0.2, h: 0.1 }] }] })).status).toBe(400);
    expect((await request(server.app).post(path).auth(gm, { type: "bearer" })
      .send({ body: "Oops", quote: "Unanchored" })).status).toBe(400);
    expect((await request(server.app).put(`${path}/missing`).auth(gm, { type: "bearer" }).send({})).status).toBe(404);
  });

  it("stores each reader's view settings", async () => {
    const path = `/api/resources/${resourceId}/pdf-reader-preferences`;
    const initial = await request(server.app).get(path).auth(gm, { type: "bearer" });
    expect(initial.body).toEqual({ note_mode: "margins", notes_collapsed: false, show_highlights: true });
    const changed = { note_mode: "list", notes_collapsed: true, show_highlights: false };
    expect((await request(server.app).put(path).auth(gm, { type: "bearer" }).send(changed)).status).toBe(200);
    expect((await request(server.app).get(path).auth(gm, { type: "bearer" })).body).toEqual(changed);
    expect((await request(server.app).get(path).auth(otherGm, { type: "bearer" })).body).toEqual(initial.body);
    expect((await request(server.app).put(path).auth(gm, { type: "bearer" }).send({ ...changed, note_mode: "invalid" })).status).toBe(400);
  });

  it("keeps a private, linked Markdown resource synchronized and archives it with the PDF", async () => {
    const notesPath = `/api/resources/${resourceId}/pdf-notes`;
    const created = await request(server.app).post(notesPath).auth(gm, { type: "bearer" })
      .send({ body: "Новая **мысль**", quote: "Цитата PDF", anchors: anchor });
    expect(created.status).toBe(201);
    const document = db.prepare("SELECT * FROM pdf_note_documents WHERE pdf_resource_id = ? AND author_user_id = ?")
      .get(resourceId, Number(db.prepare("SELECT id FROM users WHERE username = 'pdf-notes-gm'").pluck().get())) as
      { markdown_resource_id: number; file_path: string };
    expect(document.file_path.endsWith(".notes.md")).toBe(true);
    const file = vaultAbs(document.file_path);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("> Цитата PDF\n\nНовая **мысль**");
    const child = (await request(server.app).get(`/api/resources/${document.markdown_resource_id}`).auth(gm, { type: "bearer" })).body;
    expect(child).toMatchObject({ type: "pdf_notes", category: "markdown", file_url: null, linked_pdf_resource_id: resourceId });
    expect((await request(server.app).get("/api/resources").auth(gm, { type: "bearer" })).body.some((r: { id: number }) => r.id === document.markdown_resource_id)).toBe(true);
    expect((await request(server.app).get("/api/resources").auth(otherGm, { type: "bearer" })).body.some((r: { id: number }) => r.id === document.markdown_resource_id)).toBe(false);
    expect((await request(server.app).get("/api/search?q=заметки.md&types=resource").auth(otherGm, { type: "bearer" })).body.some((r: { id: number }) => r.id === document.markdown_resource_id)).toBe(false);
    expect((await request(server.app).get(`/api/resources/${document.markdown_resource_id}`).auth(otherGm, { type: "bearer" })).status).toBe(404);
    expect((await request(server.app).get(`/api/resources/${document.markdown_resource_id}/markdown-content`).auth(otherGm, { type: "bearer" })).status).toBe(404);
    const content = await request(server.app).get(`/api/resources/${document.markdown_resource_id}/markdown-content`).auth(gm, { type: "bearer" });
    expect(content.status).toBe(200);
    expect(content.body.content).toContain("Новая **мысль**");
    expect((await request(server.app).get(`/api/resources/${document.markdown_resource_id}/markdown-download`).auth(gm, { type: "bearer" })).headers["content-disposition"]).toContain("attachment");
    const fileUrl = "/files/" + vaultRel(file).split(path.sep).map(encodeURIComponent).join("/");
    expect((await request(server.app).get(fileUrl).auth(gm, { type: "bearer" })).status).toBe(404);
    expect((await request(server.app).get(`/api/files/raw/${document.markdown_resource_id}`).auth(gm, { type: "bearer" })).status).toBe(404);
    const backupPath = path.join(os.tmpdir(), `soyman-pdf-notes-${Date.now()}.zip`);
    try {
      const backup = await request(server.app).post("/api/backup").auth(gm, { type: "bearer" }).send({ filePath: backupPath });
      expect(backup.status, JSON.stringify(backup.body)).toBe(200);
      const entries = new AdmZip(backupPath).getEntries().map(entry => entry.entryName);
      expect(entries).toContain("app.db");
      expect(entries).toContain(`RPG-Vault/${vaultRel(file).split(path.sep).join("/")}`);
    } finally {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    }
    expect((await request(server.app).put(`/api/resources/${document.markdown_resource_id}`).auth(gm, { type: "bearer" }).send({ name: "changed" })).status).toBe(409);
    expect((await request(server.app).put(`/api/resources/${resourceId}`).auth(gm, { type: "bearer" }).send({ name: "Переименованная книга" })).status).toBe(200);
    expect((db.prepare("SELECT name FROM resources WHERE id = ?").get(document.markdown_resource_id) as { name: string }).name).toBe("Переименованная книга — заметки.md");
    expect(fs.readFileSync(file, "utf8")).toContain("# Заметки к «Переименованная книга»");
    await request(server.app).put(`${notesPath}/${created.body.id}`).auth(gm, { type: "bearer" }).send({ body: "Изменённый текст" });
    expect(fs.readFileSync(file, "utf8")).toContain("Изменённый текст");
    expect(fs.readFileSync(file, "utf8")).not.toContain("Новая **мысль**");
    await request(server.app).delete(`${notesPath}/${created.body.id}`).auth(gm, { type: "bearer" });
    expect(fs.readFileSync(file, "utf8")).not.toContain("Изменённый текст");
    fs.unlinkSync(file);
    expect((await request(server.app).get(`/api/resources/${document.markdown_resource_id}/markdown-content`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect(fs.existsSync(file)).toBe(true);
    expect((await request(server.app).delete(`/api/resources/${resourceId}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((db.prepare("SELECT archived_at FROM resources WHERE id = ?").get(document.markdown_resource_id) as { archived_at: string | null }).archived_at).not.toBeNull();
    expect((await request(server.app).put(`/api/resources/${resourceId}/restore`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect((db.prepare("SELECT archived_at FROM resources WHERE id = ?").get(document.markdown_resource_id) as { archived_at: string | null }).archived_at).toBeNull();
    await request(server.app).delete(`/api/resources/${resourceId}`).auth(gm, { type: "bearer" });
    expect((await request(server.app).delete(`/api/archive/resource/${resourceId}`).auth(gm, { type: "bearer" })).status).toBe(200);
    expect(db.prepare("SELECT 1 FROM resources WHERE id = ?").get(document.markdown_resource_id)).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });
});
