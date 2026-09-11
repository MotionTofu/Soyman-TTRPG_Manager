import { describe, expect, it } from "vitest";
import { storageEnvConflict } from "./storages";

// Находка 8 (docs/db-open-seam-revision.md): DB_DIR без CONFIG_DIR молча
// перебивался активным профилем, и «сервер на копии» открывал рабочую базу.
describe("storageEnvConflict", () => {
  it("без переменных — рабочий запуск, конфликта нет", () => {
    expect(storageEnvConflict({})).toBeNull();
  });

  it("DB_DIR без CONFIG_DIR — отказ с объяснением", () => {
    const message = storageEnvConflict({ DB_DIR: "E:/copy" });
    expect(message).toMatch(/DB_DIR без CONFIG_DIR/);
  });

  it("VAULT_ROOT без CONFIG_DIR — тоже отказ", () => {
    expect(storageEnvConflict({ VAULT_ROOT: "E:/copy-vault" })).toMatch(/VAULT_ROOT без CONFIG_DIR/);
  });

  it("обе переменные называются обе", () => {
    expect(storageEnvConflict({ DB_DIR: "a", VAULT_ROOT: "b" })).toMatch(/DB_DIR и VAULT_ROOT/);
  });

  it("полная изоляция, как у Electron и check-migrations, — конфликта нет", () => {
    expect(storageEnvConflict({ DB_DIR: "a", VAULT_ROOT: "b", CONFIG_DIR: "c" })).toBeNull();
  });
});
