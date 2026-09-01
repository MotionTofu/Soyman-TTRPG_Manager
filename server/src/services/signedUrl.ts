import crypto from "crypto";
import fs from "fs";
import path from "path";

function getSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const configDir = process.env.CONFIG_DIR || path.join(__dirname, "..", "..", "config");
    const p = path.join(configDir, "jwt-secret");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").trim();
  } catch {}
  return "fallback-signed-url-secret";
}

function normalizeBase(p: string): string {
  // Каноническая форма для HMAC — декодированная (файловая) форма.
  // Приходит ли base уже в виде "/files/D%20..." или "/files/D D..." —
  // сводим к одному виду, иначе подпись, посчитанная на raw-форме, не
  // совпадёт с проверкой на encoded-форме (папка "D&D 5.5" ломала все
  // картинки Бестиария). decodeURIComponent бросает на голом пробеле — ловим.
  try {
    return decodeURIComponent(p);
  } catch {
    try {
      return decodeURI(p);
    } catch {
      return p;
    }
  }
}

function encodeBase(p: string): string {
  // Кодируем каждый сегмент пути отдельно, чтобы пробел/&/unicode ушли в
  // %XX, а "/" остался разделителем. "/files" остаётся как есть, но
  // encodeURIComponent на нём безвреден.
  return p.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/");
}

export function signPath(filePath: string, ttlSec = 60): string {
  const [base, existingQs] = filePath.split("?");
  const normalized = normalizeBase(base);
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const data = `${normalized}|${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
  const encodedBase = encodeBase(normalized);
  if (existingQs) return `${encodedBase}?${existingQs}&sig=${sig}&exp=${exp}`;
  return `${encodedBase}?sig=${sig}&exp=${exp}`;
}

export function verifySignedUrl(filePath: string, sig: string, exp: string): boolean {
  const rawBase = filePath.split("?")[0];
  const base = normalizeBase(rawBase);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const data = `${base}|${expNum}`;
  const expected = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
