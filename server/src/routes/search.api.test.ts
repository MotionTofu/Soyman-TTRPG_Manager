import express from "express";
import fs from "node:fs";
import request from "supertest";
import { beforeAll, expect, it } from "vitest";
import { makeSearchFixture } from "../test/searchFixture";
import type { AuthedRequest } from "../services/auth";

let app: express.Express;
let fixture: ReturnType<typeof makeSearchFixture>;

beforeAll(async () => {
  const { db } = await import("../db/db");
  const { VAULT_ROOT } = await import("../services/filesystem");
  const { searchRouter } = await import("./search");
  fixture = makeSearchFixture(db, VAULT_ROOT);
  app = express();
  app.use((req: AuthedRequest, _res, next) => {
    req.user = { id: 1, username: "search-test", role: "gm", playerId: null };
    next();
  });
  app.use("/search", searchRouter);
});

it("returns the effective scene once with individually addressed text matches", async () => {
  const search = (q: string, scope: object = {}) =>
    request(app).get("/search").query({ q, panel: 1, types: "scene", ...scope }).expect(200);
  const scoped = await search("печать", { campaign_id: fixture.campaign });
  expect(scoped.body).toHaveLength(1);
  expect(scoped.body[0]).toMatchObject({
    id: fixture.scene, campaign_id: fixture.campaign, match_count: 2,
    fragments: [
      { match: "печать", target: { field: "read_aloud", occurrence: 0 } },
      { match: "печать", target: { field: "outcomes", occurrence: 0 } },
    ],
  });
  expect((await search("старая печать", { campaign_id: fixture.campaign })).body).toEqual([]);
  expect((await search("печать", { setting_id: fixture.setting })).body.map((row: { id: number }) => row.id)).toEqual([fixture.original]);
  expect((await search("маяк", { campaign_id: fixture.campaign })).body).toEqual([]);
  expect((await search("маяк")).body[0].id).toBe(fixture.distantScene);
});

it("finds both a setting creature and a system bestiary entry from the same campaign", async () => {
  const response = await request(app).get("/search").query({
    q: "гоблин", campaign_id: fixture.campaign, types: "being,compendium_entry", kind: "monster",
  }).expect(200);
  expect(response.body).toMatchObject([
    { type: "being", id: fixture.being },
    { type: "compendium_entry", id: fixture.monster },
  ]);
  const adventure = await request(app).get("/search").query({
    q: "ворота", campaign_id: fixture.campaign, types: "adventure",
  }).expect(200);
  expect(adventure.body).toMatchObject([{ type: "adventure", id: fixture.arc }]);
  const sections = await request(app).get("/search/sections").query({ system_id: fixture.system }).expect(200);
  expect(sections.body).toMatchObject([{ name: "Бестиарий", system_id: fixture.system }]);
});

it("searches only body text, groups PDF page hits and labels Markdown sections", async () => {
  const search = (q: string, filters: object = {}) =>
    request(app).get("/search").query({ q, book_text: 1, ...filters }).expect(200);
  const all = await search("SIGNET STAMP");
  expect(all.body).toMatchObject([
    { id: fixture.pdf, book_format: "pdf", match_count: 2, fragments: [
      { target: { page: 2, occurrence: 0 }, match: "signet stamp" },
      { target: { page: 2, occurrence: 1 }, match: "signet stamp" },
    ] },
    { id: fixture.md, book_format: "md", match_count: 2, fragments: [
      { label: "Проверка пропуска", target: { occurrence: 0 } },
      { label: "После проверки", target: { occurrence: 1 } },
    ] },
  ]);
  expect((await search("signet stamp", { format: "pdf" })).body).toMatchObject([{ id: fixture.pdf }]);
  expect((await search("signet stamp", { format: "md" })).body).toMatchObject([{ id: fixture.md }]);
  expect((await search("signet stamp", { campaign_id: fixture.campaign })).body).toMatchObject([{ id: fixture.md }]);
  fs.writeFileSync(fixture.mdPath, "# Исправлено\n\nНовый пропуск (§4).");
  expect((await search("signet stamp", { format: "md" })).body).toEqual([]);
  expect((await search("(§4)", { format: "md" })).body).toMatchObject([
    { id: fixture.md, fragments: [{ match: "(§4)" }] },
  ]);
});
