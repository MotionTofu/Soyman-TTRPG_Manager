import { describe, it, expect } from "vitest";

import { hasZipSlipEntry } from "./storages";

describe("storages ZipSlip", () => {
  it.each(["RPG-Vault/x:stream", "RPG-Vault/CON.txt", "RPG-Vault/x%00.txt", "RPG-Vault/..\\escape", "\\\\host\\share\\file", "C:/outside.txt"])("rejects unsafe path %s", entry => {
    expect(hasZipSlipEntry(entry)).toBe(true);
  });
  it("rejects .. traversal", () => expect(hasZipSlipEntry("../evil")).toBe(true));
  it("rejects %2e%2e encoded", () => expect(hasZipSlipEntry("%2e%2e%2Fevil")).toBe(true));
  it("rejects absolute", () => expect(hasZipSlipEntry("/etc/passwd")).toBe(true));
  it("allows normal", () => expect(hasZipSlipEntry("RPG-Vault/image.jpg")).toBe(false));
});
