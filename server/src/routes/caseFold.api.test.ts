import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Встроенные lower() и LIKE у SQLite сводят регистр только у латиницы: «пров»
// не находил «Проверка». Поиск идёт через lower_u (db.ts) — эти проверки падают
// на прежних запросах.
let server: typeof import("../index");
let gm: string;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  const id = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('casefold-gm', 'test-only', 'gm')").run().lastInsertRowid);
  gm = signToken({ id, username: "casefold-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

describe("поиск без учёта регистра кириллицы", () => {
  it("Мастерение находит заголовок с заглавной буквы", async () => {
    db.prepare("INSERT INTO mastering_notes (category, title, content) VALUES ('prep', 'Проверка регистра', 'Текст')").run();
    const found = (await request(server.app).get("/api/mastering").query({ q: "пров" }).auth(gm, { type: "bearer" })).body as { title: string }[];
    expect(found.map((n) => n.title)).toContain("Проверка регистра");
    const byContent = (await request(server.app).get("/api/mastering").query({ q: "ТЕКСТ" }).auth(gm, { type: "bearer" })).body as { title: string }[];
    expect(byContent.map((n) => n.title)).toContain("Проверка регистра");
  });

  it("подсказка названия связи находит его с другим регистром", async () => {
    db.prepare("INSERT INTO entity_relations (from_type, from_id, to_type, to_id, label) VALUES ('being', 1, 'being', 2, 'Ненавидит')").run();
    const labels = (await request(server.app).get("/api/entity-relations/labels").query({ q: "нен" }).auth(gm, { type: "bearer" })).body as { label: string }[];
    expect(labels.map((l) => l.label)).toContain("Ненавидит");
  });
});
