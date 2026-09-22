import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID, createHash } from "crypto";
import { db } from "../db/db";
import { requireSyncDevice, validateSyncPayloadV2, type SyncRequest } from "./sync";

// Read-only character sharing for the GM (phase D2.1): the player publishes
// a snapshot; the GM opens it with a capability token. No live updates, no
// GM writes, no import — an explicit snapshot with explicit refresh.
//
// Capability separation: the share token authorizes exactly one published
// snapshot. It never touches the sync space — no spaceId, no deviceToken,
// no pairingToken travels to the GM, and the public endpoint cannot list
// characters, manage devices or pair. Raw tokens are high-entropy, returned
// once at creation and never logged; only SHA-256 hashes are stored.

export const sharesRouter = Router();
export const sharePublicRouter = Router();

const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,}$/;

function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// Capability URLs must not be enumerable at full speed. Follows the
// in-route limiter pattern (healthScanLimiter, clientJournal postLimiter);
// there is no general public limiter in this codebase.
const shareReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте позже." },
});

interface ShareRow {
  id: string;
  token_hash: string;
  owner_sync_space_id: string;
  character_uid: string;
  snapshot_json: string;
  created_at: string;
  updated_at: string;
}

function shareShape(row: ShareRow): Record<string, unknown> {
  return { characterUid: row.character_uid, updatedAt: row.updated_at };
}

// Create: one active share per (space, character). The snapshot is the same
// v2 document sync uses (refs to already-uploaded space artifacts — no third
// artifact protocol); validation (character gate + artifact refs) is
// reused verbatim. Further player edits never touch the share until an
// explicit update.
sharesRouter.post("/", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const { characterUid, payload } = req.body as { characterUid?: unknown; payload?: unknown };
  if (typeof characterUid !== "string" || !characterUid || characterUid.length > 200) {
    return res.status(400).json({ error: "Некорректный идентификатор персонажа." });
  }
  try {
    const canonical = validateSyncPayloadV2(characterUid, device.sync_space_id, payload);
    const result = db.transaction(() => {
      const existing = db
        .prepare("SELECT id FROM character_shares WHERE owner_sync_space_id = ? AND character_uid = ?")
        .get(device.sync_space_id, characterUid) as { id: string } | undefined;
      if (existing) throw { status: 409, code: "share-exists", error: "У персонажа уже есть активная ссылка." };
      const shareToken = newShareToken();
      const id = randomUUID();
      db.prepare(
        "INSERT INTO character_shares (id, token_hash, owner_sync_space_id, character_uid, snapshot_json) VALUES (?, ?, ?, ?, ?)"
      ).run(id, sha256Hex(shareToken), device.sync_space_id, characterUid, JSON.stringify(canonical));
      const row = db
        .prepare("SELECT * FROM character_shares WHERE id = ?")
        .get(id) as ShareRow;
      return { shareToken, row };
    })();
    return res.status(201).json({ ...shareShape(result.row), shareToken: result.shareToken });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const { status, ...body } = e as { status: number; [k: string]: unknown };
      return res.status(status).json(body);
    }
    throw e;
  }
});

// Update: replace the snapshot, the token stays the same so the GM link
// keeps working.
sharesRouter.put("/:uid", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const uid = req.params.uid;
  if (typeof uid !== "string" || !uid || uid.length > 200) {
    return res.status(400).json({ error: "Некорректный идентификатор персонажа." });
  }
  const { payload } = req.body as { payload?: unknown };
  try {
    const canonical = validateSyncPayloadV2(uid, device.sync_space_id, payload);
    const existing = db
      .prepare("SELECT * FROM character_shares WHERE owner_sync_space_id = ? AND character_uid = ?")
      .get(device.sync_space_id, uid) as ShareRow | undefined;
    if (!existing) return res.status(404).json({ error: "У персонажа нет активной ссылки." });
    db.prepare("UPDATE character_shares SET snapshot_json = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(canonical),
      existing.id
    );
    const row = db.prepare("SELECT * FROM character_shares WHERE id = ?").get(existing.id) as ShareRow;
    return res.json(shareShape(row));
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const { status, ...body } = e as { status: number; [k: string]: unknown };
      return res.status(status).json(body);
    }
    throw e;
  }
});

