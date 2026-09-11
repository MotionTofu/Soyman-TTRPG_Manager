// Журнал медленных запросов и ошибок клиента (docs/adr/0001, п. 6).
// Настоящий роутер на временной базе из src/test/setupTempDb.ts.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { clientJournalRouter, trimJournal } from "./clientJournal";

let app: express.Express;
let gmId = 0;
let playerUserId = 0;

beforeAll(() => {
  gmId = Number(
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('мастер-журнал', 'x', 'gm')").run().lastInsertRowid
  );
  playerUserId = Number(
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('игрок-журнал', 'x', 'player')").run()
      .lastInsertRowid
  );
  app = express();
  app.use(express.json());
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const who = (req.headers as Record<string, string>)["x-test-user"];
    if (who === "gm") req["user"] = { id: gmId, role: "gm", playerId: null };
    if (who === "player") req["user"] = { id: playerUserId, role: "player", playerId: 1 };
    next();
  });
  app.use("/api/client-journal", clientJournalRouter);
});

const gm = { "x-test-user": "gm" };
const player = { "x-test-user": "player" };

describe("журнал клиента", () => {
  it("игрок пишет, но не читает", async () => {
    const post = await request(app)
      .post("/api/client-journal")
      .set(player)
      .send({ entries: [{ kind: "slow", screen: "/player", action: "GET /player/campaigns", durationMs: 1830, status: 200 }] });
    expect(post.status).toBe(201);
    expect(post.body.accepted).toBe(1);
    expect((await request(app).get("/api/client-journal").set(player)).status).toBe(403);
  });

  it("без входа нельзя ни писать, ни читать", async () => {
    expect((await request(app).post("/api/client-journal").send({ entries: [] })).status).toBe(401);
    expect((await request(app).get("/api/client-journal")).status).toBe(401);
  });

  it("мастер видит записи новыми сверху, с именем учётки", async () => {
    await request(app)
      .post("/api/client-journal")
      .set(gm)
      .send({ entries: [{ kind: "error", screen: "/beings/1", action: "PUT /setting-beings/1", status: 500, message: "boom" }] });
    const res = await request(app).get("/api/client-journal").set(gm);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ kind: "error", screen: "/beings/1", status: 500, message: "boom", username: "мастер-журнал" });
    expect(res.body[1]).toMatchObject({ kind: "slow", duration_ms: 1830, username: "игрок-журнал", role: "player" });
  });

  it("мусор отбрасывается, длинное обрезается, пачка ограничена", async () => {
    const long = "я".repeat(5000);
    const entries = [
      { kind: "nonsense", screen: "/x" },
      null,
      "строка",
      { kind: "error", screen: long, action: long, message: long, device: long, durationMs: 1e12, status: 99999 },
      ...Array.from({ length: 80 }, () => ({ kind: "slow", screen: "/пачка", durationMs: 1200 })),
    ];
    const res = await request(app).post("/api/client-journal").set(gm).send({ entries });
    expect(res.status).toBe(201);
    // Из первых 50: три мусорных отброшены, одна длинная и 46 «пачки» приняты.
    expect(res.body.accepted).toBe(47);
    const row = db
      .prepare("SELECT screen, action, message, device, duration_ms, status FROM client_journal WHERE kind='error' AND length(screen) > 100")
      .get() as Record<string, string | number>;
    expect(String(row.screen).length).toBe(200);
    expect(String(row.message).length).toBe(500);
    expect(String(row.device).length).toBe(120);
    expect(row.duration_ms).toBe(600_000);
    expect(row.status).toBe(999);
  });

  it("журнал срезается по числу строк и по возрасту", () => {
    db.prepare("INSERT INTO client_journal (kind, created_at) VALUES ('slow', datetime('now', '-40 days'))").run();
    trimJournal(10, 30);
    const left = db.prepare("SELECT count(*) AS n, min(created_at) AS oldest FROM client_journal").get() as {
      n: number;
      oldest: string;
    };
    expect(left.n).toBe(10);
    expect(new Date(left.oldest.replace(" ", "T") + "Z").getTime()).toBeGreaterThan(Date.now() - 31 * 86400_000);
  });

  it("мастер чистит журнал", async () => {
    expect((await request(app).delete("/api/client-journal").set(player)).status).toBe(403);
    const res = await request(app).delete("/api/client-journal").set(gm);
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM client_journal").get()).toEqual({ n: 0 });
  });
});
