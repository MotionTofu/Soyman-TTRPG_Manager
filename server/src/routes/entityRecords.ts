// Записи о сущностях в кампании — слой кампании (ADR-0006, спека
// .scratch/campaign-layer, задача 01). Запись не переписывают: замена — новая
// строка с replaces_id, прежняя остаётся, пара даёт «было → стало».
//
// Первая запись о существе, сообществе или месте задействует его в кампании:
// строка participations с context_type = 'campaign', manual = 0.
//
// Только Мастер: роутер стоит за общим гейтом /api (index.ts).
import { Router, type Request, type Response } from "express";
import { campaignEntityState, campaignEntityStateLabel, isCampaignEntityKind, isCampaignEntityState } from "@soyman/shared";
import { campaignParticipationData, campaignRecordCounts, campaignStateSession, campaignWorldDetails } from "../services/campaignWorld";
import { db } from "../db/db";
import { requireKind } from "../db/entityKinds";
import { entityNames, refKey } from "../services/entityNames";
import { idOfUid, scanMentions } from "../services/mentions";
import {
  CERTAINTY,
  KNOWN_TO,
  RECORD_ASPECTS,
  RECORD_FUNCTIONS,
  RECORD_STATUSES,
  SETTING_OWNER_TYPES,
  engagements,
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
  function: string;
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
  function?: string;
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
  if (typeof ownerType !== "string" || !RECORD_ASPECTS[ownerType]) throw new BadRequest("Запись бывает о существе, сообществе, месте, артефакте, персонаже или кампании");
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
  if (body.function !== undefined) f.function = oneOf(body.function, RECORD_FUNCTIONS, "функция");
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

/** Откуда запись: ручная, быстрая, из ленты (с сообщением). */
interface Origin {
  source: "manual" | "quick" | "feed";
  source_note_id: number | null;
}
const MANUAL: Origin = { source: "manual", source_note_id: null };

function insertRecord(campaignId: number, ownerType: string, ownerId: number, f: Fields, replacesId: number | null, origin: Origin = MANUAL): number {
  const aspect = f.aspect ?? "note";
  if (!isAspectOf(ownerType, aspect)) throw new BadRequest(`Нет такой графы у этого вида: ${aspect}`);
  if (!f.text) throw new BadRequest("Пустая запись");
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO entity_records
             (campaign_id, owner_type, owner_id, aspect, text, status, certainty, known_to, known_note, basis, function, session_id,
              replaces_id, source, source_note_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          f.function ?? "",
          f.session_id ?? null,
          replacesId,
          origin.source,
          origin.source_note_id
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

/**
 * Колонка «категории» вида для строки «Мира кампании»: у существа — роль в
 * мире (ключевая фигура, влиятельное…), у места — вывеска. У сообщества нет.
 */
const CATEGORY_COLUMN: Record<string, string | undefined> = { being: "category", location: "kind" };

/** Имя и категория задействованных сущностей; архивные и исчезнувшие — мимо. */
function worldEntities(refs: { type: string; id: number }[]) {
  const out = new Map<string, { name: string; category: string | null; image: string | null; description: string }>();
  for (const type of SETTING_OWNER_TYPES) {
    const ids = refs.filter((r) => r.type === type).map((r) => r.id);
    if (!ids.length) continue;
    const { table, nameCol } = requireKind(type);
    const cat = CATEGORY_COLUMN[type];
    const rows = db
      .prepare(
        `SELECT id, ${nameCol} AS name, ${cat ? cat : "NULL"} AS category,
           COALESCE(NULLIF(avatar_image_path, ''), ${type === "artifact" ? "NULL" : "NULLIF(thumbnail_image_path, '')"}) AS image,
           COALESCE(description, '') AS description FROM ${table}
         WHERE archived_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`
      )
      .all(...ids) as { id: number; name: string; category: string | null; image: string | null; description: string }[];
    for (const r of rows) out.set(refKey(type, r.id), { name: r.name, category: r.category || null, image: r.image, description: r.description });
  }
  return out;
}

// «Мир кампании»: задействованные сущности со сводкой записей.
entityRecordsRouter.get("/campaigns/:id/world", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const list = engagements("p.context_id = ?", campaign.id);
  const entities = worldEntities(list.map((e) => ({ type: e.entity_type, id: e.entity_id })));
  const details = campaignWorldDetails(campaign.id);
  const items = list
    .flatMap((e) => {
      const entity = entities.get(refKey(e.entity_type, e.entity_id));
      if (!entity) return [];
      const { campaign_id: _c, ...rest } = e;
      const { description, ...visible } = entity;
      const detail = details.get(refKey(e.entity_type, e.entity_id))!;
      return [{ ...rest, ...visible, ...detail, summary: detail.summary ?? { text: description, from_setting: true } }];
    })
    .sort((a, b) => b.changed_at.localeCompare(a.changed_at) || a.name.localeCompare(b.name, "ru"));
  res.json({ setting_id: campaign.setting_id, entities: items, ...campaignRecordCounts(campaign.id) });
}));

// Задействовать руками («+ Задействовать из сеттинга»).
entityRecordsRouter.post("/campaigns/:id/world", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.entity_type !== "string" || !SETTING_OWNER_TYPES.has(body.entity_type))
    throw new BadRequest("Задействовать можно существо, сообщество, место или артефакт сеттинга");
  const { ownerType, ownerId } = checkOwner(campaign, body.entity_type, body.entity_id);
  db.prepare(
    `INSERT INTO participations (context_type, context_id, entity_type, entity_id, manual)
     VALUES ('campaign', ?, ?, ?, 1)
     ON CONFLICT (context_type, context_id, entity_type, entity_id) DO NOTHING`
  ).run(campaign.id, ownerType, ownerId);
  res.status(201).json({ ok: true });
}));

