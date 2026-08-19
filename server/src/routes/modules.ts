import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { createSystemBackup, importSystemExport, updateSystemFromExport, type SystemExportData } from "./systems";
import { createSettingBackup, importSettingExport, updateSettingFromExport, type SettingExportData } from "./settings";

export const modulesRouter = Router();

// A single public GitHub repo the user curates by hand: manifest.json at the
// root lists catalog entries (each with its own id/version), modules/*.json
// holds the actual export payloads (same format as GET /systems/:id/export
// and GET /settings/:id/export). Pull-only — the app never writes back to
// this repo. Public + raw.githubusercontent.com means no auth/token and no
// GitHub REST API rate limit to worry about.
const CATALOG_REPO = "MotionTofu/soyman-modules";
const CATALOG_BRANCH = "main";

function rawUrl(path: string) {
  return `https://raw.githubusercontent.com/${CATALOG_REPO}/${CATALOG_BRANCH}/${path}`;
}

interface CatalogManifestEntry {
  id: string;
  type: "system" | "setting";
  name: string;
  description: string;
  file: string;
  version: string;
  /**
   * Минимальная версия приложения, способная прочесть этот файл.
   *
   * Формат выгрузки меняется: в 2026.8.19 ссылки внутри текстов переехали на
   * глобальные ключи, и сборка, которая о них не знает, покажет вместо ссылок
   * голые скобки. Поле необязательное — без него запись считается совместимой
   * со всеми.
   *
   * Оговорка, ради которой это стоит помнить: сборки, вышедшие до появления
   * поля, о нём не знают и всё равно предложат установку. Ограничитель
   * работает начиная со следующей смены формата, а не задним числом.
   */
  minAppVersion?: string;
}

/**
 * Версия приложения. В упакованной сборке её кладёт electron/main.js перед
 * запуском сервера; в разработке берётся из package.json репозитория.
 */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  for (const candidate of [
    path.join(__dirname, "..", "..", "..", "package.json"),
    path.join(process.cwd(), "package.json"),
    path.join(process.cwd(), "..", "package.json"),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { version?: string };
      if (pkg.version && pkg.version !== "0.1.0") return pkg.version;
    } catch {
      // Следующий кандидат.
    }
  }
  return "0.0.0";
}

/** Сравнение календарных версий «2026.8.19» по числовым частям. */
function isOlder(version: string, than: string): boolean {
  const a = version.split(".").map((n) => Number(n) || 0);
  const b = than.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/** Пригодна ли эта сборка для записи каталога. */
function tooOldFor(entry: CatalogManifestEntry): boolean {
  return !!entry.minAppVersion && isOlder(appVersion(), entry.minAppVersion);
}

async function fetchManifest(): Promise<CatalogManifestEntry[]> {
  const res = await fetch(rawUrl("manifest.json"));
  if (!res.ok) throw new Error(`манифест недоступен (HTTP ${res.status})`);
  const data = (await res.json()) as { modules?: CatalogManifestEntry[] };
  if (!Array.isArray(data.modules)) throw new Error("манифест повреждён: нет поля modules");
  return data.modules;
}

async function fetchManifestEntry(remoteId: string): Promise<CatalogManifestEntry> {
  const entry = (await fetchManifest()).find((m) => m.id === remoteId);
  if (!entry) throw new Error("запись не найдена в каталоге");
  return entry;
}

async function fetchModuleFile(entry: CatalogManifestEntry): Promise<unknown> {
  const res = await fetch(rawUrl(entry.file));
  if (!res.ok) throw new Error(`файл модуля недоступен (HTTP ${res.status})`);
  return res.json();
}

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
      const newId = await importSettingExport(data as SettingExportData);
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

// Lists the curated GitHub catalog cross-referenced against what's already
// installed locally (matched by remote_id), so the client can render
// Установить / Доступно обновление / Установлено per entry.
modulesRouter.get("/catalog", async (_req, res) => {
  let manifest: CatalogManifestEntry[];
  try {
    manifest = await fetchManifest();
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "каталог недоступен" });
  }

  const installed = db.prepare("SELECT id, remote_id, remote_version FROM modules WHERE remote_id IS NOT NULL").all() as {
    id: number;
    remote_id: string;
    remote_version: string | null;
  }[];
  const byRemoteId = new Map(installed.map((r) => [r.remote_id, r]));

  res.json(
    manifest.map((entry) => {
      const local = byRemoteId.get(entry.id);
      return {
        remoteId: entry.id,
        type: entry.type,
        name: entry.name,
        description: entry.description,
        version: entry.version,
        installedModuleId: local?.id ?? null,
        installedVersion: local?.remote_version ?? null,
        updateAvailable: local != null && local.remote_version !== entry.version,
        minAppVersion: entry.minAppVersion ?? null,
        tooOld: tooOldFor(entry),
      };
    })
  );
});

