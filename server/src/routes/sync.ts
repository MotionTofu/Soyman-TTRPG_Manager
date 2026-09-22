import { Router, type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID, createHash } from "crypto";
import { normalizeDndCharacter } from "@soyman/shared";
import { db } from "../db/db";
import {
  SYNC_ARTIFACT_HASH_PATTERN,
  SYNC_CATALOG_ARTIFACT_MAX_BYTES,
  SYNC_DOCUMENT_MAX_BYTES,
  canonicalCatalogSlice,
  catalogArtifactHash,
  isArtifactHash,
  portraitArtifactHash,
  stableStringify,
  utf8ByteLength,
  validateCatalogArtifact,
  validatePortraitArtifact,
} from "./sync-artifacts";

// Optional device sync for SoyMan_1shot (phase D1.1): personal sync spaces,
// no accounts. The server learns spaces, devices and pairing tokens only —
// never character data (no character endpoint exists in this phase).
//
// Token discipline: raw tokens are high-entropy, returned to the client only
// at issuance (space creation, pair exchange) and never logged; only
// SHA-256 hashes are stored. A spaceId alone authorizes nothing — every
// device call carries its own Bearer device token, scoped to its space.

export const syncRouter = Router();

const PAIRING_TTL_MS = 10 * 60 * 1000;
const DEVICE_TOKEN_BYTES = 32;
const PAIRING_TOKEN_BYTES = 24;

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function newToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function nowIso(): string {
  return new Date().toISOString();
}

interface SyncDevice {
  id: string;
  sync_space_id: string;
}

export interface SyncRequest extends Request {
  syncDevice?: SyncDevice;
}

// Device-Bearer auth shared with the shares router: a spaceId alone
// authorizes nothing, every call carries its own device token scoped to
// its space. Only hashes are stored, raw tokens never reach the database.
export function requireSyncDevice(req: SyncRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    const row = db
      .prepare(
        `SELECT d.id, d.sync_space_id FROM sync_devices d
         JOIN sync_spaces s ON s.id = d.sync_space_id
         WHERE d.token_hash = ? AND d.revoked_at IS NULL`
      )
      .get(sha256Hex(token)) as SyncDevice | undefined;
    if (row) {
      req.syncDevice = row;
      next();
      return;
    }
  }
  res.status(401).json({ error: "sync authorization required" });
}

// Create a space plus its first device. No auth, no character data.
syncRouter.post("/spaces", (_req, res) => {
  const spaceId = randomUUID();
  const deviceId = randomUUID();
  const deviceToken = newToken(DEVICE_TOKEN_BYTES);
  db.transaction(() => {
    db.prepare("INSERT INTO sync_spaces (id) VALUES (?)").run(spaceId);
    db.prepare("INSERT INTO sync_devices (id, sync_space_id, token_hash) VALUES (?, ?, ?)").run(
      deviceId,
      spaceId,
      sha256Hex(deviceToken)
    );
  })();
  res.status(201).json({ spaceId, deviceId, deviceToken });
});

// Mint a short-lived single-use pairing token for the caller's space.
syncRouter.post("/pairings", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const pairingToken = newToken(PAIRING_TOKEN_BYTES);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sync_pairings (token_hash, sync_space_id, created_by_device_id, expires_at) VALUES (?, ?, ?, ?)"
  ).run(sha256Hex(pairingToken), device.sync_space_id, device.id, expiresAt);
  res.status(201).json({ pairingToken, expiresAt });
});

