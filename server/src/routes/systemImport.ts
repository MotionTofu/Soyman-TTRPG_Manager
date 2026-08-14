// API импортёра книг правил (system-import/1):
//
//   POST   /api/system-import/validate        разобрать и проверить, не записав
//   POST   /api/system-import/apply           записать одной транзакцией
//   GET    /api/system-import/keys            ключи, уже занятые в системе
//   GET    /api/system-import/batches         история импортов
//   DELETE /api/system-import/batches/:id     откат батча
//
// Отдельно от /api/import: там цель — сеттинг и разовая заливка приключения,
// здесь — система и книга, к которой возвращаются.

import { Router } from "express";
import { db } from "../db/db";
import { validateSystemImport } from "../import/systemValidate";
import {
  applySystemImport,
  describeSystemImport,
  knownSystemKeys,
  rollbackSystemBatch,
  systemKeyDirectory,
  unresolvedRefCandidates,
} from "../import/systemApply";

export const systemImportRouter = Router();

/** Системы, в которые файл можно залить: по ключу прошлых импортов и по имени. */
function matchSystems(systemKey: string, name: string) {
  const byKey = db
    .prepare(
      `SELECT DISTINCT s.id, s.name FROM systems s
       JOIN system_import_batches b ON b.system_id = s.id
       WHERE b.system_key = ? AND s.archived_at IS NULL`
    )
    .all(systemKey) as { id: number; name: string }[];
  const byName = db
    .prepare("SELECT id, name FROM systems WHERE name = ? AND archived_at IS NULL")
    .all(name) as { id: number; name: string }[];
  const seen = new Set(byKey.map((s) => s.id));
  return [
    ...byKey.map((s) => ({ ...s, reason: "тот же ключ системы в прошлом импорте" })),
    ...byName.filter((s) => !seen.has(s.id)).map((s) => ({ ...s, reason: "совпадает название" })),
  ];
}

/** Что файл сделает с целевой системой: заведёт заново или перепишет. */
function previewKeys(fileKeys: Record<string, string>, systemId: number | null) {
  if (systemId == null) return { updates: [], creates: Object.keys(fileKeys).length };
  const known = knownSystemKeys(systemId);
  const updates = Object.keys(fileKeys).filter((k) => known[k]);
  return { updates, creates: Object.keys(fileKeys).length - updates.length };
}

systemImportRouter.post("/validate", (req, res) => {
  const { data, system_id } = req.body as { data?: unknown; system_id?: number | null };
  if (data === undefined) return res.status(400).json({ error: "data is required" });

  const systemId = system_id ?? null;
  const known = systemId ? knownSystemKeys(systemId) : {};
  const result = validateSystemImport(data, known);
  const system = (data as { system?: { key?: string; name?: string } })?.system;
  res.json({
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    counts: result.counts,
    matches: system?.name ? matchSystems(system.key ?? "", system.name) : [],
    // Сколько записей файл перепишет, а сколько заведёт: главная цифра на
    // экране перед импортом — повторная заливка главы правит, а не плодит.
    preview: previewKeys(result.keys, systemId),
    system: result.data?.system,
    source: result.data?.source,
    sections: result.data ? describeSystemImport(result.data, known, systemId) : [],
    // Ссылки, которым не на что указывать. Целятся они, как правило, в записи,
    // которые в компендиуме давно есть, но заведены руками и ключа не имеют, —
    // поэтому это не ошибка, а вопрос к человеку.
    unresolved: systemId ? unresolvedRefCandidates(systemId, result.unresolved) : [],
  });
});

systemImportRouter.post("/apply", (req, res) => {
  const { data, system_id, file_name, skip, bind } = req.body as {
    data?: unknown;
    system_id?: number | null;
    file_name?: string;
    skip?: string[];
    bind?: Record<string, number>;
  };
  if (data === undefined) return res.status(400).json({ error: "data is required" });

  const systemId = system_id ?? null;
  if (systemId != null) {
    const exists = db.prepare("SELECT id FROM systems WHERE id = ?").get(systemId);
    if (!exists) return res.status(404).json({ error: "system not found" });
  }

  const result = validateSystemImport(data, systemId ? knownSystemKeys(systemId) : {});
  // Предупреждения импорт не останавливают, ошибки останавливают: без
  // разрешённых ссылок запись приедет бессмысленной.
  if (!result.ok || !result.data) {
    return res.status(422).json({ ok: false, errors: result.errors, warnings: result.warnings });
  }

  try {
    const applied = applySystemImport(result.data, {
      systemId,
      fileName: file_name ?? "",
      skip,
      bind,
    });
    // Несвязанная ссылка не ломает импорт — заклинание приедет без класса, —
    // но человек должен об этом узнать, а не обнаружить пустой список потом.
    const bound = new Set(Object.keys(bind ?? {}));
    const dropped = result.unresolved.filter((u) => !bound.has(u.ref));
    res.status(201).json({
      ok: true,
      batch_id: applied.batchId,
      system_id: applied.systemId,
      system_created: applied.systemCreated,
      counts: applied.counts,
      warnings: [
        ...applied.warnings,
        ...dropped.map((u) => ({
          path: u.paths[0],
          message: `«${u.ref}» ни с чем не связан — ссылки на него (${u.paths.length}) не записаны`,
        })),
      ],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Ключи, уже занятые в системе: вкладываются в промпт следующей главы, чтобы
// модель ссылалась на приехавшее, а не выдумывала для того же типа урона
// второй ключ.
systemImportRouter.get("/keys", (req, res) => {
  const systemId = Number(req.query.system_id);
  if (!Number.isInteger(systemId) || systemId <= 0) {
    return res.status(400).json({ error: "system_id is required" });
  }
  res.json(systemKeyDirectory(systemId));
});

systemImportRouter.get("/batches", (req, res) => {
  const systemId = req.query.system_id;
  const rows = (
    systemId
      ? db
          .prepare(
            `SELECT b.*, s.name as system_name FROM system_import_batches b
             JOIN systems s ON s.id = b.system_id
             WHERE b.system_id = ? ORDER BY b.id DESC`
          )
          .all(systemId)
      : db
          .prepare(
            `SELECT b.*, s.name as system_name FROM system_import_batches b
             JOIN systems s ON s.id = b.system_id ORDER BY b.id DESC`
          )
          .all()
  ) as Record<string, unknown>[];
  res.json(
    rows.map((row) => ({
      ...row,
      counts: JSON.parse(String(row.counts_json)),
      warnings: JSON.parse(String(row.warnings_json)),
      counts_json: undefined,
      warnings_json: undefined,
    }))
  );
});

systemImportRouter.delete("/batches/:id", (req, res) => {
  const batch = db
    .prepare("SELECT id FROM system_import_batches WHERE id = ?")
    .get(req.params.id) as { id: number } | undefined;
  if (!batch) return res.status(404).json({ error: "batch not found" });
  res.json({ ok: true, ...rollbackSystemBatch(batch.id) });
});
