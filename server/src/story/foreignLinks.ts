// Разбор чужих ссылок у вставленной заготовки.
//
// «Армрестлинг в таверне» едет в любой сеттинг, а «Засада гоблинов» тащит
// гоблинов из конкретного бестиария. Вставили её в другой мир — и сцена
// продолжает указывать на чужих существ: работать это работает, но лор
// разъезжается молча.
//
// Здесь ищется соответствие ПО ИМЕНИ в целевом сеттинге и переставляется
// ссылка. Это не то же самое, что делает CrossLinksWizard: тот расставляет
// упоминания в текстах (ищет имена и предлагает превратить их в ссылки), а
// переставить уже существующую связь с гоблина сеттинга А на гоблина сеттинга
// Б он не умеет — такого механизма в приложении до сих пор не было.

import { db } from "../db/db";
import { parseAliases } from "../import/names";
import {
  scanMentions,
  rewriteMentions,
  idOfUid,
  prefixOf,
  sourceCodeOf,
  formatRef,
} from "../services/mentions";

/**
 * Типы, у которых есть однозначный дом-сеттинг. Записи компендиума сюда не
 * входят намеренно: они принадлежат СИСТЕМЕ, а не миру, и «Гоблин» из
 * бестиария D&D одинаково уместен в любом сеттинге, где играют по D&D.
 */
const SETTING_ENTITIES: Record<string, { table: string; label: string }> = {
  being: { table: "setting_beings", label: "Личность" },
  community: { table: "setting_communities", label: "Сообщество" },
  location: { table: "setting_locations", label: "Локация" },
  artifact: { table: "artifacts", label: "Предмет" },
};

// Текстовые поля сцены, в которых живут упоминания вида [[being@8f3c1a2e|wdh|гоблин]].
const SCENE_TEXT_FIELDS = [
  "summary",
  "read_aloud",
  "whats_happening",
  "entry_condition",
  "outcomes",
] as const;

export type MatchTier = "exact" | "likely" | "doubtful";

export interface ForeignCandidate {
  id: number;
  name: string;
  tier: MatchTier;
  /** Чем поймалось: имя, оригинал, синоним — ответ на «почему предложено». */
  via: string;
}

export interface ForeignLink {
  to_type: string;
  to_id: number;
  type_label: string;
  name: string;
  setting_id: number | null;
  setting_name: string | null;
  /** Сколько раз встречается: связями и упоминаниями в текстах. */
  links: number;
  mentions: number;
  candidates: ForeignCandidate[];
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");
}