// Exchange a pairing token for a fresh device credential in the same space.
// Atomic: validate, create device, mark used — one transaction, so two
// racers leave exactly one winner and the loser sees token-used.
syncRouter.post("/pair/exchange", (req, res) => {
  const { pairingToken } = req.body as { pairingToken?: unknown };
  if (typeof pairingToken !== "string" || !pairingToken) {
    return res.status(400).json({ error: "Не удалось подключить устройство." });
  }
  try {
    const result = db.transaction(() => {
      const row = db
        .prepare("SELECT sync_space_id, used_at, expires_at FROM sync_pairings WHERE token_hash = ?")
        .get(sha256Hex(pairingToken)) as
        | { sync_space_id: string; used_at: string | null; expires_at: string }
        | undefined;
      if (!row) throw { status: 410, error: "Ссылка для подключения устарела." };
      if (row.used_at) throw { status: 409, error: "Эта ссылка уже была использована." };
      if (row.expires_at <= nowIso()) throw { status: 410, error: "Ссылка для подключения устарела." };
      const deviceId = randomUUID();
      const deviceToken = newToken(DEVICE_TOKEN_BYTES);
      db.prepare("INSERT INTO sync_devices (id, sync_space_id, token_hash) VALUES (?, ?, ?)").run(
        deviceId,
        row.sync_space_id,
        sha256Hex(deviceToken)
      );
      const marked = db
        .prepare("UPDATE sync_pairings SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
        .run(nowIso(), sha256Hex(pairingToken));
      if (marked.changes !== 1) throw { status: 409, error: "Эта ссылка уже была использована." };
      return { spaceId: row.sync_space_id, deviceId, deviceToken };
    })();
    res.status(201).json(result);
  } catch (e) {
    if (e && typeof e === "object" && "status" in e && "error" in e) {
      const { status, error } = e as { status: number; error: string };
      return res.status(status).json({ error });
    }
    throw e;
  }
});

// Light handshake: credential valid, space exists, device not revoked.
syncRouter.get("/status", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  db.prepare("UPDATE sync_devices SET last_seen_at = ? WHERE id = ?").run(nowIso(), device.id);
  res.json({ connected: true, spaceId: device.sync_space_id, deviceId: device.id });
});

// Revoke this device. Local characters are untouched — the client just drops
// its credential and returns to local-only mode.
syncRouter.post("/devices/disconnect", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  db.prepare("UPDATE sync_devices SET revoked_at = ? WHERE id = ?").run(nowIso(), device.id);
  res.json({ ok: true });
});

const SYNC_CHARACTER_FORMAT = "soyman-sync-character";
// v1 (D1.2) rows stay readable via GET and are converted by clients on next
// push, but new v1 writes are rejected — pushes must be v2 (document +
// artifact refs). Internal v1→v2 conversion never bumps the logical server
// revision: it happens as an ordinary client push, not a migration.
const SYNC_CHARACTER_VERSION_V2 = 2;

interface SyncCharacterRow {
  character_uid: string;
  revision: number;
  payload_json: string | null;
  deleted_at: string | null;
  updated_at: string;
}

interface SyncArtifactRow {
  hash: string;
  kind: string;
  payload_json: string;
  bytes: number;
}

function syncConflict(current: SyncCharacterRow | undefined): { status: number; code: string; currentRevision: number | null; deleted: boolean } {
  return {
    status: 409,
    code: "sync-conflict",
    currentRevision: current?.revision ?? null,
    deleted: current ? current.deleted_at != null : false,
  };
}

