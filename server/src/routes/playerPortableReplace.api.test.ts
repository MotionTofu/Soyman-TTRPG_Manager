// Portable identity-aware import (фаза B2.2): decision, replace, copy.
// Настоящий playerRouter на временной базе из src/test/setupTempDb.ts.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import { db } from "../db/db";
import { playerRouter } from "./player";
import { vaultAbs } from "../services/filesystem";

let app: express.Express;
let playerId = 0;
let otherPlayerId = 0;

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const content = (overrides: Record<string, unknown> = {}) => ({
  characterName: "Мордекай",
  classes: [],
  abilities,
  hitPointsCurrent: "21",
  ...overrides,
});

function doc(payload: unknown): string {
  return `<!doctype html><html><body><script id="oneshot-payload" type="application/json">${JSON.stringify(payload).replaceAll("<", "\\u003c")}</script></body></html>`;
}

const v2 = (uid: string, overrides: Record<string, unknown> = {}) => ({
  format: "soyman-1shot-portable",
  version: 2,
  exportedAt: "2026-09-21T00:00:00.000Z",
  identity: { characterUid: uid },
  character: { name: "Мордекай", content: content(), portrait: "data:image/png;base64,iVBORw0KGgo=" },
  catalog: { system: { name: "No Such System" }, sections: [], entries: [] },
  ...overrides,
});

beforeAll(() => {
  const mkUser = (username: string) =>
    Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'x', 'player')").run(username).lastInsertRowid);
  const userId = mkUser("игрок-замена");
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Владелец')").run().lastInsertRowid);
  db.prepare("UPDATE users SET player_id = ? WHERE id = ?").run(playerId, userId);
  const otherUserId = mkUser("игрок-чужой");
  otherPlayerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Чужой')").run().lastInsertRowid);
  db.prepare("UPDATE users SET player_id = ? WHERE id = ?").run(otherPlayerId, otherUserId);
  app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const who = (req.headers as Record<string, string>)["x-test-user"];
    if (who === "owner") req["user"] = { id: userId, role: "player", playerId };
    if (who === "other") req["user"] = { id: otherUserId, role: "player", playerId: otherPlayerId };
    next();
  });
  app.use("/api/player", playerRouter);
});

