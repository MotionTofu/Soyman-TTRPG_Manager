// Корабль кампании (спека profiles-paper-2, «Корабль кампании»): вкладка
// «Транспорт» и страница корабля у Мастера. Запись на основе судна
// компендиума — см. services/campaignVessels.ts.
//
// Только Мастер: роутер стоит за общим гейтом /api (index.ts). Игрок читает
// свои корабли через /api/player/campaigns/:id/vessels.
import { Router } from "express";
import { db } from "../db/db";
import { toFileUrl } from "../services/filesystem";
import { vesselRow, vesselSummary, vesselView, type VesselRow } from "../services/campaignVessels";

export const campaignVesselsRouter = Router();

const MAX_NAME = 120;
const MAX_CARGO = 300;
const MAX_UNNAMED = 100_000;

function campaignOf(id: unknown) {
  return db.prepare("SELECT id, system_id, setting_id FROM campaigns WHERE id = ?").get(id) as
    | { id: number; system_id: number | null; setting_id: number | null }
    | undefined;
}

function isVessel(entryId: unknown): boolean {
  return !!db
    .prepare("SELECT 1 FROM compendium_entries WHERE id = ? AND kind = 'vehicle' AND parent_id IS NULL")
    .get(entryId);
}

/** Пост основы этого корабля — иначе экипаж и хиты повисли бы на чужом посте. */
function isPostOf(v: VesselRow, postId: unknown): boolean {
  return (
    v.entry_id != null &&
    !!db.prepare("SELECT 1 FROM compendium_entries WHERE id = ? AND parent_id = ? AND kind = 'vehicle_post'").get(postId, v.entry_id)
  );
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null);

function sendView(res: import("express").Response, id: number) {
  const v = vesselRow(id);
  if (!v) return res.status(404).json({ error: "not found" });
  res.json(vesselView(v, { gm: true }));
}

campaignVesselsRouter.get("/campaign/:campaignId", (req, res) => {
  if (!campaignOf(req.params.campaignId)) return res.status(404).json({ error: "not found" });
  const rows = db
    .prepare("SELECT * FROM campaign_vessels WHERE campaign_id = ? ORDER BY archived_at IS NOT NULL, position, id")
    .all(req.params.campaignId) as VesselRow[];
  res.json(rows.map(vesselSummary));
});

// Суда для «+ Корабль»: компендиум системы кампании, без системы — все.
campaignVesselsRouter.get("/campaign/:campaignId/bases", (req, res) => {
  const c = campaignOf(req.params.campaignId);
  if (!c) return res.status(404).json({ error: "not found" });
  const rows = db
    .prepare(
      `SELECT ce.id, ce.name, ce.data, sy.name AS system_name FROM compendium_entries ce
         JOIN systems sy ON sy.id = ce.system_id
        WHERE ce.kind = 'vehicle' AND ce.parent_id IS NULL AND (? IS NULL OR ce.system_id = ?)
        ORDER BY ce.name COLLATE NOCASE`
    )
    .all(c.system_id, c.system_id) as { id: number; name: string; data: string; system_name: string }[];
  res.json(
    rows.map((r) => {
      let category = "";
      try {
        const d = JSON.parse(r.data) as { category?: unknown };
        if (typeof d.category === "string") category = d.category;
      } catch {
        // битый data — без категории
      }
      return { id: r.id, name: r.name, category, system_name: r.system_name };
    })
  );
});

campaignVesselsRouter.post("/campaign/:campaignId", (req, res) => {
  if (!campaignOf(req.params.campaignId)) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const entryId = int(body.entry_id);
  if (entryId == null || !isVessel(entryId)) return res.status(400).json({ error: "Нужно судно из компендиума" });
  const base = db.prepare("SELECT name FROM compendium_entries WHERE id = ?").get(entryId) as { name: string };
  const name = text(body.name, MAX_NAME) || base.name;
  const pos = (
    db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM campaign_vessels WHERE campaign_id = ?").get(req.params.campaignId) as {
      p: number;
    }
  ).p;
  const info = db
    .prepare("INSERT INTO campaign_vessels (campaign_id, entry_id, name, position) VALUES (?, ?, ?, ?)")
    .run(req.params.campaignId, entryId, name, pos);
  res.status(201);
  sendView(res, Number(info.lastInsertRowid));
});

