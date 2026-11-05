import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "./uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nativeCrypto = globalThis.crypto;

afterEach(() => vi.unstubAllGlobals());

describe("UUID в браузере", () => {
  it("использует встроенный randomUUID с правильным this", () => {
    const crypto = { randomUUID: vi.fn(function (this: unknown) {
      expect(this).toBe(crypto);
      return "00000000-0000-4000-8000-000000000001";
    }), getRandomValues: vi.fn() };
    vi.stubGlobal("crypto", crypto);
    expect(randomUUID()).toBe("00000000-0000-4000-8000-000000000001");
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });

  it.each([0, 255])("по HTTP сохраняет версию и вариант UUID при случайных байтах %i", value => {
    const crypto = { getRandomValues: vi.fn(function (this: unknown, bytes: Uint8Array) {
      expect(this).toBe(crypto);
      return bytes.fill(value);
    }) };
    vi.stubGlobal("crypto", crypto);
    const id = randomUUID();
    expect(id).toMatch(UUID_V4);
    expect(id).toBe(value === 0 ? "00000000-0000-4000-8000-000000000000" : "ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("без randomUUID создаёт разные UUID из getRandomValues", () => {
    vi.stubGlobal("crypto", { getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto) });
    const ids = Array.from({ length: 1000 }, randomUUID);
    expect(ids.every(id => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
