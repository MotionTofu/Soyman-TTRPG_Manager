import { describe, it, expect } from "vitest";

// copy of hasZipSlipEntry logic for unit test without importing router (has side effects)
function hasZipSlipEntry(entryName: string): boolean {
  if (!entryName) return true;
  if (entryName.includes("\0")) return true;
  let decoded = entryName;
  try { decoded = decodeURIComponent(entryName); } catch {}
  if (/[\u202A-\u202E\u200B-\u200F\uFEFF]/.test(decoded)) return true;
  const normalized = decoded.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) return true;
  if (decoded.includes(":") && /^[a-zA-Z]:/.test(decoded)) return true;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return true;
  if (decoded.startsWith("\\\\")) return true;
  return false;
}

describe("storages ZipSlip", () => {
  it("rejects .. traversal", () => expect(hasZipSlipEntry("../evil")).toBe(true));
  it("rejects %2e%2e encoded", () => expect(hasZipSlipEntry("%2e%2e%2Fevil")).toBe(true));
  it("rejects absolute", () => expect(hasZipSlipEntry("/etc/passwd")).toBe(true));
  it("allows normal", () => expect(hasZipSlipEntry("RPG-Vault/image.jpg")).toBe(false));
});
