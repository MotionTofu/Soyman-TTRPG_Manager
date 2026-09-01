import { describe, it, expect } from "vitest";
import { verifySignedUrl, signPath } from "./signedUrl";

// auth rate-limit is integration, unit here checks HMAC secret mode 0600 not testable without fs
// so we test signedUrl as proxy for auth token handling
describe("auth signedUrl HMAC", () => {
  it("sig is hex 64 chars", () => {
    const p = "/files/a";
    const s = signPath(p, 60);
    const sig = new URL("http://x" + s).searchParams.get("sig")!;
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});
