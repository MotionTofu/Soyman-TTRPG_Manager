import { randomUUID } from "crypto";
import { parseCutsceneDocument, type CutsceneDocument, type CutsceneOriginal } from "@soyman/shared";
import { db } from "../db/db";
import { CutsceneRequestError } from "./cutsceneErrors";
import { syncCutsceneOriginalMedia } from "./cutsceneMedia";
export { CutsceneRequestError } from "./cutsceneErrors";

interface CutsceneRow {
  id: number;
  name: string;
  description: string;
  document: string;
  saved_version: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function cutsceneId(raw: unknown): number {
  if ((typeof raw !== "string" && typeof raw !== "number") || !/^[1-9]\d*$/.test(String(raw))) {
    throw new CutsceneRequestError(400, "Некорректный идентификатор");
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new CutsceneRequestError(400, "Некорректный идентификатор");
  return id;
}

function original(row: CutsceneRow): CutsceneOriginal {
  const parsed = parseCutsceneDocument(row.document);
  if (!parsed.ok) throw new Error(`Invalid stored cutscene ${row.id}`);
  return {
    id: row.id, savedVersion: row.saved_version, document: parsed.value,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
}

export function readCutscene(id: number): CutsceneOriginal {
  const row = db.prepare("SELECT * FROM cutscenes WHERE id = ?").get(id) as CutsceneRow | undefined;
  if (!row) throw new CutsceneRequestError(404, "Катсцена не найдена");
  return original(row);
}

/** Validate the entire draft BEFORE any write; readiness is deliberately not required. */
export function cutsceneDraft(raw: unknown): CutsceneDocument {
  const parsed = parseCutsceneDocument(raw);
  if (!parsed.ok) throw new CutsceneRequestError(400, "Некорректный документ катсцены", parsed.issues);
  return parsed.value;
}

export function createCutscene(document: CutsceneDocument): CutsceneOriginal {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO cutscenes
      (uid, name, description, document, saved_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), document.name, document.description, JSON.stringify(document), randomUUID(), now, now);
    syncCutsceneOriginalMedia(Number(result.lastInsertRowid), document);
    return readCutscene(Number(result.lastInsertRowid));
  })();
}

export function saveCutscene(id: number, document: CutsceneDocument): CutsceneOriginal {
  return db.transaction(() => {
    readCutscene(id);
    syncCutsceneOriginalMedia(id, document);
    const result = db.prepare(`UPDATE cutscenes SET name = ?, description = ?, document = ?,
      saved_version = ?, updated_at = ? WHERE id = ?`)
      .run(document.name, document.description, JSON.stringify(document), randomUUID(), new Date().toISOString(), id);
    if (!result.changes) throw new CutsceneRequestError(404, "Катсцена не найдена");
    return readCutscene(id);
  })();
}

