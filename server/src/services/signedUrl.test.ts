import { describe, it, expect } from "vitest";
import { signPath, verifySignedUrl } from "./signedUrl";

describe("signedUrl", () => {
  it("signs and verifies /files path within TTL", () => {
    const p = "/files/Campaigns/test/image.jpg";
    const signed = signPath(p, 60);
    const url = new URL("http://x" + signed);
    const sig = url.searchParams.get("sig")!;
    const exp = url.searchParams.get("exp")!;
    expect(verifySignedUrl(p, sig, exp)).toBe(true);
  });
  it("rejects expired", () => {
    const p = "/files/a.jpg";
    const signed = signPath(p, -10);
    const url = new URL("http://x" + signed);
    const sig = url.searchParams.get("sig")!;
    const exp = url.searchParams.get("exp")!;
    expect(verifySignedUrl(p, sig, exp)).toBe(false);
  });
  it("rejects tampered path", () => {
    const p = "/files/a.jpg";
    const signed = signPath(p, 60);
    const url = new URL("http://x" + signed);
    const sig = url.searchParams.get("sig")!;
    const exp = url.searchParams.get("exp")!;
    expect(verifySignedUrl("/files/b.jpg", sig, exp)).toBe(false);
  });
});
