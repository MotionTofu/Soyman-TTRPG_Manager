import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "../mentions/MentionText";
import { useEntity } from "../../data/hooks";
import { sessionLabel } from "../../sessionLabel";
import { parseDateKey } from "../../utils/date";
import { daysUntilLabel, groupSessions, hasOutcome, heldTails, passportDone } from "./sessionGroups";
import type { SessionDetail, SessionSummary } from "../../types";

// Вкладка «Сессии» строками (гриллинг 2026-10-23, Q1–Q19): группы «Ждут
// разбора / Запланированы / Сыграны», у сыгранных — месяцы; слева колонка
// даты, строка целиком ведёт в сессию, редкие действия — под «⋯». Под
// названием — то, что по сессии ещё не сделано (Q8, Q9); игроку хвостов нет.

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
      <span className="paper-rows__main">
        <span className="session-row__head">
          <Link className="session-row__link" to={`/sessions/${session.id}`}>{label}</Link>
          {inworld && <span className="paper-rows__sub">{inworld}</span>}
        </span>
        {first ? (
          <span className="session-rows__line"><MentionText text={first} /></span>
        ) : (
          session.status === "held" && <span className="session-rows__line muted">лента пуста</span>
        )}
        {shown.length > 0 && (
          <span className="session-row__meta">
            {shown.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </span>
        )}
      </span>
      {onOutcome && (
        <button type="button" className="session-row__action" onClick={() => onOutcome(session)}>
          Разобрать
        </button>
      )}
      {onMenu && (
        <button type="button" className="session-row__menu" aria-label={`Действия: ${label}`} aria-haspopup="menu" onClick={(e) => onMenu(e, session)}>
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
    <ul className="paper-rows session-rows">
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
  return (
    <>
      {groups.overdue.length > 0 && (
        <section className="paper-list-group session-group--overdue">
          <h3 className="paper-group__head">
            Ждут разбора <span className="paper-group__count">· {groups.overdue.length}</span>
          </h3>
          {rows(groups.overdue, (s) => [s.start_time], () => true)}
        </section>
      )}
      {(isGm || groups.planned.length > 0) && (
        <section className="paper-list-group">
          <h3 className="paper-group__head">
            Запланированы <span className="paper-group__count">· {groups.planned.length}</span>
            {isGm && (
              <button type="button" className="session-group__add" onClick={onSchedule}>
                + Запланировать
              </button>
            )}
          </h3>
          {groups.planned.length > 0 && rows(groups.planned, plannedMeta, () => false)}
        </section>
      )}
      {groups.months.length > 0 && (
        <section className="paper-list-group">
          <h3 className="paper-group__head">
            Сыграны <span className="paper-group__count">· {groups.months.reduce((n, m) => n + m.sessions.length, 0)}</span>
          </h3>
          {groups.months.map((m) => (
            <div key={m.key} className="session-month">
              <h4 className="session-month__head">
                {m.title} <span className="paper-group__count">· {m.sessions.length}</span>
              </h4>
              {rows(m.sessions, heldMeta, (s) => s.status === "held" && heldTails(s).unreviewed)}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
