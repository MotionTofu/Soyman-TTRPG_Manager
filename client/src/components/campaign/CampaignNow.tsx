import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { plural } from "../../sceneKinds";
import { sessionLabel } from "../../sessionLabel";
import { toLocalDateKey, formatDateKeyRu } from "../../utils/date";
import type { EntityRecord } from "../../entityRecords";
import type { SessionSummary } from "../../types";

// Ближайшая сессия в строке названия кампании; под ней — неразобранные
// черновики записей (слой кампании, задача 08).
export function CampaignNow({
  campaignId,
  oneshot,
  sessions,
  onSchedule,
}: {
  campaignId: number;
  oneshot: boolean;
  sessions: SessionSummary[];
  onSchedule: () => void;
}) {
  const today = toLocalDateKey();
  const next = useMemo(
    () => sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0],
    [sessions, today]
  );
  const drafts = useResource<{ records: EntityRecord[] }>(`${campaignPaths.records(campaignId)}?status=draft`).data?.records;
  const unsorted = useMemo(() => unsortedDrafts(drafts ?? [], sessions), [drafts, sessions]);
  return (
    <section className="campaign-now" aria-label="Ближайшая сессия">
      <div>
        <span className="paper-label">{oneshot ? "Ближайший прогон" : "Ближайшая"}</span>
        {next ? (
          <Link to={`/sessions/${next.id}`}>
            {formatDateKeyRu(next.date)} — {sessionLabel(next)}
          </Link>
        ) : (
          <button type="button" className="paper-more" onClick={onSchedule}>
            Запланировать ›
          </button>
        )}
      </div>
      {unsorted && (
        <div>
          <span className="paper-label">Не разобрано</span>
          <Link to={`/sessions/${unsorted.sessionId}?tab=${encodeURIComponent("Итоги")}`}>
            {unsorted.count} {plural(unsorted.count, "черновик", "черновика", "черновиков")} ›
          </Link>
        </div>
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
