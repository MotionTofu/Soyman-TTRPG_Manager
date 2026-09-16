import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "../db/db";
import { hashPassword } from "../services/auth";

// «Не выходить на этом компьютере»: с галочкой пропуск бессрочный, без неё —
// недельный, как раньше. Временную базу заводит src/test/setupTempDb.ts.
let server: typeof import("../index");

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('remember-gm', ?, 'gm')")
    .run(await hashPassword("test-only"));
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
});

async function login(body: Record<string, unknown>) {
  const res = await request(server.app).post("/api/auth/login").send({ username: "remember-gm", password: "test-only", ...body });
  expect(res.status).toBe(200);
  return res.body.token as string;
}
const exp = (token: string) => (jwt.decode(token) as { exp?: number; iat: number });

describe("вход с «не выходить»", () => {
  it("без галочки пропуск живёт 7 дней", async () => {
    const payload = exp(await login({}));
    expect(payload.exp! - payload.iat).toBe(7 * 24 * 3600);
  });

  it("с галочкой пропуск не истекает и пускает в приложение", async () => {
    const token = await login({ remember: true });
    expect(exp(token).exp).toBeUndefined();
    expect((await request(server.app).get("/api/auth/me").auth(token, { type: "bearer" })).status).toBe(200);
  });

  it("смена логина в Кабинете сохраняет бессрочность", async () => {
    const token = await login({ remember: true });
    const res = await request(server.app).put("/api/auth/me").auth(token, { type: "bearer" })
      .send({ currentPassword: "test-only", username: "remember-gm" });
    expect(res.status).toBe(200);
    expect(exp(res.body.token).exp).toBeUndefined();
  });

  it("смена пароля отзывает бессрочный пропуск", async () => {
    const token = await login({ remember: true });
    const res = await request(server.app).put("/api/auth/me").auth(token, { type: "bearer" })
      .send({ currentPassword: "test-only", password: "test-only-2" });
    expect(res.status).toBe(200);
    expect((await request(server.app).get("/api/auth/me").auth(token, { type: "bearer" })).status).toBe(401);
  });
});
