import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { parseLongStoryShort } from "../services/lssImport";
import { broadcastCharacterUpdate } from "../services/realtime";
import { syncCreatureDataFromStatblock } from "../services/monsterSummary";
import { beingFolder, ensureSubfolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { removeOrArchive } from "../services/vaultDedup";
import { ensureCharacterFolder } from "./characters";
import { mergeContentPatch } from "../db/statblockContent";

export const statblocksRouter = Router();
const ALLOWED_IMAGE_MIMES = /^image\/(jpeg|png|gif|webp|avif)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

function withAvatarUrl<T extends { avatar_image_path?: string | null }>(row: T) {
  return { ...row, avatar_image_url: row.avatar_image_path ? toFileUrl(row.avatar_image_path) : null };
}

// A statblock's owner (character/being/compendium_entry) already has its own
// folder for characters/beings — compendium entries don't (a system's
// bestiary can have thousands of them, so no per-entry folder was ever
// created), so those share one "Statblocks" folder under the system, keyed
// by statblock id in the filename to avoid collisions.
function resolveStatblockOwnerFolder(ownerType: string, ownerId: number): string | null {
  if (ownerType === "character") {
    return ensureCharacterFolder(ownerId);
  }
  if (ownerType === "being") {
    const being = db
      .prepare(
        `SELECT b.name, b.folder_path, s.folder_path AS setting_folder_path
         FROM setting_beings b JOIN settings s ON s.id = b.setting_id WHERE b.id = ?`
      )
      .get(ownerId) as { name: string; folder_path: string | null; setting_folder_path: string } | undefined;
    if (!being) return null;
    return being.folder_path || beingFolder(being.setting_folder_path, being.name);
  }
  if (ownerType === "compendium_entry") {
    const entry = db
      .prepare(
        `SELECT sy.folder_path AS system_folder_path
         FROM compendium_entries ce JOIN systems sy ON sy.id = ce.system_id WHERE ce.id = ?`
      )
      .get(ownerId) as { system_folder_path: string } | undefined;
    if (!entry) return null;
    return ensureSubfolder(entry.system_folder_path, "Statblocks");
  }
  return null;
}

const ALLOWED_OWNER_TYPES = new Set(["character", "being", "compendium_entry"]);

// Preview without DB write — returns parsed summary + warnings so client can show modal before confirm
statblocksRouter.post("/import/preview", (req, res) => {
  const { owner_type, owner_id, json } = req.body as {
    owner_type: string;
    owner_id: number;
    json: string;
  };
  if (!owner_type || owner_id == null || !json)
    return res.status(400).json({ error: "owner_type, owner_id и json обязательны" });
  if (!ALLOWED_OWNER_TYPES.has(owner_type))
    return res.status(400).json({ error: `Недопустимый owner_type: ${owner_type}` });
  if (owner_type !== "character")
    return res.status(400).json({ error: "Импорт Long Story Short доступен только для персонажей" });
  const numericOwnerId = Number(owner_id);
  if (!Number.isFinite(numericOwnerId) || numericOwnerId <= 0)
    return res.status(400).json({ error: "Некорректный owner_id" });
  if (typeof json !== "string" || !json.trim())
    return res.status(400).json({ error: "json должен быть непустой строкой" });
  let parsed: ReturnType<typeof parseLongStoryShort>;
  try {
    parsed = parseLongStoryShort(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: "Не удалось разобрать файл: " + msg.split("\n")[0].slice(0, 500) });
  }
  // Summarize for preview table without leaking full characterData (too large)
  const cd = parsed.characterData as Record<string, unknown>;
  const classes = cd.classes as { className: string; subclassName: string; level: number }[] | undefined;
  const attacks = cd.attacks as { name: string }[] | undefined;
  const equipSections = cd.equipmentSections as { items: unknown[] }[] | undefined;
  const preview = {
    characterName: parsed.characterName,
    shortText: parsed.shortText,
    warnings: parsed.warnings,
    summary: {
      raceName: cd.raceName,
      raceId: cd.raceId,
      className: classes?.[0]?.className ?? "",
      subclassName: classes?.[0]?.subclassName ?? "",
      classId: (classes?.[0] as Record<string, unknown> | undefined)?.classId ?? null,
      subclassId: (classes?.[0] as Record<string, unknown> | undefined)?.subclassId ?? null,
      level: classes?.[0]?.level ?? 1,
      armorClass: cd.armorClass,
      hitPointMax: cd.hitPointMax,
      speed: cd.speed,
      abilities: cd.abilities,
      skillCount: Object.keys((cd.skillProfs as object) ?? {}).length,
      attackCount: attacks?.length ?? 0,
      equipmentCount: equipSections?.[0]?.items?.length ?? 0,
      hasSpells: false, // LSS spells are IDs, not mappable — preview flags via warnings
    },
  };
  res.json(preview);
});

