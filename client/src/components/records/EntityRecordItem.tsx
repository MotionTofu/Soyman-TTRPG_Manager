import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { sessionLabel } from "../../sessionLabel";
import { CERTAINTY_LABELS, STATUS_LABELS, knownToLabel, ownerLabel, ownerPath, type EntityRecord, type RecordChain } from "../../entityRecords";
import { mentionTone } from "../../mentions";
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

/** «на ком: Мия Тарн» — ссылкой на профиль в контексте кампании. */
export function RecordOwner({ record }: { record: EntityRecord }) {
  const path = ownerPath(record);
  return (
    <span>
      на ком:{" "}
      {path ? (
        <Link className={`mention-link mention--${mentionTone(record.owner_type, record.owner_id)}`} to={path}>
          {ownerLabel(record)}
        </Link>
      ) : (
        ownerLabel(record)
      )}
    </span>
  );
}

export function EntityRecordItem({
  chain,
  settingId,
  was,
  showOwner,
}: {
  chain: RecordChain;
  settingId: number | null;
  /** «на ком» — в списках, где записи разных владельцев (разбор встречи). */
  showOwner?: boolean;
  /** «Было → стало»: прежняя версия зачёркнутой строкой над текстом (профиль в кампании). */
  was?: boolean;
}) {
  const { record, history } = chain;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(record.campaign_id)).data;
  const [form, setForm] = useState<"edit" | "replace" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="entity-record">
      {was && history[0] && (
        <div className="entity-record__was">
          <MentionText text={history[0].text} />
        </div>
      )}
      <div className="entity-record__text">
        {was && history[0] && <span aria-hidden="true">→ </span>}
        <MentionText text={record.text} />
      </div>
      <div className="entity-record__meta">
        <RecordMeta record={record} sessions={sessions} />
        {showOwner && <RecordOwner record={record} />}
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
