import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../db/db";
import { VAULT_ROOT, vaultAbs } from "../services/filesystem";
import { settingBeingsRouter } from "./settingBeings";
import { settingCommunitiesRouter } from "./settingCommunities";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+pS8AAAAASUVORK5CYII=", "base64");
const app = express();
app.use("/beings", settingBeingsRouter);
app.use("/communities", settingCommunitiesRouter);
app.get("/ping", (_req, res) => res.json({ ok: true }));
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "upload failed" });
});
const settingId = Number(db.prepare("INSERT INTO settings(name, folder_path) VALUES ('Вотердип', 'Settings/Вотердип')").run().lastInsertRowid);

describe.each([
  ["beings", "setting_beings", "Population"],
  ["communities", "setting_communities", path.join("Population", "Communities")],
] as const)("%s image upload", (route, table, folder) => {
  it.each(["avatar", "thumbnail"] as const)("creates a missing folder for %s and reuses it on replacement", async (kind) => {
    const id = Number(db.prepare(`INSERT INTO ${table}(name, setting_id) VALUES (?, ?)`)
      .run(`${route}-${kind}`, settingId).lastInsertRowid);
    const upload = () => request(app).post(`/${route}/${id}/${kind}`)
      .attach("file", PNG, { filename: "portrait.png", contentType: "image/png" });
    const first = await upload();
    expect(first.status).toBe(200);
    const saved = db.prepare(`SELECT folder_path, ${kind}_image_path AS image FROM ${table} WHERE id=?`).get(id) as { folder_path: string; image: string };
    expect(saved.folder_path).toBe(path.join("Settings", "Вотердип", folder, `${route}-${kind}`));
    expect(fs.existsSync(vaultAbs(saved.image))).toBe(true);
    expect(first.body[`${kind}_image_url`]).toContain("/files/Settings/");
    expect((await upload()).status).toBe(200);
    expect(db.prepare(`SELECT folder_path FROM ${table} WHERE id=?`).get(id)).toEqual({ folder_path: saved.folder_path });
  });

  it.each(["avatar", "thumbnail"] as const)("forwards a failed %s write and keeps serving requests", async (kind) => {
    const blocked = path.join(VAULT_ROOT, `${route}-${kind}-blocked`);
    fs.writeFileSync(blocked, "This is a file, not a folder");
    const id = Number(db.prepare(`INSERT INTO ${table}(name, setting_id, folder_path) VALUES ('Blocked', ?, ?)`)
      .run(settingId, blocked).lastInsertRowid);
    const result = await request(app).post(`/${route}/${id}/${kind}`)
      .attach("file", PNG, { filename: "portrait.png", contentType: "image/png" });
    expect(result.status).toBe(500);
    expect((await request(app).get("/ping")).body).toEqual({ ok: true });
    expect(db.prepare(`SELECT ${kind}_image_path AS image FROM ${table} WHERE id=?`).get(id)).toEqual({ image: null });
  });
});
