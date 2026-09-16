import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import childProcess from "node:child_process";
import { openInFileExplorer, VAULT_ROOT, writeReplacingOldFile, writeBase64File, deleteVaultFolder } from "./filesystem";
import { storeDeduped } from "./vaultDedup";

vi.mock("node:child_process", () => ({ default: { execFile: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const outside = () => fs.mkdtempSync(path.join(os.tmpdir(), "soyman-outside-"));

describe("vault filesystem boundaries", () => {
  it("rejects a junction to an external directory for writes, reveal and deletion", async () => {
    const external = outside();
    fs.writeFileSync(path.join(external, "keep.txt"), "keep");
    const junction = path.join(VAULT_ROOT, "escape");
    fs.symlinkSync(external, junction, "junction");
    await expect(writeBase64File(junction, "created.txt", Buffer.from("new").toString("base64"))).rejects.toThrow();
    expect(() => openInFileExplorer(junction, false)).toThrow();
    deleteVaultFolder(junction);
    expect(fs.readFileSync(path.join(external, "keep.txt"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(external, "created.txt"))).toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
  it("does not delete an external old file when replacing an upload", async () => {
    const external = path.join(outside(), "old.txt");
    fs.writeFileSync(external, "keep");
    await writeReplacingOldFile(path.join(VAULT_ROOT, "replacement.txt"), Buffer.from("new contents"), external);
    expect(fs.readFileSync(external, "utf8")).toBe("keep");
  });
  it("keeps the old file if the new destination cannot be written", async () => {
    const old = path.join(VAULT_ROOT, "old.txt");
    fs.writeFileSync(old, "keep");
    await expect(writeReplacingOldFile(path.join(VAULT_ROOT, "missing-parent", "new.txt"), Buffer.from("new"), old)).rejects.toThrow();
    expect(fs.readFileSync(old, "utf8")).toBe("keep");
  });
  it("preserves a same-path file and its hard-linked neighbour if replacement fails", async () => {
    const target = path.join(VAULT_ROOT, "atomic.txt");
    const neighbour = path.join(VAULT_ROOT, "neighbour.txt");
    fs.writeFileSync(target, "original");
    fs.linkSync(target, neighbour);
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("injected rename failure"); });
    await expect(storeDeduped(Buffer.from("replacement"), target)).rejects.toThrow("injected rename failure");
    expect(fs.readFileSync(target, "utf8")).toBe("original");
    expect(fs.readFileSync(neighbour, "utf8")).toBe("original");
  });

  it("replaces a file successfully without changing its hard-link peer", async () => {
    const target = path.join(VAULT_ROOT, "success.txt");
    const neighbour = path.join(VAULT_ROOT, "success-peer.txt");
    await storeDeduped(Buffer.from("before"), target);
    fs.linkSync(target, neighbour);
    await writeReplacingOldFile(target, Buffer.from("after"), target);
    expect(fs.readFileSync(target, "utf8")).toBe("after");
    expect(fs.readFileSync(neighbour, "utf8")).toBe("before");
  });
});
