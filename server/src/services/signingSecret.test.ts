import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getSigningSecret, loadOrCreateSigningSecret } from "./signingSecret";

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), "soyman-secret-"));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("shared signing secret", () => {
  it("creates once and survives a new load and storage changes", () => {
    const CONFIG_DIR = fresh();
    const first = loadOrCreateSigningSecret({ CONFIG_DIR });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(loadOrCreateSigningSecret({ CONFIG_DIR, DB_DIR: "other", VAULT_ROOT: "other" })).toBe(first);
  });
  it("preserves an existing secret and lets env override it", () => {
    const CONFIG_DIR = fresh();
    fs.writeFileSync(path.join(CONFIG_DIR, "jwt-secret"), "existing-secret\n");
    expect(loadOrCreateSigningSecret({ CONFIG_DIR })).toBe("existing-secret");
    expect(loadOrCreateSigningSecret({ CONFIG_DIR, JWT_SECRET: "env-secret" })).toBe("env-secret");
    expect(fs.readFileSync(path.join(CONFIG_DIR, "jwt-secret"), "utf8")).toBe("existing-secret\n");
  });
  it("does not replace an empty or unreadable secret", () => {
    const CONFIG_DIR = fresh();
    const file = path.join(CONFIG_DIR, "jwt-secret");
    fs.writeFileSync(file, " ");
    expect(() => loadOrCreateSigningSecret({ CONFIG_DIR })).toThrow(/empty/);
    const write = vi.spyOn(fs, "writeFileSync");
    vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw Object.assign(new Error("access denied"), { code: "EACCES" }); });
    expect(() => loadOrCreateSigningSecret({ CONFIG_DIR })).toThrow("access denied");
    expect(write).not.toHaveBeenCalled();
  });
  it("keeps the in-process secret when its file disappears", () => {
    const CONFIG_DIR = fresh();
    vi.stubEnv("CONFIG_DIR", CONFIG_DIR);
    vi.stubEnv("JWT_SECRET", "");
    const first = getSigningSecret();
    fs.unlinkSync(path.join(CONFIG_DIR, "jwt-secret"));
    expect(getSigningSecret()).toBe(first);
  });
  it("does not overwrite a key created by another process", () => {
    const CONFIG_DIR = fresh();
    const original = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce((file, _data, _options) => {
      original(file, "winner-secret");
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    });
    expect(loadOrCreateSigningSecret({ CONFIG_DIR })).toBe("winner-secret");
  });
});
