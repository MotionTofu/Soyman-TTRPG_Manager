// Паспорт кампании (спека campaign-paper, Q7/Q16): закрытый набор ключей и
// переезд «Препродакшена» в паспорт без потерь.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db, migratePreproductionToPassport } from "../db/db";
import { campaignsRouter } from "./campaigns";

let app: express.Express;
let campaignId = 0;

beforeAll(() => {
  campaignId = Number(db.prepare("INSERT INTO campaigns (name) VALUES ('Паспортная')").run().lastInsertRowid);
  app = express();
  app.use(express.json());
  app.use("/api/campaigns", campaignsRouter);
});

describe("паспорт кампании", () => {
  it("пишется по закрытому набору ключей, пустые и чужие отбрасываются", async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignId}/passport`)
      .send({ passport: { premise: " Город сокровищ ", promise: "", hack: "x", stakes: "Ренна ищет брата" } });
    expect(res.status).toBe(200);
    expect(res.body.passport).toEqual({ premise: "Город сокровищ", stakes: "Ренна ищет брата" });
    const got = await request(app).get(`/api/campaigns/${campaignId}`);
    expect(got.body.passport).toEqual({ premise: "Город сокровищ", stakes: "Ренна ищет брата" });
  });

  it("«Препродакшен» переезжает: дописывается ниже, длинное не режется, повтор не дублирует", () => {
    const long = "нить ".repeat(1000).trim();
    db.prepare(
      `INSERT INTO preproduction (campaign_id, adventure_challenge, gameplay_styles, background, adventure_stakes_hooks, threads_clues_lore)
       VALUES (?, 'Найти казну', 'налёты', '', 'Долг таверне', ?)`
    ).run(campaignId, long);
    migratePreproductionToPassport(db);
    migratePreproductionToPassport(db);
    const raw = (db.prepare("SELECT passport FROM campaigns WHERE id = ?").get(campaignId) as { passport: string }).passport;
    const passport = JSON.parse(raw) as Record<string, string>;
    expect(passport.promise).toBe("Найти казну");
    expect(passport.activity).toBe("налёты");
    expect(passport.tension).toBe(long);
    expect(passport.stakes).toBe("Ренна ищет брата\n\nДолг таверне");
    expect(passport.background).toBeUndefined();
  });
});