// Installs a not-yet-installed catalog entry: fetches the module file and
// materializes it right away (unlike "+ Добавить модуль из файла", which
// registers a disabled pending import first) — "Установить" already implies
// the module should be active immediately.
modulesRouter.post("/catalog/:remoteId/install", async (req, res) => {
  let entry: CatalogManifestEntry;
  let data: unknown;
  try {
    entry = await fetchManifestEntry(req.params.remoteId);
    data = await fetchModuleFile(entry);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "не удалось скачать модуль" });
  }

  // Запрет не только в интерфейсе: иначе он обходится прямым запросом.
  if (tooOldFor(entry)) {
    return res.status(409).json({
      error:
        "нужна версия приложения не ниже " + entry.minAppVersion + " — обновитесь и попробуйте снова",
    });
  }

  try {
    if (entry.type === "system") {
      const systemId = await importSystemExport(data as SystemExportData);
      db.prepare(
        "INSERT INTO modules (type, name, source, enabled, system_id, setting_id, remote_id, remote_version) VALUES ('system', ?, 'imported', 1, ?, NULL, ?, ?)"
      ).run(entry.name, systemId, entry.id, entry.version);
    } else {
      const settingId = await importSettingExport(data as SettingExportData);
      db.prepare(
        "INSERT INTO modules (type, name, source, enabled, system_id, setting_id, remote_id, remote_version) VALUES ('setting', ?, 'imported', 1, NULL, ?, ?, ?)"
      ).run(entry.name, settingId, entry.id, entry.version);
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "не удалось установить модуль" });
  }

  res.status(201).json({ ok: true });
});

// Updates an already-installed catalog module in place — same
// backup-then-merge flow as the file-upload "⟳ Обновить", reusing
// createSystemBackup/updateSystemFromExport (and the setting equivalents)
// so both update paths behave identically.
modulesRouter.post("/catalog/:remoteId/update", async (req, res) => {
  const mod = db.prepare("SELECT * FROM modules WHERE remote_id = ?").get(req.params.remoteId) as ModuleRow | undefined;
  if (!mod) return res.status(404).json({ error: "модуль не установлен — сначала нажми «Установить»" });

  let entry: CatalogManifestEntry;
  let data: unknown;
  try {
    entry = await fetchManifestEntry(req.params.remoteId);
    data = await fetchModuleFile(entry);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "не удалось скачать модуль" });
  }

  try {
    if (entry.type === "system" && mod.system_id != null) {
      const target = db.prepare("SELECT name FROM systems WHERE id = ?").get(mod.system_id) as { name: string };
      const backup = await createSystemBackup(mod.system_id, target.name);
      const summary = await updateSystemFromExport(mod.system_id, data as SystemExportData);
      db.prepare("UPDATE modules SET remote_version = ? WHERE id = ?").run(entry.version, mod.id);
      return res.json({ backup, summary });
    }
    if (entry.type === "setting" && mod.setting_id != null) {
      const target = db.prepare("SELECT name FROM settings WHERE id = ?").get(mod.setting_id) as { name: string };
      const backup = await createSettingBackup(mod.setting_id, target.name);
      const summary = await updateSettingFromExport(mod.setting_id, data as SettingExportData);
      db.prepare("UPDATE modules SET remote_version = ? WHERE id = ?").run(entry.version, mod.id);
      return res.json({ backup, summary });
    }
    return res.status(400).json({ error: "модуль не материализован" });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "не удалось обновить модуль" });
  }
});
