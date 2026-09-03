import { Router } from "express";
import { db } from "../db/db";
import type { AuthedRequest } from "../services/auth";
import {
  emptyCellsBlob,
  isThumbnail,
  validateCellsBlob,
  validateMapCreate,
  MAP_MIN_SIDE,
  MAP_MAX_SIDE,
  MAP_SCALES,
} from "./mapsValidation";

// Раздел «Карты»: CRUD тайловых полей. Игрокам — только чтение видимых
// (player_visible=1): остальное режет apiRoleGate, а видимость строк —
// запросы ниже через isPlayer(). Запись игрокам запрещена гейтом целиком.
export const mapsRouter = Router();

function isPlayer(req: AuthedRequest): boolean {
  return req.user?.role === "player";
}

function parentExists(id: number): boolean {
  return !!db.prepare("SELECT id FROM maps WHERE id = ?").get(id);
}

const META_COLUMNS =
  "id, name, grid, scale, width, height, cell_lore, seed, sea, mountains, forest, thumbnail, player_visible, parent_map_id, created_at, updated_at";

// Список без миниатюр (P0-2): thumbnail до 300k символов на карту —
// отдавать его на каждую строку списка значит грузить мегабайты за один
// запрос. Плитки догружают превью точечно через GET /:id/thumbnail.
const LIST_COLUMNS =
  "id, name, grid, scale, width, height, cell_lore, seed, sea, mountains, forest, player_visible, parent_map_id, created_at, updated_at";

mapsRouter.get("/", (req: AuthedRequest, res) => {
  const where = isPlayer(req) ? "WHERE player_visible = 1" : "";
  const rows = db
    .prepare(`SELECT ${LIST_COLUMNS} FROM maps ${where} ORDER BY updated_at DESC, id DESC`)
    .all();
  res.json(rows);
});

// Точечная догрузка превью для плиток списка (те же правила видимости,
// что у GET /:id — скрытое игрокам отдаёт 404).
mapsRouter.get("/:id/thumbnail", (req: AuthedRequest, res) => {
  const row = db
    .prepare("SELECT id, thumbnail, player_visible FROM maps WHERE id = ?")
    .get(req.params.id) as { id: number; thumbnail: string | null; player_visible: number } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (isPlayer(req) && !row.player_visible) return res.status(404).json({ error: "not found" });
  // Превью печётся мастерским рендером (видны секреты): игрокам его не
  // отдаём вообще — иначе позиции секретных дверей утекут через список.
  if (isPlayer(req)) return res.json({ id: row.id, thumbnail: null });
  res.json({ id: row.id, thumbnail: row.thumbnail });
});

