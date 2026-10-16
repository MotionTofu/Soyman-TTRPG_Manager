// Записи о сущностях в кампании — слой кампании (ADR-0006, спека
// .scratch/campaign-layer, задача 01). Запись не переписывают: замена — новая
// строка с replaces_id, прежняя остаётся, пара даёт «было → стало».
//
// Первая запись о существе, сообществе или месте задействует его в кампании:
// строка participations с context_type = 'campaign', manual = 0.
//
// Только Мастер: роутер стоит за общим гейтом /api (index.ts).
import { Router, type Request, type Response } from "express";
import { db } from "../db/db";
import { requireKind } from "../db/entityKinds";
import { entityNames, refKey } from "../services/entityNames";
import {
  CERTAINTY,
  KNOWN_TO,
  RECORD_ASPECTS,
  RECORD_STATUSES,
  SETTING_OWNER_TYPES,
  isAspectOf,
} from "../services/entityRecords";

export const entityRecordsRouter = Router();

interface RecordRow {
  id: number;
  campaign_id: number | null;
  owner_type: string;
  owner_id: number;
  aspect: string;
  text: string;
  status: string;
  certainty: string;
  known_to: string;
  known_note: string;
  basis: string;
  session_id: number | null;
  replaces_id: number | null;
  source: string;
  source_note_id: number | null;
  created_at: string;
  updated_at: string;
  replaced_by: number | null;
}

interface Campaign {
  id: number;
  setting_id: number | null;
}

/** Поля, которые Мастер правит; владелец и графа проверяются отдельно. */
interface Fields {
  aspect?: string;
  text?: string;
  status?: string;
  certainty?: string;
  known_to?: string;
  known_note?: string;
  basis?: string;
  session_id?: number | null;
}

class BadRequest extends Error {}

function positiveId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function campaignById(id: unknown): Campaign | undefined {
  const n = positiveId(id);
  return n ? (db.prepare("SELECT id, setting_id FROM campaigns WHERE id = ?").get(n) as Campaign | undefined) : undefined;
}

const SELECT_RECORDS = `
  SELECT r.*, (SELECT n.id FROM entity_records n WHERE n.replaces_id = r.id ORDER BY n.id DESC LIMIT 1) AS replaced_by
  FROM entity_records r`;

/** Записи с именем владельца — для списка и ответа на запись. */
function withOwnerNames(rows: RecordRow[]) {
  const names = entityNames(rows.map((r) => ({ kind: r.owner_type, id: r.owner_id })));
  return rows.map((r) => ({ ...r, owner_name: names.get(refKey(r.owner_type, r.owner_id)) ?? null }));
}

function recordById(id: number) {
  const row = db.prepare(`${SELECT_RECORDS} WHERE r.id = ?`).get(id) as RecordRow | undefined;
  return row ? withOwnerNames([row])[0] : undefined;
}

/**
 * Владелец записи принадлежит кампании: сущность — её сеттингу, персонаж —
 * ей самой, `campaign` — это она и есть.
 */
function checkOwner(campaign: Campaign, ownerType: unknown, ownerIdRaw: unknown): { ownerType: string; ownerId: number } {
  if (typeof ownerType !== "string" || !RECORD_ASPECTS[ownerType]) throw new BadRequest("Запись бывает о существе, сообществе, месте, персонаже или кампании");
  const ownerId = positiveId(ownerIdRaw);
  if (!ownerId) throw new BadRequest("Не указано, о ком запись");
  if (ownerType === "campaign") {
    if (ownerId !== campaign.id) throw new BadRequest("Запись о кампании — только о своей");
    return { ownerType, ownerId };
  }
  const table = requireKind(ownerType).table;
  if (ownerType === "character") {
    const row = db.prepare(`SELECT campaign_id FROM ${table} WHERE id = ?`).get(ownerId) as { campaign_id: number | null } | undefined;
    if (!row) throw new BadRequest("Персонаж не найден");
    if (row.campaign_id !== campaign.id) throw new BadRequest("Персонаж не из этой кампании");
    return { ownerType, ownerId };
  }
  if (!campaign.setting_id) throw new BadRequest("Кампания не привязана к сеттингу");
  const row = db.prepare(`SELECT setting_id FROM ${table} WHERE id = ?`).get(ownerId) as { setting_id: number } | undefined;
  if (!row) throw new BadRequest("Сущность не найдена");
  if (row.setting_id !== campaign.setting_id) throw new BadRequest("Сущность не из сеттинга этой кампании");
  return { ownerType, ownerId };
}

