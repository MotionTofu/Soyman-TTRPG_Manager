// Заметки игрока на листе (гриллинг 2026-09-28, шаг 4): к какой сессии
// встаёт заметка, что отдаёт колонка и что игрок может упомянуть.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { playerRouter } from "./player";
import { sheetNotes } from "../services/sheetNotes";

let app: express.Express;
let campaignId = 0;
let playerId = 0;
let charId = 0;
let settingId = 0;

function asPlayer(req: Record<string, unknown>, _res: unknown, next: () => void): void {
  req["user"] = { id: 8, role: "player", playerId, isAdmin: false, tokenVersion: 0 };
  next();
}

const session = (date: string, status: string, liveMode: string | null = null) =>
  Number(
    db
      .prepare("INSERT INTO sessions (campaign_id, date, status, live_mode) VALUES (?, ?, ?, ?)")
      .run(campaignId, date, status, liveMode).lastInsertRowid
  );

const note = async (description: string) => {
  const res = await request(app)
    .post(`/api/player/campaigns/${campaignId}/world-entries`)
    .send({ character_id: charId, kind: "", description, to_session: true });
  expect(res.status).toBe(201);
  return res.body as { id: number; session_id: number | null };
};

beforeAll(() => {
  playerId = Number(db.prepare("INSERT INTO players (name) VALUES ('Заметчик')").run().lastInsertRowid);
  settingId = Number(db.prepare("INSERT INTO settings (name) VALUES ('Мир заметок')").run().lastInsertRowid);
  campaignId = Number(
    db.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Кампания заметок', ?)").run(settingId).lastInsertRowid
  );
  db.prepare("INSERT INTO campaign_roster (campaign_id, player_id) VALUES (?, ?)").run(campaignId, playerId);
  charId = Number(
    db
      .prepare("INSERT INTO characters (player_id, campaign_id, character_name) VALUES (?, ?, 'Писарь')")
      .run(playerId, campaignId).lastInsertRowid
  );
  app = express();
  app.use(express.json());
  app.use("/api/player", asPlayer, playerRouter);
});

describe("заметки на листе", () => {
  it("встают к идущей, иначе к сегодняшней, иначе к последней проведённой; прогон не в счёт", async () => {
    const today = db.prepare("SELECT date('now', 'localtime') AS d").get() as { d: string };
    expect((await note("до всех сессий")).session_id).toBeNull();

    const held = session("2000-01-01", "held");
    expect((await note("после проведённой")).session_id).toBe(held);

    const planned = session(today.d, "planned");
    expect((await note("в день игры")).session_id).toBe(planned);

    session("2000-02-01", "planned", "rehearsal");
    expect((await note("во время чужого прогона")).session_id).toBe(planned);

    const live = session("2001-01-01", "planned", "live");
    expect((await note("на игре")).session_id).toBe(live);

    const col = sheetNotes(charId)!;
    expect(col.target?.id).toBe(live);
    expect(col.target?.live).toBe(true);
    // Без сессии запись в колонку не попадает: она — вкладки дневника.
    expect(col.entries.map((e) => e.description)).not.toContain("до всех сессий");
    expect(col.sessions.map((s) => s.id).sort()).toEqual([held, planned, live].sort());
  });

  it("игрок упоминает только выданное ему «глазом»", async () => {
    const hidden = Number(
      db.prepare("INSERT INTO setting_beings (setting_id, name, uid) VALUES (?, 'Тайный Мирт', lower(hex(randomblob(16))))").run(settingId)
        .lastInsertRowid
    );
    const shown = Number(
      db.prepare("INSERT INTO setting_beings (setting_id, name, uid) VALUES (?, 'Открытый Мирт', lower(hex(randomblob(16))))").run(settingId)
        .lastInsertRowid
    );
    db.prepare(
      "INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id) VALUES (?, ?, 'setting_being', ?)"
    ).run(campaignId, playerId, shown);

    const found = await request(app).get("/api/player/search?q=мирт");
    const names = (found.body as { title: string }[]).map((r) => r.title);
    expect(names).toContain("Открытый Мирт");
    expect(names).not.toContain("Тайный Мирт");

    expect((await request(app).get(`/api/player/mentions/token?type=being&id=${hidden}`)).status).toBe(404);
    const ok = await request(app).get(`/api/player/mentions/token?type=being&id=${shown}`);
    expect(ok.status).toBe(200);
    expect(ok.body.prefix).toBeTruthy();
  });

  it("«Проставить упоминания» в дневнике: только открытое, текст правится, граф Мастера не трогается", async () => {
    const sid = session("2002-01-01", "held", "live");
    const entry = await note("Тайный Мирт спорил, а Открытый Мирт молчал.");
    expect(entry.session_id).toBe(sid);

    const plan = await request(app).get(`/api/player/campaigns/${campaignId}/cross-links?session_id=${sid}`);
    expect(plan.status).toBe(200);
    const targets = (plan.body as { targetName: string }[]).map((p) => p.targetName);
    expect(targets).toEqual(["Открытый Мирт"]);

    const applied = await request(app)
      .post(`/api/player/campaigns/${campaignId}/cross-links?session_id=${sid}`)
      .send({ chosen: plan.body });
    expect(applied.body.written).toBe(1);
    const text = (db.prepare("SELECT description FROM world_exploration_entries WHERE id = ?").get(entry.id) as {
      description: string;
    }).description;
    expect(text).toMatch(/\[\[being@[0-9a-f]+\|[^|]*\|Открытый Мирт\]\]/);
    expect(text).toContain("Тайный Мирт спорил");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM generic_links WHERE from_type = 'world_entry'").get()
    ).toEqual({ n: 0 });

    // Чужая кампания — 404.
    expect((await request(app).get(`/api/player/campaigns/999999/cross-links?session_id=${sid}`)).status).toBe(404);
  });
});
