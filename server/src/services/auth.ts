import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/db";

// Auth is always on — local desktop and hosted deployments alike. The first
// launch with no gm account shows a one-time "create GM account" setup form
// in the client (see routes/auth.ts /status + /setup) instead of requiring
// ADMIN_USERNAME/ADMIN_PASSWORD env vars.

// Same default as storages.ts's CONFIG_DIR — the secret must survive both
// restarts and storage switches, or every restart would log everyone out.
// JWT_SECRET env still wins (hosted deployments set it explicitly).
function loadOrCreateJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const configDir = process.env.CONFIG_DIR || path.join(__dirname, "..", "..", "config");
  const secretPath = path.join(configDir, "jwt-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf-8").trim();
    if (existing) return existing;
  } catch {
    /* first run — generate below */
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  try { fs.chmodSync(secretPath, 0o600); } catch {}
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();

export interface AuthUser {
  id: number;
  username: string;
  role: "gm" | "player";
  playerId: number | null;
  // Права администратора — независимо от `role` (она остаётся "gm", то есть
  // обычный мастерский доступ у такого аккаунта тоже есть). Единственное, что
  // закрыто этим флагом, — смена роли у чужих учёток. Флаг получает первый
  // мастер, заведённый первым запуском (см. POST /auth/setup).
  isAdmin: boolean;
  tokenVersion: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

// Exported (not just used internally) so routes/index.ts can accept a
// `?token=` query param as a fallback where a bearer header isn't possible —
// see the /files middleware, which plain <img>/<audio> tags hit directly.
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    // Отзыв старых токенов при смене пароля/роли (audit P0 C-03): сравниваем
    // tokenVersion из JWT с актуальным в БД — несовпадение = токен отозван.
    try {
      const row = db.prepare("SELECT token_version FROM users WHERE id = ?").get(payload.id) as { token_version: number } | undefined;
      if (row && typeof payload.tokenVersion === "number" && row.token_version !== payload.tokenVersion) return null;
      // Для токенов, выданных до введения token_version (поле отсутствует),
      // считаем версию 0 — совпадает с DEFAULT 0 в БД, не ломает старые сессии.
      if (row && payload.tokenVersion == null && row.token_version !== 0) return null;
    } catch {
      // Если БД ещё не мигрирована — не блокируем вход
    }
    return payload;
  } catch {
    return null;
  }
}

// Reads the bearer token (if any) and attaches req.user — never rejects on
// its own, so it can also be used where auth is optional. requireAuth below
// is what actually enforces a role.
export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const user = verifyToken(header.slice("Bearer ".length));
    if (user) req.user = user;
  }
  next();
}

// role omitted = any authenticated user; role='gm'|'player' = that role only.
export function requireAuth(role?: "gm" | "player") {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "authentication required" });
    if (role && req.user.role !== role) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

// Gates the "change another account's role" endpoint — narrower than
// requireAuth("gm"), since every gm account can already do everything else a
// gm can do, but only the seeded admin/admin account can hand out the gm
// label itself.
export function requireAdmin() {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "authentication required" });
    if (!req.user.isAdmin) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

// Whether the one-time first-run setup is still needed (no gm account yet).
// Exposed via GET /api/auth/status so the client can show the "create GM
// account" form instead of a login form no one could pass.
export function needsSetup(): boolean {
  return !db.prepare("SELECT id FROM users WHERE role = 'gm'").get();
}

// Called once at startup. Headless/hosted deployments can still seed the
// first GM login from ADMIN_USERNAME/ADMIN_PASSWORD env vars; interactive
// installs go through the client's first-run setup screen instead (see
// routes/auth.ts POST /setup). No-op once a gm account exists.
export async function bootstrapGmAccount(): Promise<void> {
  if (!needsSetup()) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const passwordHash = await hashPassword(password);
  // Права администратора — этой же учётке: она первая и единственная, и
  // отдельного аккаунта с известным паролем в приложении больше нет.
  db.prepare(
    "INSERT INTO users (username, password_hash, role, is_admin) VALUES (?, ?, 'gm', 1)"
  ).run(username, passwordHash);
  console.log(`[auth] Bootstrapped gm account "${username}".`);
}

