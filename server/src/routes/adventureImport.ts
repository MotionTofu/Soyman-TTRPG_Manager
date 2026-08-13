// API импортёра книг приключений:
//
//   POST   /api/import/validate   разобрать и проверить, ничего не записав
//   POST   /api/import/plan       то же плюс список сущностей и совпадений
//   POST   /api/import/apply      записать в базу одной транзакцией
//   GET    /api/import/batches    история импортов
//   DELETE /api/import/batches/:id  откат батча

import { Router } from "express";
import { db } from "../db/db";
import { validateImport } from "../import/validate";
import { applyImport, rollbackBatch, knownKeysFor, keyDirectoryFor } from "../import/apply";
import { buildPlan } from "../import/plan";

export const adventureImportRouter = Router();

/** Сеттинги, в которые файл можно дозалить: по имени и по ключу прошлых батчей. */
function matchSettings(settingKey: string, name: string) {
  const byKey = db
    .prepare(
      `SELECT DISTINCT s.id, s.name FROM settings s
       JOIN import_batches b ON b.setting_id = s.id
       WHERE b.setting_key = ? AND s.archived_at IS NULL`
    )
    .all(settingKey) as { id: number; name: string }[];
  const byName = db
    .prepare("SELECT id, name FROM settings WHERE name = ? AND archived_at IS NULL")
    .all(name) as { id: number; name: string }[];
  const seen = new Set(byKey.map((s) => s.id));
  return [
    ...byKey.map((s) => ({ ...s, reason: "тот же ключ сеттинга в прошлом импорте" })),
    ...byName.filter((s) => !seen.has(s.id)).map((s) => ({ ...s, reason: "совпадает название" })),
  ];
}

adventureImportRouter.post("/validate", (req, res) => {
  const { data, setting_id } = req.body as { data?: unknown; setting_id?: number | null };
  if (data === undefined) return res.status(400).json({ error: "data is required" });

  const known = setting_id ? knownKeysFor(setting_id) : {};
  const result = validateImport(data, known);
  const setting = (data as { setting?: { key?: string; name?: string } })?.setting;
  res.json({
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    counts: result.counts,
    matches: setting?.name ? matchSettings(setting.key ?? "", setting.name) : [],
  });
});

// Экран сверки: то же, что /validate, плюс поштучный список того, что приедет,
// и найденные совпадения с уже существующим в целевом сеттинге.
adventureImportRouter.post("/plan", (req, res) => {
  const { data, setting_id } = req.body as { data?: unknown; setting_id?: number | null };
  if (data === undefined) return res.status(400).json({ error: "data is required" });

  const settingId = setting_id ?? null;
  const known = settingId ? knownKeysFor(settingId) : {};
  const result = validateImport(data, known);
  const setting = (data as { setting?: { key?: string; name?: string } })?.setting;
  if (!result.ok || !result.data) {
    return res.json({
      ok: false,
      errors: result.errors,
      warnings: result.warnings,
      counts: result.counts,
      matches: [],
      plan: { sections: [], extras: {} },
    });
  }
  res.json({
    ok: true,
    errors: result.errors,
    warnings: result.warnings,
    counts: result.counts,
    matches: setting?.name ? matchSettings(setting.key ?? "", setting.name) : [],
    setting: result.data.setting,
    source: result.data.source,
    plan: buildPlan(result.data, settingId, known),
  });
});

adventureImportRouter.post("/apply", (req, res) => {
  const { data, setting_id, file_name, skip, reuse, categories, compendium, detach } =
    req.body as {
      data?: unknown;
      setting_id?: number | null;
      file_name?: string;
      skip?: string[];
      reuse?: Record<string, string>;
      categories?: Record<string, string>;
      compendium?: Record<string, number[]>;
      detach?: string[];
    };
  if (data === undefined) return res.status(400).json({ error: "data is required" });

  const settingId = setting_id ?? null;
  if (settingId != null) {
    const exists = db.prepare("SELECT id FROM settings WHERE id = ?").get(settingId);
    if (!exists) return res.status(404).json({ error: "setting not found" });
  }

  const known = settingId ? knownKeysFor(settingId) : {};
  const result = validateImport(data, known);
  // Предупреждения импорт не останавливают — иначе одна битая ссылка отменяла
  // бы разбор целой книги. Ошибки останавливают: без ключей писать нечего.
  if (!result.ok || !result.data) {
    return res.status(422).json({ ok: false, errors: result.errors, warnings: result.warnings });
  }

  try {
    const applied = applyImport(result.data, {
      settingId,
      fileName: file_name ?? "",
      knownKeys: known,
      skip,
      reuse,
      categories,
      compendium,
      detach,
    });
    res.status(201).json({
      ok: true,
      batch_id: applied.batchId,
      setting_id: applied.settingId,
      setting_created: applied.settingCreated,
      counts: applied.counts,
      warnings: [...result.warnings, ...applied.warnings],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Ключи, уже занятые в сеттинге: вкладываются в промпт следующей части книги,
// чтобы модель не выдумала для той же локации второй ключ.
adventureImportRouter.get("/keys", (req, res) => {
  const settingId = Number(req.query.setting_id);
  if (!Number.isInteger(settingId) || settingId <= 0) {
    return res.status(400).json({ error: "setting_id is required" });
  }
  res.json(keyDirectoryFor(settingId));
});

adventureImportRouter.get("/batches", (req, res) => {
  const settingId = req.query.setting_id;
  const rows = (
    settingId
      ? db
          .prepare(
            `SELECT b.*, s.name as setting_name FROM import_batches b
             JOIN settings s ON s.id = b.setting_id
             WHERE b.setting_id = ? ORDER BY b.id DESC`
          )
          .all(settingId)
      : db
          .prepare(
            `SELECT b.*, s.name as setting_name FROM import_batches b
             JOIN settings s ON s.id = b.setting_id ORDER BY b.id DESC`
          )
          .all()
  ) as Record<string, unknown>[];
  res.json(
    rows.map((row) => ({
      ...row,
      counts: JSON.parse(String(row.counts_json)),
      warnings: JSON.parse(String(row.warnings_json)),
      counts_json: undefined,
      key_map_json: undefined,
      warnings_json: undefined,
    }))
  );
});

adventureImportRouter.delete("/batches/:id", (req, res) => {
  const batch = db
    .prepare("SELECT id FROM import_batches WHERE id = ?")
    .get(req.params.id) as { id: number } | undefined;
  if (!batch) return res.status(404).json({ error: "batch not found" });
  const { deleted } = rollbackBatch(batch.id);
  res.json({ ok: true, deleted });
});
