import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db } from "../db/db";
import { vaultAbs } from "./filesystem";

// Автономный HTML и резервная копия листа D&D в форматах OneShot (гриллинг
// 2026-09-26, Q13/Q14): одно и то же открывается в OneShot через «Импортировать
// персонажа» / «Восстановить из копии». Справочник — как в
// SoyMan_1shot/prepare-catalog.mjs (секрет не выбирается: это уходит игроку),
// ссылки — как в SoyMan_1shot/app/export-audit.mjs. ponytail: логика среза
// повторяет export-audit.mjs; при правке одной — править обе.

const ENTRY_KEYS = new Set([
  "entryId", "classId", "subclassId", "raceId", "backgroundId", "sourceParentId",
  "featureEntryId", "spellEntryId", "schemeEntryId", "baseEntryId",
]);
// Общие правила едут всегда: их читают подсказки листа (portable.mjs).
const COMMON_GROUPS = ["Состояния", "Типы урона", "Особое восприятие", "Навыки", "Свойства оружия", "Мастерство оружия", "Оружейные приёмы"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown> & { id: number; parent_id: number | null; section_id: number; kind: string; avatar_image_path: string | null };

const ENTRY_COLUMNS =
  "id, uid, section_id, parent_id, name, name_original, aliases, kind, level, position, data, description, avatar_image_path, combat_roles, tactics";

function list(raw: unknown): unknown[] {
  try {
    const v = JSON.parse(typeof raw === "string" ? raw : "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function collectRefs(value: unknown, into: Set<number>) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (ENTRY_KEYS.has(key) && Number.isSafeInteger(child) && (child as number) > 0) into.add(child as number);
    else if (child && typeof child === "object") collectRefs(child, into);
  }
}

async function imageDataUrl(rel: string | null, mode: "preview" | "large" | "portrait"): Promise<string | null> {
  if (!rel) return null;
  let full: Buffer;
  try {
    full = await readFile(path.isAbsolute(rel) ? rel : vaultAbs(rel));
  } catch {
    return null;
  }
  if (mode === "large") {
    const ext = path.extname(rel).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : null;
    if (mime) return `data:${mime};base64,${full.toString("base64")}`;
  }
  const width = mode === "preview" ? 320 : 1200;
  const out = await sharp(full).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return `data:image/webp;base64,${out.toString("base64")}`;
}

function entryOut(row: Row, creatureStatblock: (id: number) => unknown) {
  const { combat_roles, tactics, avatar_image_path: _path, ...rest } = row;
  return {
    ...rest,
    data: JSON.parse((row.data as string) || "{}"),
    aliases: list(row.aliases),
    ...(row.kind === "monster"
      ? { creature: { combat_roles: list(combat_roles), tactics: list(tactics), statblock: creatureStatblock(row.id) ?? null } }
      : {}),
  };
}

export class PortableExportError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * kind "html" — payload автономного листа (срез справочника под персонажа,
 * превью картинок); kind "backup" — резервная копия OneShot (весь
 * справочник системы, превью — у записей персонажа, большие — по largeCards).
 */
export async function buildPortableExport(statblockId: number, kind: "html" | "backup", largeCards: boolean) {
  const sb = db
    .prepare("SELECT id, owner_type, owner_id, content, avatar_image_path FROM statblocks WHERE id = ? AND archived_at IS NULL AND format = 'dnd_character'")
    .get(statblockId) as { id: number; owner_type: string; owner_id: number; content: string; avatar_image_path: string | null } | undefined;
  if (!sb) throw new PortableExportError(404, "Лист не найден");
  const content = JSON.parse(sb.content || "{}") as Record<string, unknown>;
  const owner =
    sb.owner_type === "character"
      ? (db.prepare("SELECT avatar_image_path, character_uid FROM characters WHERE id = ?").get(sb.owner_id) as
          | { avatar_image_path: string | null; character_uid: string | null }
          | undefined)
      : undefined;

  const systemId = Number(content.systemId);
  const system = db.prepare("SELECT id, name, code, description FROM systems WHERE id = ?").get(systemId) as Record<string, unknown> | undefined;
  if (!system) throw new PortableExportError(422, "У листа не найдена система справочника");

  const creature = db.prepare(
    "SELECT id, kind, format, content, theme, density FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = 'dnd_creature' ORDER BY CASE kind WHEN 'full' THEN 0 ELSE 1 END, id LIMIT 1",
  );
  const creatureStatblock = (id: number) => creature.get(id);
  const byId = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM compendium_entries WHERE id = ?`);

  // Срез персонажа: его ссылки + общие правила, с цепочкой родителей (без
  // родителя parseCatalog в OneShot отвергает запись). Пропавшие записи
  // (лист показывает «ссылки потеряны») просто не едут.
  const refs = new Set<number>();
  collectRefs(content, refs);
  const groups = db
    .prepare(`SELECT id FROM compendium_entries WHERE system_id = ? AND name IN (${COMMON_GROUPS.map(() => "?").join(",")})`)
    .all(systemId, ...COMMON_GROUPS) as { id: number }[];
  for (const g of groups) {
    refs.add(g.id);
    for (const c of db.prepare("SELECT id FROM compendium_entries WHERE parent_id = ?").all(g.id) as { id: number }[]) refs.add(c.id);
  }
  const slice = new Map<number, Row>();
  const include = (id: number, depth = 0) => {
    if (slice.has(id) || depth > 20) return;
    const row = byId.get(id) as Row | undefined;
    if (!row) return;
    slice.set(id, row);
    if (row.parent_id != null) include(row.parent_id, depth + 1);
  };
  for (const id of refs) include(id);

  const rows =
    kind === "html"
      ? [...slice.values()].sort((a, b) => a.id - b.id)
      : (db.prepare(`SELECT ${ENTRY_COLUMNS} FROM compendium_entries WHERE system_id = ? ORDER BY id`).all(systemId) as Row[]);
  const entries = [];
  for (const row of rows) {
    const out: Record<string, unknown> = entryOut(row, creatureStatblock);
    if (slice.has(row.id)) {
      out.avatar_preview_url = await imageDataUrl(row.avatar_image_path, "preview");
      if (kind === "backup" && largeCards) out.avatar_large_url = await imageDataUrl(row.avatar_image_path, "large");
    }
    entries.push(out);
  }
  const sectionIds = [...new Set(entries.map((e) => e.section_id as number))];
  const sections = sectionIds.length
    ? db.prepare(`SELECT id, name, kind, position FROM system_sections WHERE id IN (${sectionIds.map(() => "?").join(",")})`).all(...sectionIds)
    : [];
  const catalog = { system, sections, entries };

  const portrait = await imageDataUrl(owner?.avatar_image_path ?? sb.avatar_image_path, "portrait");
  const name = typeof content.characterName === "string" ? content.characterName : "";
  const characterUid = owner?.character_uid && UUID.test(owner.character_uid) ? owner.character_uid.toLowerCase() : null;

  if (kind === "backup") {
    return {
      format: "soyman-1shot-backup",
      version: 1,
      character: { name, content, portrait, characterUid },
      catalog,
    };
  }
  // Как portablePayload в OneShot: пересылки между персонажами — только
  // внутри кампании, в автономный лист не едут.
  for (const section of (content.equipmentSections as { items?: Record<string, unknown>[] }[] | undefined) ?? []) {
    for (const item of section.items ?? []) {
      delete item.transferIn;
      delete item.transferOut;
    }
  }
  return {
    format: "soyman-1shot-portable",
    version: characterUid ? 2 : 1,
    exportedAt: new Date().toISOString(),
    ...(characterUid ? { identity: { characterUid } } : {}),
    character: { name, content, portrait },
    catalog,
  };
}
