import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { plural } from "../../sceneKinds";
import { sessionLabel } from "../../sessionLabel";
import { toLocalDateKey, formatDateKeyRu } from "../../utils/date";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from "../../paymentTypes";
import { NavIcon } from "../NavIcons";
import type { EntityRecord } from "../../entityRecords";
import type { CampaignDetail, SessionSummary } from "../../types";

// Шапка кампании под названием (гриллинг 2026-10-23, Q2): одна строка фактов
// и два действия. Каждый факт — один раз: статус, система и счёт сессий
// раньше повторялись в колонке слева, ближайшая сессия — трижды. Под строкой
// — неразобранные черновики записей (слой кампании, задача 08).
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
  return (
    <section className="campaign-now" aria-label="Кампания коротко">
      <div className="campaign-now__row">
        <ul className="campaign-now__facts">
          {oneshot && <li><span className="badge tag">Ваншот</span></li>}
          <li className="campaign-now__status" data-status={status}>{CAMPAIGN_STATUS_LABELS[status] ?? status}</li>
          {campaign.system_name && <li><NavIcon name="die" />{campaign.system_name}</li>}
          {campaign.setting_id != null && (
            <li><NavIcon name="globe" /><Link to={`/settings/${campaign.setting_id}`}>{campaign.setting_name || "Сеттинг"}</Link></li>
          )}
          <li>
            <NavIcon name="archive" />
            сыграно {held} · впереди {planned}
          </li>
          {next && (
            <li>
              <NavIcon name="calendar" />
              {oneshot ? "следующий" : "следующая"}: {formatDateKeyRu(next.date)} — {sessionLabel(next)}
            </li>
          )}
        </ul>
        <div className="campaign-now__actions">
          {next ? (
            <Link className="campaign-now__go" to={`/sessions/${next.id}`}>
              <NavIcon name="play" />
              {oneshot ? "Готовить прогон" : `Готовить сессию №${next.session_number ?? ""}`}
            </Link>
          ) : (
            <button type="button" className="campaign-now__go" onClick={onSchedule}>
              <NavIcon name="calendar" />
              Запланировать
            </button>
          )}
          <button type="button" className="campaign-now__edit" onClick={onEdit}>
            <NavIcon name="edit" />
            Редактировать
          </button>
        </div>
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
