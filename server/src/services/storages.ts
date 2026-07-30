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

// Called once at process startup, before ./db/db is imported, so the initial
// SQLite connection opens against whichever storage is currently active
// instead of always the hardcoded defaults.
export function applyActiveStorageEnv(): void {
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