statblocksRouter.post("/import", (req, res) => {
  const { owner_type, owner_id, json } = req.body as {
    owner_type: string;
    owner_id: number;
    json: string;
  };
  if (!owner_type || owner_id == null || !json)
    return res.status(400).json({ error: "owner_type, owner_id и json обязательны" });
  if (!ALLOWED_OWNER_TYPES.has(owner_type))
    return res.status(400).json({ error: `Недопустимый owner_type: ${owner_type}` });
  const numericOwnerId = Number(owner_id);
  if (!Number.isFinite(numericOwnerId) || numericOwnerId <= 0)
    return res.status(400).json({ error: "Некорректный owner_id" });
  if (typeof json !== "string" || !json.trim())
    return res.status(400).json({ error: "json должен быть непустой строкой" });
  // LSS import is only meaningful for characters — being/compendium_entry get a plain text fallback
  if (owner_type !== "character") {
    return res.status(400).json({ error: "Импорт Long Story Short доступен только для персонажей (owner_type=character)" });
  }
  // Early owner existence check (character)
  const ownerExists = db.prepare("SELECT id FROM characters WHERE id = ?").get(numericOwnerId);
  if (!ownerExists) return res.status(404).json({ error: "Персонаж не найден" });

  let parsed: ReturnType<typeof parseLongStoryShort>;
  try {
    parsed = parseLongStoryShort(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Avoid leaking full stack — only first line
    const safe = msg.split("\n")[0].slice(0, 500);
    return res.status(400).json({ error: "Не удалось разобрать файл: " + safe });
  }

  const note = `Импортировано из Long Story Short${parsed.characterName ? ` (${parsed.characterName})` : ""}`;
  const insert = db.transaction((content: string) => {
    const info = db
      .prepare(
        "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(owner_type, numericOwnerId, "full", "dnd_character", content, note);
    return info.lastInsertRowid;
  });

  let newId: number | bigint;
  try {
    newId = insert(JSON.stringify(parsed.characterData));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: "Не удалось сохранить статблок: " + msg.slice(0, 300) });
  }

  // Realtime — same as PUT /:id so other windows refresh
  try {
    broadcastCharacterUpdate(numericOwnerId);
  } catch {
    /* broadcast is best-effort */
  }

  const row = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(newId) as { avatar_image_path: string | null };
  res.status(201).json({
    characterName: parsed.characterName,
    warnings: parsed.warnings,
    shortText: parsed.shortText,
    statblock: withAvatarUrl(row),
  });
});

statblocksRouter.get("/", (req, res) => {
  const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
  if (!owner_type || !owner_id)
    return res.status(400).json({ error: "owner_type and owner_id are required" });
  const rows = db
    .prepare(
      "SELECT * FROM statblocks WHERE owner_type = ? AND owner_id = ? AND archived_at IS NULL ORDER BY created_at"
    )
    .all(owner_type, owner_id) as { avatar_image_path: string | null }[];
  res.json(rows.map(withAvatarUrl));
});

statblocksRouter.post("/", (req, res) => {
  const { owner_type, owner_id, kind, format, content, note } = req.body as {
    owner_type: string;
    owner_id: number;
    kind?: string;
    format?: string;
    content?: string;
    note?: string;
  };
  if (!owner_type || !owner_id)
    return res.status(400).json({ error: "owner_type and owner_id are required" });
  const info = db
    .prepare(
      `INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`
    )
    .run(owner_type, owner_id, kind ?? "full", format ?? "text", content ?? "", note ?? "");
  const row = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(info.lastInsertRowid) as {
    owner_type: string;
    owner_id: number;
    format: string;
    avatar_image_path: string | null;
  };
  // Сохранение dnd-статблока монстра — источник истины: сводка разделов идёт
  // в ту же секунду (см. обратный ход writeDndCreatureSummary).
  if (row.owner_type === "compendium_entry" && row.format === "dnd_creature") {
    syncCreatureDataFromStatblock(db, row.owner_id);
  }
  res.status(201).json(withAvatarUrl(row));
});

// Форматы, у которых `content` — это JSON. Пустая строка допустима: так
// заводится свежий статблок до первого сохранения.
const JSON_FORMATS = new Set(["litm_character", "litm_challenge", "dnd_character", "dnd_creature", "zip_character", "zip_creature"]);

