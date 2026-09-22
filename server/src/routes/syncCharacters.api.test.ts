// Character snapshots over sync (phases D1.2 + D1.3): CAS, tombstones,
// content-addressed artifacts, v2 refs, v1 grace reads.
// Настоящие роутеры на временной базе из src/test/setupTempDb.ts. Персонажи
// здесь — только snapshots/ревизии, без локальной логики 1shot.

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/db";
import { syncRouter } from "./sync";
import { canonicalCatalogSlice, catalogArtifactHash, portraitArtifactHash } from "./sync-artifacts";

let app: express.Express;
let tokenA = "";
let tokenB = "";

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
// Mirror vectors shared with SoyMan_1shot/tests/sync-artifacts.test.mjs:
// the same logical slice with shuffled keys and unsorted entries must hash
// the same on both sides.
const SHUFFLED_SLICE = {
  entries: [
    { name: "Trait B", section_id: 2, id: 7, kind: "feature", position: 1, data: { text: "b" } },
    { id: 3, section_id: 1, kind: "feature", name: "Trait A", position: 0, data: { text: "a" } },
  ],
  system: { name: "D&D 5.5", code: "dnd55" },
  sections: [{ name: "S2", id: 2, kind: "traits" }, { kind: "traits", id: 1, name: "S1" }],
};
const PORTRAIT = "data:image/png;base64,iVBORw0KGgo=";
const EXPECTED_CATALOG_HASH = "6737f312e658798bf80e395b35da0d16359ba558f12488804dddf38ae46f35cd";
const EXPECTED_PORTRAIT_HASH = "e1e10747c2374f621aa59fefede6ef99dc6acdb41b267ab4af408d5529f89ea8";
const CATALOG_HASH = catalogArtifactHash(SHUFFLED_SLICE);
const PORTRAIT_HASH = portraitArtifactHash(PORTRAIT);
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  format: "soyman-sync-character",
  version: 2,
  characterUid: "sync-uid-1",
  character: {
    name: "Мордекай",
    content: { characterName: "Мордекай", classes: [], abilities, hitPointsCurrent: "21" },
    archivedAt: null,
  },
  artifacts: { catalogHash: CATALOG_HASH, portraitHash: PORTRAIT_HASH },
  ...overrides,
});

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/api/sync", syncRouter);
  const space = (await request(app).post("/api/sync/spaces").send({})).body as {
    spaceId: string;
    deviceToken: string;
  };
  tokenA = space.deviceToken;
  const pairing = (
    await request(app).post("/api/sync/pairings").set("Authorization", `Bearer ${tokenA}`).send({})
  ).body as { pairingToken: string };
  const joined = (
    await request(app).post("/api/sync/pair/exchange").send({ pairingToken: pairing.pairingToken })
  ).body as { deviceToken: string };
  tokenB = joined.deviceToken;
  // Shared artifacts for the v2 snapshots below (uploaded once, referenced
  // by hash — the D1.3 push shape).
  expect(CATALOG_HASH).toBe(EXPECTED_CATALOG_HASH);
  expect(PORTRAIT_HASH).toBe(EXPECTED_PORTRAIT_HASH);
  const putCatalog = await request(app).put(`/api/sync/artifacts/${CATALOG_HASH}`).set(authA()).send({
    kind: "catalog",
    payload: SHUFFLED_SLICE,
  });
  expect(putCatalog.status).toBe(200);
  const putPortrait = await request(app).put(`/api/sync/artifacts/${PORTRAIT_HASH}`).set(authA()).send({
    kind: "portrait",
    payload: PORTRAIT,
  });
  expect(putPortrait.status).toBe(200);
});

const authA = () => ({ Authorization: `Bearer ${tokenA}` });
const authB = () => ({ Authorization: `Bearer ${tokenB}` });