mapsRouter.post("/", (req: AuthedRequest, res) => {
  const result = validateMapCreate(req.body ?? {}, parentExists);
  if ("error" in result) return res.status(400).json({ error: result.error });
  const v = result.value;
  const info = db
    .prepare(
      `INSERT INTO maps (name, grid, scale, width, height, cell_lore, seed, sea, mountains, forest, cells, thumbnail, player_visible, parent_map_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.name, v.grid, v.scale, v.width, v.height, v.cell_lore, v.seed, v.sea,
      v.mountains, v.forest, v.cells, v.thumbnail, v.player_visible, v.parent_map_id
    );
  res
    .status(201)
    .json(db.prepare(`SELECT ${META_COLUMNS}, cells FROM maps WHERE id = ?`).get(info.lastInsertRowid));
});

mapsRouter.get("/:id", (req: AuthedRequest, res) => {
  const row = db
    .prepare(`SELECT ${META_COLUMNS}, cells FROM maps WHERE id = ?`)
    .get(req.params.id) as { player_visible: number; cells: string } | undefined;
  if (!row) return res.status(404).json({ error: "not found" });
  if (isPlayer(req) && !row.player_visible) return res.status(404).json({ error: "not found" });
  if (isPlayer(req)) return res.json({ ...row, cells: stripCellsForPlayer(row.cells) });
  res.json(row);
});

// Чистка секретного слоя для игроков (пакет A §6): секретные двери — вон,
// trapped — обычной дверью, ловушки — все вон. Чистим на отдаче, а не на
// клиенте: скрытое не должно покидать сервер вообще.
function stripCellsForPlayer(cellsStr: string): string {
  let blob: Record<string, unknown>;
  try {
    blob = JSON.parse(cellsStr) as Record<string, unknown>;
  } catch {
    return cellsStr;
  }
  if (typeof blob !== "object" || blob === null || blob.v !== 3) return cellsStr;
  const doors = Array.isArray(blob.doors) ? blob.doors : [];
  const kept = (doors as Record<string, unknown>[]).filter(
    (d) => d.kind !== "secret" && d.secret !== true
  );
  const shown = kept.map((d) => (d.kind === "trapped" ? { ...d, kind: "door" } : d));
  return JSON.stringify({ ...blob, doors: shown, traps: [] });
}

// Трим blob под новые размеры (P1-6): ресайз без `cells` иначе оставлял клетки
// снаружи поля, и следующий сейв тех же клеток падал на валидации. Инвариант —
// как у клиента: «поле ужмётся, снаружи пропадает»; комната, торчащая за край,
// уходит целиком (резать регион по живому нельзя).
function trimCellsTo(blobStr: string, width: number, height: number): string {
  let blob: Record<string, unknown>;
  try {
    blob = JSON.parse(blobStr) as Record<string, unknown>;
  } catch {
    return blobStr;
  }
  if (typeof blob !== "object" || blob === null) return blobStr;
  const inB = (x: unknown, y: unknown) =>
    Number.isInteger(x) && Number.isInteger(y) &&
    (x as number) >= 0 && (y as number) >= 0 && (x as number) < width && (y as number) < height;
  const keyIn = (k: string) => {
    const m = /^(\d+),(\d+)$/.exec(k);
    return !!m && inB(Number(m[1]), Number(m[2]));
  };
  if (typeof blob.cells === "object" && blob.cells !== null && !Array.isArray(blob.cells)) {
    const kept: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(blob.cells as Record<string, unknown>)) if (keyIn(k)) kept[k] = t;
    blob.cells = kept;
  }
  if (Array.isArray(blob.roads)) blob.roads = (blob.roads as unknown[]).filter((k) => typeof k === "string" && keyIn(k));
  if (Array.isArray(blob.rivers)) blob.rivers = (blob.rivers as unknown[]).filter((k) => typeof k === "string" && keyIn(k));
  if (Array.isArray(blob.labels)) {
    blob.labels = (blob.labels as Record<string, unknown>[]).filter(
      (l) => typeof l === "object" && l !== null && inB(l.x, l.y)
    );
  }
  if (Array.isArray(blob.rooms)) {
    blob.rooms = (blob.rooms as Record<string, unknown>[]).filter(
      (r) =>
        typeof r === "object" && r !== null &&
        Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h) &&
        (r.x as number) >= 0 && (r.y as number) >= 0 &&
        (r.x as number) + (r.w as number) <= width && (r.y as number) + (r.h as number) <= height
    );
  }
  for (const arr of ["doors", "traps", "markers"] as const) {
    if (Array.isArray(blob[arr])) {
      blob[arr] = (blob[arr] as Record<string, unknown>[]).filter(
        (o) => typeof o === "object" && o !== null && inB(o.x, o.y)
      );
    }
  }
  for (const key of ["start", "finish"] as const) {
    const p = blob[key] as Record<string, unknown> | null | undefined;
    if (p !== undefined && p !== null && (typeof p !== "object" || !inB(p.x, p.y))) blob[key] = null;
  }
  return JSON.stringify(blob);
}

mapsRouter.put("/:id", (req: AuthedRequest, res) => {
  const current = db.prepare("SELECT * FROM maps WHERE id = ?").get(req.params.id) as
    | {
        grid: string;
        width: number;
        height: number;
        cells: string;
      }
    | undefined;
  if (!current) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Сетка — свойство навсегда: смена без флага очистки отклоняется, иначе
  // клетки сбрасываются (пересчёт гексы↔квадраты без потерь невозможен).
  let grid = current.grid;
  let width = current.width;
  let height = current.height;
  let cells = body.cells as string | undefined;
  if (body.grid !== undefined && body.grid !== current.grid) {
    if (body.grid !== "square" && body.grid !== "hex")
      return res.status(400).json({ error: "grid must be 'square' or 'hex'" });
    if (!body.clearCells) return res.status(400).json({ error: "changing grid requires clearCells" });
    grid = body.grid as string;
    cells = JSON.stringify(emptyCellsBlob());
  }
  if (body.width !== undefined || body.height !== undefined) {
    const w = body.width === undefined ? width : body.width;
    const h = body.height === undefined ? height : body.height;
    if (
      typeof w !== "number" || !Number.isInteger(w) || w < MAP_MIN_SIDE || w > MAP_MAX_SIDE ||
      typeof h !== "number" || !Number.isInteger(h) || h < MAP_MIN_SIDE || h > MAP_MAX_SIDE
    )
      return res.status(400).json({ error: `width/height must be integers ${MAP_MIN_SIDE}..${MAP_MAX_SIDE}` });
    width = w;
    height = h;
  }
  // Ресайз без клеток: триммим хранимое под новый размер, иначе в базе остаётся
  // out-of-bounds, и следующий сейв падает (P1-6). Явные `cells` в запросе —
  // как есть, их режет строгая валидация ниже.
  if (cells === undefined && (width !== current.width || height !== current.height)) {
    cells = trimCellsTo(current.cells, width, height);
  }
  if (cells !== undefined) {
    const err = validateCellsBlob(cells, width, height);
    if (err) return res.status(400).json({ error: err });
  }
  if (body.scale !== undefined && !(MAP_SCALES as readonly string[]).includes(body.scale as string))
    return res.status(400).json({ error: "scale must be one of: " + MAP_SCALES.join(", ") });
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim()))
    return res.status(400).json({ error: "name must be a non-empty string" });
  if (typeof body.name === "string" && body.name.trim().length > 200)
    return res.status(400).json({ error: "name too long (max 200)" });
  if (body.cell_lore !== undefined && (typeof body.cell_lore !== "string" || body.cell_lore.length > 64))
    return res.status(400).json({ error: "cell_lore must be a string (max 64)" });
  for (const [key, min, max] of [["sea", 20, 80], ["mountains", 0, 40], ["forest", 0, 60]] as const) {
    const v = body[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max))
      return res.status(400).json({ error: `${key} must be an integer ${min}..${max}` });
  }
  if (body.seed !== undefined && (typeof body.seed !== "number" || !Number.isInteger(body.seed)))
    return res.status(400).json({ error: "seed must be an integer" });
  if (body.thumbnail !== undefined && body.thumbnail !== null) {
    if (!isThumbnail(body.thumbnail)) return res.status(400).json({ error: "thumbnail must be a PNG data URL" });
  }
  if (body.parent_map_id !== undefined && body.parent_map_id !== null) {
    if (typeof body.parent_map_id !== "number" || !Number.isInteger(body.parent_map_id))
      return res.status(400).json({ error: "parent_map_id must be an integer" });
    if (!parentExists(body.parent_map_id)) return res.status(400).json({ error: "parent map not found" });
  }

  db.prepare(
    `UPDATE maps SET
       name = COALESCE(?, name), grid = ?, scale = COALESCE(?, scale),
       width = ?, height = ?, cell_lore = COALESCE(?, cell_lore),
       seed = COALESCE(?, seed), sea = COALESCE(?, sea),
       mountains = COALESCE(?, mountains), forest = COALESCE(?, forest),
       cells = COALESCE(?, cells), thumbnail = COALESCE(?, thumbnail),
       player_visible = COALESCE(?, player_visible),
       parent_map_id = COALESCE(?, parent_map_id),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    typeof body.name === "string" ? body.name.trim() : null,
    grid,
    (body.scale as string | undefined) ?? null,
    width,
    height,
    (body.cell_lore as string | undefined) ?? null,
    (body.seed as number | undefined) ?? null,
    (body.sea as number | undefined) ?? null,
    (body.mountains as number | undefined) ?? null,
    (body.forest as number | undefined) ?? null,
    cells ?? null,
    (body.thumbnail as string | null | undefined) ?? null,
    body.player_visible === undefined ? null : body.player_visible ? 1 : 0,
    (body.parent_map_id as number | null | undefined) ?? null,
    req.params.id
  );
  res.json(db.prepare(`SELECT ${META_COLUMNS}, cells FROM maps WHERE id = ?`).get(req.params.id));
});

