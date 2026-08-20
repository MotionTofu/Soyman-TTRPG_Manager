import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import {
  findMissingFiles,
  findRelinkCandidates,
  relinkResource,
} from "../services/fileHealth";

export const filesRouter = Router();

// Файл, лежащий вне текущего хранилища. Путь не собирается из запроса —
// берётся из базы по id, поэтому подсунуть сюда «..» нельзя: отдаётся ровно
// то, что записано в file_path конкретного ресурса.
filesRouter.get("/raw/:id", (req, res) => {
  const row = db
    .prepare("SELECT file_path FROM resources WHERE id = ?")
    .get(req.params.id) as { file_path: string | null } | undefined;
  if (!row?.file_path) return res.status(404).json({ error: "у ресурса нет файла" });
  if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: "файл не найден" });
  res.sendFile(row.file_path);
});

// Все ресурсы с файлом, которого нет на диске. Пульт зовёт это при открытии,
// чтобы погасить кнопки заранее: узнавать о пропаже в момент, когда звук
// нужен, — худший из возможных моментов.
filesRouter.get("/missing", (_req, res) => {
  res.json(findMissingFiles());
});

// Указали новое место одному файлу — заодно смотрим, не лежат ли в этой же
// папке остальные пропавшие. Кандидаты возвращаются списком; применяет их
// человек отметками (см. /relink-batch), а не мы молча.
filesRouter.post("/relink", (req, res) => {
  const { resource_id, new_path } = req.body as { resource_id?: number; new_path?: string };
  if (!resource_id || !new_path) {
    return res.status(400).json({ error: "нужны resource_id и new_path" });
  }
  if (!fs.existsSync(new_path)) {
    return res.status(400).json({ error: "по этому пути файла нет" });
  }
  relinkResource(resource_id, new_path);
  res.json({
    ok: true,
    candidates: findRelinkCandidates(path.dirname(new_path), resource_id),
  });
});

filesRouter.post("/relink-batch", (req, res) => {
  const { items } = req.body as { items?: { resource_id: number; new_path: string }[] };
  if (!Array.isArray(items)) return res.status(400).json({ error: "нужен items" });
  const apply = db.transaction(() => {
    for (const item of items) {
      if (!item?.resource_id || !item?.new_path) continue;
      if (!fs.existsSync(item.new_path)) continue;
      relinkResource(item.resource_id, item.new_path);
    }
  });
  apply();
  res.json({ ok: true, updated: items.length });
});