// v2 document validation, shared with the shares router: small mutable
// document plus refs to immutable artifacts. Deep character normalization
// reuses the shared DndCharacterData logic (same gate as portable import);
// artifact bytes were validated once at upload and are never re-validated
// here. Unknown top-level fields are dropped on store: owner/campaign/server
// metadata can never smuggle in through a snapshot. Embedded v2
// portrait/catalog bytes are a protocol violation — heavy bytes travel only
// as artifacts.
export function validateSyncPayloadV2(
  uid: string,
  spaceId: string,
  payload: unknown
): Record<string, unknown> {
  const fail = (status: number, message: string, extra?: Record<string, unknown>): never => {
    throw { status, error: message, ...extra };
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(422, "Повреждённый снимок персонажа.");
  }
  const doc = payload as Record<string, unknown>;
  if (doc["format"] !== SYNC_CHARACTER_FORMAT) fail(422, "Это не снимок синхронизации SoyMan.");
  if (doc["version"] === 1) {
    fail(400, "Устаревшая версия снимка персонажа. Обновите приложение.", {
      code: "sync-version-unsupported",
    });
  }
  if (doc["version"] !== SYNC_CHARACTER_VERSION_V2) fail(422, "Неподдерживаемая версия снимка персонажа.");
  if (doc["characterUid"] !== uid) fail(422, "Снимок относится к другому персонажу.");
  const c = doc["character"];
  if (!c || typeof c !== "object" || Array.isArray(c)) fail(422, "Повреждённый снимок персонажа.");
  const character = c as Record<string, unknown>;
  if ("portrait" in character) fail(422, "Снимок должен ссылаться на артефакты, а не содержать их байты.");
  if ("catalog" in doc) fail(422, "Снимок должен ссылаться на артефакты, а не содержать их байты.");
  const content = character["content"];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    fail(422, "Не удалось восстановить персонажа из снимка.");
  }
  const raw = content as { classes?: unknown; abilities?: unknown };
  if (!Array.isArray(raw.classes) || !raw.abilities) fail(422, "Некорректный лист персонажа в снимке.");
  try {
    normalizeDndCharacter(raw);
  } catch {
    fail(422, "Некорректный лист персонажа в снимке.");
  }
  const archivedAt = character["archivedAt"] ?? null;
  if (archivedAt !== null && typeof archivedAt !== "string") fail(422, "Повреждённый снимок персонажа.");
  const a = doc["artifacts"];
  if (!a || typeof a !== "object" || Array.isArray(a)) fail(422, "Повреждённый снимок персонажа.");
  const artifacts = a as Record<string, unknown>;
  if (!isArtifactHash(artifacts["catalogHash"])) fail(422, "Повреждённый снимок персонажа.");
  if (artifacts["portraitHash"] !== null && !isArtifactHash(artifacts["portraitHash"])) {
    fail(422, "Повреждённый снимок персонажа.");
  }
  const name = typeof character["name"] === "string" ? character["name"] : "";
  const stored = {
    format: SYNC_CHARACTER_FORMAT,
    version: SYNC_CHARACTER_VERSION_V2,
    characterUid: uid,
    character: { name, content: raw, archivedAt },
    artifacts: { catalogHash: artifacts["catalogHash"], portraitHash: artifacts["portraitHash"] ?? null },
  };
  if (utf8ByteLength(JSON.stringify(stored.character)) > SYNC_DOCUMENT_MAX_BYTES) {
    fail(422, "Документ персонажа слишком большой.");
  }
  // Referenced artifacts must already exist in THIS space (the device Bearer
  // scopes the space — a client-supplied spaceId is never authority).
  const wanted = [artifacts["catalogHash"] as string];
  if (artifacts["portraitHash"] != null) wanted.push(artifacts["portraitHash"] as string);
  const placeholders = wanted.map(() => "?").join(",");
  const have = db
    .prepare(`SELECT hash FROM sync_artifacts WHERE sync_space_id = ? AND hash IN (${placeholders})`)
    .all(spaceId, ...wanted) as { hash: string }[];
  const haveSet = new Set(have.map((r) => r.hash));
  for (const hash of wanted) {
    if (!haveSet.has(hash)) {
      fail(422, "На сервере нет артефакта, на который ссылается снимок. Загрузите его сначала.", {
        code: "sync-artifact-missing",
        hash,
      });
    }
  }
  return stored;
}

function syncCharacterShape(row: SyncCharacterRow): Record<string, unknown> {
  return {
    characterUid: row.character_uid,
    revision: row.revision,
    deleted: row.deleted_at != null,
    updatedAt: row.updated_at,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as unknown) : null,
  };
}

// Index: every known uid of this space (tombstones included, so deletes
// propagate instead of resurrecting).
syncRouter.get("/characters", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const rows = db
    .prepare(
      "SELECT character_uid, revision, deleted_at, updated_at FROM sync_characters WHERE sync_space_id = ? ORDER BY character_uid"
    )
    .all(device.sync_space_id) as SyncCharacterRow[];
  res.json(
    rows.map((r) => ({
      characterUid: r.character_uid,
      revision: r.revision,
      deleted: r.deleted_at != null,
      updatedAt: r.updated_at,
    }))
  );
});