mapsRouter.delete("/:id", (req: AuthedRequest, res) => {
  // Жёсткое удаление: карта — черновик мира, а не лор-сущность; связи
  // чистятся каскадом. Отмена — тостом UndoDelete на клиенте (тикет 02+).
  db.prepare("DELETE FROM maps WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Привязки многие-ко-многим (P2-4): карта ↔ сеттинги/кампании/локации ---
// Запись — только мастер (игрокам POST/DELETE режет apiRoleGate, как и весь
// maps). Чтение — тот же гейт строк, что у GET /:id: скрытая карта игрокам
// 404; к видимой игрок видит типы/id, но не имена (имена сеттингов/кампаний
// могут быть спойлером, а сами разделы игрокам 403).

const MAP_BINDING_TARGETS = ["setting", "campaign", "location"] as const;
type MapBindingTarget = (typeof MAP_BINDING_TARGETS)[number];

function bindingTargetName(targetType: string, targetId: number): string | null {
  const table =
    targetType === "setting" ? "settings" : targetType === "campaign" ? "campaigns" : "setting_locations";
  try {
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(targetId) as
      | { name: string }
      | undefined;
    return row?.name ?? null;
  } catch {
    return null;
  }
}

function mapRowForBindings(req: AuthedRequest, id: string | number): { id: number; player_visible: number } | undefined {
  const row = db.prepare("SELECT id, player_visible FROM maps WHERE id = ?").get(id) as
    | { id: number; player_visible: number }
    | undefined;
  if (!row) return undefined;
  if (isPlayer(req) && !row.player_visible) return undefined;
  return row;
}

mapsRouter.get("/:id/bindings", (req: AuthedRequest, res) => {
  if (!mapRowForBindings(req, req.params.id)) return res.status(404).json({ error: "not found" });
  const rows = db
    .prepare("SELECT id, map_id, target_type, target_id, created_at FROM map_bindings WHERE map_id = ? ORDER BY id")
    .all(req.params.id) as { id: number; map_id: number; target_type: string; target_id: number; created_at: string }[];
  if (isPlayer(req)) return res.json(rows);
  res.json(rows.map((r) => ({ ...r, target_name: bindingTargetName(r.target_type, r.target_id) })));
});

mapsRouter.post("/:id/bindings", (req: AuthedRequest, res) => {
  const mapRow = db.prepare("SELECT id FROM maps WHERE id = ?").get(req.params.id) as { id: number } | undefined;
  if (!mapRow) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as { target_type?: unknown; target_id?: unknown };
  if (typeof body.target_type !== "string" || !(MAP_BINDING_TARGETS as readonly string[]).includes(body.target_type))
    return res.status(400).json({ error: "target_type must be one of: " + MAP_BINDING_TARGETS.join(", ") });
  if (typeof body.target_id !== "number" || !Number.isInteger(body.target_id))
    return res.status(400).json({ error: "target_id must be an integer" });
  const targetType = body.target_type as MapBindingTarget;
  const name = bindingTargetName(targetType, body.target_id);
  if (name === null) return res.status(400).json({ error: "target not found" });
  try {
    const info = db
      .prepare("INSERT INTO map_bindings (map_id, target_type, target_id) VALUES (?, ?, ?)")
      .run(req.params.id, targetType, body.target_id);
    res.status(201).json(
      db
        .prepare("SELECT id, map_id, target_type, target_id, created_at FROM map_bindings WHERE id = ?")
        .get(info.lastInsertRowid)
    );
  } catch {
    return res.status(400).json({ error: "already bound" });
  }
});

mapsRouter.delete("/:id/bindings/:bindingId", (req: AuthedRequest, res) => {
  const info = db
    .prepare("DELETE FROM map_bindings WHERE id = ? AND map_id = ?")
    .run(req.params.bindingId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});