const owner = { "x-test-user": "owner" };
const other = { "x-test-user": "other" };
const characterCount = () => (db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;

async function importAs(headers: Record<string, string>, payload: unknown, extra: Record<string, unknown> = {}) {
  return request(app).post("/api/player/characters/import/portable").set(headers).send({ html: doc(payload), ...extra });
}

describe("portable decision и replace", () => {
  it("match не пишет ничего: 409 + DB и файлы нетронуты", async () => {
    const created = await importAs(owner, v2("uid-decide"));
    expect(created.status).toBe(201);
    const before = characterCount();
    const avatar = String(created.body.avatar_image_path);
    const decision = await importAs(owner, v2("uid-decide"));
    expect(decision.status).toBe(409);
    expect(decision.body.code).toBe("portable-character-exists");
    expect(decision.body.match).toMatchObject({ id: created.body.id });
    expect(characterCount()).toBe(before);
    expect(fs.existsSync(vaultAbs(avatar))).toBe(true);
    const row = db.prepare("SELECT character_name, avatar_image_path FROM characters WHERE id = ?").get(created.body.id);
    expect(row).toMatchObject({ character_name: "Мордекай", avatar_image_path: avatar });
  });

  it("replace меняет имя/лист/портрет, хранит id/UID/владельца/кампанию", async () => {
    const created = await importAs(owner, v2("uid-replace"));
    expect(created.status).toBe(201);
    const campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Кампания X')").run().lastInsertRowid);
    db.prepare("UPDATE characters SET campaign_id = ? WHERE id = ?").run(campaignId, created.body.id);
    const oldAvatar = String(created.body.avatar_image_path);
    expect(oldAvatar).toMatch(/avatar\.png$/);
    const file = v2("uid-replace", {
      character: {
        name: "Мордекай Обновлённый",
        content: content({ characterName: "Мордекай Обновлённый", hitPointsCurrent: "9" }),
        portrait: "data:image/jpeg;base64,/9j/2Q==",
      },
    });
    const replaced = await importAs(owner, file, { action: "replace", targetCharacterId: created.body.id });
    expect(replaced.status).toBe(200);
    expect(replaced.body.id).toBe(created.body.id);
    expect(replaced.body.character_uid).toBe("uid-replace");
    expect(replaced.body.player_id).toBe(playerId);
    expect(replaced.body.campaign_id).toBe(campaignId);
    expect(replaced.body.character_name).toBe("Мордекай Обновлённый");
    expect(String(replaced.body.avatar_image_path)).toMatch(/avatar\.jpg$/);
    expect(fs.existsSync(vaultAbs(String(replaced.body.avatar_image_path)))).toBe(true);
    expect(fs.existsSync(vaultAbs(oldAvatar))).toBe(false);
    const sheet = db
      .prepare("SELECT content FROM statblocks WHERE owner_type = 'character' AND owner_id = ? AND format = 'dnd_character'")
      .get(created.body.id) as { content: string };
    expect((JSON.parse(sheet.content) as { hitPointsCurrent: string }).hitPointsCurrent).toBe("9");
  });

  it("copy создаёт независимого персонажа вне кампании, оригинал цел", async () => {
    const created = await importAs(owner, v2("uid-copy"));
    expect(created.status).toBe(201);
    const copied = await importAs(owner, v2("uid-copy"), { action: "copy" });
    expect(copied.status).toBe(201);
    expect(copied.body.id).not.toBe(created.body.id);
    expect(copied.body.character_uid).not.toBe("uid-copy");
    expect(copied.body.campaign_id).toBeNull();
    expect(copied.body.player_id).toBe(playerId);
    const original = db.prepare("SELECT character_uid FROM characters WHERE id = ?").get(created.body.id) as {
      character_uid: string;
    };
    expect(original.character_uid).toBe("uid-copy");
  });

  it("чужой UID невидим; свой дубль даёт conflict и запрещает replace", async () => {
    const mine = await importAs(owner, v2("uid-scope"));
    expect(mine.status).toBe(201);
    const stranger = await importAs(other, v2("uid-scope"));
    expect(stranger.status).toBe(201);
    // Чужой тот же UID — для владельца всё равно один собственный match.
    const decision = await importAs(owner, v2("uid-scope"));
    expect(decision.status).toBe(409);
    expect(decision.body.code).toBe("portable-character-exists");
    expect(decision.body.match).toMatchObject({ id: mine.body.id });
    // Второй собственный UID-дубль (как из старых backup) — конфликт.
    const dupe = await importAs(owner, v2("uid-scope"), { action: "copy" });
    expect(dupe.status).toBe(201);
    db.prepare("UPDATE characters SET character_uid = ? WHERE id = ?").run("uid-scope", dupe.body.id);
    const conflict = await importAs(owner, v2("uid-scope"));
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("portable-character-identity-conflict");
    const forbidden = await importAs(owner, v2("uid-scope"), { action: "replace", targetCharacterId: mine.body.id });
    expect(forbidden.status).toBe(409);
    expect(forbidden.body.code).toBe("portable-character-identity-conflict");
  });

  it("stale target отказывает без изменений; null-портрет снимает аватар", async () => {
    const created = await importAs(owner, v2("uid-stale"));
    expect(created.status).toBe(201);
    const oldAvatar = String(created.body.avatar_image_path);
    db.prepare("UPDATE characters SET archived_at = datetime('now') WHERE id = ?").run(created.body.id);
    const stale = await importAs(owner, v2("uid-stale"), { action: "replace", targetCharacterId: created.body.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("Персонаж изменился после открытия окна импорта. Попробуйте импортировать файл ещё раз.");
    const row = db.prepare("SELECT character_name, avatar_image_path, archived_at FROM characters WHERE id = ?").get(
      created.body.id
    ) as { character_name: string; avatar_image_path: string; archived_at: string };
    expect(row.character_name).toBe("Мордекай");
    expect(row.avatar_image_path).toBe(oldAvatar);
    expect(fs.existsSync(vaultAbs(oldAvatar))).toBe(true);
    db.prepare("UPDATE characters SET archived_at = NULL WHERE id = ?").run(created.body.id);
    const noPortrait = v2("uid-stale", { character: { name: "Мордекай", content: content(), portrait: null } });
    const replaced = await importAs(owner, noPortrait, { action: "replace", targetCharacterId: created.body.id });
    expect(replaced.status).toBe(200);
    expect(replaced.body.avatar_image_path).toBeNull();
    expect(fs.existsSync(vaultAbs(oldAvatar))).toBe(false);
  });
});
