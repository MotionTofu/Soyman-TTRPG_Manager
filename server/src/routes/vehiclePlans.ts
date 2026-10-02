// Чертёж транспорта (гриллинг профилей 2026-10-02, Q9; тикет 05): картинка
// судна и пины на ней. Пин — пост экипажа (дочерняя запись судна) или
// метка-подпись без сущности («трюм», «баллиста»). Тела пинов те же, что у
// пинов карты места: клиентское ядро «картинка + пины» (PinBoard) общее.
//
// Только Мастер: роутер стоит за общим гейтом /api (index.ts).
import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db/db";
import { entryImageFolder, toFileUrl, writeReplacingOldFile } from "../services/filesystem";
import { removeOrArchive } from "../services/vaultDedup";

export const vehiclePlansRouter = Router();

const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(jpeg|png|gif|webp|avif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});
const MAX_PINS = 100;
const MAX_LABEL = 80;

interface Ship {
  id: number;
  name: string;
  kind: string;
  blueprint_image_path: string | null;
  system_folder_path: string | null;
}

function shipOf(entryId: unknown): Ship | undefined {
  return db
    .prepare(
      `SELECT ce.id, ce.name, ce.kind, ce.blueprint_image_path, sy.folder_path AS system_folder_path
         FROM compendium_entries ce JOIN systems sy ON sy.id = ce.system_id
        WHERE ce.id = ? AND ce.parent_id IS NULL`
    )
    .get(entryId) as Ship | undefined;
}

function pinsOf(entryId: number) {
  return db
    .prepare(
      `SELECT p.*, post.name AS post_name FROM blueprint_pins p
       LEFT JOIN compendium_entries post ON post.id = p.post_id
       WHERE p.entry_id = ? ORDER BY p.created_at, p.id`
    )
    .all(entryId);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
const percent = (v: unknown) => {
  const n = finite(v);
  return n == null ? null : Math.max(0, Math.min(100, n));
};

vehiclePlansRouter.get("/:entryId", (req, res) => {
  const ship = shipOf(req.params.entryId);
  if (!ship) return res.status(404).json({ error: "not found" });
  res.json({
    blueprint_image_url: ship.blueprint_image_path ? toFileUrl(ship.blueprint_image_path) : null,
    pins: pinsOf(ship.id),
  });
});

vehiclePlansRouter.post("/:entryId/image", upload.single("file"), async (req, res) => {
  const ship = shipOf(req.params.entryId);
  if (!ship) return res.status(404).json({ error: "not found" });
  if (!ship.system_folder_path) return res.status(400).json({ error: "system folder is missing" });
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const ext = (path.extname(req.file.originalname) || ".jpg").toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return res.status(400).json({ error: "Недопустимое расширение файла" });
  const target = path.join(entryImageFolder(ship.system_folder_path, ship.kind), `entry-${ship.id}-blueprint${ext}`);
  await writeReplacingOldFile(target, req.file.buffer, ship.blueprint_image_path);
  db.prepare("UPDATE compendium_entries SET blueprint_image_path = ? WHERE id = ?").run(target, ship.id);
  res.json({ blueprint_image_url: toFileUrl(target) });
});

// «Убрать чертёж» — картинка в _Archive, пины вместе с ней: без картинки их
// координаты ничего не значат.
vehiclePlansRouter.delete("/:entryId/image", (req, res) => {
  const ship = shipOf(req.params.entryId);
  if (!ship) return res.status(404).json({ error: "not found" });
  if (ship.blueprint_image_path) removeOrArchive(ship.blueprint_image_path, "archive", "compendium_entry", ship.id, ship.name);
  db.transaction(() => {
    db.prepare("UPDATE compendium_entries SET blueprint_image_path = NULL WHERE id = ?").run(ship.id);
    db.prepare("DELETE FROM blueprint_pins WHERE entry_id = ?").run(ship.id);
  })();
  res.json({ ok: true });
});

// Пин поста (post_id — пост этого судна) или метка (text).
vehiclePlansRouter.post("/:entryId/pins", (req, res) => {
  const ship = shipOf(req.params.entryId);
  if (!ship) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const x = percent(body.x);
  const y = percent(body.y);
  if (x == null || y == null) return res.status(400).json({ error: "x, y are required" });
  const postId = finite(body.post_id);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_LABEL) : "";
  if (postId == null && !text) return res.status(400).json({ error: "Нужен пост или текст метки" });
  if (postId != null && !db.prepare("SELECT 1 FROM compendium_entries WHERE id = ? AND parent_id = ?").get(postId, ship.id))
    return res.status(400).json({ error: "Это не пост этого судна" });
  const count = (db.prepare("SELECT COUNT(*) AS n FROM blueprint_pins WHERE entry_id = ?").get(ship.id) as { n: number }).n;
  if (count >= MAX_PINS) return res.status(400).json({ error: `Максимум ${MAX_PINS} пинов на чертеже` });
  const info = db
    .prepare(
      `INSERT INTO blueprint_pins (entry_id, post_id, text, x, y, color, size, border_color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ship.id,
      postId,
      postId == null ? text : "",
      x,
      y,
      typeof body.color === "string" ? body.color : null,
      finite(body.size),
      typeof body.border_color === "string" ? body.border_color : null
    );
  res.status(201).json(db.prepare("SELECT * FROM blueprint_pins WHERE id = ?").get(info.lastInsertRowid));
});

vehiclePlansRouter.put("/pins/:pinId", (req, res) => {
  const pin = db.prepare("SELECT id, post_id FROM blueprint_pins WHERE id = ?").get(req.params.pinId) as
    | { id: number; post_id: number | null }
    | undefined;
  if (!pin) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Текст правится только у метки: у поста подпись — имя поста.
  const text = pin.post_id == null && typeof body.text === "string" ? body.text.trim().slice(0, MAX_LABEL) : null;
  if (text === "") return res.status(400).json({ error: "У метки должен быть текст" });
  db.prepare(
    `UPDATE blueprint_pins SET
       x = COALESCE(?, x), y = COALESCE(?, y),
       text = COALESCE(?, text),
       color = CASE WHEN ? THEN NULL ELSE COALESCE(?, color) END,
       size = COALESCE(?, size),
       border_color = CASE WHEN ? THEN NULL ELSE COALESCE(?, border_color) END
     WHERE id = ?`
  ).run(
    percent(body.x),
    percent(body.y),
    text,
    body.clear_color ? 1 : 0,
    typeof body.color === "string" ? body.color : null,
    finite(body.size),
    body.clear_border_color ? 1 : 0,
    typeof body.border_color === "string" ? body.border_color : null,
    pin.id
  );
  res.json(db.prepare("SELECT * FROM blueprint_pins WHERE id = ?").get(pin.id));
});

vehiclePlansRouter.delete("/pins/:pinId", (req, res) => {
  db.prepare("DELETE FROM blueprint_pins WHERE id = ?").run(req.params.pinId);
  res.json({ ok: true });
});
