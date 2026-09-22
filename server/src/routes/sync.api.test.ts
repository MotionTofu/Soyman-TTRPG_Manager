// Optional device sync foundation (phase D1.1): spaces, devices, pairings.
// Настоящий syncRouter на временной базе из src/test/setupTempDb.ts.
// Персонажи здесь не участвуют by design — только spaces/devices/pairings.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "crypto";
import { db } from "../db/db";
import { syncRouter } from "./sync";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api/sync", syncRouter);
});

const sha256 = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

async function createSpace() {
  const res = await request(app).post("/api/sync/spaces").send({});
  expect(res.status).toBe(201);
  return res.body as { spaceId: string; deviceId: string; deviceToken: string };
}

describe("sync spaces и devices", () => {
  it("create выдаёт credential, сервер хранит только hash", async () => {
    const { spaceId, deviceId, deviceToken } = await createSpace();
    expect(typeof spaceId).toBe("string");
    expect(deviceId).not.toBe(spaceId);
    expect(deviceToken.length).toBeGreaterThanOrEqual(40);
    const row = db
      .prepare("SELECT sync_space_id, token_hash FROM sync_devices WHERE id = ?")
      .get(deviceId) as { sync_space_id: string; token_hash: string };
    expect(row.sync_space_id).toBe(spaceId);
    expect(row.token_hash).toBe(sha256(deviceToken));
    expect(row.token_hash).not.toContain(deviceToken.slice(0, 8));
    const status = await request(app).get("/api/sync/status").set("Authorization", `Bearer ${deviceToken}`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ connected: true, spaceId, deviceId });
  });

  it("pair: второе устройство входит в тот же space со своим credential", async () => {
    const a = await createSpace();
    const pairing = await request(app)
      .post("/api/sync/pairings")
      .set("Authorization", `Bearer ${a.deviceToken}`)
      .send({});
    expect(pairing.status).toBe(201);
    expect(typeof pairing.body.pairingToken).toBe("string");
    const exchange = await request(app)
      .post("/api/sync/pair/exchange")
      .send({ pairingToken: pairing.body.pairingToken });
    expect(exchange.status).toBe(201);
    expect(exchange.body.spaceId).toBe(a.spaceId);
    expect(exchange.body.deviceId).not.toBe(a.deviceId);
    const both = await request(app).get("/api/sync/status").set("Authorization", `Bearer ${exchange.body.deviceToken}`);
    expect(both.status).toBe(200);
    expect(both.body).toMatchObject({ connected: true, spaceId: a.spaceId });
    const stillA = await request(app).get("/api/sync/status").set("Authorization", `Bearer ${a.deviceToken}`);
    expect(stillA.status).toBe(200);
  });

  it("single-use и expiry: повтор и просрочка отвергаются", async () => {
    const a = await createSpace();
    const auth = { Authorization: `Bearer ${a.deviceToken}` };
    const pairing = await request(app).post("/api/sync/pairings").set(auth).send({});
    const first = await request(app).post("/api/sync/pair/exchange").send({ pairingToken: pairing.body.pairingToken });
    expect(first.status).toBe(201);
    const reuse = await request(app).post("/api/sync/pair/exchange").send({ pairingToken: pairing.body.pairingToken });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toBe("Эта ссылка уже была использована.");
    const second = await request(app).post("/api/sync/pairings").set(auth).send({});
    db.prepare("UPDATE sync_pairings SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?").run(
      sha256(second.body.pairingToken)
    );
    const expired = await request(app).post("/api/sync/pair/exchange").send({ pairingToken: second.body.pairingToken });
    expect(expired.status).toBe(410);
    expect(expired.body.error).toBe("Ссылка для подключения устарела.");
    const garbage = await request(app).post("/api/sync/pair/exchange").send({ pairingToken: "nope-not-a-token" });
    expect(garbage.status).toBe(410);
  });

  it("изоляция: чужой и отозванный credential не авторизуют", async () => {
    const a = await createSpace();
    const b = await createSpace();
    expect(a.spaceId).not.toBe(b.spaceId);
    // Pairing всегда привязан к space создателя, а не вызывающего.
    const pairing = await request(app)
      .post("/api/sync/pairings")
      .set("Authorization", `Bearer ${a.deviceToken}`)
      .send({});
    const joined = await request(app).post("/api/sync/pair/exchange").send({ pairingToken: pairing.body.pairingToken });
    expect(joined.body.spaceId).toBe(a.spaceId);
    expect(joined.body.spaceId).not.toBe(b.spaceId);
    // Отзыв убивает credential везде.
    const bye = await request(app)
      .post("/api/sync/devices/disconnect")
      .set("Authorization", `Bearer ${a.deviceToken}`)
      .send({});
    expect(bye.status).toBe(200);
    expect((await request(app).get("/api/sync/status").set("Authorization", `Bearer ${a.deviceToken}`)).status).toBe(401);
    expect(
      (await request(app).post("/api/sync/pairings").set("Authorization", `Bearer ${a.deviceToken}`).send({})).status
    ).toBe(401);
    // Мусорный Bearer и его отсутствие — тоже 401.
    expect((await request(app).get("/api/sync/status").set("Authorization", "Bearer nope")).status).toBe(401);
    expect((await request(app).get("/api/sync/status")).status).toBe(401);
    // Устройство B своей изоляцией довольно.
    expect((await request(app).get("/api/sync/status").set("Authorization", `Bearer ${b.deviceToken}`)).status).toBe(200);
  });
});
