import { Router } from "express";
import { db } from "../db/db";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireAdmin,
  needsSetup,
  type AuthedRequest,
  type AuthUser,
} from "../services/auth";

export const authRouter = Router();

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: "gm" | "player";
  player_id: number | null;
  is_admin: number;
  token_version: number;
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, role: row.role, playerId: row.player_id, isAdmin: !!row.is_admin, tokenVersion: row.token_version ?? 0 };
}

// Public: lets the client decide between the login form and the one-time
// "create GM account" setup form on a fresh install.
authRouter.get("/status", (_req, res) => {
  res.json({ needsSetup: needsSetup() });
});

// Public, but only works while no gm account exists — the very first launch
// of a fresh install. After that it's permanently 403 and GM credentials can
// only be changed by the GM themselves.
authRouter.post("/setup", async (req, res) => {
  if (!needsSetup()) return res.status(403).json({ error: "setup already completed" });
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const passwordHash = await hashPassword(password);
  // Первый мастер получает и права администратора: отдельной учётки с
  // известным паролем в приложении нет, а сменить роль игрока кто-то должен.
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role, is_admin) VALUES (?, ?, 'gm', 1)")
    .run(username.trim(), passwordHash);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid) as UserRow;
  const user = toAuthUser(row);
  res.status(201).json({ token: signToken(user), user });
});

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: "username and password are required" });
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return res.status(401).json({ error: "invalid username or password" });
  }
  const user = toAuthUser(row);
  res.json({ token: signToken(user), user });
});

authRouter.get("/me", requireAuth(), (req: AuthedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "authentication required" });
  res.json(req.user);
});

// Self-service account update (Кабинет) — any authenticated user, gm or
// player, changing their own login. Requires the current password so a
// hijacked session token alone can't lock the real owner out.
authRouter.put("/me", requireAuth(), async (req: AuthedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "authentication required" });
  const { currentPassword, username, password } = req.body as {
    currentPassword?: string;
    username?: string;
    password?: string;
  };
  if (!currentPassword) return res.status(400).json({ error: "currentPassword is required" });
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id) as UserRow | undefined;
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return res.status(401).json({ error: "current password is incorrect" });
  }
  if (username && username !== row.username) {
    const taken = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, row.id);
    if (taken) return res.status(409).json({ error: "username already taken" });
  }
  const passwordHash = password ? await hashPassword(password) : null;
  const bumpVersion = passwordHash ? ", token_version = token_version + 1" : "";
  db.prepare(
    `UPDATE users SET username = COALESCE(?, username), password_hash = COALESCE(?, password_hash)${bumpVersion} WHERE id = ?`
  ).run(username || null, passwordHash, row.id);
  const updated = toAuthUser(
    db.prepare("SELECT * FROM users WHERE id = ?").get(row.id) as UserRow
  );
  res.json({ token: signToken(updated), user: updated });
});

// GM-only: which players already have a login — lets the GM's "Игроки" page
// show account status per player without a separate lookup per row. Not
// filtered by role — a login stays visible here (and manageable) after an
// admin promotes it to gm, so the "Сменить логин/пароль" UI doesn't break.
authRouter.get("/players", requireAuth("gm"), (_req, res) => {
  const rows = db
    .prepare("SELECT id, username, role, is_admin, player_id FROM users WHERE player_id IS NOT NULL")
    .all();
  res.json(rows);
});

// GM-only: create a login for one of their players (linking to an existing
// `players` row so the account's character access can be derived from it —
// see routes/player.ts). One account per player — a second call for the same
// player_id is rejected; use PUT /players/:playerId to change username/password
// on the existing account instead.
authRouter.post("/players", requireAuth("gm"), async (req, res) => {
  const { username, password, player_id } = req.body as {
    username?: string;
    password?: string;
    player_id?: number;
  };
  if (!username || !password || !player_id) {
    return res.status(400).json({ error: "username, password and player_id are required" });
  }
  const player = db.prepare("SELECT id FROM players WHERE id = ?").get(player_id);
  if (!player) return res.status(404).json({ error: "player not found" });
  const existingForPlayer = db.prepare("SELECT id FROM users WHERE player_id = ?").get(player_id);
  if (existingForPlayer) return res.status(409).json({ error: "this player already has a login" });
  const existingUsername = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existingUsername) return res.status(409).json({ error: "username already taken" });
  const passwordHash = await hashPassword(password);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role, player_id) VALUES (?, ?, 'player', ?)")
    .run(username, passwordHash, player_id);
  res.status(201).json({ id: info.lastInsertRowid, username, role: "player", player_id });
});

// GM-only: change username and/or reset the password on a player's existing
// login. Keyed by player_id (not the users.id) since that's what the GM UI
// already has on hand from the players list.
authRouter.put("/players/:playerId/password", requireAuth("gm"), async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const existing = db
    .prepare("SELECT id, username FROM users WHERE player_id = ?")
    .get(req.params.playerId) as { id: number; username: string } | undefined;
  if (!existing) return res.status(404).json({ error: "this player has no login yet" });

  if (username && username !== existing.username) {
    const taken = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, existing.id);
    if (taken) return res.status(409).json({ error: "username already taken" });
  }
  const passwordHash = password ? await hashPassword(password) : null;
  const bump = passwordHash ? ", token_version = token_version + 1" : "";
  db.prepare(`UPDATE users SET username = COALESCE(?, username), password_hash = COALESCE(?, password_hash)${bump} WHERE id = ?`).run(
    username || null,
    passwordHash,
    existing.id
  );
  const updated = db.prepare("SELECT id, username, player_id FROM users WHERE id = ?").get(existing.id);
  res.json(updated);
});

// Admin-only: grant or revoke the "Мастер" (gm) label on a player's login.
// Keyed by player_id like the endpoints above, for the same reason (that's
// what the GM UI already has on hand). The seeded admin account itself
// (is_admin=1) can't be changed here — it has no player_id anyway, since it
// isn't tied to any player row, but the guard also protects a future admin
// account that someone links to a player.
authRouter.put("/players/:playerId/role", requireAdmin(), async (req, res) => {
  const { role } = req.body as { role?: "gm" | "player" };
  if (role !== "gm" && role !== "player") {
    return res.status(400).json({ error: "role must be 'gm' or 'player'" });
  }
  const existing = db
    .prepare("SELECT id, is_admin FROM users WHERE player_id = ?")
    .get(req.params.playerId) as { id: number; is_admin: number } | undefined;
  if (!existing) return res.status(404).json({ error: "this player has no login yet" });
  if (existing.is_admin) return res.status(403).json({ error: "can't change the admin account's role" });
  db.prepare("UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?").run(role, existing.id);
  res.json({ id: existing.id, role });
});
