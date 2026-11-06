import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { statblocksRouter } from "./statblocks";

const app = express();
app.use(express.json());
app.use("/statblocks", statblocksRouter);

describe("GET /statblocks?owner_ids=", () => {
  it("returns live statblocks of several compendium entries in one request", async () => {
    const insert = db.prepare("INSERT INTO statblocks (owner_type, owner_id, kind, format, content) VALUES (?, ?, 'full', 'litm_challenge', ?)");
    const a = Number(insert.run("compendium_entry", 990001, "{\"title\":\"A\"}").lastInsertRowid);
    const b = Number(insert.run("compendium_entry", 990002, "{\"title\":\"B\"}").lastInsertRowid);
    const archived = Number(insert.run("compendium_entry", 990002, "{}").lastInsertRowid);
    const other = Number(insert.run("character", 990001, "{}").lastInsertRowid);
    db.prepare("UPDATE statblocks SET archived_at = datetime('now') WHERE id = ?").run(archived);
    try {
      const res = await request(app).get("/statblocks?owner_type=compendium_entry&owner_ids=990001,990002,abc");
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: number }) => r.id)).toEqual([a, b]);
      expect((await request(app).get("/statblocks?owner_type=compendium_entry&owner_ids=")).body).toEqual([]);
      expect((await request(app).get("/statblocks?owner_type=character&owner_ids=990001")).status).toBe(400);
    } finally {
      db.prepare("DELETE FROM statblocks WHERE id IN (?, ?, ?, ?)").run(a, b, archived, other);
    }
  });
});
