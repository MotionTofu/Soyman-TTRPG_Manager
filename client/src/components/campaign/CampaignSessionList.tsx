import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "../mentions/MentionText";
import { useEntity } from "../../data/hooks";
import { sessionLabel } from "../../sessionLabel";
import { parseDateKey } from "../../utils/date";
import { daysUntilLabel, groupSessions, hasOutcome, heldTails, passportDone } from "./sessionGroups";
import type { SessionDetail, SessionSummary } from "../../types";

// Вкладка «Сессии» строками (гриллинг 2026-10-23, Q1–Q19; вид «Д» — макет
// Camp-Sessions): «Ждут разбора» плашкой сверху, ближайшая запланированная —
// главным блоком с «Готовить» и малой «+ Запланировать ещё» (группы
// «Запланированы» нет), ниже «Сыграны» по месяцам. Слева колонка даты,
// редкие действия — под «⋯». Справа на строке — то, что по сессии ещё не
// сделано (Q8, Q9); игроку хвостов нет.

const monthShort = new Intl.DateTimeFormat("ru", { month: "short" });

function SessionRow({
  session,
  inworld,
  meta,
  onMenu,
  onOutcome,
}: {
  session: SessionSummary;
  inworld: string;
  meta?: ReactNode[];
  onMenu?: (e: React.MouseEvent<HTMLElement>, s: SessionSummary) => void;
  onOutcome?: (s: SessionSummary) => void;
}) {
  const d = parseDateKey(session.date);
  const first = session.notes_text?.split("\n").find((l) => l.trim())?.trim() ?? "";
  const label = sessionLabel(session);
  const shown = meta?.filter(Boolean) ?? [];
  return (
    <li className="session-row">
      <span className="session-row__date" aria-hidden="true">
        <span className="session-row__day">{d.getDate()}</span>
        <span className="session-row__month">{monthShort.format(d).replace(".", "")}</span>
      </span>
      <span className="session-row__main">
        <span className="session-row__head">
          <Link className="session-row__link" to={`/sessions/${session.id}`}>{label}</Link>
          {inworld && <span className="d-mono">{inworld}</span>}
        </span>
        {first ? (
          <span className="session-rows__line"><MentionText text={first} /></span>
        ) : (
          session.status === "held" && <span className="session-rows__line muted">лента пуста</span>
        )}
      </span>
      {shown.length > 0 && (
        <span className="session-row__meta">
          {shown.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </span>
      )}
      {onOutcome && (
        <button type="button" className="d-btn d-btn--sm session-row__action" onClick={() => onOutcome(session)}>
          Разобрать
        </button>
      )}
      {onMenu && (
        <button type="button" className="d-dots session-row__menu" aria-label={`Действия: ${label}`} aria-haspopup="menu" onClick={(e) => onMenu(e, session)}>
          ⋯
        </button>
      )}
    </li>
  );
}

export function CampaignSessionList({
  sessions,
  today,
  isGm,
  showMoney,
  inworldLabel,
  onSchedule,
  onMenu,
  onOutcome,
  oneshot = false,
}: {
  sessions: SessionSummary[];
  today: string;
  isGm: boolean;
  /** Долги на строках: не игроку, не при скрытых финансах (Q8). */
  showMoney: boolean;
  inworldLabel: (s: SessionSummary) => string;
  onSchedule: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, s: SessionSummary) => void;
  onOutcome: (s: SessionSummary) => void;
  /** У ваншота готовят прогон, а не сессию №N. */
  oneshot?: boolean;
}) {
  const groups = groupSessions(sessions, today, isGm);
  const nearest = groups.planned[0];
  // «Что изменилось» нужно только к следующей игре — смотрим последнюю
  // сыгранную, как и «Обзор» (Q8).
  const latestHeld = groups.months[0]?.sessions.find((s) => s.status === "held");
  const nearestDetail = useEntity<SessionDetail>("session", isGm ? nearest?.id ?? null : null).data;
  const latestDetail = useEntity<SessionDetail>("session", isGm ? latestHeld?.id ?? null : null).data;
  const menu = isGm ? onMenu : undefined;

  const plannedMeta = (s: SessionSummary): ReactNode[] => {
    if (s !== nearest) return [s.start_time];
    const prep = nearestDetail && passportDone({ ...nearestDetail.passport, idea_notes: nearestDetail.idea_notes });
    return [s.start_time, prep && `подготовка ${prep.done}/${prep.total}`, daysUntilLabel(s.date, today)];
  };
  const heldMeta = (s: SessionSummary): ReactNode[] => {
    if (!isGm || s.status !== "held") return [];
    const t = heldTails(s);
    return [
      t.unreviewed && "не разобрана",
      t.attendance,
      s === latestHeld && latestDetail && !hasOutcome(latestDetail.outcomes) && "итог не заполнен",
      showMoney && t.unpaid > 0 && <span key="debt" className="session-row__debt">не оплатили {t.unpaid}</span>,
    ];
  };

  const rows = (list: SessionSummary[], meta: (s: SessionSummary) => ReactNode[], outcome: (s: SessionSummary) => boolean) => (
    <ul className="session-rows">
      {list.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          inworld={inworldLabel(s)}
          meta={meta(s)}
          onMenu={menu}
          onOutcome={isGm && outcome(s) ? onOutcome : undefined}
        />
      ))}
    </ul>
  );
  const nd = nearest && parseDateKey(nearest.date);
  const later = groups.planned.slice(1);
  return (
    <>
      {groups.overdue.length > 0 && (
        <section className="session-overdue" aria-label="Ждут разбора">
          <div className="d-gh">
            <h3 className="d-plate">Ждут разбора</h3>
            <span className="d-mark active">{groups.overdue.length}</span>
          </div>
          {rows(groups.overdue, (s) => [s.start_time], () => true)}
        </section>
      )}
      {nearest && nd ? (
        <section className="d-focal session-next" aria-label="Ближайшая игра">
          <span className="session-next__date" aria-hidden="true">
            <b>{nd.getDate()}</b>
            <span>{monthShort.format(nd).replace(".", "")}</span>
          </span>
          <div className="session-next__main">
            <Link className="session-next__title" to={`/sessions/${nearest.id}`}>
              {sessionLabel(nearest)}
              {nearest.start_time ? ` · ${nearest.start_time}` : ""}
            </Link>
            <span className="d-mono">{plannedMeta(nearest).slice(1).filter(Boolean).reverse().join("  ")}</span>
            {later.length > 0 && (
              <span className="session-next__later">
                Дальше:{" "}
                {later.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    <Link to={`/sessions/${s.id}`}>{formatDayMonth(s.date)} · {sessionLabel(s)}</Link>
                  </span>
                ))}
              </span>
            )}
          </div>
          {isGm && (
            <div className="session-next__acts">
              <Link className="d-btn d-btn--primary" to={`/sessions/${nearest.id}`}>
                {oneshot ? "Готовить прогон" : `Готовить сессию №${nearest.session_number ?? ""}`}
              </Link>
              <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={onSchedule}>
                + Запланировать ещё
              </button>
            </div>
          )}
        </section>
      ) : (
        isGm && (
          <section className="d-focal session-next session-next--empty" aria-label="Ближайшая игра">
            <p>Ближайшей игры нет.</p>
            <button type="button" className="d-btn d-btn--primary" onClick={onSchedule}>
              + Запланировать
            </button>
          </section>
        )
      )}
      {groups.months.length > 0 && (
        <section className="session-held">
          <div className="d-gh">
            <h3 className="d-plate">Сыграны</h3>
            <span className="d-note">{groups.months.reduce((n, m) => n + m.sessions.length, 0)}</span>
          </div>
          {groups.months.map((m) => (
            <div key={m.key} className="session-month">
              <h4 className="session-month__head d-mono">{m.title}</h4>
              {rows(m.sessions, heldMeta, (s) => s.status === "held" && heldTails(s).unreviewed)}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const dayMonth = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });
function formatDayMonth(date: string): string {
  return dayMonth.format(parseDateKey(date)).replace(".", "");
}
