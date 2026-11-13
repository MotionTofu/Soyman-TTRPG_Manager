import { Router } from "express";
import { db } from "../db/db";
import { appendLog, type LogRow } from "../services/battles";
import { LitmActionError, undoLitmCompound } from "../services/litmCompound";
import { broadcastCharacterUpdate } from "../services/realtime";

// Лог боя (боевой режим, шаг 4): строки пишет пульт, отмену считает клиент
// (shared/battleLog.ts) и отмечает здесь — «отменено» или почему нельзя.
export const battlesRouter = Router();

const KINDS = ["turn", "event", "note"];

function present(row: LogRow) {
  let changes: unknown = [];
  try {
    changes = JSON.parse(row.changes);
  } catch {
    /* битая строка — без разницы, отменить её нельзя */
  }
  return { ...row, changes, undone: !!row.undone };
}

battlesRouter.get("/:id/log", (req, res) => {
  const rows = db.prepare("SELECT * FROM battle_log WHERE battle_id = ? ORDER BY id").all(req.params.id) as LogRow[];
  res.json(rows.map(present));
});

battlesRouter.post("/log/:lineId/litm-undo", (req, res) => {
  try {
    const result = undoLitmCompound(Number(req.params.lineId));
    for (const id of result.characterIds) broadcastCharacterUpdate(id, "sheet");
    res.json(result);
  } catch (error) {
    if (!(error instanceof LitmActionError)) throw error;
    res.status(409).json({ error: error.message });
  }
});

battlesRouter.post("/:id/log", (req, res) => {
  const battleId = Number(req.params.id);
  const { session_id, round, kind, text, sub, changes } = (req.body ?? {}) as {
    session_id?: number;
    round?: number;
    kind?: string;
    text?: string;
    sub?: string;
    changes?: unknown;
  };
  if (!db.prepare("SELECT 1 FROM battles WHERE id = ?").get(battleId)) return res.status(404).json({ error: "бой не найден" });
  if (!Number.isInteger(session_id) || !text?.trim()) return res.status(400).json({ error: "session_id и text обязательны" });
  if (!KINDS.includes(kind ?? "")) return res.status(400).json({ error: "kind: turn | event | note" });
  if (changes !== undefined && !Array.isArray(changes)) return res.status(400).json({ error: "changes должен быть массивом" });
  res.json(present(appendLog(battleId, { session_id: session_id!, round: Math.max(0, Number(round) || 0), kind: kind!, text, sub, changes })));
});

// «Отменено» или причина, по которой отменить нельзя (Q67).
battlesRouter.put("/log/:lineId", (req, res) => {
  const { undone, blocked } = (req.body ?? {}) as { undone?: boolean; blocked?: string };
  const row = db.prepare("SELECT * FROM battle_log WHERE id = ?").get(req.params.lineId) as LogRow | undefined;
  if (!row) return res.status(404).json({ error: "строка не найдена" });
  db.prepare("UPDATE battle_log SET undone = ?, blocked = ? WHERE id = ?").run(
    undone === undefined ? row.undone : undone ? 1 : 0,
    typeof blocked === "string" ? blocked : row.blocked,
    row.id
  );
  res.json(present(db.prepare("SELECT * FROM battle_log WHERE id = ?").get(row.id) as LogRow));
});