// Single snapshot or tombstone.
syncRouter.get("/characters/:uid", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const uid = req.params.uid;
  if (typeof uid !== "string" || !uid || uid.length > 200) return res.status(400).json({ error: "Некорректный идентификатор персонажа." });
  const row = db
    .prepare("SELECT * FROM sync_characters WHERE sync_space_id = ? AND character_uid = ?")
    .get(device.sync_space_id, uid) as SyncCharacterRow | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(syncCharacterShape(row));
});

// CAS upsert. Deleted tombstones keep their last snapshot (simpler recovery
// and conflict UX); only deleted_at + revision move.
syncRouter.put("/characters/:uid", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const uid = req.params.uid;
  if (typeof uid !== "string" || !uid || uid.length > 200) {
    return res.status(400).json({ error: "Некорректный идентификатор персонажа." });
  }
  const { baseRevision, payload, deleted } = req.body as {
    baseRevision?: unknown;
    payload?: unknown;
    deleted?: unknown;
  };
  const base = baseRevision ?? 0;
  if (!Number.isSafeInteger(base) || (base as number) < 0) {
    return res.status(400).json({ error: "Некорректная базовая ревизия." });
  }
  try {
    if (deleted === true) {
      const revision = db.transaction(() => {
        const row = db
          .prepare("SELECT * FROM sync_characters WHERE sync_space_id = ? AND character_uid = ?")
          .get(device.sync_space_id, uid) as SyncCharacterRow | undefined;
        if (!row) throw syncConflict(undefined);
        if (row.revision !== (base as number)) throw syncConflict(row);
        db.prepare(
          "UPDATE sync_characters SET deleted_at = datetime('now'), revision = ?, updated_at = datetime('now'), updated_by_device_id = ? WHERE sync_space_id = ? AND character_uid = ?"
        ).run(row.revision + 1, device.id, device.sync_space_id, uid);
        return row.revision + 1;
      })();
      return res.json({ characterUid: uid, revision, deleted: true });
    }
    const canonical = validateSyncPayloadV2(uid, device.sync_space_id, payload);
    const revision = db.transaction(() => {
      const row = db
        .prepare("SELECT * FROM sync_characters WHERE sync_space_id = ? AND character_uid = ?")
        .get(device.sync_space_id, uid) as SyncCharacterRow | undefined;
      if (!row) {
        if ((base as number) !== 0) throw syncConflict(undefined);
        db.prepare(
          "INSERT INTO sync_characters (sync_space_id, character_uid, revision, payload_json, deleted_at, updated_by_device_id) VALUES (?, ?, 1, ?, NULL, ?)"
        ).run(device.sync_space_id, uid, JSON.stringify(canonical), device.id);
        return 1;
      }
      if (row.revision !== (base as number)) throw syncConflict(row);
      db.prepare(
        "UPDATE sync_characters SET payload_json = ?, deleted_at = NULL, revision = ?, updated_at = datetime('now'), updated_by_device_id = ? WHERE sync_space_id = ? AND character_uid = ?"
      ).run(JSON.stringify(canonical), row.revision + 1, device.id, device.sync_space_id, uid);
      return row.revision + 1;
    })();
    return res.json({ characterUid: uid, revision, deleted: false });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const { status, ...body } = e as { status: number; [k: string]: unknown };
      return res.status(status).json(body);
    }
    throw e;
  }
});

// Immutable artifacts (D1.3). Existence probe for pushes; idempotent upload
// (same hash twice stores once); fetch for pulls. Every request is device-
// scoped to its space — a hash alone authorizes nothing, there are no
// public /artifacts/<sha> URLs, and hashes are never treated as secrets.
function syncArtifactShape(row: SyncArtifactRow): Record<string, unknown> {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    payload = row.payload_json;
  }
  // Portrait canonical form is the raw data URL string, not JSON: the hash
  // covers exactly these stored bytes.
  if (row.kind === "portrait" && typeof payload !== "string") payload = row.payload_json;
  return { hash: row.hash, kind: row.kind, bytes: row.bytes, payload };
}