statblocksRouter.put("/:id", (req, res) => {
  const { kind, content, note, theme, density, contentPatch, baseUpdatedAt } = req.body as {
    kind?: string;
    content?: string;
    note?: string;
    theme?: string;
    density?: string;
    contentPatch?: Record<string, unknown>;
    baseUpdatedAt?: string | null;
  };
  // Раньше UPDATE по несуществующему id молча ничего не менял, а ответом
  // уходил 200 с пустым телом — клиент считал, что сохранил. Статблок, снесённый
  // на другом устройстве, съедал правку без единого следа.
  const existing = db
    .prepare("SELECT id, format, content, updated_at FROM statblocks WHERE id = ?")
    .get(req.params.id) as
    | { id: number; format: string; content: string; updated_at: string | null }
    | undefined;
  if (!existing) return res.status(404).json({ error: "Статблок не найден — возможно, он удалён" });
  // Снимок целиком принимается только поверх той версии, которую отправитель
  // видел. Патчу проверка не нужна: он не трогает чужих полей.
  if (
    typeof content === "string" &&
    typeof baseUpdatedAt === "string" &&
    existing.updated_at &&
    existing.updated_at !== baseUpdatedAt
  ) {
    return res.status(409).json({
      error: "Статблок изменён в другом окне — откройте его заново, чтобы не потерять чужую правку",
      updated_at: existing.updated_at,
    });
  }
  if (contentPatch !== undefined) {
    if (contentPatch === null || typeof contentPatch !== "object" || Array.isArray(contentPatch)) {
      return res.status(400).json({ error: "contentPatch должен быть объектом" });
    }
    if (!JSON_FORMATS.has(existing.format)) {
      return res.status(400).json({ error: "contentPatch применим только к JSON-форматам" });
    }
  }
  // Битый JSON в content означает, что лист откроется пустым (normalize*
  // разбирает `{}` вместо данных) — то есть тихая потеря чарника. Дешевле
  // отказать здесь, чем разбирать потом.
  if (typeof content === "string" && content.trim() && JSON_FORMATS.has(existing.format)) {
    try {
      JSON.parse(content);
    } catch {
      return res.status(400).json({ error: "content не разбирается как JSON" });
    }
  }
  const nextContent =
    contentPatch !== undefined
      ? mergeContentPatch(existing.content ?? "", contentPatch)
      : (content ?? null);
  db.prepare(
    `UPDATE statblocks SET
       kind = COALESCE(?, kind), content = COALESCE(?, content), note = COALESCE(?, note),
       theme = COALESCE(?, theme), density = COALESCE(?, density),
       updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
     WHERE id = ?`
  ).run(kind ?? null, nextContent, note ?? null, theme ?? null, density ?? null, req.params.id);
  const updated = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(req.params.id) as
    | {
        owner_type: string;
        owner_id: number;
        format: string;
        avatar_image_path: string | null;
      }
    | undefined;
  if (!updated) {
    res.status(404).json({ error: "Статблок не найден" });
    return;
  }
  if (updated.owner_type === "character") broadcastCharacterUpdate(updated.owner_id);
  // Правка dnd-статблока монстра синхронизируется со сводкой записи — новое
  // значение КО/размера видно в разделе сразу, без переимпорта.
  if (updated.owner_type === "compendium_entry" && updated.format === "dnd_creature") {
    syncCreatureDataFromStatblock(db, updated.owner_id);
  }
  res.json(withAvatarUrl(updated));
});

