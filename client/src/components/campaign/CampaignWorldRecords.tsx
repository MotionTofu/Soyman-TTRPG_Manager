import { Link, useNavigate } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { isUnaddressed, knownToLabel, ownerLabel, ownerPath, type EntityRecord } from "../../entityRecords";
import { sessionLabel } from "../../sessionLabel";
import { plural } from "../../sceneKinds";
import { formatDateKeyRu } from "../../utils/date";
import { RecordOwner } from "../records/EntityRecordItem";
import { MentionText } from "../mentions/MentionText";
import type { SessionSummary } from "../../types";

/** Здесь записи только читают; разбор остаётся в «Итогах» сессии. */
export function CampaignWorldRecords({ campaignId, mode, sessions, query }: {
  campaignId: number;
  mode: "rumor" | "draft";
  sessions: SessionSummary[];
  query: string;
}) {
  const state = useResource<{ records: EntityRecord[] }>(campaignPaths.records(campaignId));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const search = query.trim().toLocaleLowerCase("ru");
  const records = (state.data?.records ?? [])
    .filter((r) => r.replaced_by == null && (mode === "draft" ? r.status === "draft" : r.certainty === "rumor" && r.status !== "draft" && r.status !== "discarded"))
    .filter((r) => !search || `${r.text} ${ownerLabel(r)}`.toLocaleLowerCase("ru").includes(search))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const groups = new Map<number | null, EntityRecord[]>();
  for (const r of records) groups.set(r.session_id, [...(groups.get(r.session_id) ?? []), r]);
  const orderedGroups = [...groups].sort(([a, ar], [b, br]) => {
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    return (sessionById.get(b)?.date ?? br[0].created_at).localeCompare(sessionById.get(a)?.date ?? ar[0].created_at) || b - a;
  });

  return <section className="world-records" aria-label={mode === "rumor" ? "Слухи" : "Черновики"}>
    <h3>{mode === "rumor" ? "Слухи" : "Черновики"}</h3>
    {state.error ? <p role="alert">Не удалось загрузить записи. <button type="button" onClick={state.reload}>Повторить</button></p> : !state.data ? <p className="muted" role="status">Загружаем записи…</p> : <>
      <p className="campaign-world__count">{records.length} {mode === "rumor" ? plural(records.length, "запись", "записи", "записей") : plural(records.length, "черновик", "черновика", "черновиков")}</p>
      {!records.length ? <p className="campaign-world__empty">{search ? "Ничего не подходит." : mode === "rumor" ? "В кампании пока нет слухов." : "В кампании пока нет черновиков."}</p> : mode === "rumor" ? <ul className="world-records__rows">{records.map((r) => <RecordRow key={r.id} record={r} session={r.session_id != null ? sessionById.get(r.session_id) : undefined} rumor />)}</ul> : orderedGroups.map(([sessionId, rows]) => {
        const session = sessionId != null ? sessionById.get(sessionId) : undefined;
        return <section className="world-records__group" key={sessionId ?? "none"} aria-label={session ? sessionLabel(session) : sessionId != null ? "Сессия" : "Без сессии"}>
          <header><h4>{session ? sessionLabel(session) : sessionId != null ? "Сессия" : "Без сессии"}</h4><span>· {rows.length} {plural(rows.length, "черновик", "черновика", "черновиков")}</span>{sessionId != null && <Link to={`/sessions/${sessionId}?tab=${encodeURIComponent("Итоги")}`}>Разобрать ›</Link>}</header>
          <ul className="world-records__rows">{rows.map((r) => <RecordRow key={r.id} record={r} session={session} />)}</ul>
        </section>;
      })}
    </>}
  </section>;
}

function RecordRow({ record, session, rumor = false }: { record: EntityRecord; session?: SessionSummary; rumor?: boolean }) {
  const navigate = useNavigate();
  const path = rumor ? ownerPath(record) : null;
  return <li className="world-records__row">
    <article className={path ? "world-record world-record--link" : "world-record"} role={path ? "link" : undefined} tabIndex={path ? 0 : undefined} aria-label={path ? `Открыть профиль: ${ownerLabel(record)}` : undefined}
      onClick={path ? (event) => { if (!(event.target as Element).closest("a,button")) navigate(path); } : undefined}
      onKeyDown={path ? (event) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); navigate(path); } } : undefined}>
      <div className="world-record__text"><MentionText text={record.text} /></div>
      <div className="world-record__meta">
        {isUnaddressed(record) ? <span className="world-record__unaddressed">без адреса</span> : <RecordOwner record={record} />}
        {record.session_id != null && <Link to={`/sessions/${record.session_id}`}>{session ? `${sessionLabel(session)} · ${formatDateKeyRu(session.date)}` : "сессия"}</Link>}
        <span>знает: {knownToLabel(record)}</span>
      </div>
    </article>
  </li>;
}
