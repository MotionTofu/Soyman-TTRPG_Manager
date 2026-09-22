// Read-only character shares for the GM (phase D2.1): publish, capability
// read, isolation, update, revoke. Настоящие роутеры на временной базе.
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { syncRouter } from "./sync";
import { sharesRouter, sharePublicRouter } from "./shares";
import { catalogArtifactHash, portraitArtifactHash } from "./sync-artifacts";

let app: express.Express;
let tokenA = "";

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const SLICE = {
  system: { name: "D&D 5.5", code: "dnd55" },
  sections: [{ id: 1, kind: "traits", name: "S1" }],
  entries: [{ id: 3, section_id: 1, kind: "feature", name: "Trait A", position: 0, data: {} }],
};
const PORTRAIT = "data:image/png;base64,iVBORw0KGgo=";
const CATALOG_HASH = catalogArtifactHash(SLICE);
const PORTRAIT_HASH = portraitArtifactHash(PORTRAIT);
const doc = (uid: string, hp: string) => ({
  format: "soyman-sync-character",
  version: 2,
  characterUid: uid,
  character: {
    name: "Мордекай",
    content: { characterName: "Мордекай", classes: [], abilities, hitPointsCurrent: hp },
    archivedAt: null,
  },
  artifacts: { catalogHash: CATALOG_HASH, portraitHash: PORTRAIT_HASH },
});

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api/sync", syncRouter);
  app.use("/api/sync/shares", sharesRouter);
  app.use("/api/public", sharePublicRouter);
  const space = (await request(app).post("/api/sync/spaces").send({})).body as { deviceToken: string };
  tokenA = space.deviceToken;
  const auth = { Authorization: `Bearer ${tokenA}` };
  await request(app).put(`/api/sync/artifacts/${CATALOG_HASH}`).set(auth).send({ kind: "catalog", payload: SLICE });
  await request(app).put(`/api/sync/artifacts/${PORTRAIT_HASH}`).set(auth).send({ kind: "portrait", payload: PORTRAIT });
});

const authA = () => ({ Authorization: `Bearer ${tokenA}` });

describe("character shares", () => {
  it("publish issues a token; anonymous GET reads the snapshot", async () => {
    const created = await request(app).post("/api/sync/shares").set(authA()).send({
      characterUid: "share-uid-1",
      payload: doc("share-uid-1", "18"),
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.shareToken).toBe("string");
    expect(created.body.shareToken.length).toBeGreaterThan(40);
    expect(created.body).toMatchObject({ characterUid: "share-uid-1" });
    const token = created.body.shareToken as string;
    const read = await request(app).get(`/api/public/character-share/${token}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      format: "soyman-character-share",
      version: 1,
      characterUid: "share-uid-1",
    });
    expect(read.body.character.name).toBe("Мордекай");
    expect(read.body.character.content.hitPointsCurrent).toBe("18");
    expect(read.body.portrait).toBe(PORTRAIT);
    expect(read.body.catalog.entries).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_shares").get()).toMatchObject({ n: 1 });
  });

  it("isolation: one snapshot only, no space access, no second share", async () => {
    const list = await request(app).get("/api/sync/shares").set(authA());
    const token = (
      await request(app).post("/api/sync/shares").set(authA()).send({
        characterUid: "share-uid-iso",
        payload: doc("share-uid-iso", "10"),
      })
    ).body.shareToken as string;
    expect(list.body.some((e: { characterUid: string }) => e.characterUid === "share-uid-1")).toBe(true);
    // The token reads exactly its own character, nothing else.
    const read = await request(app).get(`/api/public/character-share/${token}`);
    expect(read.status).toBe(200);
    expect(read.body.characterUid).toBe("share-uid-iso");
    expect(read.body.characterUid).not.toBe("share-uid-1");
    expect(read.body.spaceId).toBeUndefined();
    expect(read.body.characters).toBeUndefined();
    // Garbage token and capability misuse stay out.
    expect((await request(app).get("/api/public/character-share/not-a-real-token-aaa")).status).toBe(404);
    expect((await request(app).get("/api/sync/characters").set({ Authorization: `Bearer ${token}` })).status).toBe(401);
    // Second active share for the same character is refused.
    const dup = await request(app).post("/api/sync/shares").set(authA()).send({
      characterUid: "share-uid-iso",
      payload: doc("share-uid-iso", "10"),
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("share-exists");
  });

  it("update keeps the token; revoke invalidates the URL", async () => {
    const created = await request(app).post("/api/sync/shares").set(authA()).send({
      characterUid: "share-uid-2",
      payload: doc("share-uid-2", "18"),
    });
    const token = created.body.shareToken as string;
    const updated = await request(app).put("/api/sync/shares/share-uid-2").set(authA()).send({
      payload: doc("share-uid-2", "12"),
    });
    expect(updated.status).toBe(200);
    const reread = await request(app).get(`/api/public/character-share/${token}`);
    expect(reread.status).toBe(200);
    expect(reread.body.character.content.hitPointsCurrent).toBe("12");
    const revoked = await request(app).delete("/api/sync/shares/share-uid-2").set(authA());
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ deleted: true });
    expect((await request(app).get(`/api/public/character-share/${token}`)).status).toBe(404);
    const list = await request(app).get("/api/sync/shares").set(authA());
    expect(list.body.some((e: { characterUid: string }) => e.characterUid === "share-uid-2")).toBe(false);
    // Re-sharing after revoke mints a fresh token.
    const recreated = await request(app).post("/api/sync/shares").set(authA()).send({
      characterUid: "share-uid-2",
      payload: doc("share-uid-2", "12"),
    });
    expect(recreated.status).toBe(201);
    expect(recreated.body.shareToken).not.toBe(token);
  });
});
