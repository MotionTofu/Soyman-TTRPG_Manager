import { FORCE_FIELDS } from "./beingForce";
import { campaignPaths } from "./data/campaigns";
import { plural } from "./sceneKinds";
import type { Affect } from "./data/entities";
import type { SessionSummary } from "./types";

// Запись о сущности в кампании (ADR-0006, спека .scratch/campaign-layer,
// задача 04). Ключи граф и значений — те же, что у сервера
// (server/src/services/entityRecords.ts); подписи — здесь, как у FORCE_FIELDS.

export type RecordOwnerType = "being" | "community" | "location" | "character" | "campaign";
export type RecordStatus = "established" | "assumption" | "draft" | "discarded";
export type RecordCertainty = "known" | "rumor" | "disputed" | "reported";
/** Функция сведения (лист 9): пусто — запись не «сведение». */
export type RecordFunction = "" | "current" | "anchor" | "archive";
export type RecordKnownTo = "gm" | "table" | "public" | "some";

export interface EntityRecord {
  id: number;
  campaign_id: number;
  owner_type: RecordOwnerType;
  owner_id: number;
  owner_name: string | null;
  aspect: string;
  text: string;
  status: RecordStatus;
  certainty: RecordCertainty;
  known_to: RecordKnownTo;
  known_note: string;
  basis: string;
  function: RecordFunction;
  session_id: number | null;
  replaces_id: number | null;
  /** Id заменившей записи; есть — эта запись уже «было». */
  replaced_by: number | null;
  source: "manual" | "quick" | "feed" | "player";
  source_note_id: number | null;
  created_at: string;
  updated_at: string;
}

const NOTE = { key: "note", label: "Свободная запись" };
/** Графы стороны (лист 7) — только слой кампании, не двигатель силы: необязательны. */
export const SIDE_ASPECTS = [
  { key: "alternative", label: "Без соглашения" },
  { key: "red_line", label: "Красная линия" },
  { key: "status_claim", label: "На какую роль претендует" },
  { key: "recognition", label: "Признание" },
  { key: "reputation", label: "Репутация" },
] as const;
/** «Что изменилось» на профиле стороны: свободная запись и графы стороны. */
export const SIDE_PROFILE_ASPECTS: readonly string[] = ["note", ...SIDE_ASPECTS.map((a) => a.key)];
const FORCE = [...FORCE_FIELDS.map(({ key, label }) => ({ key, label })), ...SIDE_ASPECTS, NOTE];

/** Графы по виду владельца — в порядке словаря сервера. */
export const RECORD_ASPECTS: Record<RecordOwnerType, readonly { key: string; label: string }[]> = {
  being: FORCE,
  community: FORCE,
  location: [
    { key: "function", label: "Функция" },
    { key: "affordances", label: "Возможности" },
    { key: "signs", label: "Признаки" },
    { key: "access", label: "Доступ" },
    { key: "cost_risk", label: "Цена и риск" },
    { key: "past_trace", label: "След прошлого" },
    { key: "after", label: "После вмешательства" },
    { key: "unknown", label: "Честно неизвестно" },
    NOTE,
  ],
  character: [
    { key: "player_interest", label: "Чем увлечён" },
    { key: "hooks", label: "Крючки" },
    { key: "if_goal_reached", label: "Если цель достигнута" },
    { key: "cherishes", label: "Чем дорожит" },
    { key: "coordination", label: "Координация" },
    NOTE,
  ],
  campaign: [
    NOTE,
    { key: "resources", label: "Ресурсы группы" },
    { key: "intentions", label: "Намерения группы" },
    { key: "group_ties", label: "Что связывает наши дела" },
    { key: "open_goals", label: "Какие цели открыто обсуждены" },
    { key: "disputes", label: "О чём герои могут спорить" },
    { key: "needs_agreement", label: "Что требует отдельного соглашения" },
    { key: "goal_conflict", label: "Конфликт целей" },
    { key: "unsorted", label: "Без адреса" },
  ],
};

export function aspectLabel(ownerType: RecordOwnerType, aspect: string): string {
  return RECORD_ASPECTS[ownerType]?.find((a) => a.key === aspect)?.label ?? aspect;
}

/** Статус — уверенность Мастера. Отброшенное в окне не выбирают: это разбор. */
export const STATUS_LABELS: Record<RecordStatus, string> = {
  established: "установлено",
  assumption: "предположение",
  draft: "черновик",
  discarded: "отброшено",
};

/** Достоверность — что это внутри мира. */
export const CERTAINTY_LABELS: Record<RecordCertainty, string> = { known: "известно", rumor: "слух", disputed: "спорно", reported: "сообщение" };

