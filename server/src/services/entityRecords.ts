// Запись о сущности в кампании (ADR-0006, спека .scratch/campaign-layer).
// Графы — словари по видам, а не колонки: каталог объектов сеттинга ещё не
// устоялся, и новая графа не должна требовать миграции. Сервер принимает
// только ключи словаря вида. Подписи граф — у клиента, как у FORCE_KEYS.
import { db } from "../db/db";
import { FORCE_KEYS } from "./beingForce";
import { CERTAINTY } from "./settingWorld";

export { CERTAINTY };

/**
 * Графы стороны (лист 7 тетради кампании, спека workbook-rework) — только
 * слой кампании: в двигатель силы основы не входят и необязательны.
 */
export const SIDE_ASPECTS = ["alternative", "red_line", "status_claim", "recognition", "reputation"] as const;

/** Графы по виду владельца; тот же набор видов, что в CHECK таблицы (db.ts). */
export const RECORD_ASPECTS: Readonly<Record<string, readonly string[]>> = {
  being: [...FORCE_KEYS, ...SIDE_ASPECTS, "note"],
  community: [...FORCE_KEYS, ...SIDE_ASPECTS, "note"],
  location: ["function", "affordances", "signs", "access", "cost_risk", "past_trace", "after", "unknown", "note"],
  character: ["player_interest", "hooks", "if_goal_reached", "cherishes", "coordination", "note"],
  // group_ties … goal_conflict — общие основания группы (лист 4).
  // unsorted — черновик без адреса: адрес выбирают при подтверждении.
  campaign: ["note", "resources", "intentions", "group_ties", "open_goals", "disputes", "needs_agreement", "goal_conflict", "unsorted"],
};

/** Виды сеттинга: запись о них задействует сущность в кампании. */
export const SETTING_OWNER_TYPES: ReadonlySet<string> = new Set(["being", "community", "location"]);

/** Статус — уверенность Мастера: установлено · предположение · черновик · отброшено. */
export const RECORD_STATUSES = ["established", "assumption", "draft", "discarded"] as const;

/**
 * Функция сведения (лист 9, спека workbook-rework, Q7): нужно для текущего
 * решения · кампанийная опора · архивная фактура. Пусто — запись не
 * «сведение», живёт в хронике. Тот же список — в CHECK колонки (db.ts).
 */
export const RECORD_FUNCTIONS = ["", "current", "anchor", "archive"] as const;

/** Кому известно в мире: мастер · группа героев · все · некоторые. */
export const KNOWN_TO = ["gm", "table", "public", "some"] as const;

export function isAspectOf(ownerType: string, aspect: string): boolean {
  return RECORD_ASPECTS[ownerType]?.includes(aspect) ?? false;
}

export interface Engagement {
  campaign_id: number;
  entity_type: string;
  entity_id: number;
  manual: boolean;
  /** Действующие записи: не черновики, не отброшенные, не заменённые. */
  records: number;
  drafts: number;
  /** Действующие записи с достоверностью «слух». */
  rumors: number;
  /** Последняя встреча, на которой о сущности что-то записано. */
  last_session: { id: number; title: string | null; date: string } | null;
}

/**
 * Ссылки «задействована в кампании» со сводкой записей — для «Мира кампании»
 * (по кампании) и для профиля сущности (по сущности). Фильтр — по колонкам
 * participations `p`.
 */
export function engagements(filter: string, ...params: unknown[]): Engagement[] {
  const types = [...SETTING_OWNER_TYPES];
  const rows = db
    .prepare(
      `SELECT p.context_id AS campaign_id, p.entity_type, p.entity_id, p.manual,
         (SELECT COUNT(*) FROM entity_records r
           WHERE r.campaign_id = p.context_id AND r.owner_type = p.entity_type AND r.owner_id = p.entity_id
             AND r.status NOT IN ('draft','discarded')
             AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.replaces_id = r.id)) AS records,
         (SELECT COUNT(*) FROM entity_records r
           WHERE r.campaign_id = p.context_id AND r.owner_type = p.entity_type AND r.owner_id = p.entity_id
             AND r.status = 'draft') AS drafts,
         (SELECT COUNT(*) FROM entity_records r
           WHERE r.campaign_id = p.context_id AND r.owner_type = p.entity_type AND r.owner_id = p.entity_id
             AND r.status NOT IN ('draft','discarded') AND r.certainty = 'rumor'
             AND NOT EXISTS (SELECT 1 FROM entity_records n WHERE n.replaces_id = r.id)) AS rumors,
         (SELECT s.id FROM entity_records r JOIN sessions s ON s.id = r.session_id
           WHERE r.campaign_id = p.context_id AND r.owner_type = p.entity_type AND r.owner_id = p.entity_id
             AND r.status <> 'discarded'
           ORDER BY s.date DESC, s.id DESC LIMIT 1) AS last_session_id
       FROM participations p
       WHERE p.context_type = 'campaign' AND p.entity_type IN (${types.map(() => "?").join(",")}) AND ${filter}`
    )
    .all(...types, ...params) as (Omit<Engagement, "manual" | "last_session"> & { manual: number; last_session_id: number | null })[];
  const sessionIds = [...new Set(rows.map((r) => r.last_session_id).filter((id): id is number => id != null))];
  const sessions = new Map(
    (sessionIds.length
      ? (db.prepare(`SELECT id, title, date FROM sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`).all(...sessionIds) as {
          id: number;
          title: string | null;
          date: string;
        }[])
      : []
    ).map((s) => [s.id, s])
  );
  return rows.map(({ last_session_id, manual, ...r }) => ({
    ...r,
    manual: !!manual,
    last_session: last_session_id != null ? (sessions.get(last_session_id) ?? null) : null,
  }));
}

/** «Задействована в кампаниях» на профиле существа, сообщества, места. */
export function campaignsOfEntity(entityType: string, entityId: number) {
  const list = engagements("p.entity_type = ? AND p.entity_id = ?", entityType, entityId);
  if (!list.length) return [];
  const names = new Map(
    (db
      .prepare(`SELECT id, name FROM campaigns WHERE archived_at IS NULL AND id IN (${list.map(() => "?").join(",")})`)
      .all(...list.map((e) => e.campaign_id)) as { id: number; name: string }[]).map((c) => [c.id, c.name])
  );
  return list
    .filter((e) => names.has(e.campaign_id))
    .map((e) => ({
      id: e.campaign_id,
      name: names.get(e.campaign_id)!,
      records: e.records,
      drafts: e.drafts,
      rumors: e.rumors,
      last_session: e.last_session,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
