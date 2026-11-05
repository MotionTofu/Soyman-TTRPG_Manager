import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../db/db";
import { requireKind, SATELLITE_OWNERS } from "../db/entityKinds";
import { campaignPlayerSectionFolder, ensureSubfolder, vaultAbs, vaultRel } from "./filesystem";
import { storeDedupedFile } from "./vaultDedup";

const SOURCE_TABLES = Object.fromEntries(SATELLITE_OWNERS.gallery_images
  .filter((kind) => ["being", "location", "community", "artifact"].includes(kind))
  .map((kind) => [kind, requireKind(kind).table]));

export function galleryIssueOptions(ownerType: string, ownerId: number) {
  const table = SOURCE_TABLES[ownerType];
  if (!table) return [];
  return db.prepare(`SELECT c.id, c.name FROM campaigns c JOIN ${table} o ON o.setting_id = c.setting_id
    WHERE o.id = ? AND o.archived_at IS NULL AND c.archived_at IS NULL ORDER BY c.name`).all(ownerId);
}

export function galleryIssues(sourceId: number, campaignId?: number) {
  const copies = db.prepare(`SELECT i.id AS image_id, c.id AS campaign_id, c.name AS campaign_name,
    s.id AS section_id, s.name AS section_name FROM gallery_images i
    JOIN campaign_player_sections s ON s.id = i.owner_id JOIN campaigns c ON c.id = s.campaign_id
    WHERE i.source_image_id = ? AND i.owner_type = 'campaign_player_section' AND i.archived_at IS NULL
      AND s.archived_at IS NULL AND c.archived_at IS NULL ${campaignId ? "AND c.id = ?" : ""}
    ORDER BY c.name, s.position, i.id`).all(...(campaignId ? [sourceId, campaignId] : [sourceId])) as {
      image_id: number; campaign_id: number; campaign_name: string; section_id: number; section_name: string;
    }[];
  const players = db.prepare(`SELECT DISTINCT p.id, p.name FROM player_visibility_grants g
    JOIN players p ON p.id = g.player_id JOIN campaign_roster r ON r.player_id = p.id AND r.campaign_id = g.campaign_id
    WHERE g.campaign_id = ? AND g.target_type = 'campaign_player_image' AND g.target_id = ?
      AND g.access_level = 'open' AND r.status != 'left' ORDER BY p.name`);
  return copies.map((copy) => ({ ...copy, players: players.all(copy.campaign_id, copy.image_id) }));
}

export class GalleryIssueError extends Error {}

export async function issueGalleryImage(sourceId: number, campaignId: number, sectionId: number | null, playerIds: number[]) {
  function validate() {
    const source = db.prepare("SELECT * FROM gallery_images WHERE id = ? AND archived_at IS NULL").get(sourceId) as
      { owner_type: string; owner_id: number; image_path: string; caption: string } | undefined;
    if (!source || !SOURCE_TABLES[source.owner_type]) throw new GalleryIssueError("Изображение недоступно для выдачи");
    const owner = db.prepare(`SELECT setting_id FROM ${SOURCE_TABLES[source.owner_type]} WHERE id = ? AND archived_at IS NULL`)
      .get(source.owner_id) as { setting_id: number } | undefined;
    const campaign = db.prepare("SELECT setting_id, folder_path FROM campaigns WHERE id = ? AND archived_at IS NULL")
      .get(campaignId) as { setting_id: number; folder_path: string | null } | undefined;
    if (!owner || !campaign || campaign.setting_id !== owner.setting_id || !campaign.folder_path) throw new GalleryIssueError("Кампания должна принадлежать сеттингу изображения");
    const section = sectionId == null ? null : db.prepare(`SELECT id, folder_path FROM campaign_player_sections
      WHERE id = ? AND campaign_id = ? AND kind = 'gallery' AND archived_at IS NULL`).get(sectionId, campaignId) as
      { id: number; folder_path: string | null } | undefined;
    if (sectionId != null && !section?.folder_path) throw new GalleryIssueError("Раздел должен быть галереей этой кампании");
    const member = db.prepare("SELECT 1 FROM campaign_roster WHERE campaign_id = ? AND player_id = ? AND status != 'left'");
    if (playerIds.some((id) => !member.get(campaignId, id))) throw new GalleryIssueError("Игрок отсутствует в ростере кампании");
    return { source, campaign, section };
  }
  const { source, campaign, section } = validate();
  const existing = () => sectionId == null ? undefined : db.prepare(`SELECT id FROM gallery_images
    WHERE owner_type = 'campaign_player_section' AND owner_id = ? AND source_image_id = ? AND archived_at IS NULL ORDER BY id LIMIT 1`)
    .get(sectionId, sourceId) as { id: number } | undefined;
  let copy = existing();
  let target: string | null = null;
  // File I/O is asynchronous. Stage bytes first; the section, copy and grants below
  // are committed together in one synchronous SQLite transaction, after revalidation.
  const folder = section?.folder_path ?? campaignPlayerSectionFolder(campaign.folder_path!, "Изображения");
  try {
    if (!copy) {
      target = path.join(ensureSubfolder(folder, "Gallery"), `img-${crypto.randomUUID()}${path.extname(source.image_path)}`);
      await storeDedupedFile(vaultAbs(source.image_path), target);
    }
    const result = db.transaction(() => {
      const current = validate();
      if (sectionId == null) {
        const pos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM campaign_player_sections WHERE campaign_id = ?").get(campaignId) as { n: number };
        sectionId = Number(db.prepare(`INSERT INTO campaign_player_sections (campaign_id, name, kind, folder_path, position)
          VALUES (?, 'Изображения', 'gallery', ?, ?)`).run(campaignId, folder, pos.n).lastInsertRowid);
      }
      copy = existing();
      if (!copy) {
        const pos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM gallery_images WHERE owner_type = 'campaign_player_section' AND owner_id = ?").get(sectionId) as { n: number };
        copy = { id: Number(db.prepare(`INSERT INTO gallery_images (owner_type, owner_id, image_path, caption, position, source_image_id)
          VALUES ('campaign_player_section', ?, ?, ?, ?, ?)`).run(sectionId, vaultRel(target!), current.source.caption, pos.n, sourceId).lastInsertRowid) };
      }
      const grant = db.prepare(`INSERT INTO player_visibility_grants (campaign_id, player_id, target_type, target_id, access_level)
        VALUES (?, ?, 'campaign_player_image', ?, 'open')
        ON CONFLICT(campaign_id, player_id, target_type, target_id) DO UPDATE SET access_level = excluded.access_level`);
      for (const playerId of new Set(playerIds)) grant.run(campaignId, playerId, copy.id);
      return { campaign_id: campaignId, section_id: sectionId, image_id: copy.id };
    })();
    const saved = db.prepare("SELECT image_path FROM gallery_images WHERE id = ?").get(result.image_id) as { image_path: string };
    if (target && saved.image_path === vaultRel(target)) target = null;
    return result;
  } finally {
    if (target) {
      if (fs.existsSync(vaultAbs(target))) fs.unlinkSync(vaultAbs(target));
      db.prepare("DELETE FROM vault_files WHERE path = ?").run(vaultRel(target));
    }
  }
}
