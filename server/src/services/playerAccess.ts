import type { Response, NextFunction } from "express";
import { db } from "../db/db";
import type { AuthedRequest } from "./auth";

// Role-aware gate for the general /api/* surface (mounted in index.ts where
// the old blanket requireAuth("gm") used to be). A gm token passes
// everything, exactly as before. A player token gets a narrow allowlist with
// per-row ownership checks:
//
//   - their own characters: read + edit, chapters, important dates, avatar/
//     thumbnail/gallery, and statblocks owned by those characters — the same
//     editor surface the GM has for that character, no more;
//   - the compendium (GET /systems/**) read-only, because the statblock
//     editor's pickers (species, backgrounds, spells, feats…) live there.
//
// Everything else — campaigns, settings, finance, resources, search, other
// people's characters — stays 403 for players. Player-scoped views of shared
// content go through /api/player/* (mounted before this gate), never here.

function ownsCharacter(playerId: number, characterId: string | number): boolean {
  return !!db
    .prepare("SELECT id FROM characters WHERE id = ? AND player_id = ? AND archived_at IS NULL")
    .get(characterId, playerId);
}

function chapterOwned(playerId: number, chapterId: string): boolean {
  const row = db.prepare("SELECT character_id FROM character_chapters WHERE id = ?").get(chapterId) as
    | { character_id: number }
    | undefined;
  return !!row && ownsCharacter(playerId, row.character_id);
}

function importantDateOwned(playerId: number, dateId: string): boolean {
  const row = db
    .prepare("SELECT owner_type, owner_id FROM important_dates WHERE id = ?")
    .get(dateId) as { owner_type: string; owner_id: number } | undefined;
  return !!row && row.owner_type === "character" && ownsCharacter(playerId, row.owner_id);
}

function statblockOwned(playerId: number, statblockId: string): boolean {
  const row = db.prepare("SELECT owner_type, owner_id FROM statblocks WHERE id = ?").get(statblockId) as
    | { owner_type: string; owner_id: number }
    | undefined;
  return !!row && row.owner_type === "character" && ownsCharacter(playerId, row.owner_id);
}

function galleryImageOwned(playerId: number, imageId: string): boolean {
  const row = db.prepare("SELECT owner_type, owner_id FROM gallery_images WHERE id = ?").get(imageId) as
    | { owner_type: string; owner_id: number }
    | undefined;
  return !!row && row.owner_type === "character" && ownsCharacter(playerId, row.owner_id);
}

export function apiRoleGate(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  if (req.user.role === "gm") return next();

  const playerId = req.user.playerId;
  const p = req.path;
  const m = req.method;
  const forbid = () => void res.status(403).json({ error: "forbidden" });
  if (!playerId) return forbid();

  // Read-only compendium (statblock editor pickers + Системы section).
  if (m === "GET" && p.startsWith("/systems")) return next();

  let match: RegExpMatchArray | null;

  // Кабинет (own account): read their own player record, edit its name/
  // notes, and change its avatar — the same three fields the GM's Игроки
  // page can touch, scoped to this one row. Reminders/restore/delete on
  // /players/:id stay GM-only since they aren't matched here.
  if ((match = p.match(/^\/players\/(\d+)(\/avatar)?$/))) {
    if (Number(match[1]) !== playerId) return forbid();
    if (m === "GET" || m === "PUT" || (m === "POST" && match[2])) return next();
    return forbid();
  }

  // Chapter/date subroutes match before the generic /characters/:id pattern —
  // their ids are chapter/date ids, not character ids.
  if ((match = p.match(/^\/characters\/chapters\/(\d+)/))) {
    return chapterOwned(playerId, match[1]) ? next() : forbid();
  }
  if ((match = p.match(/^\/characters\/important-dates\/(\d+)/))) {
    return importantDateOwned(playerId, match[1]) ? next() : forbid();
  }
  if ((match = p.match(/^\/characters\/(\d+)(\/|$)/))) {
    if (!ownsCharacter(playerId, match[1])) return forbid();
    // No archiving/deleting your character out from under the campaign —
    // that stays a GM action.
    if (m === "DELETE" && p === `/characters/${match[1]}`) return forbid();
    return next();
  }

  if (p === "/statblocks" && m === "GET") {
    const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
    return owner_type === "character" && owner_id && ownsCharacter(playerId, owner_id) ? next() : forbid();
  }
  if ((p === "/statblocks" || p === "/statblocks/import") && m === "POST") {
    const { owner_type, owner_id } = req.body as { owner_type?: string; owner_id?: number };
    return owner_type === "character" && owner_id && ownsCharacter(playerId, owner_id) ? next() : forbid();
  }
  // `/restore` идёт тем же правом, что и удаление: игрок, который может снести
  // свой чарник, обязан мочь и отменить это. Без отдельной ветки путь не
  // подпадал под regex выше и упирался в forbid() — кнопка «Отменить» в тосте
  // работала бы только у мастера.
  if ((match = p.match(/^\/statblocks\/(\d+)(\/restore)?$/))) {
    return statblockOwned(playerId, match[1]) ? next() : forbid();
  }

  if (p === "/gallery" && m === "GET") {
    const { owner_type, owner_id } = req.query as { owner_type?: string; owner_id?: string };
    return owner_type === "character" && owner_id && ownsCharacter(playerId, owner_id) ? next() : forbid();
  }
  // Gallery upload is multipart — owner fields live in the form data, which
  // isn't parsed until the router's own multer middleware runs. Let it
  // through here; the ownership check runs inside the router (see
  // routes/gallery.ts playerOwnershipGuard).
  if (p === "/gallery" && m === "POST") return next();
  if ((match = p.match(/^\/gallery\/(\d+)$/))) {
    return galleryImageOwned(playerId, match[1]) ? next() : forbid();
  }

  return forbid();
}