/** Все упоминания в текстах сцены, по типу и id (разрешаются через uid). */
function mentionCounts(scene: Record<string, unknown>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const field of SCENE_TEXT_FIELDS) {
    const text = String(scene[field] ?? "");
    for (const m of scanMentions(text)) {
      let id: number | null = null;
      if (m.kind === "legacy") id = m.id;
      else if (m.kind === "ref") id = idOfUid(m.type, m.uid);
      if (id == null) continue;
      const key = `${m.type}:${id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Кандидаты на замену: записи того же типа в целевом сеттинге, чьё имя,
 * оригинальное написание или синоним совпали.
 *
 * Уровень уверенности, а не флажок «нашлось»: точное совпадение имени и
 * совпадение по третьему синониму — разные вещи, и решать всё равно Мастеру.
 */
function candidatesFor(type: string, name: string, settingId: number): ForeignCandidate[] {
  const spec = SETTING_ENTITIES[type];
  if (!spec) return [];
  const rows = db
    .prepare(
      `SELECT id, name, name_original, aliases FROM ${spec.table}
       WHERE setting_id = ? AND archived_at IS NULL`
    )
    .all(settingId) as { id: number; name: string; name_original: string; aliases: string }[];

  const needle = norm(name);
  const out: ForeignCandidate[] = [];
  for (const row of rows) {
    if (norm(row.name) === needle) {
      out.push({ id: row.id, name: row.name, tier: "exact", via: "имя" });
      continue;
    }
    if (row.name_original && norm(row.name_original) === needle) {
      out.push({ id: row.id, name: row.name, tier: "likely", via: "оригинальное название" });
      continue;
    }
    const alias = parseAliases(row.aliases).find((a) => norm(a) === needle);
    if (alias) {
      out.push({ id: row.id, name: row.name, tier: "likely", via: `синоним «${alias}»` });
      continue;
    }
    // Вхождение — самый слабый сигнал: «Гоблин» отзовётся и на «Гоблин-шаман».
    // Оставляем, но честно называем сомнительным.
    if (norm(row.name).includes(needle) || needle.includes(norm(row.name))) {
      out.push({ id: row.id, name: row.name, tier: "doubtful", via: "часть названия" });
    }
  }
  const order: Record<MatchTier, number> = { exact: 0, likely: 1, doubtful: 2 };
  out.sort((a, b) => order[a.tier] - order[b.tier] || a.name.localeCompare(b.name));
  return out;
}

/**
 * Чужие ссылки сцены: и структурные (подцепленные монстры, локации,
 * предметы), и упоминания в текстах. Считаются вместе, потому что для
 * Мастера это одна вещь — «эта сцена показывает на чужого гоблина», — а то,
 * что одна из них строка в таблице, а другая разметка в абзаце, его не
 * касается.
 */
export function foreignLinksFor(
  sceneId: number,
  opts: { withCandidates?: boolean } = {}
): ForeignLink[] {
  const withCandidates = opts.withCandidates !== false;
  const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as
    | Record<string, unknown>
    | undefined;
  if (!scene) return [];
  const homeSettingId = scene.setting_id as number | null;
  // Бездомная сцена (заготовка без сеттинга) чужой ни к чему быть не может:
  // не с чем сравнивать.
  if (homeSettingId == null) return [];

  // Содержимое читается там, где лежит: у нетронутой вставки — у заготовки.
  const contentId = (scene.library_scene_id as number | null) ?? sceneId;
  const content =
    contentId === sceneId
      ? scene
      : ((db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(contentId) ?? scene) as Record<
          string,
          unknown
        >);

  const linkRows = db
    .prepare(
      `SELECT to_type, to_id, COUNT(*) AS n FROM generic_links
       WHERE from_type = 'scene' AND from_id = ?
       GROUP BY to_type, to_id`
    )
    .all(contentId) as { to_type: string; to_id: number; n: number }[];
  const mentions = mentionCounts(content);

  const keys = new Set<string>([
    ...linkRows.map((r) => `${r.to_type}:${r.to_id}`),
    ...mentions.keys(),
  ]);

  const out: ForeignLink[] = [];
  for (const key of keys) {
    const [type, rawId] = key.split(":");
    const spec = SETTING_ENTITIES[type];
    if (!spec) continue;
    const id = Number(rawId);
    const row = db
      .prepare(
        `SELECT e.name, e.setting_id, t.name AS setting_name
         FROM ${spec.table} e LEFT JOIN settings t ON t.id = e.setting_id
         WHERE e.id = ?`
      )
      .get(id) as { name: string; setting_id: number | null; setting_name: string | null } | undefined;
    if (!row) continue;
    if (row.setting_id === homeSettingId) continue;

    out.push({
      to_type: type,
      to_id: id,
      type_label: spec.label,
      name: row.name,
      setting_id: row.setting_id,
      setting_name: row.setting_name,
      links: linkRows.find((r) => r.to_type === type && r.to_id === id)?.n ?? 0,
      mentions: mentions.get(key) ?? 0,
      candidates: withCandidates ? candidatesFor(type, row.name, homeSettingId) : [],
    });
  }
  out.sort((a, b) => a.type_label.localeCompare(b.type_label) || a.name.localeCompare(b.name));
  return out;
}

/**
 * Сколько у сцены чужих ссылок. Отдельно от foreignLinksFor, потому что
 * холст спрашивает это у каждой ноды сразу, а подбор кандидатов — самая
 * дорогая часть разбора и для пометки на ноде не нужен.
 */
export function foreignLinkCount(sceneId: number): number {
  return foreignLinksFor(sceneId, { withCandidates: false }).length;
}

/**
 * Перевести ссылку на местную запись: и структурные связи, и разметку в
 * текстах, одним действием.
 *
 * По отдельности их чинить нельзя. Поправишь только связь — текст останется
 * с прежней разметкой, и ближайшее сохранение поля вернёт связь обратно
 * (её пересобирает syncMentionLinks по тексту). Поправишь только текст —
 * останется висеть структурная связь.
 */
export function repointSceneLink(
  sceneId: number,
  toType: string,
  fromId: number,
  toId: number
): { links: number; mentions: number } {
  if (!SETTING_ENTITIES[toType]) return { links: 0, mentions: 0 };

  return db.transaction(() => {
    // INSERT OR IGNORE + DELETE, а не UPDATE: на сцене уже может висеть связь
    // с той же местной записью, и UPDATE упёрся бы в уникальность.
    const moved = db
      .prepare(
        `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section, origin)
         SELECT from_type, from_id, to_type, ?, section, origin
         FROM generic_links
         WHERE from_type = 'scene' AND from_id = ? AND to_type = ? AND to_id = ?`
      )
      .run(toId, sceneId, toType, fromId);
    const dropped = db
      .prepare(
        `DELETE FROM generic_links
         WHERE from_type = 'scene' AND from_id = ? AND to_type = ? AND to_id = ?`
      )
      .run(sceneId, toType, fromId);

    const scene = db.prepare("SELECT * FROM story_scenes WHERE id = ?").get(sceneId) as Record<
      string,
      unknown
    >;
    let mentions = 0;
    const targetPrefix = prefixOf(toType, toId);
    const targetSource = targetPrefix ? sourceCodeOf(toType, toId) : "";
    for (const field of SCENE_TEXT_FIELDS) {
      const text = String(scene[field] ?? "");
      if (!text.includes("[[")) continue;
      const next = rewriteMentions(text, (m) => {
        if (m.type !== toType) return null;
        let curId: number | null = null;
        if (m.kind === "legacy") curId = m.id;
        else curId = idOfUid(m.type, m.uid);
        if (curId !== fromId) return null;
        if (!targetPrefix) return m.label;
        return formatRef(toType, targetPrefix, targetSource, m.label);
      });
      if (next !== text) {
        const before = scanMentions(text).filter((mm) => {
          const cid = mm.kind === "legacy" ? mm.id : idOfUid(mm.type, (mm as { uid: string }).uid);
          return mm.type === toType && cid === fromId;
        }).length;
        mentions += before;
        db.prepare(`UPDATE story_scenes SET ${field} = ? WHERE id = ?`).run(next, sceneId);
      }
    }
    return { links: Math.max(moved.changes, dropped.changes), mentions };
  })();
}
