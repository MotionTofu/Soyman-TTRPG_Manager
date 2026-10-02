import { useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { campaignEntryAffects, campaignPaths } from "../../data/campaigns";
import type { CampaignEntry } from "../../types";
import { CampaignEntryList } from "../CampaignEntryList";
import { Modal } from "../Modal";
import { WORKBOOK_AFFECTS, type InstanceSummary } from "../workbooks/model";

// «Старые заметки» на «Обзоре» кампании (спека campaign-paper, Q31/Q32/Q36;
// доска 45). Вкладки «Заметки» больше нет: свободные записи живут в листах
// тетради. Прежние заметки Мастера видны, пока они есть, правятся, новых нет;
// «В тетрадь» переносит выбранные в записи листа. Перенесли последнюю —
// свёртка пропадает.
export function OldNotesFold({ campaignId, settingId }: { campaignId: number; settingId: number | null }) {
  const notes = useResource<CampaignEntry[]>(campaignPaths.entries(campaignId, "gm_notes")).data;
  const workbooks = useResource<InstanceSummary[]>(`/workbooks/instances?project_type=campaign&project_id=${campaignId}`).data;
  const [moving, setMoving] = useState(false);
  if (!notes || notes.length === 0) return null;
  const live = (workbooks ?? []).filter((w) => !w.archived_at);
  return (
    <details className="paper-fold">
      <summary>
        Старые заметки <span className="paper-fold__count">· {notes.length}</span>
      </summary>
      <div className="paper-fold__body stack">
        {live.length > 0 ? (
          <div className="row">
            <button type="button" onClick={() => setMoving(true)}>
              В тетрадь…
            </button>
            <span className="muted">заметки станут записями листа тетради и уйдут отсюда</span>
          </div>
        ) : (
          <p className="muted">Привяжите тетрадь к кампании — заметки можно будет перенести в её лист.</p>
        )}
        <CampaignEntryList
          campaignId={campaignId}
          category="gm_notes"
          addLabel=""
          emptyLabel=""
          canAdd={false}
          defaultSettingId={settingId ?? undefined}
        />
      </div>
      {moving && <MoveToWorkbook campaignId={campaignId} notes={notes} workbooks={live} onClose={() => setMoving(false)} />}
    </details>
  );
}

interface WorkbookDetail {
  id: number;
  template: { sheets: { key: string; title: string }[] } | null;
}

function MoveToWorkbook({
  campaignId,
  notes,
  workbooks,
  onClose,
}: {
  campaignId: number;
  notes: CampaignEntry[];
  workbooks: InstanceSummary[];
  onClose: () => void;
}) {
  const [workbookId, setWorkbookId] = useState(workbooks[0].id);
  const detail = useResource<WorkbookDetail>(`/workbooks/instances/${workbookId}`).data;
  const sheets = detail?.id === workbookId ? (detail.template?.sheets ?? []) : [];
  const [sheet, setSheet] = useState("");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(notes.map((n) => n.id)));
  const run = useAction();
  const sheetKey = sheet || sheets[0]?.key || "";

  async function move() {
    const ids = [...picked];
    const all = ids.length === notes.length;
    const done = await run(
      () =>
        write.post(`/workbooks/instances/${workbookId}/campaign-notes`, {
          campaign_id: campaignId,
          sheet_key: sheetKey,
          ...(all ? {} : { entry_ids: ids }),
        }),
      { affects: [...campaignEntryAffects(campaignId), ...WORKBOOK_AFFECTS], retry: false }
    );
    if (done) onClose();
  }

  return (
    <Modal onClose={onClose} ariaLabel="Перенести заметки в тетрадь">
      <div className="stack">
        <h2>Перенести заметки в тетрадь</h2>
        {workbooks.length > 1 && (
          <label className="stack">
            <span className="paper-label">Тетрадь</span>
            <select
              value={workbookId}
              onChange={(e) => {
                setWorkbookId(Number(e.target.value));
                setSheet("");
              }}
            >
              {workbooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="stack">
          <span className="paper-label">Лист</span>
          <select value={sheetKey} onChange={(e) => setSheet(e.target.value)} disabled={sheets.length === 0}>
            {sheets.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="stack">
          <legend className="paper-label">Какие заметки</legend>
          {notes.map((n) => (
            <label key={n.id} className="row">
              <input
                type="checkbox"
                checked={picked.has(n.id)}
                onChange={() =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
              />
              {n.title?.trim() || n.content?.split("\n")[0]?.slice(0, 80) || "Без названия"}
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button type="button" className="primary" disabled={!sheetKey || picked.size === 0} onClick={() => void move()}>
            Перенести {picked.size === notes.length ? "все" : picked.size}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