function oneOf(value: unknown, allowed: readonly string[], what: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new BadRequest(`Неизвестное значение: ${what}`);
  return value;
}

function plainText(value: unknown, what: string): string {
  if (typeof value !== "string") throw new BadRequest(`${what} — не текст`);
  return value;
}

/** Поля из тела запроса; отсутствующие не трогаются. */
function readFields(body: Record<string, unknown>, campaignId: number): Fields {
  const f: Fields = {};
  if (body.aspect !== undefined) f.aspect = plainText(body.aspect, "Графа");
  if (body.text !== undefined) {
    const text = plainText(body.text, "Запись").trim();
    if (!text) throw new BadRequest("Пустая запись");
    f.text = text;
  }
  if (body.status !== undefined) f.status = oneOf(body.status, RECORD_STATUSES, "статус");
  if (body.certainty !== undefined) f.certainty = oneOf(body.certainty, CERTAINTY, "достоверность");
  if (body.known_to !== undefined) f.known_to = oneOf(body.known_to, KNOWN_TO, "кому известно");
  if (body.known_note !== undefined) f.known_note = plainText(body.known_note, "Кто именно знает");
  if (body.basis !== undefined) f.basis = plainText(body.basis, "Основание");
  if (body.session_id !== undefined) {
    if (body.session_id === null) f.session_id = null;
    else {
      const sessionId = positiveId(body.session_id);
      const ok = sessionId && db.prepare("SELECT 1 FROM sessions WHERE id = ? AND campaign_id = ?").get(sessionId, campaignId);
      if (!ok) throw new BadRequest("Встреча не из этой кампании");
      f.session_id = sessionId;
    }
  }
  return f;
}

/** Первая запись о сущности сеттинга задействует её в кампании. */
function engage(campaignId: number, ownerType: string, ownerId: number): void {
  if (!SETTING_OWNER_TYPES.has(ownerType)) return;
  db.prepare(
    `INSERT OR IGNORE INTO participations (context_type, context_id, entity_type, entity_id, manual)
     VALUES ('campaign', ?, ?, ?, 0)`
  ).run(campaignId, ownerType, ownerId);
}

function insertRecord(campaignId: number, ownerType: string, ownerId: number, f: Fields, replacesId: number | null): number {
  const aspect = f.aspect ?? "note";
  if (!isAspectOf(ownerType, aspect)) throw new BadRequest(`Нет такой графы у этого вида: ${aspect}`);
  if (!f.text) throw new BadRequest("Пустая запись");
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO entity_records
             (campaign_id, owner_type, owner_id, aspect, text, status, certainty, known_to, known_note, basis, session_id, replaces_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          campaignId,
          ownerType,
          ownerId,
          aspect,
          f.text,
          f.status ?? "established",
          f.certainty ?? "known",
          f.known_to ?? "gm",
          f.known_note ?? "",
          f.basis ?? "",
          f.session_id ?? null,
          replacesId
        ).lastInsertRowid
    );
    engage(campaignId, ownerType, ownerId);
    return id;
  })();
}

/** Ошибки проверки — 400 с текстом, остальное — общему обработчику. */
function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      throw e;
    }
  };
}

