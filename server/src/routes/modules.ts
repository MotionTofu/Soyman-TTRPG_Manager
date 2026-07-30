import { Router } from "express";
import { db } from "../db/db";
import { importSystemExport, type SystemExportData } from "./systems";
import { importSettingExport, type SettingExportData } from "./settings";

export const modulesRouter = Router();

interface ModuleRow {
  id: number;
  type: "system" | "setting";
  name: string;
  source: "local" | "imported";
  source_json: string | null;
  enabled: number;
  system_id: number | null;
  setting_id: number | null;
  created_at: string;
}

// Any system/setting not yet wrapped by a module row gets one lazily — this
// is what lets pre-existing (non-imported) systems/settings show up in the
// same list without a data migration.
function syncLocalWrappers() {
  const wrappedSystemIds = new Set(
    (db.prepare("SELECT system_id FROM modules WHERE system_id IS NOT NULL").all() as { system_id: number }[]).map(
      (r) => r.system_id
    )
  );
  const systems = db.prepare("SELECT id, name, archived_at FROM systems").all() as {
    id: number;
    name: string;
    archived_at: string | null;
  }[];
  const insertModule = db.prepare(
    "INSERT INTO modules (type, name, source, enabled, system_id, setting_id) VALUES (?, ?, 'local', ?, ?, ?)"
  );
  for (const s of systems) {
    if (wrappedSystemIds.has(s.id)) continue;
    insertModule.run("system", s.name, s.archived_at == null ? 1 : 0, s.id, null);
  }

  const wrappedSettingIds = new Set(
    (db.prepare("SELECT setting_id FROM modules WHERE setting_id IS NOT NULL").all() as { setting_id: number }[]).map(
      (r) => r.setting_id
    )
  );
  const settings = db.prepare("SELECT id, name, archived_at FROM settings").all() as {
    id: number;
    name: string;
    archived_at: string | null;
  }[];
  for (const s of settings) {
    if (wrappedSettingIds.has(s.id)) continue;
    insertModule.run("setting", s.name, s.archived_at == null ? 1 : 0, null, s.id);
  }
}

modulesRouter.get("/", (_req, res) => {
  syncLocalWrappers();
  const rows = db.prepare("SELECT * FROM modules ORDER BY type, name").all() as ModuleRow[];
  res.json(rows.map((r) => ({ ...r, source_json: undefined })));
});

modulesRouter.post("/import", (req, res) => {
  const { type, data } = req.body as { type: "system" | "setting"; data: unknown };
  if (type !== "system" && type !== "setting") {
    return res.status(400).json({ error: "type must be 'system' or 'setting'" });
  }
  const name =
    type === "system"
      ? (data as SystemExportData)?.system?.name
      : (data as SettingExportData)?.setting?.name;
  if (!name) return res.status(400).json({ error: "invalid export file" });

  const info = db
    .prepare(
      "INSERT INTO modules (type, name, source, source_json, enabled, system_id, setting_id) VALUES (?, ?, 'imported', ?, 0, NULL, NULL)"
    )
    .run(type, name, JSON.stringify(data));
  res.status(201).json(db.prepare("SELECT id, type, name, source, enabled, system_id, setting_id, created_at FROM modules WHERE id = ?").get(info.lastInsertRowid));
});

modulesRouter.put("/:id/enable", async (req, res) => {
  const mod = db.prepare("SELECT * FROM modules WHERE id = ?").get(req.params.id) as ModuleRow | undefined;
  if (!mod) return res.status(404).json({ error: "not found" });
  if (mod.enabled) return res.json({ ok: true });

  if (mod.system_id != null) {
    db.prepare("UPDATE systems SET archived_at = NULL WHERE id = ?").run(mod.system_id);
  } else if (mod.setting_id != null) {
    db.prepare("UPDATE settings SET archived_at = NULL WHERE id = ?").run(mod.setting_id);
  } else if (mod.source === "imported" && mod.source_json) {
    const data = JSON.parse(mod.source_json);
    if (mod.type === "system") {
      const newId = await importSystemExport(data as SystemExportData);
      db.prepare("UPDATE modules SET system_id = ? WHERE id = ?").run(newId, mod.id);
    } else {
      const newId = importSettingExport(data as SettingExportData);
      db.prepare("UPDATE modules SET setting_id = ? WHERE id = ?").run(newId, mod.id);
    }
  } else {
    return res.status(400).json({ error: "module has no source to enable from" });
  }

  db.prepare("UPDATE modules SET enabled = 1 WHERE id = ?").run(mod.id);
  res.json(db.prepare("SELECT id, type, name, source, enabled, system_id, setting_id, created_at FROM modules WHERE id = ?").get(mod.id));
});

modulesRouter.put("/:id/disable", (req, res) => {
  const mod = db.prepare("SELECT * FROM modules WHERE id = ?").get(req.params.id) as ModuleRow | undefined;
  if (!mod) return res.status(404).json({ error: "not found" });

  if (mod.system_id != null) {
    db.prepare("UPDATE systems SET archived_at = datetime('now') WHERE id = ?").run(mod.system_id);
  } else if (mod.setting_id != null) {
    db.prepare("UPDATE settings SET archived_at = datetime('now') WHERE id = ?").run(mod.setting_id);
  }
  db.prepare("UPDATE modules SET enabled = 0 WHERE id = ?").run(mod.id);
  res.json(db.prepare("SELECT id, type, name, source, enabled, system_id, setting_id, created_at FROM modules WHERE id = ?").get(mod.id));
});

// The "✕" on a module. For a materialized module (has a real
// system_id/setting_id) this *archives* the underlying system/setting — same
// non-destructive soft-delete as unchecking it, and it can be restored (or
// permanently removed) from the Archive page. For an unmaterialized imported
// registration (no real data yet) there's nothing to archive, so the pending
// registration row is just dropped. Permanent, cascading deletion lives only
// on the Archive page (DELETE /archive/:type/:id), uniform across all types.
modulesRouter.delete("/:id", (req, res) => {
  const mod = db.prepare("SELECT * FROM modules WHERE id = ?").get(req.params.id) as ModuleRow | undefined;
  if (!mod) return res.status(404).json({ error: "not found" });

  if (mod.system_id != null) {
    db.prepare("UPDATE systems SET archived_at = datetime('now') WHERE id = ?").run(mod.system_id);
    db.prepare("UPDATE modules SET enabled = 0 WHERE id = ?").run(mod.id);
  } else if (mod.setting_id != null) {
    db.prepare("UPDATE settings SET archived_at = datetime('now') WHERE id = ?").run(mod.setting_id);
    db.prepare("UPDATE modules SET enabled = 0 WHERE id = ?").run(mod.id);
  } else {
    db.prepare("DELETE FROM modules WHERE id = ?").run(mod.id);
  }
  res.json({ ok: true });
});
