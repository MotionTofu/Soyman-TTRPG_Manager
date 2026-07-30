import { Router } from "express";
import { db } from "../db/db";
import { parseLongStoryShort } from "../services/lssImport";
import { broadcastCharacterUpdate } from "../services/realtime";

export const statblocksRouter = Router();

statblocksRouter.post("/import", (req, res) => {
  const { owner_type, owner_id, json } = req.body as {
    owner_type: string;
    owner_id: number;
    json: string;
  };
  if (!owner_type || !owner_id || !json)
    return res.status(400).json({ error: "owner_type, owner_id and json are required" });

  let parsed;
  try {
    parsed = parseLongStoryShort(json);
  } catch (err) {
    return res.status(400).json({ error: "Не удалось разобрать файл: " + String(err) });
  }

  const note = `Импортировано из Long Story Short${parsed.characterName ? ` (${parsed.characterName})` : ""}`;
  const info = db
    .prepare(
      "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, "full", "dnd_character", JSON.stringify(parsed.characterData), note);

  res.status(201).json({
    characterName: parsed.characterName,
    statblock: db.prepare("SELECT * FROM statblocks WHERE id = ?").get(info.lastInsertRowid),
  });
});

statblocksRouter.get("/", (req, res) => {
  const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
  if (!owner_type || !owner_id)
    return res.status(400).json({ error: "owner_type and owner_id are required" });
  const rows = db
    .prepare(
      "SELECT * FROM statblocks WHERE owner_type = ? AND owner_id = ? ORDER BY created_at"
    )
    .all(owner_type, owner_id);
  res.json(rows);
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
      "INSERT INTO statblocks (owner_type, owner_id, kind, format, content, note) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(owner_type, owner_id, kind ?? "full", format ?? "text", content ?? "", note ?? "");
  res
    .status(201)
    .json(db.prepare("SELECT * FROM statblocks WHERE id = ?").get(info.lastInsertRowid));
});

statblocksRouter.put("/:id", (req, res) => {
  const { kind, content, note, theme, density } = req.body as {
    kind?: string;
    content?: string;
    note?: string;
    theme?: string;
    density?: string;
  };
  db.prepare(
    `UPDATE statblocks SET
       kind = COALESCE(?, kind), content = COALESCE(?, content), note = COALESCE(?, note),
       theme = COALESCE(?, theme), density = COALESCE(?, density)
     WHERE id = ?`
  ).run(kind ?? null, content ?? null, note ?? null, theme ?? null, density ?? null, req.params.id);
  const updated = db.prepare("SELECT * FROM statblocks WHERE id = ?").get(req.params.id) as
    | { owner_type: string; owner_id: number }
    | undefined;
  if (updated?.owner_type === "character") broadcastCharacterUpdate(updated.owner_id);
  res.json(updated);
});

statblocksRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM statblocks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
