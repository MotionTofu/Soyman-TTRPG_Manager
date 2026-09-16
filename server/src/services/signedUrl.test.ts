import { describe, it, expect } from "vitest";
import { signPath, verifySignedUrl } from "./signedUrl";
import crypto from "crypto";

describe("signedUrl", () => {
  it("never accepts the publicly known fallback secret", () => {
    const p = "/files/private.jpg";
    const exp = String(Math.floor(Date.now() / 1000) + 60);
    const sig = crypto.createHmac("sha256", "fallback-signed-url-secret").update(`${p}|${exp}`).digest("hex");
    expect(verifySignedUrl(p, sig, exp)).toBe(false);
  });
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
