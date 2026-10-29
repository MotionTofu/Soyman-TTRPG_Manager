import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { plural } from "../../sceneKinds";
import { sessionLabel } from "../../sessionLabel";
import { toLocalDateKey, formatDateKeyRu } from "../../utils/date";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "../../paymentTypes";
import type { EntityRecord } from "../../entityRecords";
import type { CampaignDetail, SessionSummary } from "../../types";

// Шапка кампании под названием (гриллинг 2026-10-23, Q2; вид — «Д»,
// docs/design-system.md §6.7–§6.8): строка-досье моноширинным, штамп статуса,
// факты и два действия. Каждый факт — один раз: статус, система и счёт сессий
// раньше повторялись в колонке слева, ближайшая сессия — трижды. Ниже —
// неразобранные черновики записей (слой кампании, задача 08).
export function CampaignNow({
  campaign,
  sessions,
  onSchedule,
  onEdit,
}: {
  campaign: Pick<CampaignDetail, "id" | "type" | "status" | "system_name" | "setting_id" | "setting_name">;
  sessions: SessionSummary[];
  onSchedule: () => void;
  onEdit: () => void;
}) {
  const oneshot = campaign.type === "oneshot";
  const today = toLocalDateKey();
  const next = useMemo(
    () => sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0],
    [sessions, today]
  );
  const held = sessions.filter((s) => s.status === "held").length;
  // Прошедшая неразобранная — не «впереди»: её показывает «Ждут разбора» на
  // вкладке «Сессии» (гриллинг 2026-10-23, Q18). Сегодняшняя ещё впереди.
  const planned = sessions.filter((s) => s.status === "planned" && s.date >= today).length;
  const drafts = useResource<{ records: EntityRecord[] }>(`${campaignPaths.records(campaign.id)}?status=draft`).data?.records;
  const unsorted = useMemo(() => unsortedDrafts(drafts ?? [], sessions), [drafts, sessions]);
  const status = campaign.status as CampaignStatus;
  const first = sessions.reduce<string | null>((min, s) => (min == null || s.date < min ? s.date : min), null);
  return (
    <section className="campaign-now" aria-label="Кампания коротко">
      <p className="campaign-now__file d-mono">
        <span>{oneshot ? "Ваншот" : "Кампания"}</span>
        {campaign.system_name && <span>{campaign.system_name}</span>}
        {first && <span>с {formatDateKeyRu(first)}</span>}
      </p>
      <span className="campaign-now__status d-stamp" data-status={status}>{CAMPAIGN_STATUS_LABELS[status] ?? status}</span>
      <dl className="campaign-now__facts">
        {campaign.setting_id != null && (
          <div><dt>Сеттинг</dt><dd><Link to={`/settings/${campaign.setting_id}`}>{campaign.setting_name || "Сеттинг"}</Link></dd></div>
        )}
        <div><dt>Сессии</dt><dd>сыграно {held} · впереди {planned}</dd></div>
        {next && (
          <div><dt>{oneshot ? "Следующий" : "Следующая"}</dt><dd>{formatDateKeyRu(next.date)} — {sessionLabel(next)}</dd></div>
        )}
      </dl>
      <div className="campaign-now__actions">
        {next ? (
          <Link className="campaign-now__go d-btn d-btn--primary" to={`/sessions/${next.id}`}>
            {oneshot ? "Готовить прогон" : `Готовить сессию №${next.session_number ?? ""}`}
          </Link>
        ) : (
          <button type="button" className="campaign-now__go d-btn d-btn--primary" onClick={onSchedule}>
            Запланировать
          </button>
        )}
        <button type="button" className="campaign-now__edit d-btn" onClick={onEdit}>
          Редактировать
        </button>
      </div>
      {unsorted && (
        <p className="campaign-now__drafts">
          <span className="paper-label">Не разобрано</span>{" "}
          <Link to={`/sessions/${unsorted.sessionId}?tab=${encodeURIComponent("Итоги")}`}>
            {unsorted.count} {plural(unsorted.count, "черновик", "черновика", "черновиков")} ›
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Черновики, которые ждут разбора во «Итогах», и самая ранняя встреча с ними.
 * Черновик без встречи разбирать негде — он не считается.
 */
function unsortedDrafts(drafts: readonly EntityRecord[], sessions: readonly SessionSummary[]) {
  const date = new Map(sessions.map((s) => [s.id, s.date]));
  const withSession = drafts.filter((d) => d.session_id != null && date.has(d.session_id));
  if (!withSession.length) return null;
  const first = withSession.reduce((a, b) => {
    const da = date.get(a.session_id!)!;
    const db = date.get(b.session_id!)!;
    return db < da || (db === da && b.session_id! < a.session_id!) ? b : a;
  });
  return { count: withSession.length, sessionId: first.session_id! };
}