// Состояние — поле ссылки плюс служебная запись; обе операции атомарны.
entityRecordsRouter.put("/campaigns/:id/world/:type/:entityId/state", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const kind = req.params.type;
  if (!isCampaignEntityKind(kind)) throw new BadRequest("Неверный вид сущности");
  const { ownerId } = checkOwner(campaign, kind, req.params.entityId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const state = body.state;
  if (!isCampaignEntityState(kind, state)) throw new BadRequest("Неизвестное состояние для этого вида");
  const requestedSession = readFields({ session_id: body.session_id }, campaign.id).session_id;
  const undoId = body.undo_record_id === undefined ? null : positiveId(body.undo_record_id);
  if (body.undo_record_id !== undefined && !undoId) throw new BadRequest("Неверная запись отмены");
  const result = db.transaction(() => {
    const link = db.prepare(
      "SELECT data FROM participations WHERE context_type = 'campaign' AND context_id = ? AND entity_type = ? AND entity_id = ?"
    ).get(campaign.id, kind, ownerId) as { data: string } | undefined;
    const data = campaignParticipationData(link?.data);
    const previous = campaignEntityState(kind, data.state);
    const text = `${campaignEntityStateLabel(kind, previous)} → ${campaignEntityStateLabel(kind, state)}`;
    let recordId: number | null = null;
    if (undoId) {
      const record = db.prepare(
        `SELECT r.* FROM entity_records r
         WHERE r.id = ? AND r.campaign_id = ? AND r.owner_type = ? AND r.owner_id = ? AND r.aspect = 'state'
           AND r.status = 'established'
           AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.replaces_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.campaign_id = r.campaign_id
             AND n.owner_type = r.owner_type AND n.owner_id = r.owner_id AND n.aspect = 'state' AND n.id > r.id)`
      ).get(undoId, campaign.id, kind, ownerId) as { text: string } | undefined;
      const expected = `${campaignEntityStateLabel(kind, state)} → ${campaignEntityStateLabel(kind, previous)}`;
      if (!link || !record || record.text !== expected) return null;
      db.prepare("DELETE FROM entity_records WHERE id = ?").run(undoId);
      recordId = undoId;
    } else if (state !== previous) {
      recordId = insertRecord(campaign.id, kind, ownerId, {
        aspect: "state", text, status: "established", session_id: requestedSession ?? campaignStateSession(campaign.id),
      }, null);
    }
    // Не прогоняем через словари хода событий/персонажа: это другой вид ссылки.
    db.prepare(
      `INSERT INTO participations (context_type, context_id, entity_type, entity_id, manual, data)
       VALUES ('campaign', ?, ?, ?, 0, ?)
       ON CONFLICT (context_type, context_id, entity_type, entity_id)
       DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
    ).run(campaign.id, kind, ownerId, JSON.stringify({ ...data, state }));
    return { state, previous, record_id: recordId };
  })();
  if (!result) return res.status(409).json({ error: "Эту смену состояния уже нельзя отменить" });
  res.json(result);
}));

// Убрать из «Мира кампании». Пока о сущности есть записи, ссылку держат
// они: снять её значило бы спрятать записи из списка кампании.
entityRecordsRouter.delete("/campaigns/:id/world/:type/:entityId", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const entityId = positiveId(req.params.entityId);
  if (!entityId || !SETTING_OWNER_TYPES.has(req.params.type)) throw new BadRequest("Неверный адрес");
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM entity_records
       WHERE campaign_id = ? AND owner_type = ? AND owner_id = ? AND status <> 'discarded'`
    )
    .get(campaign.id, req.params.type, entityId) as { n: number };
  if (n > 0)
    return res.status(409).json({
      error: `О ней в кампании есть записи (${n}). Убрать из «Мира кампании» можно, когда записей не останется — отбросьте их или оставьте сущность.`,
    });
  db.prepare(
    "DELETE FROM participations WHERE context_type = 'campaign' AND context_id = ? AND entity_type = ? AND entity_id = ?"
  ).run(campaign.id, req.params.type, entityId);
  res.json({ ok: true });
}));

// Записи кампании. Отброшенные — только если спросили status=discarded.
entityRecordsRouter.get("/campaigns/:id/records", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const where = ["r.campaign_id = ?"];
  const params: unknown[] = [campaign.id];
  const { owner_type, owner_id, session_id, status, certainty, function: fn } = req.query;
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
  if (certainty !== undefined) {
    where.push("r.certainty = ?");
    params.push(oneOf(certainty, CERTAINTY, "достоверность"));
  }
  if (fn !== undefined) {
    where.push("r.function = ?");
    params.push(oneOf(fn, RECORD_FUNCTIONS, "функция"));
  }
  if (status !== undefined) {
    where.push("r.status = ?");
    params.push(oneOf(status, RECORD_STATUSES, "статус"));
  } else where.push("r.status <> 'discarded'");
  const rows = db.prepare(`${SELECT_RECORDS} WHERE ${where.join(" AND ")} ORDER BY r.id DESC`).all(...params) as RecordRow[];
  res.json({ records: withOwnerNames(rows) });
}));