campaignVesselsRouter.get("/:id", (req, res) => sendView(res, Number(req.params.id)));

// Кого можно поставить на пост: персонажи кампании и существа её сеттинга.
campaignVesselsRouter.get("/:id/people", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  const c = campaignOf(v.campaign_id);
  const characters = db
    .prepare(
      `SELECT c.id, c.character_name AS name, p.name AS sub, c.avatar_image_path FROM characters c
         LEFT JOIN players p ON p.id = c.player_id
        WHERE c.campaign_id = ? AND c.archived_at IS NULL ORDER BY c.character_name COLLATE NOCASE`
    )
    .all(v.campaign_id) as { id: number; name: string; sub: string | null; avatar_image_path: string | null }[];
  const beings = c?.setting_id
    ? (db
        .prepare(
          `SELECT id, name, avatar_image_path FROM setting_beings
            WHERE setting_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE`
        )
        .all(c.setting_id) as { id: number; name: string; avatar_image_path: string | null }[])
    : [];
  const url = (p: string | null) => (p ? toFileUrl(p) : null);
  res.json({
    characters: characters.map((r) => ({ id: r.id, name: r.name, sub: r.sub ?? "", avatar_image_url: url(r.avatar_image_path) })),
    beings: beings.map((r) => ({ id: r.id, name: r.name, avatar_image_url: url(r.avatar_image_path) })),
  });
});

// Имя, заметки, хиты корпуса. Хиты — целое не меньше нуля; null — «целый».
campaignVesselsRouter.put("/:id", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = text(body.name, MAX_NAME);
  if (name === "") return res.status(400).json({ error: "У корабля должно быть имя" });
  const notes = typeof body.notes === "string" ? body.notes : null;
  let hull: number | null | undefined;
  if ("hull_hp" in body) {
    if (body.hull_hp === null) hull = null;
    else {
      const n = int(body.hull_hp);
      if (n == null || n < 0) return res.status(400).json({ error: "Хиты — целое не меньше нуля" });
      hull = n;
    }
  }
  db.prepare(
    `UPDATE campaign_vessels SET
       name = COALESCE(?, name), notes = COALESCE(?, notes),
       hull_hp = CASE WHEN ? THEN ? ELSE hull_hp END
     WHERE id = ?`
  ).run(name, notes, hull !== undefined ? 1 : 0, hull ?? null, v.id);
  sendView(res, v.id);
});

// Потоплен или продан — в архив; возвращается вместе с экипажем.
campaignVesselsRouter.post("/:id/archive", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE campaign_vessels SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(v.id);
  sendView(res, v.id);
});

campaignVesselsRouter.post("/:id/restore", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE campaign_vessels SET archived_at = NULL WHERE id = ?").run(v.id);
  sendView(res, v.id);
});

// Насовсем — только из архива: случайный щелчок не уносит экипаж и груз.
campaignVesselsRouter.delete("/:id", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  if (!v.archived_at) return res.status(400).json({ error: "Сначала в архив" });
  db.prepare("DELETE FROM campaign_vessels WHERE id = ?").run(v.id);
  res.json({ ok: true });
});

