import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { sessionLabel } from "../../sessionLabel";
import { MentionText } from "../mentions/MentionText";
import { toLocalDateKey, formatDateKeyRu } from "../../utils/date";
import type { CampaignGrouped, SessionSummary, StorySecret } from "../../types";

// Полоса «Сейчас» на «Обзоре» кампании (спека campaign-paper, Q14; доска 41):
// сводка, в неё ничего не вводят. Бывший «Продакшен».
export function CampaignNow({
  campaignId,
  oneshot,
  sessions,
  onSchedule,
  onSecrets,
}: {
  campaignId: number;
  oneshot: boolean;
  sessions: SessionSummary[];
  onSchedule: () => void;
  onSecrets: () => void;
}) {
  const secrets = useResource<CampaignGrouped<StorySecret>>(campaignPaths.secrets(campaignId)).data;
  const hidden = secrets
    ? [...secrets.own, ...secrets.groups.flatMap((g) => g.items)].filter((s) => s.state?.revealed !== 1).length
    : null;
  const today = toLocalDateKey();
  const next = useMemo(
    () => sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0],
    [sessions, today]
  );
  const last = useMemo(
    () => sessions.filter((s) => s.status === "held").sort((a, b) => b.date.localeCompare(a.date))[0],
    [sessions]
  );
  const firstLine = last?.notes_text?.split("\n").find((l) => l.trim())?.trim() ?? "";
  return (
    <section className="campaign-now" aria-label="Сейчас">
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
      <div>
        <span className="paper-label">{oneshot ? "Последний" : "Последняя"}</span>
        {last ? (
          <>
            <Link to={`/sessions/${last.id}`}>
              {formatDateKeyRu(last.date)} — {sessionLabel(last)}
            </Link>
            {firstLine && (
              <span className="campaign-now__line">
                <MentionText text={firstLine} />
              </span>
            )}
          </>
        ) : (
          <span className="muted">ещё не играли</span>
        )}
      </div>
      <div>
        <span className="paper-label">Нераскрытых тайн</span>
        <button type="button" className="paper-more" onClick={onSecrets}>
          {hidden ?? "…"} ›
        </button>
      </div>
    </section>
  );
}