/**
 * Откуда запись, если это не ручной ввод. С клиента приходит только «из
 * ленты» — с сообщением ленты этой кампании; «быстрая» — свой маршрут ниже.
 */
function readOrigin(body: Record<string, unknown>, campaignId: number): Origin {
  if (body.source === undefined || body.source === "manual") return MANUAL;
  if (body.source !== "feed") throw new BadRequest("Неизвестное значение: источник");
  const noteId = positiveId(body.source_note_id);
  const ok =
    noteId &&
    db.prepare("SELECT 1 FROM session_notes n JOIN sessions s ON s.id = n.session_id WHERE n.id = ? AND s.campaign_id = ?").get(noteId, campaignId);
  if (!ok) throw new BadRequest("Сообщение ленты не из этой кампании");
  return { source: "feed", source_note_id: noteId };
}

entityRecordsRouter.post("/campaigns/:id/records", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { ownerType, ownerId } = checkOwner(campaign, body.owner_type, body.owner_id);
  const id = insertRecord(campaign.id, ownerType, ownerId, readFields(body, campaign.id), null, readOrigin(body, campaign.id));
  res.status(201).json(recordById(id));
}));

/**
 * Владелец строки быстрой записи — её первое упоминание, если это сущность
 * сеттинга кампании или её персонаж. Иначе — черновик без адреса.
 */
function quickOwner(campaign: Campaign, line: string): { ownerType: string; ownerId: number; aspect: string } {
  const first = scanMentions(line)[0];
  const id = !first ? null : first.kind === "ref" ? idOfUid(first.type, first.uid) : first.id;
  if (first && id && (SETTING_OWNER_TYPES.has(first.type) || first.type === "character")) {
    try {
      return { ...checkOwner(campaign, first.type, id), aspect: "note" };
    } catch (e) {
      if (!(e instanceof BadRequest)) throw e;
    }
  }
  return { ownerType: "campaign", ownerId: campaign.id, aspect: "unsorted" };
}

// Быстрая запись во «Итогах»: строка — черновик. Пустые строки пропускаются.
entityRecordsRouter.post("/campaigns/:id/records/quick", handle((req, res) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Кампания не найдена" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { session_id } = readFields({ session_id: body.session_id ?? null }, campaign.id);
  const lines = plainText(body.text, "Быстрая запись")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new BadRequest("Пустая запись");
  const ids = db.transaction(() =>
    lines.map((text) => {
      const owner = quickOwner(campaign, text);
      return insertRecord(campaign.id, owner.ownerType, owner.ownerId, { text, aspect: owner.aspect, status: "draft", session_id }, null, {
        source: "quick",
        source_note_id: null,
      });
    })
  )();
  res.status(201).json({ records: ids.map((id) => recordById(id)) });
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
         known_to = ?, known_note = ?, basis = ?, function = ?, session_id = ?, updated_at = datetime('now')
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
      f.function ?? current.function,
      f.session_id !== undefined ? f.session_id : current.session_id,
      current.id
    );
    engage(campaign.id, ownerType, ownerId);
  })();
  res.json(recordById(current.id));
}));

// Замена: новая запись того же владельца и графы, прежняя не меняется.
// Функция сведения переходит к замене, если её не прислали.
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
  const newId = insertRecord(campaign.id, prev.owner_type, prev.owner_id, { ...f, aspect: prev.aspect, function: f.function ?? prev.function }, prev.id);
  res.status(201).json(recordById(newId));
}));
