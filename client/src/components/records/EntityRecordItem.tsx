import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { sessionLabel } from "../../sessionLabel";
import { CERTAINTY_LABELS, STATUS_LABELS, knownToLabel, type EntityRecord, type RecordChain } from "../../entityRecords";
import { MentionText } from "../mentions/MentionText";
import { RecordFormModal } from "./RecordFormModal";
import type { SessionSummary } from "../../types";

// Запись слоя кампании (спека .scratch/campaign-layer, задача 04): текст с
// упоминаниями и метки. Метки — только отличия: «установлено» и «известно»
// не показываются, «знает: …» и встреча — всегда, если есть.

function RecordMeta({ record, sessions }: { record: EntityRecord; sessions: SessionSummary[] | undefined }) {
  const session = record.session_id != null ? sessions?.find((s) => s.id === record.session_id) : undefined;
  return (
    <>
      {record.status !== "established" && <span className={`badge tag entity-record__status--${record.status}`}>{STATUS_LABELS[record.status]}</span>}
      {record.certainty !== "known" && <span className="badge tag entity-record__certainty">{CERTAINTY_LABELS[record.certainty]}</span>}
      <span className="badge tag">знает: {knownToLabel(record)}</span>
      {record.session_id != null && (
        <Link className="muted" to={`/sessions/${record.session_id}`}>
          {session ? sessionLabel(session) : "встреча"}
        </Link>
      )}
      {record.basis && <span>· {record.basis}</span>}
    </>
  );
}

export function EntityRecordItem({ chain, settingId }: { chain: RecordChain; settingId: number | null }) {
  const { record, history } = chain;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(record.campaign_id)).data;
  const [form, setForm] = useState<"edit" | "replace" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="entity-record">
      <div className="entity-record__text">
        <MentionText text={record.text} />
      </div>
      <div className="entity-record__meta">
        <RecordMeta record={record} sessions={sessions} />
        <span className="entity-record__acts">
          <button type="button" onClick={() => setForm("edit")}>
            Править
          </button>
          {record.status !== "draft" && (
            <button type="button" onClick={() => setForm("replace")}>
              Заменить
            </button>
          )}
          {history.length > 0 && (
            <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
              История замен · {history.length}
            </button>
          )}
        </span>
      </div>
      {historyOpen && (
        <ol className="entity-record__history" aria-label="История замен">
          {history.map((prev) => (
            <li key={prev.id}>
              <div className="entity-record__was">
                <MentionText text={prev.text} />
              </div>
              <div className="entity-record__meta">
                <RecordMeta record={prev} sessions={sessions} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {form && <RecordFormModal campaignId={record.campaign_id} settingId={settingId} record={record} replace={form === "replace"} onClose={() => setForm(null)} />}
    </div>
  );
}
