import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface StorageProfile {
  id: string;
  name: string;
  dbDir: string;
  vaultRoot: string;
  createdAt: string;
}

interface Registry {
  activeId: string;
  storages: StorageProfile[];
}

// CONFIG_DIR is deliberately independent of DB_DIR/VAULT_ROOT: it has to stay
// put while those two get swapped out from under the running app whenever
// the user switches storages.
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, "..", "..", "config");
const REGISTRY_PATH = path.join(CONFIG_DIR, "storages.json");

function defaultDbDir(): string {
  return process.env.DB_DIR || path.join(__dirname, "..", "..", "data");
}
function defaultVaultRoot(): string {
  return process.env.VAULT_ROOT || "E:\\RPG-Vault";
}

function load(): Registry {
  if (!fs.existsSync(REGISTRY_PATH)) {
    const bootstrap: Registry = {
      activeId: "default",
      storages: [
        {
          id: "default",
          name: "Основное хранилище",
          dbDir: defaultDbDir(),
          vaultRoot: defaultVaultRoot(),
          createdAt: new Date().toISOString(),
        },
      ],
    };
    save(bootstrap);
    return bootstrap;
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as Registry;
}

function save(registry: Registry): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

export function listStorages(): { activeId: string; storages: StorageProfile[] } {
  return load();
}

export function getActiveStorage(): StorageProfile {
  const registry = load();
  const active = registry.storages.find((s) => s.id === registry.activeId);
  return active ?? registry.storages[0];
}

/**
 * DB_DIR или VAULT_ROOT из окружения без своего CONFIG_DIR — ловушка: реестр
 * хранилищ тогда читается из общего `server/config` и молча перебивает их
 * активным профилем. Так конфигурации `api-scratch*` годами работали с рабочей
 * базой и рабочим хранилищем, считая, что работают с копией
 * (docs/db-open-seam-revision.md, находка 8).
 *
 * Уважать DB_DIR из окружения нельзя: Electron ставит его всегда, и тогда
 * переключение хранилища в установленном приложении перестало бы работать.
 * Но Electron ставит и CONFIG_DIR — как и scripts/check-migrations.js, — так что
 * запрет задевает только неполную изоляцию.
 */
export function storageEnvConflict(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CONFIG_DIR) return null;
  const given = (["DB_DIR", "VAULT_ROOT"] as const).filter((name) => env[name]);
  if (given.length === 0) return null;
  return (
    `Задан ${given.join(" и ")} без CONFIG_DIR. Реестр хранилищ из общего server/config ` +
    `перебил бы ${given.length > 1 ? "их" : "его"} активным профилем, и сервер открыл бы рабочую ` +
    `базу и рабочее хранилище. Задайте CONFIG_DIR (свой каталог для копии) вместе с DB_DIR и VAULT_ROOT.`
  );
}

// Called once at process startup, before ./db/db is imported, so the initial
// SQLite connection opens against whichever storage is currently active
// instead of always the hardcoded defaults.
export function applyActiveStorageEnv(): void {
  const conflict = storageEnvConflict();
  if (conflict) throw new Error(conflict);
  const active = getActiveStorage();
  process.env.DB_DIR = active.dbDir;
  process.env.VAULT_ROOT = active.vaultRoot;
}

export function addStorage(name: string, dbDir: string, vaultRoot: string): StorageProfile {
  const registry = load();
  const profile: StorageProfile = {
    id: crypto.randomUUID(),
    name,
    dbDir,
    vaultRoot,
    createdAt: new Date().toISOString(),
  };
  registry.storages.push(profile);
  save(registry);
  return profile;
}

export function updateStorage(id: string, patch: { name?: string }): StorageProfile {
  const registry = load();
  const profile = registry.storages.find((s) => s.id === id);
  if (!profile) throw new Error("storage not found");
  if (patch.name) profile.name = patch.name;
  save(registry);
  return profile;
}

export function removeStorage(id: string): void {
  const registry = load();
  if (registry.activeId === id) throw new Error("cannot remove the active storage");
  registry.storages = registry.storages.filter((s) => s.id !== id);
  save(registry);
}

export function setActiveStorageId(id: string): StorageProfile {
  const registry = load();
  const profile = registry.storages.find((s) => s.id === id);
  if (!profile) throw new Error("storage not found");
  registry.activeId = id;
  save(registry);
  return profile;
}