// Записи кампании. Отброшенные — только если спросили status=discarded.
entityRecordsRouter.get("/campaigns/:id/records", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const where = ["r.campaign_id = ?"];
  const params: unknown[] = [campaign.id];
  const { owner_type, owner_id, session_id, status } = req.query;
  if (owner_type !== undefined) {
    where.push("r.owner_type = ?");
    params.push(oneOf(owner_type, Object.keys(RECORD_ASPECTS), "вид владельца"));
  }
  if (owner_id !== undefined) {
    const id = positiveId(owner_id);
    if (!id) throw new BadRequest("Неверный владелец");
    where.push("r.owner_id = ?");
    params.push(id);
  }
  if (session_id !== undefined) {
    const id = positiveId(session_id);
    if (!id) throw new BadRequest("Неверная встреча");
    where.push("r.session_id = ?");
    params.push(id);
  }
  if (status !== undefined) {
    where.push("r.status = ?");
    params.push(oneOf(status, RECORD_STATUSES, "статус"));
  } else where.push("r.status <> 'discarded'");
  const rows = db.prepare(`${SELECT_RECORDS} WHERE ${where.join(" AND ")} ORDER BY r.id DESC`).all(...params) as RecordRow[];
  res.json({ records: withOwnerNames(rows) });
}));

entityRecordsRouter.post("/campaigns/:id/records", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { ownerType, ownerId } = checkOwner(campaign, body.owner_type, body.owner_id);
  const id = insertRecord(campaign.id, ownerType, ownerId, readFields(body, campaign.id), null);
  res.status(201).json(recordById(id));
}));

// Правка полей. Сменить, о ком запись, можно только у черновика — так
// черновик без адреса получает адрес при подтверждении.
entityRecordsRouter.put("/records/:id", handle((req, res) => {
  const id = positiveId(req.params.id);
  const current = id ? (db.prepare("SELECT * FROM entity_records WHERE id = ?").get(id) as RecordRow | undefined) : undefined;
  if (!current) return res.status(404).json({ error: "Запись не найдена" });
  const campaign = campaignById(current.campaign_id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const f = readFields(body, campaign.id);

  let { owner_type: ownerType, owner_id: ownerId } = current;
  const ownerGiven = body.owner_type !== undefined || body.owner_id !== undefined;
  if (ownerGiven) {
    const next = checkOwner(campaign, body.owner_type ?? current.owner_type, body.owner_id ?? current.owner_id);
    if ((next.ownerType !== ownerType || next.ownerId !== ownerId) && current.status !== "draft")
      throw new BadRequest("Сменить, о ком запись, можно только у черновика");
    ({ ownerType, ownerId } = next);
  }
  const aspect = f.aspect ?? current.aspect;
  if (!isAspectOf(ownerType, aspect)) throw new BadRequest(`Нет такой графы у этого вида: ${aspect}`);

  db.transaction(() => {
    db.prepare(
      `UPDATE entity_records SET owner_type = ?, owner_id = ?, aspect = ?, text = ?, status = ?, certainty = ?,
         known_to = ?, known_note = ?, basis = ?, session_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      ownerType,
      ownerId,
      aspect,
      f.text ?? current.text,
      f.status ?? current.status,
      f.certainty ?? current.certainty,
      f.known_to ?? current.known_to,
      f.known_note ?? current.known_note,
      f.basis ?? current.basis,
      f.session_id !== undefined ? f.session_id : current.session_id,
      current.id
    );
    engage(campaign.id, ownerType, ownerId);
  })();
  res.json(recordById(current.id));
}));

// Замена: новая запись того же владельца и графы, прежняя не меняется.
// Заменяют последнюю в цепочке — иначе история разветвится.
entityRecordsRouter.post("/records/:id/replace", handle((req, res) => {
  const id = positiveId(req.params.id);
  const prev = id ? recordById(id) : undefined;
  if (!prev) return res.status(404).json({ error: "Запись не найдена" });
  if (prev.replaced_by) return res.status(409).json({ error: "Запись уже заменена — замените последнюю" });
  const campaign = campaignById(prev.campaign_id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const f = readFields(body, campaign.id);
  const newId = insertRecord(campaign.id, prev.owner_type, prev.owner_id, { ...f, aspect: prev.aspect }, prev.id);
  res.status(201).json(recordById(newId));
}));