function summary(row: CutsceneRow) {
  return {
    id: row.id, name: row.name, description: row.description, savedVersion: row.saved_version,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
}

const summaryColumns = "c.id, c.name, c.description, c.saved_version, c.created_at, c.updated_at, c.archived_at";

export function listCutscenes(query: Record<string, unknown>) {
  const archive = query.archive ?? "active";
  const sort = query.sort ?? "updated";
  const order = query.order ?? (sort === "name" ? "asc" : "desc");
  if (typeof archive !== "string" || !["active", "archived", "all"].includes(archive) ||
      typeof sort !== "string" || !["name", "updated"].includes(sort) ||
      typeof order !== "string" || !["asc", "desc"].includes(order) ||
      (query.search !== undefined && typeof query.search !== "string")) {
    throw new CutsceneRequestError(400, "Некорректные фильтры каталога");
  }
  const clauses: string[] = [];
  const params: number[] = [];
  if (archive !== "all") clauses.push(`c.archived_at IS ${archive === "active" ? "NULL" : "NOT NULL"}`);
  if (query.campaignId !== undefined) {
    const campaignId = cutsceneId(query.campaignId);
    requireCutsceneContext("campaign", campaignId);
    clauses.push("EXISTS (SELECT 1 FROM campaign_cutscenes b WHERE b.cutscene_id = c.id AND b.campaign_id = ?)");
    params.push(campaignId);
  }
  const rows = db.prepare(`SELECT ${summaryColumns} FROM cutscenes c
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`).all(...params) as CutsceneRow[];
  // SQLite's lower()/NOCASE only fold ASCII; catalogue search must also work in Russian.
  const search = String(query.search ?? "").trim().toLocaleLowerCase("ru");
  const filtered = search ? rows.filter(row =>
    `${row.name}\n${row.description}`.toLocaleLowerCase("ru").includes(search)) : rows;
  const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
  const direction = order === "asc" ? 1 : -1;
  filtered.sort((a, b) => direction * (sort === "name"
    ? collator.compare(a.name, b.name) || a.id - b.id
    : a.updated_at.localeCompare(b.updated_at) || a.id - b.id));
  return filtered.map(summary);
}

export type CutsceneContext = "campaign" | "session";

export function requireCutsceneContext(context: CutsceneContext, id: number): void {
  const table = context === "campaign" ? "campaigns" : "sessions";
  if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) {
    throw new CutsceneRequestError(404, context === "campaign" ? "Кампания не найдена" : "Сессия не найдена");
  }
}

export function readCutsceneBindings(context: CutsceneContext, id: number) {
  requireCutsceneContext(context, id);
  if (context === "campaign") {
    return (db.prepare(`SELECT ${summaryColumns} FROM cutscenes c JOIN campaign_cutscenes b ON b.cutscene_id = c.id
      WHERE b.campaign_id = ? ORDER BY c.name, c.id`).all(id) as CutsceneRow[]).map(summary);
  }
  return (db.prepare(`SELECT ${summaryColumns} FROM cutscenes c JOIN session_cutscenes b ON b.cutscene_id = c.id
    WHERE b.session_id = ? ORDER BY b.position`).all(id) as CutsceneRow[]).map(summary);
}

export function replaceCutsceneBindings(context: CutsceneContext, id: number, raw: unknown) {
  if (!Array.isArray(raw)) throw new CutsceneRequestError(400, "Нужен список cutsceneIds");
  const ids = raw.map(cutsceneId);
  if (new Set(ids).size !== ids.length) throw new CutsceneRequestError(400, "Повторы катсцены недопустимы");
  return db.transaction(() => {
    requireCutsceneContext(context, id);
    for (const cutscene of ids) readCutscene(cutscene);
    if (context === "campaign") {
      db.prepare("DELETE FROM campaign_cutscenes WHERE campaign_id = ?").run(id);
      const insert = db.prepare("INSERT INTO campaign_cutscenes (campaign_id, cutscene_id) VALUES (?, ?)");
      for (const cutscene of ids) insert.run(id, cutscene);
    } else {
      db.prepare("DELETE FROM session_cutscenes WHERE session_id = ?").run(id);
      const insert = db.prepare("INSERT INTO session_cutscenes (session_id, cutscene_id, position) VALUES (?, ?, ?)");
      ids.forEach((cutscene, position) => insert.run(id, cutscene, position));
    }
    return readCutsceneBindings(context, id);
  })();
}

export function removeCutsceneBinding(context: CutsceneContext, id: number, cutscene: number): void {
  db.transaction(() => {
    requireCutsceneContext(context, id);
    if (context === "campaign") {
      db.prepare("DELETE FROM campaign_cutscenes WHERE campaign_id = ? AND cutscene_id = ?").run(id, cutscene);
    } else {
      // Rebuild contiguous positions atomically; UNIQUE(session_id, position) stays true throughout.
      const remaining = readCutsceneBindings(context, id).filter(item => item.id !== cutscene).map(item => item.id);
      replaceCutsceneBindings(context, id, remaining);
    }
  })();
}