// Хиты поста и число безымянных на нём.
campaignVesselsRouter.put("/:id/posts/:postId", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  if (!isPostOf(v, req.params.postId)) return res.status(400).json({ error: "Это не пост этого корабля" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  let hp: number | null | undefined;
  if ("hp" in body) {
    if (body.hp === null) hp = null;
    else {
      const n = int(body.hp);
      if (n == null || n < 0) return res.status(400).json({ error: "Хиты — целое не меньше нуля" });
      hp = n;
    }
  }
  let unnamed: number | undefined;
  if ("unnamed" in body) {
    const n = int(body.unnamed);
    if (n == null || n < 0 || n > MAX_UNNAMED) return res.status(400).json({ error: "Безымянных — целое не меньше нуля" });
    unnamed = n;
  }
  db.prepare("INSERT OR IGNORE INTO campaign_vessel_posts (vessel_id, post_id) VALUES (?, ?)").run(v.id, req.params.postId);
  db.prepare(
    `UPDATE campaign_vessel_posts SET
       hp = CASE WHEN ? THEN ? ELSE hp END,
       unnamed = COALESCE(?, unnamed)
     WHERE vessel_id = ? AND post_id = ?`
  ).run(hp !== undefined ? 1 : 0, hp ?? null, unnamed ?? null, v.id, req.params.postId);
  sendView(res, v.id);
});

// Поимённый экипаж: персонаж кампании или существо её сеттинга. Один человек —
// один пост на корабле: поставить на другой пост значит перевести.
campaignVesselsRouter.post("/:id/crew", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const postId = int(body.post_id);
  if (postId == null || !isPostOf(v, postId)) return res.status(400).json({ error: "Это не пост этого корабля" });
  const characterId = int(body.character_id);
  const beingId = int(body.being_id);
  if ((characterId == null) === (beingId == null)) return res.status(400).json({ error: "Нужен персонаж или существо" });
  const c = campaignOf(v.campaign_id);
  if (characterId != null && !db.prepare("SELECT 1 FROM characters WHERE id = ? AND campaign_id = ?").get(characterId, v.campaign_id))
    return res.status(400).json({ error: "Персонаж не из этой кампании" });
  if (beingId != null && !db.prepare("SELECT 1 FROM setting_beings WHERE id = ? AND setting_id = ?").get(beingId, c?.setting_id ?? -1))
    return res.status(400).json({ error: "Существо не из сеттинга кампании" });
  db.transaction(() => {
    db.prepare(
      `DELETE FROM campaign_vessel_crew WHERE vessel_id = ? AND
         (character_id IS ? AND being_id IS ?)`
    ).run(v.id, characterId, beingId);
    db.prepare("INSERT INTO campaign_vessel_crew (vessel_id, post_id, character_id, being_id) VALUES (?, ?, ?, ?)").run(
      v.id,
      postId,
      characterId,
      beingId
    );
  })();
  res.status(201);
  sendView(res, v.id);
});

campaignVesselsRouter.delete("/:id/crew/:crewId", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM campaign_vessel_crew WHERE id = ? AND vessel_id = ?").run(req.params.crewId, v.id);
  sendView(res, v.id);
});

campaignVesselsRouter.post("/:id/cargo", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const t = text(body.text, MAX_CARGO) ?? "";
  if (!t) return res.status(400).json({ error: "Что везём?" });
  const pos = (
    db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM campaign_vessel_cargo WHERE vessel_id = ?").get(v.id) as { p: number }
  ).p;
  db.prepare("INSERT INTO campaign_vessel_cargo (vessel_id, text, amount, position) VALUES (?, ?, ?, ?)").run(
    v.id,
    t,
    text(body.amount, MAX_NAME) ?? "",
    pos
  );
  res.status(201);
  sendView(res, v.id);
});

campaignVesselsRouter.put("/:id/cargo/:cargoId", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const t = text(body.text, MAX_CARGO);
  if (t === "") return res.status(400).json({ error: "Что везём?" });
  db.prepare(
    "UPDATE campaign_vessel_cargo SET text = COALESCE(?, text), amount = COALESCE(?, amount) WHERE id = ? AND vessel_id = ?"
  ).run(t, text(body.amount, MAX_NAME), req.params.cargoId, v.id);
  sendView(res, v.id);
});

campaignVesselsRouter.delete("/:id/cargo/:cargoId", (req, res) => {
  const v = vesselRow(req.params.id);
  if (!v) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM campaign_vessel_cargo WHERE id = ? AND vessel_id = ?").run(req.params.cargoId, v.id);
  sendView(res, v.id);
});