syncRouter.head("/artifacts/:hash", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const hash = req.params.hash;
  if (typeof hash !== "string" || !SYNC_ARTIFACT_HASH_PATTERN.test(hash)) return res.sendStatus(400);
  const row = db
    .prepare("SELECT hash FROM sync_artifacts WHERE sync_space_id = ? AND hash = ?")
    .get(device.sync_space_id, hash) as { hash: string } | undefined;
  return row ? res.sendStatus(200) : res.sendStatus(404);
});

syncRouter.get("/artifacts/:hash", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const hash = req.params.hash;
  if (typeof hash !== "string" || !SYNC_ARTIFACT_HASH_PATTERN.test(hash)) {
    return res.status(400).json({ error: "Некорректный hash артефакта." });
  }
  const row = db
    .prepare("SELECT hash, kind, payload_json, bytes FROM sync_artifacts WHERE sync_space_id = ? AND hash = ?")
    .get(device.sync_space_id, hash) as SyncArtifactRow | undefined;
  if (!row) return res.status(404).json({ error: "Артефакт не найден." });
  res.json(syncArtifactShape(row));
});

// Idempotent upload: the server re-canonicalizes and re-hashes — a client-
// supplied hash is never trusted. URL hash != calculated hash → reject.
syncRouter.put("/artifacts/:hash", requireSyncDevice, (req: SyncRequest, res: Response) => {
  const device = req.syncDevice!;
  const hash = req.params.hash;
  if (typeof hash !== "string" || !SYNC_ARTIFACT_HASH_PATTERN.test(hash)) {
    return res.status(400).json({ error: "Некорректный hash артефакта." });
  }
  const { kind, payload } = req.body as { kind?: unknown; payload?: unknown };
  try {
    const existing = db
      .prepare("SELECT hash, kind, payload_json, bytes FROM sync_artifacts WHERE sync_space_id = ? AND hash = ?")
      .get(device.sync_space_id, hash) as SyncArtifactRow | undefined;
    if (existing) return res.json({ ...syncArtifactShape(existing), stored: false });
    let artifactKind: string;
    let canonicalText: string;
    let calculated: string;
    if (kind === "catalog") {
      const valid = validateCatalogArtifact(payload);
      const canonical = canonicalCatalogSlice(valid);
      canonicalText = stableStringify(canonical) ?? "null";
      if (utf8ByteLength(canonicalText) > SYNC_CATALOG_ARTIFACT_MAX_BYTES) {
        throw { status: 422, error: "Справочник в снимке слишком большой." };
      }
      calculated = catalogArtifactHash(canonical);
      artifactKind = "catalog";
    } else if (kind === "portrait") {
      // Stored AND hashed as the raw canonical data URL string.
      canonicalText = validatePortraitArtifact(payload);
      calculated = portraitArtifactHash(canonicalText);
      artifactKind = "portrait";
    } else {
      throw { status: 422, error: "Неизвестный вид артефакта." };
    }
    if (calculated !== hash) {
      throw { status: 422, code: "sync-artifact-mismatch", error: "Hash артефакта не совпадает с содержимым." };
    }
    const bytes = utf8ByteLength(canonicalText);
    db.prepare(
      "INSERT INTO sync_artifacts (sync_space_id, hash, kind, payload_json, bytes) VALUES (?, ?, ?, ?, ?)"
    ).run(device.sync_space_id, hash, artifactKind, canonicalText, bytes);
    return res.json({ hash, kind: artifactKind, bytes, payload: artifactKind === "catalog" ? JSON.parse(canonicalText) : canonicalText, stored: true });
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const { status, ...body } = e as { status: number; [k: string]: unknown };
      return res.status(status).json(body);
    }
    throw e;
  }
});