/** Т — нужно для текущего решения, О — кампанийная опора, А — архивная фактура. */
export const FUNCTION_LABELS: Record<RecordFunction, string> = { "": "не сведение", current: "Т · для решения", anchor: "О · опора", archive: "А · фактура" };

export const KNOWN_TO_LABELS: Record<RecordKnownTo, string> = { gm: "мастер", table: "группа", public: "все", some: "некоторые" };

/** «знает: …» — при «некоторых» говорит, кто именно, если это записано. */
export function knownToLabel(r: Pick<EntityRecord, "known_to" | "known_note">): string {
  return r.known_to === "some" && r.known_note.trim() ? r.known_note.trim() : KNOWN_TO_LABELS[r.known_to];
}

export interface RecordChain {
  record: EntityRecord;
  /** Прежние версии, от последней к первой. */
  history: EntityRecord[];
}

/**
 * Действующие записи с их «Историей замен». Запись, на которую кто-то
 * указывает replaces_id, — уже «было»: сама в список не идёт, а попадает в
 * историю заменившей. Порядок — как пришёл (сервер отдаёт новые сверху).
 */
export function recordChains(records: readonly EntityRecord[]): RecordChain[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return records
    .filter((r) => !r.replaced_by)
    .map((record) => {
      const history: EntityRecord[] = [];
      for (let prev = record.replaces_id ? byId.get(record.replaces_id) : undefined; prev; prev = prev.replaces_id ? byId.get(prev.replaces_id) : undefined)
        history.push(prev);
      return { record, history };
    });
}

/**
 * Что задевает правка записи: списки записей кампании, «Мир кампании»
 * (сводка, авто-задействование) и профиль сущности сеттинга («Задействована
 * в кампаниях»).
 */
export function recordAffects(campaignId: number, ownerType: RecordOwnerType, ownerId: number): Affect[] {
  const affects: Affect[] = [{ path: campaignPaths.records(campaignId) }, { path: campaignPaths.world(campaignId) }];
  if (ownerType === "being" || ownerType === "community" || ownerType === "location") affects.push({ kind: ownerType, id: ownerId });
  return affects;
}

/** Последняя сыгранная встреча — по ней записывают то, что узнали за столом. */
export function lastHeldSession(sessions: readonly SessionSummary[]): SessionSummary | undefined {
  let last: SessionSummary | undefined;
  for (const s of sessions)
    if (s.status === "held" && (!last || s.date > last.date || (s.date === last.date && s.id > last.id))) last = s;
  return last;
}

/** «3 записи · слух · 1 черновик» — что с сущностью в кампании, не открывая. */
export function recordSummary(e: { records: number; rumors: number; drafts: number }): string {
  const parts: string[] = [];
  if (e.records) parts.push(`${e.records} ${plural(e.records, "запись", "записи", "записей")}`);
  if (e.rumors) parts.push(e.rumors === 1 ? "слух" : `слухов: ${e.rumors}`);
  if (e.drafts) parts.push(`${e.drafts} ${plural(e.drafts, "черновик", "черновика", "черновиков")}`);
  return parts.join(" · ") || "записей нет";
}

/** Откуда черновик — подпись в очереди разбора. Ручная запись подписи не несёт. */
export const SOURCE_LABELS: Record<EntityRecord["source"], string> = {
  manual: "",
  quick: "быстрая запись",
  feed: "из ленты",
  player: "от игрока",
};

/** Черновик без адреса: адрес выбирают при подтверждении (графа кампании `unsorted`). */
export function isUnaddressed(r: Pick<EntityRecord, "owner_type" | "aspect">): boolean {
  return r.owner_type === "campaign" && r.aspect === "unsorted";
}

const OWNER_PATHS: Partial<Record<RecordOwnerType, string>> = {
  being: "/beings",
  community: "/communities",
  location: "/locations",
  character: "/characters",
};

/** Профиль владельца; сущность сеттинга — сразу в контексте кампании. */
export function ownerPath(r: Pick<EntityRecord, "owner_type" | "owner_id" | "campaign_id">): string | null {
  const base = OWNER_PATHS[r.owner_type];
  if (!base) return null;
  return r.owner_type === "character" ? `${base}/${r.owner_id}` : `${base}/${r.owner_id}?campaign=${r.campaign_id}`;
}

/** «Мия Тарн», «кампания · ресурсы группы». */
export function ownerLabel(r: Pick<EntityRecord, "owner_type" | "owner_name" | "aspect">): string {
  if (r.owner_type === "campaign") return `кампания · ${aspectLabel("campaign", r.aspect).toLowerCase()}`;
  return r.owner_name ?? "—";
}
