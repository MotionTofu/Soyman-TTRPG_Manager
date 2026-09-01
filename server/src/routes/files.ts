import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import {
  findMissingFiles,
  findRelinkCandidates,
  relinkResource,
} from "../services/fileHealth";
import { vaultAbs, VAULT_ROOT } from "../services/filesystem";
import { signPath } from "../services/signedUrl";
import { requireAuth } from "../services/auth";

function isInsideVault(p: string): boolean {
  try {
    const resolved = path.resolve(p);
    const root = path.resolve(VAULT_ROOT);
    return resolved === root || resolved.startsWith(root + path.sep);
  } catch { return false; }
}

export const filesRouter = Router();

// Подписанный URL на 60 сек для <img>/<audio> без ?token= (O-3)
filesRouter.get("/signed-url", requireAuth(), (req, res) => {
  const p = req.query.path as string | undefined;
  if (!p || typeof p !== "string" || !p.startsWith("/files/") || p.includes("\0") || p.length > 1024) {
    return res.status(400).json({ error: "invalid path" });
  }
  res.json({ url: signPath(p, 60) });
});

// Файл, лежащий вне текущего хранилища. Путь не собирается из запроса —
// берётся из базы по id, поэтому подсунуть сюда «..» нельзя: отдаётся ровно
// то, что записано в file_path конкретного ресурса.
filesRouter.get("/raw/:id", (req, res) => {
  const row = db
    .prepare("SELECT file_path FROM resources WHERE id = ?")
    .get(req.params.id) as { file_path: string | null } | undefined;
  if (!row?.file_path) return res.status(404).json({ error: "у ресурса нет файла" });
  const abs = vaultAbs(row.file_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "файл не найден" });
  res.sendFile(abs);
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
  if (new_path.includes("\0") || /[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(new_path)) {
    return res.status(400).json({ error: "Недопустимый путь" });
  }
  const normalized = path.resolve(path.normalize(new_path));
  if (!isInsideVault(normalized)) {
    return res.status(403).json({ error: "Путь вне хранилища запрещён" });
  }
  if (!fs.existsSync(normalized)) {
    return res.status(400).json({ error: "по этому пути файла нет" });
  }
  relinkResource(resource_id, normalized);
  res.json({
    ok: true,
    candidates: findRelinkCandidates(path.dirname(normalized), resource_id),
  });
});

filesRouter.post("/relink-batch", (req, res) => {
  const { items } = req.body as { items?: { resource_id: number; new_path: string }[] };
  if (!Array.isArray(items)) return res.status(400).json({ error: "нужен items" });
  const apply = db.transaction(() => {
    for (const item of items) {
      if (!item?.resource_id || !item?.new_path) continue;
      if (item.new_path.includes("\0") || /[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(item.new_path)) continue;
      const normalized = path.resolve(path.normalize(item.new_path));
      if (!isInsideVault(normalized)) continue;
      if (!fs.existsSync(normalized)) continue;
      relinkResource(item.resource_id, normalized);
    }
  });
  apply();
  res.json({ ok: true, updated: items.length });
});