statblocksRouter.post("/:id/avatar", upload.single("file"), async (req, res) => {
  const statblock = db
    .prepare("SELECT id, owner_type, owner_id, avatar_image_path FROM statblocks WHERE id = ?")
    .get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number; avatar_image_path: string | null }
    | undefined;
  if (!statblock) return res.status(404).json({ error: "not found" });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const folder = resolveStatblockOwnerFolder(statblock.owner_type, statblock.owner_id);
  if (!folder) return res.status(404).json({ error: "owner not found" });

  const ext = path.extname(req.file.originalname) || ".jpg";
  const target = path.join(folder, `statblock-${statblock.id}-avatar${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, statblock.avatar_image_path, "avatar");

  db.prepare("UPDATE statblocks SET avatar_image_path = ? WHERE id = ?").run(target, statblock.id);
  if (statblock.owner_type === "character") broadcastCharacterUpdate(statblock.owner_id);
  res.json(withAvatarUrl({ avatar_image_path: target }));
});

// Убрать портрет статблока — с вкладки «Изображения» профиля записи, где
// портреты статблоков стоят рядом с аватаром самой записи. Файл уходит в
// _Archive той же дорогой, что и остальные удалённые картинки хранилища.
statblocksRouter.delete("/:id/avatar", (req, res) => {
  const statblock = db
    .prepare("SELECT id, owner_type, owner_id, avatar_image_path FROM statblocks WHERE id = ?")
    .get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number; avatar_image_path: string | null }
    | undefined;
  if (!statblock) return res.status(404).json({ error: "not found" });
  if (statblock.avatar_image_path) {
    removeOrArchive(
      statblock.avatar_image_path,
      "archive",
      "statblock",
      statblock.id,
      `Портрет статблока ${statblock.id}`
    );
  }
  db.prepare("UPDATE statblocks SET avatar_image_path = NULL WHERE id = ?").run(statblock.id);
  if (statblock.owner_type === "character") broadcastCharacterUpdate(statblock.owner_id);
  res.json({ avatar_image_url: null });
});

// Мягкое удаление. Раньше строка сносилась физически, и единственной
// преградой был `confirm("удалить ЭТО?")` — импортированный из LSS чарник
// уходил навсегда с одного промаха. Теперь ставится `archived_at`, GET такой
// статблок не отдаёт, а PUT /:id/restore возвращает его целиком, вместе с
// портретом: файл-портрет поэтому здесь НЕ архивируется.
statblocksRouter.delete("/:id", (req, res) => {
  const statblock = db
    .prepare(
      "SELECT id, owner_type, owner_id, format FROM statblocks WHERE id = ? AND archived_at IS NULL"
    )
    .get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number; format: string }
    | undefined;
  if (!statblock) return res.status(404).json({ error: "not found" });

  db.transaction(() => {
    db.prepare("UPDATE statblocks SET archived_at = datetime('now') WHERE id = ?").run(statblock.id);
    syncEntrySummaryAfterCreatureChange(statblock);
  })();

  if (statblock.owner_type === "character") broadcastCharacterUpdate(statblock.owner_id);
  res.json({ ok: true });
});

// Отмена удаления (тост «Отменить» в StatblockList).
statblocksRouter.put("/:id/restore", (req, res) => {
  const statblock = db
    .prepare("SELECT id, owner_type, owner_id, format FROM statblocks WHERE id = ?")
    .get(req.params.id) as
    | { id: number; owner_type: string; owner_id: number; format: string }
    | undefined;
  if (!statblock) return res.status(404).json({ error: "not found" });

  db.prepare("UPDATE statblocks SET archived_at = NULL WHERE id = ?").run(statblock.id);
  // Сводка записи бестиария снимается при удалении — на возврате её надо
  // пересобрать из вернувшегося статблока, иначе фильтры останутся пустыми.
  if (statblock.owner_type === "compendium_entry" && statblock.format === "dnd_creature") {
    syncCreatureDataFromStatblock(db, statblock.owner_id);
  }
  if (statblock.owner_type === "character") broadcastCharacterUpdate(statblock.owner_id);
  const row = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(statblock.id) as {
    avatar_image_path: string | null;
  };
  res.json(withAvatarUrl(row));
});

// Для компендиум-монстра: если убран последний живой dnd_creature, сводка
// записи (data.cr/size/creature_type) перестаёт подтверждаться источником
// истины — чистим её, чтобы фильтры бестиария не показывали мёртвые значения
// (находка 10.2). Живые dnd_character/litm статблоки не мешают: их поля живут
// в другом пространстве имён. Вызывается внутри транзакции удаления.
function syncEntrySummaryAfterCreatureChange(statblock: {
  owner_type: string;
  owner_id: number;
  format: string;
}): void {
  if (statblock.owner_type !== "compendium_entry" || statblock.format !== "dnd_creature") return;
  const remaining = db
    .prepare(
      "SELECT COUNT(*) AS c FROM statblocks WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = 'dnd_creature' AND archived_at IS NULL"
    )
    .get(statblock.owner_id) as { c: number };
  if (remaining.c > 0) return;
  const entry = db.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(statblock.owner_id) as
    | { data: string }
    | undefined;
  if (!entry) return;
  try {
    const data = JSON.parse(entry.data ?? "{}") as Record<string, unknown>;
    if ("cr" in data || "size" in data || "creature_type" in data) {
      delete data.cr;
      delete data.size;
      delete data.creature_type;
      db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(
        JSON.stringify(data),
        statblock.owner_id
      );
    }
  } catch {
    // Битый JSON в data не должен мешать удалению статблока.
  }
}
