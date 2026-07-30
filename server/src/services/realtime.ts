import type { Server as HttpServer } from "http";
import { Server as SocketIoServer } from "socket.io";
import { verifyToken, type AuthUser } from "./auth";
import { db } from "../db/db";

let io: SocketIoServer | null = null;

function campaignsForPlayer(playerId: number): number[] {
  const rows = db
    .prepare("SELECT DISTINCT campaign_id FROM characters WHERE player_id = ? AND archived_at IS NULL")
    .all(playerId) as { campaign_id: number }[];
  return rows.map((r) => r.campaign_id);
}

// Called once at startup (auth is always on now, so realtime always
// initializes — the local desktop GM's own client is a socket consumer too).
// Player sockets auto-join a room per campaign they're in, via the same
// characters->campaign derivation used by routes/player.ts, so a GM
// broadcast to "campaign:<id>" reaches exactly the right players.
export function initRealtime(httpServer: HttpServer): SocketIoServer {
  io = new SocketIoServer(httpServer, {
    cors: { origin: true }, // same allowlist reasoning doesn't apply here — the JWT handshake is what gates access
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("authentication required"));
    const user = verifyToken(token);
    if (!user) return next(new Error("invalid token"));
    (socket.data as { user: AuthUser }).user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = (socket.data as { user: AuthUser }).user;
    if (user.role === "player" && user.playerId) {
      socket.join(`player:${user.playerId}`);
      for (const campaignId of campaignsForPlayer(user.playerId)) {
        socket.join(`campaign:${campaignId}`);
      }
    } else if (user.role === "gm") {
      socket.join("gm");
    }
  });

  return io;
}

// Used by routes (e.g. POST /api/campaigns/:id/show-image) to push to every
// connected player device in that campaign.
export function broadcastToCampaign(campaignId: number, event: string, payload: unknown): void {
  io?.to(`campaign:${campaignId}`).emit(event, payload);
}

// Fired after any save touching a character (profile fields, chapters,
// statblock content) so an open player-app character view and an open
// desktop CharacterDetailPage stay in sync without a manual "Синхронизировать".
// Reaches the owning player (via their campaign room, or a direct
// player:<id> room for a standalone character with no campaign) and every
// connected GM instance (the "gm" room) — a GM desktop app has no single
// campaign scope to join, so it just gets everything and filters by id itself.
export function broadcastCharacterUpdate(characterId: number): void {
  if (!io) return;
  const row = db
    .prepare("SELECT campaign_id, player_id FROM characters WHERE id = ?")
    .get(characterId) as { campaign_id: number | null; player_id: number } | undefined;
  if (!row) return;
  const payload = { characterId };
  if (row.campaign_id != null) {
    io.to(`campaign:${row.campaign_id}`).emit("character-updated", payload);
  } else {
    io.to(`player:${row.player_id}`).emit("character-updated", payload);
  }
  io.to("gm").emit("character-updated", payload);
}
