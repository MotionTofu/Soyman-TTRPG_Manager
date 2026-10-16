import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import { sessionLabel } from "../../sessionLabel";
import { formatDateKeyRu } from "../../utils/date";
import {
  CERTAINTY_LABELS,
  KNOWN_TO_LABELS,
  lastHeldSession,
  RECORD_ASPECTS,
  STATUS_LABELS,
  recordAffects,
  type EntityRecord,
  type RecordCertainty,
  type RecordKnownTo,
  type RecordOwnerType,
  type RecordStatus,
} from "../../entityRecords";
import { Modal } from "../Modal";
import { MentionTextarea } from "../mentions/MentionTextarea";
import type { SessionSummary } from "../../types";

// Окно записи (спека .scratch/campaign-layer, задача 04): графа по словарю
// вида · текст · статус · достоверность · кому известно · основание · встреча.
// «Заменить» — то же окно: новая запись, прежняя остаётся в «Истории замен».

const STATUSES: RecordStatus[] = ["established", "assumption", "draft"];
const CERTAINTIES: RecordCertainty[] = ["known", "rumor", "disputed"];
const KNOWN_TO: RecordKnownTo[] = ["gm", "table", "public", "some"];
const NO_SESSIONS: SessionSummary[] = [];

function Seg<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="stack">
      <span className="paper-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" className={o === value ? "is-active" : ""} aria-pressed={o === value} onClick={() => onChange(o)}>
            {labels[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

type Props = {
  campaignId: number;
  /** Сеттинг кампании — для упоминаний в тексте. */
  settingId: number | null;
  onClose: () => void;
} & (
  | { record?: undefined; replace?: undefined; ownerType: RecordOwnerType; ownerId: number; aspect?: string }
  | { record: EntityRecord; replace?: boolean; ownerType?: undefined; ownerId?: undefined; aspect?: undefined }
);

export function RecordFormModal(props: Props) {
  const { campaignId, settingId, onClose, record, replace } = props;
  const ownerType = record ? record.owner_type : props.ownerType;
  const ownerId = record ? record.owner_id : props.ownerId;
  const aspects = RECORD_ASPECTS[ownerType];
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaignId)).data ?? NO_SESSIONS;
  const run = useAction();

  const [aspect, setAspect] = useState(record?.aspect ?? props.aspect ?? "note");
  const [text, setText] = useState(record?.text ?? "");
  const [status, setStatus] = useState<RecordStatus>(record && !replace ? record.status : "established");
  const [certainty, setCertainty] = useState<RecordCertainty>(record?.certainty ?? "known");
  const [knownTo, setKnownTo] = useState<RecordKnownTo>(record?.known_to ?? "gm");
  const [knownNote, setKnownNote] = useState(record?.known_note ?? "");
  const [basis, setBasis] = useState(record && !replace ? record.basis : "");
  // undefined — Мастер встречу не трогал: берём умолчание, когда список придёт.
  const [sessionChoice, setSessionChoice] = useState<number | null | undefined>(record && !replace ? record.session_id : undefined);
  const [saving, setSaving] = useState(false);

  const fallback = lastHeldSession(sessions)?.id ?? null;
  const sessionId = sessionChoice !== undefined ? sessionChoice : fallback;
  const sessionOptions = useMemo(
    () => sessions.filter((s) => s.status !== "cancelled" || s.id === sessionId).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [sessions, sessionId]
  );

  const title = replace ? "Заменить запись" : record ? "Править запись" : "Запись";

  async function save() {
    const body = {
      aspect,
      text: text.trim(),
      status,
      certainty,
      known_to: knownTo,
      known_note: knownTo === "some" ? knownNote.trim() : "",
      basis: basis.trim(),
      session_id: sessionId,
    };
    setSaving(true);
    const saved = await run(
      labelled(title, () =>
        record
          ? replace
            ? write.post(`/records/${record.id}/replace`, body)
            : write.put(`/records/${record.id}`, body)
          : write.post(campaignPaths.records(campaignId), { ...body, owner_type: ownerType, owner_id: ownerId })
      ),
      { affects: recordAffects(campaignId, ownerType, ownerId), retry: false }
    );
    setSaving(false);
    if (saved !== undefined) onClose();
  }

  return (
    <Modal onClose={onClose} ariaLabel={title} closeOnBackdropClick={false} autoFocus={false}>
      <form
        className="stack record-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !saving) void save();
        }}
      >
        <h2>{title}</h2>
        {replace && <p className="muted">Прежняя запись останется в «Истории замен».</p>}
        <label className="stack">
          <span className="paper-label">Графа</span>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={replace}>
            {aspects.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <div className="stack">
          <label className="paper-label" htmlFor="record-form-text">
            Утверждение
          </label>
          <MentionTextarea
            id="record-form-text"
            value={text}
            onChange={setText}
            rows={3}
            autoGrow
            // Панель «при фокусе» сдвигает окно на blur — первый клик по
            // переключателю под полем уходил мимо кнопки.
            toolbar="always"
            placeholder="Наблюдаемым языком: что произошло, что стало известно"
            defaultSettingId={settingId ?? undefined}
          />
        </div>
        <Seg label="Статус" value={status} options={STATUSES} labels={STATUS_LABELS} onChange={setStatus} />
        <Seg label="Достоверность" value={certainty} options={CERTAINTIES} labels={CERTAINTY_LABELS} onChange={setCertainty} />
        <Seg label="Кому известно" value={knownTo} options={KNOWN_TO} labels={KNOWN_TO_LABELS} onChange={setKnownTo} />
        {knownTo === "some" && (
          <label className="stack">
            <span className="paper-label">Кто именно</span>
            <input value={knownNote} onChange={(e) => setKnownNote(e.target.value)} placeholder="VANTA, Орис" />
          </label>
        )}
        <label className="stack">
          <span className="paper-label">Основание</span>
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Откуда известно / почему может измениться" />
        </label>
        <label className="stack">
          <span className="paper-label">Встреча</span>
          <select value={sessionId ?? ""} onChange={(e) => setSessionChoice(e.target.value ? Number(e.target.value) : null)}>
            {sessionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)} · {formatDateKeyRu(s.date)}
              </option>
            ))}
            <option value="">вне встречи</option>
          </select>
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={!text.trim() || saving}>
            {replace ? "Заменить" : "Сохранить"}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
