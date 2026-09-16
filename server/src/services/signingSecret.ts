import crypto from "crypto";
import fs from "fs";
import path from "path";

/** One secret for JWT and file HMAC, independent of the active storage. */
export function loadOrCreateSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  const configDir = env.CONFIG_DIR || path.join(__dirname, "..", "..", "config");
  const secretPath = path.join(configDir, "jwt-secret");
  const read = () => {
    const secret = fs.readFileSync(secretPath, "utf8").trim();
    if (!secret) throw new Error("Signing secret file is empty; restore the configuration secret");
    return secret;
  };
  try { return read(); } catch (error) {
    // Permission/read errors are not a first launch and must never rotate keys.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  fs.mkdirSync(configDir, { recursive: true });
  const secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretPath, secret, { flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    // Another process created it first. Never overwrite an existing key.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return read();
    throw error;
  }
}

let cached: string | undefined;
export function getSigningSecret(): string {
  return cached ??= loadOrCreateSigningSecret();
}
