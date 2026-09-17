import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import path from "path";
import { db } from "../db/db";
import { signToken } from "../services/auth";

// Две находки про окна, которые не узнают друг о друге: персонаж, заведённый
// игроком, не доходил до открытого у Мастера профиля игрока, а применённая
// Тема Содружества — до открытого листа игрока. Обе закрываются событием
// персонажа, поэтому проверяем именно его отправку.
const broadcastCharacterUpdate = vi.fn();
vi.mock("../services/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/realtime")>();
  return { ...actual, broadcastCharacterUpdate: (...args: unknown[]) => broadcastCharacterUpdate(...args) };
});

let server: typeof import("../index");
let gm: string;
let player: string;
let campaignId = 0;
let playerId = 0;
let litmCharacterId = 0;

beforeAll(async () => {
  process.env.PORT = "0";
  server = await import("../index");
  await server.serverReady;

  const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  const gmUser = insert("INSERT INTO users (username, password_hash, role) VALUES ('signals-gm', 'test-only', 'gm')");
  gm = signToken({ id: gmUser, username: "signals-gm", role: "gm", playerId: null, isAdmin: false, tokenVersion: 0 });

  // Папка игрока нужна: без неё создание персонажа падает на построении пути.
  playerId = insert("INSERT INTO players (name, folder_path) VALUES ('Игрок сигналов', ?)", path.join("Players", "Игрок сигналов"));
  const playerUser = insert(
    "INSERT INTO users (username, password_hash, role, player_id) VALUES ('signals-player', 'test-only', 'player', ?)",
    playerId
  );
  player = signToken({ id: playerUser, username: "signals-player", role: "player", playerId, isAdmin: false, tokenVersion: 0 });

  campaignId = insert("INSERT INTO campaigns (name) VALUES ('Стол сигналов')");
  insert("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)", campaignId, playerId);
  litmCharacterId = insert(
    "INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Азура-проверка')",
    playerId,
    campaignId
  );
  insert(
    "INSERT INTO statblocks (owner_type, owner_id, kind, format, content) VALUES ('character', ?, 'full', 'litm_character', '{}')",
    litmCharacterId
  );
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => {
  broadcastCharacterUpdate.mockClear();
});

describe("сигналы между окном игрока и окном Мастера", () => {
  it("персонаж, созданный игроком, объявляется столу", async () => {
    const r = await request(server.app)
      .post("/api/player/characters")
      .auth(player, { type: "bearer" })
      .send({ character_name: "Проверка связи", campaign_id: campaignId });
    expect(r.status).toBe(201);
    expect(broadcastCharacterUpdate).toHaveBeenCalledWith(r.body.id);
  });

  it("Тема Содружества объявляется по каждому переписанному листу", async () => {
    const r = await request(server.app)
      .post(`/api/campaigns/${campaignId}/group-theme/apply`)
      .auth(gm, { type: "bearer" })
      .send({ theme: { title: "Содружество проверки" } });
    expect(r.status).toBe(200);
    expect(r.body.updatedCharacters).toBe(1);
    expect(broadcastCharacterUpdate).toHaveBeenCalledWith(litmCharacterId, "sheet");
    // Лист действительно переписан — сигнал не про пустое место.
    const content = (db.prepare("SELECT content FROM statblocks WHERE owner_id = ?").get(litmCharacterId) as { content: string }).content;
    expect(JSON.parse(content).fellowshipTheme).toEqual({ title: "Содружество проверки" });
  });

  it("в событии персонажа виден его игрок — по нему Мастер перечитывает профиль", async () => {
    const { characterUpdatePayload } = await vi.importActual<typeof import("../services/realtime")>("../services/realtime");
    expect(characterUpdatePayload(litmCharacterId, "card")).toEqual({
      characterId: litmCharacterId,
      scope: "card",
      playerId,
      campaignId,
    });
  });
});