describe("sync characters CAS", () => {
  it("create rev1, A update base1 -> rev2, B update base1 -> 409", async () => {
    const created = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 0,
      payload: snapshot(),
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ characterUid: "sync-uid-1", revision: 1, deleted: false });
    const updated = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 1,
      payload: snapshot(),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.revision).toBe(2);
    const stale = await request(app).put("/api/sync/characters/sync-uid-1").set(authB()).send({
      baseRevision: 1,
      payload: snapshot(),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("sync-conflict");
    expect(stale.body.currentRevision).toBe(2);
    const index = await request(app).get("/api/sync/characters").set(authA());
    expect(index.body).toMatchObject([{ characterUid: "sync-uid-1", revision: 2, deleted: false }]);
    const one = await request(app).get("/api/sync/characters/sync-uid-1").set(authB());
    expect(one.body.revision).toBe(2);
    expect(one.body.payload.character.content.hitPointsCurrent).toBe("21");
  });

  it("keep-local resolution retries on latest base; tombstone propagates", async () => {
    const retry = await request(app).put("/api/sync/characters/sync-uid-1").set(authB()).send({
      baseRevision: 2,
      payload: snapshot({ character: { name: "Мордекай", content: { characterName: "Мордекай", classes: [], abilities, hitPointsCurrent: "9" }, archivedAt: null } }),
    });
    expect(retry.status).toBe(200);
    expect(retry.body.revision).toBe(3);
    const tomb = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 3,
      deleted: true,
    });
    expect(tomb.status).toBe(200);
    expect(tomb.body).toMatchObject({ revision: 4, deleted: true });
    const index = await request(app).get("/api/sync/characters").set(authB());
    expect(index.body).toMatchObject([{ characterUid: "sync-uid-1", revision: 4, deleted: true }]);
    const one = await request(app).get("/api/sync/characters/sync-uid-1").set(authB());
    expect(one.body.deleted).toBe(true);
    // Last snapshot is kept on the tombstone for recovery/UX.
    expect(one.body.payload.character.content.hitPointsCurrent).toBe("9");
    // Explicit resurrection against the tombstone revision works.
    const revived = await request(app).put("/api/sync/characters/sync-uid-1").set(authB()).send({
      baseRevision: 4,
      payload: snapshot(),
    });
    expect(revived.status).toBe(200);
    expect(revived.body).toMatchObject({ revision: 5, deleted: false });
  });

  it("validation rejects junk without touching the row", async () => {
    const bad = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 5,
      payload: { format: "soyman-sync-character", version: 1, characterUid: "other-uid" },
    });
    // v1 writes are rejected outright — pushes must be v2.
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("sync-version-unsupported");
    const embedded = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 5,
      payload: {
        ...snapshot(),
        character: { ...snapshot().character, portrait: PORTRAIT },
      },
    });
    expect(embedded.status).toBe(422);
    const evil = await request(app).put("/api/sync/characters/sync-uid-1").set(authA()).send({
      baseRevision: 5,
      payload: { ...snapshot(), owner: "mallory", campaign_id: 7 },
    });
    expect(evil.status).toBe(200);
    const one = await request(app).get("/api/sync/characters/sync-uid-1").set(authA());
    expect(one.body.payload.owner).toBeUndefined();
    expect(one.body.payload.campaign_id).toBeUndefined();
    expect(one.body.revision).toBe(6);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_characters").get()).toMatchObject({ n: 1 });
  });

  it("artifact upload is idempotent and hash-verified; HEAD/GET probe", async () => {
    // Same bytes twice store once.
    const again = await request(app).put(`/api/sync/artifacts/${CATALOG_HASH}`).set(authB()).send({
      kind: "catalog",
      payload: SHUFFLED_SLICE,
    });
    expect(again.status).toBe(200);
    expect(again.body.stored).toBe(false);
    expect(again.body.bytes).toBeGreaterThan(0);
    const count = db.prepare("SELECT COUNT(*) AS n FROM sync_artifacts WHERE hash = ?").get(CATALOG_HASH) as { n: number };
    expect(count).toMatchObject({ n: 1 });
    // Server stores the canonical form and any device recomputes the hash.
    const fetched = await request(app).get(`/api/sync/artifacts/${CATALOG_HASH}`).set(authB());
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ hash: CATALOG_HASH, kind: "catalog" });
    expect(fetched.body.payload).toEqual(canonicalCatalogSlice(SHUFFLED_SLICE));
    // URL hash != calculated hash → reject, nothing stored.
    const wrong = "ab".repeat(32);
    const mismatch = await request(app).put(`/api/sync/artifacts/${wrong}`).set(authA()).send({
      kind: "catalog",
      payload: SHUFFLED_SLICE,
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe("sync-artifact-mismatch");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM sync_artifacts WHERE hash = ?").get(wrong) as { n: number }
    ).toMatchObject({ n: 0 });
    // Unknown kind and malformed hash → reject.
    const bogus = await request(app).put(`/api/sync/artifacts/${CATALOG_HASH}`).set(authA()).send({
      kind: "preview",
      payload: {},
    });
    expect(bogus.status).toBe(200); // already stored: idempotent read, kind ignored
    expect(bogus.body.stored).toBe(false);
    const fresh = "cd".repeat(32);
    const unknownKind = await request(app).put(`/api/sync/artifacts/${fresh}`).set(authA()).send({
      kind: "preview",
      payload: {},
    });
    expect(unknownKind.status).toBe(422);
    const malformed = await request(app).put("/api/sync/artifacts/not-a-hash").set(authA()).send({
      kind: "catalog",
      payload: SHUFFLED_SLICE,
    });
    expect(malformed.status).toBe(400);
    await request(app).head(`/api/sync/artifacts/${CATALOG_HASH}`).set(authA()).expect(200);
    await request(app).head(`/api/sync/artifacts/${wrong}`).set(authA()).expect(404);
  });

  it("v2 refs: missing and foreign artifacts rejected, same-space CAS works", async () => {
    const missing = "ef".repeat(32);
    const cases: { name: string; artifacts: Record<string, unknown>; status: number; code?: string }[] = [
      { name: "missing catalog", artifacts: { catalogHash: missing, portraitHash: null }, status: 422, code: "sync-artifact-missing" },
      { name: "missing portrait", artifacts: { catalogHash: CATALOG_HASH, portraitHash: missing }, status: 422, code: "sync-artifact-missing" },
      { name: "malformed hash", artifacts: { catalogHash: "zzz", portraitHash: null }, status: 422 },
    ];
    for (const c of cases) {
      const res = await request(app).put("/api/sync/characters/sync-uid-refs").set(authA()).send({
        baseRevision: 0,
        payload: snapshot({ characterUid: "sync-uid-refs", artifacts: c.artifacts }),
      });
      expect(res.status).toBe(c.status);
      if (c.code) expect(res.body.code).toBe(c.code);
    }
    // Artifact from another space is foreign: same hash, rejected.
    const otherSpace = (await request(app).post("/api/sync/spaces").send({})).body as { deviceToken: string };
    const foreign = await request(app).put("/api/sync/characters/sync-uid-refs").set({
      Authorization: `Bearer ${otherSpace.deviceToken}`,
    }).send({
      baseRevision: 0,
      payload: snapshot({ characterUid: "sync-uid-refs" }),
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe("sync-artifact-missing");
    // Same-space refs: CAS success, then a stale base conflicts.
    const created = await request(app).put("/api/sync/characters/sync-uid-refs").set(authA()).send({
      baseRevision: 0,
      payload: snapshot({ characterUid: "sync-uid-refs" }),
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ revision: 1, deleted: false });
    const stale = await request(app).put("/api/sync/characters/sync-uid-refs").set(authB()).send({
      baseRevision: 0,
      payload: snapshot({ characterUid: "sync-uid-refs" }),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("sync-conflict");
  });

  it("v1 remote stays readable and converts on next push with one revision bump", async () => {
    // A D1.2 row straight into the table: no migration touches it.
    const v1 = {
      format: "soyman-sync-character",
      version: 1,
      characterUid: "sync-uid-v1",
      character: {
        name: "Мордекай",
        content: { characterName: "Мордекай", classes: [], abilities, hitPointsCurrent: "21" },
        portrait: PORTRAIT,
        archivedAt: null,
      },
      catalog: SHUFFLED_SLICE,
    };
    db.prepare(
      "INSERT INTO sync_characters (sync_space_id, character_uid, revision, payload_json, deleted_at, updated_by_device_id) VALUES ((SELECT sync_space_id FROM sync_devices LIMIT 1), ?, ?, ?, NULL, NULL)"
    ).run("sync-uid-v1", 3, JSON.stringify(v1));
    // GET serves the v1 bytes untouched.
    const index = await request(app).get("/api/sync/characters").set(authB());
    expect(index.body.find((e: { characterUid: string }) => e.characterUid === "sync-uid-v1")).toMatchObject({
      revision: 3,
      deleted: false,
    });
    const before = await request(app).get("/api/sync/characters/sync-uid-v1").set(authB());
    expect(before.body.revision).toBe(3);
    expect(before.body.payload.version).toBe(1);
    expect(before.body.payload.catalog.entries.length).toBe(2);
    // Next client push converts the same data to v2: exactly one bump.
    const converted = await request(app).put("/api/sync/characters/sync-uid-v1").set(authB()).send({
      baseRevision: 3,
      payload: snapshot({ characterUid: "sync-uid-v1" }),
    });
    expect(converted.status).toBe(200);
    expect(converted.body).toMatchObject({ revision: 4, deleted: false });
    const after = await request(app).get("/api/sync/characters/sync-uid-v1").set(authA());
    expect(after.body.payload.version).toBe(2);
    expect(after.body.payload.character.content.hitPointsCurrent).toBe("21");
    expect(after.body.payload.artifacts).toMatchObject({ catalogHash: CATALOG_HASH, portraitHash: PORTRAIT_HASH });
  });
});
