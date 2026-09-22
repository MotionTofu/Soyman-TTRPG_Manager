// Portable HTML import в основной SoyMan (фаза B2.1).
// Настоящий playerRouter на временной базе из src/test/setupTempDb.ts.
// Один формат на два продукта: файл собран вручную по контракту, без
// зависимости тестов сервера от SoyMan_1shot.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { playerRouter } from "./player";
import { vaultAbs } from "../services/filesystem";

let app: express.Express;
let playerId = 0;

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const content = {
  characterName: "Мордекай",
  classes: [],
  abilities,
  hitPointsCurrent: "3",
  notes: "smoke-note",
};

function doc(payload: unknown): string {
  return `<!doctype html><html><body><script id="oneshot-payload" type="application/json">${JSON.stringify(payload).replaceAll("<", "\\u003c")}</script></body></html>`;
}

const v2 = (uid = "test-uid-1", overrides: Record<string, unknown> = {}) => ({
  format: "soyman-1shot-portable",
  version: 2,
  exportedAt: "2026-09-21T00:00:00.000Z",
  identity: { characterUid: uid },
  character: {
    name: "Мордекай",
    content,
    portrait: "data:image/png;base64,iVBORw0KGgo=",
  },
  catalog: { system: { name: "No Such System" }, sections: [], entries: [] },
  ...overrides,
});

beforeAll(() => {
  const userId = Number(
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('игрок-портабл', 'x', 'player')").run()
      .lastInsertRowid
  );
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Тестовый игрок')").run().lastInsertRowid);
  db.prepare("UPDATE users SET player_id = ? WHERE id = ?").run(playerId, userId);
  app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    if ((req.headers as Record<string, string>)["x-test-user"] === "player") {
      req["user"] = { id: userId, role: "player", playerId };
    }
    next();
  });
  app.use("/api/player", playerRouter);
});

const player = { "x-test-user": "player" };
const characterCount = () => (db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;

describe("portable import в основной SoyMan", () => {
  it("v2 создаёт нового персонажа с листом, UID и портретом", async () => {
    const before = characterCount();
    const res = await request(app).post("/api/player/characters/import/portable").set(player).send({ html: doc(v2()) });
    expect(res.status).toBe(201);
    expect(res.body.character_name).toBe("Мордекай");
    expect(res.body.character_uid).toBe("test-uid-1");
    expect(res.body.campaign_id).toBeNull();
    expect(res.body.player_id).toBe(playerId);
    expect(characterCount()).toBe(before + 1);
    const sheet = db
      .prepare("SELECT content FROM statblocks WHERE owner_type = 'character' AND owner_id = ? AND format = 'dnd_character'")
      .get(res.body.id) as { content: string };
    const data = JSON.parse(sheet.content) as { hitPointsCurrent: string; notes: string; characterName: string };
    expect(data.hitPointsCurrent).toBe("3");
    expect(data.notes).toBe("smoke-note");
    expect(data.characterName).toBe("Мордекай");
    expect(String(res.body.avatar_image_path)).toMatch(/avatar\.png$/);
    expect(fs.existsSync(vaultAbs(String(res.body.avatar_image_path)))).toBe(true);
  });

  it("повторный импорт того же v2 спрашивает решение, а не дублирует молча", async () => {
    const before = characterCount();
    const first = await request(app).post("/api/player/characters/import/portable").set(player).send({ html: doc(v2("test-uid-2")) });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/player/characters/import/portable").set(player).send({ html: doc(v2("test-uid-2")) });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("portable-character-exists");
    expect(second.body.match).toMatchObject({ id: first.body.id });
    expect(characterCount()).toBe(before + 1);
    const copy = await request(app)
      .post("/api/player/characters/import/portable")
      .set(player)
      .send({ html: doc(v2("test-uid-2")), action: "copy" });
    expect(copy.status).toBe(201);
    expect(copy.body.id).not.toBe(first.body.id);
    expect(copy.body.character_uid).not.toBe("test-uid-2");
    expect(characterCount()).toBe(before + 2);
  });

  it("v1 получает свежий UID", async () => {
    const { identity: _dropped, ...rest } = v2();
    const payload = { ...rest, version: 1 };
    const res = await request(app).post("/api/player/characters/import/portable").set(player).send({ html: doc(payload) });
    expect(res.status).toBe(201);
    expect(typeof res.body.character_uid).toBe("string");
    expect(res.body.character_uid).not.toBe("test-uid-1");
    expect(res.body.character_uid.length).toBeGreaterThan(0);
  });

  it("чужой HTML отвергается без записи", async () => {
    const before = characterCount();
    const res = await request(app).post("/api/player/characters/import/portable").set(player).send({ html: "<html><body>nope</body></html>" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Это не файл персонажа SoyMan.");
    expect(characterCount()).toBe(before);
    const broken = await request(app)
      .post("/api/player/characters/import/portable")
      .set(player)
      .send({ html: doc({ format: "soyman-1shot-portable", version: 99 }) });
    expect(broken.status).toBe(422);
    expect(characterCount()).toBe(before);
  });
});