// Revoke: hard delete. The old URL stops resolving; the local character and
// its sync state are untouched.
sharesRouter.delete("/:uid", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const uid = req.params.uid;
  if (typeof uid !== "string" || !uid || uid.length > 200) {
    return res.status(400).json({ error: "Некорректный идентификатор персонажа." });
  }
  const removed = db
    .prepare("DELETE FROM character_shares WHERE owner_sync_space_id = ? AND character_uid = ?")
    .run(device.sync_space_id, uid);
  return res.json({ characterUid: uid, deleted: removed.changes > 0 });
});

// Awararess for sibling devices: which characterUids are published in this
// space (no tokens — the raw token lives only on the creating device).
sharesRouter.get("/", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const rows = db
    .prepare("SELECT character_uid, updated_at FROM character_shares WHERE owner_sync_space_id = ? ORDER BY character_uid")
    .all(device.sync_space_id) as { character_uid: string; updated_at: string }[];
  res.json(rows.map((r) => ({ characterUid: r.character_uid, updatedAt: r.updated_at })));
});

// Public read: token capability, no login. Returns the resolved snapshot —
// character document plus the referenced artifact bytes inlined — so the
// viewer needs no second request and learns nothing else: no space, no
// character list, no devices, no pairing, no writes.
sharePublicRouter.get("/character-share/:token", shareReadLimiter, (req, res: Response) => {
  const token = req.params.token;
  if (typeof token !== "string" || !SHARE_TOKEN_PATTERN.test(token)) {
    return res.status(404).json({ error: "Ссылка недействительна." });
  }
  const row = db
    .prepare("SELECT * FROM character_shares WHERE token_hash = ?")
    .get(sha256Hex(token)) as ShareRow | undefined;
  if (!row) return res.status(404).json({ error: "Ссылка недействительна." });
  let snapshot: {
    characterUid: string;
    character: { name: string; content: unknown; archivedAt: string | null };
    artifacts: { catalogHash: string; portraitHash: string | null };
  };
  try {
    snapshot = JSON.parse(row.snapshot_json) as typeof snapshot;
  } catch {
    return res.status(404).json({ error: "Ссылка недействительна." });
  }
  const catalog = db
    .prepare("SELECT payload_json FROM sync_artifacts WHERE sync_space_id = ? AND hash = ?")
    .get(row.owner_sync_space_id, snapshot.artifacts.catalogHash) as { payload_json: string } | undefined;
  if (!catalog) return res.status(404).json({ error: "Ссылка недействительна." });
  let portrait: string | null = null;
  if (snapshot.artifacts.portraitHash !== null) {
    const portraitRow = db
      .prepare("SELECT payload_json FROM sync_artifacts WHERE sync_space_id = ? AND hash = ?")
      .get(row.owner_sync_space_id, snapshot.artifacts.portraitHash) as { payload_json: string } | undefined;
    // Portraits are stored (and hashed) as the raw canonical data URL
    // string, not JSON — same convention as the artifact endpoints.
    if (!portraitRow || typeof portraitRow.payload_json !== "string" || !portraitRow.payload_json.startsWith("data:image/")) {
      return res.status(404).json({ error: "Ссылка недействительна." });
    }
    portrait = portraitRow.payload_json;
  }
  let catalogPayload: unknown;
  try {
    catalogPayload = JSON.parse(catalog.payload_json) as unknown;
  } catch {
    return res.status(404).json({ error: "Ссылка недействительна." });
  }
  return res.json({
    format: "soyman-character-share",
    version: 1,
    characterUid: row.character_uid,
    character: {
      name: snapshot.character.name,
      content: snapshot.character.content,
      archivedAt: snapshot.character.archivedAt,
    },
    portrait,
    catalog: catalogPayload,
    updatedAt: row.updated_at,
  });
});
