import { Router } from "express";
import { db } from "../db/db";
import {
  CrossLinkChoice,
  LINKABLE_TYPES,
  SourceRef,
  applyCrossLinks,
  parseSources,
  planCrossLinks,
  stripCrossLinks,
} from "../import/crossLinks";

export const crossLinksRouter = Router();

/**
 * Что предлагается искать по умолчанию, в зависимости от того, где визард
 * запустили.
 *
 * Из кампании — сама кампания вместе со своим сеттингом и системой: там
 * ссылка на персонажа партии уместна. Из сеттинга — только сеттинг и система:
 * описание таверны переживёт конкретную партию, а ссылка на её персонажа нет,
 * и по умолчанию такие связи заводить не стоит. Из системы — только система.
 *
 * Это умолчание, а не запрет: любой источник можно добавить руками.
 */
function defaultSources(ownerKind: string, ownerId: number): SourceRef[] {
  if (ownerKind === "campaign") {
    const row = db.prepare("SELECT setting_id, system_id FROM campaigns WHERE id = ?").get(ownerId) as
      | { setting_id: number | null; system_id: number | null }
      | undefined;
    const out: SourceRef[] = [];
    if (row?.setting_id) out.push({ kind: "setting", id: row.setting_id });
    if (row?.system_id) out.push({ kind: "system", id: row.system_id });
    return out;
  }
  if (ownerKind === "system") return [{ kind: "system", id: ownerId }];
  if (ownerKind === "adventure") {
    const row = db.prepare("SELECT setting_id FROM story_arcs WHERE id = ?").get(ownerId) as
      | { setting_id: number }
      | undefined;
    return row ? sourcesForSetting(row.setting_id) : [];
  }
  return sourcesForSetting(ownerId);
}

/**
 * Сеттинг плюс системы, которыми по нему играют: записи компендиума — самое
 * частое, ради чего проход и нужен, а система у сеттинга своей колонкой не
 * записана, она известна через кампании.
 */
function sourcesForSetting(settingId: number): SourceRef[] {
  const systems = db
    .prepare(
      "SELECT DISTINCT system_id FROM campaigns WHERE setting_id = ? AND system_id IS NOT NULL"
    )
    .all(settingId) as { system_id: number }[];
  return [
    { kind: "setting" as const, id: settingId },
    ...systems.map((s) => ({ kind: "system" as const, id: s.system_id })),
  ];
}

/** Из чего вообще можно собрать область: список для чекбоксов в визарде. */
crossLinksRouter.get("/scope", (req, res) => {
  const ownerKind = String(req.query.ownerKind || "setting");
  const ownerId = Number(req.query.ownerId);
  const chosen = new Set(defaultSources(ownerKind, ownerId).map((s) => `${s.kind}:${s.id}`));
  const settings = db
    .prepare("SELECT id, name FROM settings WHERE archived_at IS NULL ORDER BY name")
    .all() as { id: number; name: string }[];
  const systems = db
    .prepare("SELECT id, name FROM systems WHERE archived_at IS NULL ORDER BY name")
    .all() as { id: number; name: string }[];
  res.json({
    steps: LINKABLE_TYPES.map((t) => ({ key: t.key, label: t.label, owner: t.owner })),
    sources: [
      ...settings.map((s) => ({ kind: "setting", id: s.id, name: s.name })),
      ...systems.map((s) => ({ kind: "system", id: s.id, name: s.name })),
    ].map((s) => ({ ...s, checked: chosen.has(`${s.kind}:${s.id}`) })),
  });
});

function request(req: { query: Record<string, unknown>; body?: unknown }) {
  const q = req.query as Record<string, string>;
  return {
    ownerKind: String(q.ownerKind || "setting"),
    ownerId: Number(q.ownerId),
    targetType: String(q.targetType || ""),
    sources: parseSources(q.sources),
  };
}

crossLinksRouter.get("/plan", (req, res) => {
  res.json(planCrossLinks(request(req as never)));
});

crossLinksRouter.post("/apply", (req, res) => {
  const chosen = (req.body as { chosen?: CrossLinkChoice[] })?.chosen ?? [];
  res.json(applyCrossLinks(request(req as never), chosen));
});

// Снятие расставленного — по владельцу целиком, безотносительно шагов.
crossLinksRouter.delete("/", (req, res) => {
  const q = req.query as Record<string, string>;
  res.json(stripCrossLinks(String(q.ownerKind || "setting"), Number(q.ownerId)));
});
