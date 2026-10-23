import { Link } from "react-router-dom";
import { MentionText } from "../mentions/MentionText";
import { sessionLabel } from "../../sessionLabel";
import { parseDateKey } from "../../utils/date";
import { groupSessions } from "./sessionGroups";
import type { SessionSummary } from "../../types";

// Вкладка «Сессии» строками (гриллинг 2026-10-23, Q1–Q19): группы «Ждут
// разбора / Запланированы / Сыграны», у сыгранных — месяцы; слева колонка
// даты, строка целиком ведёт в сессию, редкие действия — под «⋯».

const monthShort = new Intl.DateTimeFormat("ru", { month: "short" });

function SessionRow({
  session,
  inworld,
  onMenu,
  onOutcome,
}: {
  session: SessionSummary;
  inworld: string;
  onMenu?: (e: React.MouseEvent<HTMLElement>, s: SessionSummary) => void;
  onOutcome?: (s: SessionSummary) => void;
}) {
  const d = parseDateKey(session.date);
  const first = session.notes_text?.split("\n").find((l) => l.trim())?.trim() ?? "";
  const label = sessionLabel(session);
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
  inworldLabel,
  onSchedule,
  onMenu,
  onOutcome,
}: {
  sessions: SessionSummary[];
  today: string;
  isGm: boolean;
  inworldLabel: (s: SessionSummary) => string;
  onSchedule: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, s: SessionSummary) => void;
  onOutcome: (s: SessionSummary) => void;
}) {
  const groups = groupSessions(sessions, today, isGm);
  const menu = isGm ? onMenu : undefined;
  const rows = (list: SessionSummary[], outcome?: (s: SessionSummary) => void) => (
    <ul className="paper-rows session-rows">
      {list.map((s) => (
        <SessionRow key={s.id} session={s} inworld={inworldLabel(s)} onMenu={menu} onOutcome={outcome} />
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
          {rows(groups.overdue, onOutcome)}
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
          {groups.planned.length > 0 && rows(groups.planned)}
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
              {rows(m.sessions)}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
