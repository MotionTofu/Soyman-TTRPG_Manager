import { useMemo, useState } from "react";
import { useAction, useResource, write } from "../../data/hooks";
import { labelled } from "../../data/notices";
import { campaignPaths } from "../../data/campaigns";
import {
  RECORD_ASPECTS,
  SOURCE_LABELS,
  isUnaddressed,
  recordAffects,
  recordChains,
  type EntityRecord,
  type RecordOwnerType,
  type RecordStatus,
} from "../../entityRecords";
import { EntityRecordItem, RecordOwner } from "./EntityRecordItem";
import { RecordFormModal } from "./RecordFormModal";
import { MentionText } from "../mentions/MentionText";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import type { CampaignWorld } from "../campaign/CampaignWorldTab";
import type { Character } from "../../types";

// Разбор встречи во «Итогах» (спека .scratch/campaign-layer, задача 06):
// записи этой встречи и очередь черновиков. Черновик ничего не утверждает,
// пока его не подтвердили; без адреса подтвердить нельзя.

const NO_CHARACTERS: Character[] = [];
const SETTING_TYPES = ["being", "community", "location"] as const;
const CAMPAIGN_ASPECTS = RECORD_ASPECTS.campaign.filter((a) => a.key !== "unsorted");

type Owner = { owner_type: RecordOwnerType; owner_id: number; aspect: string };

/** «→ на ком»: кампания по графам, «Мир кампании», персонажи, другая сущность сеттинга. */
function OwnerSelect({
  record,
  settingId,
  onPick,
}: {
  record: EntityRecord;
  settingId: number | null;
  onPick: (owner: Owner) => void;
}) {
  const world = useResource<CampaignWorld>(settingId ? campaignPaths.world(record.campaign_id) : null).data?.entities;
  const characters = useResource<Character[]>(campaignPaths.characters(record.campaign_id)).data ?? NO_CHARACTERS;
  const [picking, setPicking] = useState(false);

  function choose(value: string) {
    if (value === "other") return setPicking(true);
    const [type, id, aspect] = value.split(":");
    if (type === "campaign") onPick({ owner_type: "campaign", owner_id: record.campaign_id, aspect });
    else onPick({ owner_type: type as RecordOwnerType, owner_id: Number(id), aspect: "note" });
  }

  return (
    <>
      <select aria-label="На ком" value="" onChange={(e) => e.target.value && choose(e.target.value)}>
        <option value="">{isUnaddressed(record) ? "без адреса — выбрать…" : "сменить…"}</option>
        <optgroup label="Кампания">
          {CAMPAIGN_ASPECTS.map((a) => (
            <option key={a.key} value={`campaign:${record.campaign_id}:${a.key}`}>
              кампания · {a.label.toLowerCase()}
            </option>
          ))}
        </optgroup>
        {!!world?.length && (
          <optgroup label="Мир кампании">
            {world.map((e) => (
              <option key={`${e.entity_type}:${e.entity_id}`} value={`${e.entity_type}:${e.entity_id}`}>
                {e.name}
              </option>
            ))}
          </optgroup>
        )}
        {characters.length > 0 && (
          <optgroup label="Персонажи игроков">
            {characters.map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.character_name}
              </option>
            ))}
          </optgroup>
        )}
        {settingId && <option value="other">другая сущность сеттинга…</option>}
      </select>
      {picking && settingId && (
        <MentionPickerModal
          initialQuery=""
          heading="На ком запись"
          direct
          onlyTypes={SETTING_TYPES}
          defaultSettingId={settingId}
          lockSetting
          onPick={(r) => {
            setPicking(false);
            onPick({ owner_type: r.type as RecordOwnerType, owner_id: r.id, aspect: "note" });
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function DraftRow({ record, settingId }: { record: EntityRecord; settingId: number | null }) {
  const run = useAction();
  const [editing, setEditing] = useState(false);
  const unaddressed = isUnaddressed(record);
  const source = SOURCE_LABELS[record.source];

  async function update(body: Partial<Owner> & { status?: RecordStatus }, label: string, next: Owner = record) {
    await run(labelled(label, () => write.put(`/records/${record.id}`, body)), {
      // Задеты оба владельца: смена адреса уводит запись с одного профиля на другой.
      affects: [...recordAffects(record.campaign_id, record.owner_type, record.owner_id), ...recordAffects(record.campaign_id, next.owner_type, next.owner_id)],
    });
  }

  return (
    <li className="entity-record session-review__draft">
      <div className="entity-record__text">
        <MentionText text={record.text} />
      </div>
      <div className="entity-record__meta">
        {source && <span>источник: {source}</span>}
        {record.basis && <span>· {record.basis}</span>}
        <span className="session-review__owner">
          → {unaddressed ? "на ком: не выбрано" : <RecordOwner record={record} />}{" "}
          <OwnerSelect record={record} settingId={settingId} onPick={(o) => void update(o, "На ком запись", o)} />
        </span>
      </div>
      <div className="session-review__acts">
        <button
          type="button"
          className="primary"
          disabled={unaddressed}
          title={unaddressed ? "Сначала выберите, на ком запись" : undefined}
          onClick={() => void update({ status: "established" }, "Подтвердить")}
        >
          Подтвердить
        </button>
        <button type="button" disabled={unaddressed} onClick={() => void update({ status: "assumption" }, "Оставить предположением")}>
          Оставить предположением
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          Править
        </button>
        <button type="button" className="session-review__discard" onClick={() => void update({ status: "discarded" }, "Отбросить")}>
          Отбросить
        </button>
      </div>
      {editing && <RecordFormModal campaignId={record.campaign_id} settingId={settingId} record={record} onClose={() => setEditing(false)} />}
    </li>
  );
}

export function SessionRecordsReview({ campaignId, sessionId, settingId }: { campaignId: number; sessionId: number; settingId: number | null }) {
  const records = useResource<{ records: EntityRecord[] }>(`${campaignPaths.records(campaignId)}?session_id=${sessionId}`).data?.records;
  const { held, drafts } = useMemo(() => {
    const list = records ?? [];
    return {
      held: recordChains(list.filter((r) => r.status !== "draft")),
      drafts: list.filter((r) => r.status === "draft").reverse(),
    };
  }, [records]);
  if (!records) return null;

  return (
    <div className="session-review">
      <section className="campaign-records">
        <h3 className="paper-group__head">
          Записи встречи <span className="paper-group__count">· {held.length}</span>
        </h3>
        {held.length ? (
          held.map((c) => <EntityRecordItem key={c.record.id} chain={c} settingId={settingId} showOwner />)
        ) : (
          <p className="muted">Пока ничего не записано. Записи появляются из окна записи на профилях и из подтверждённых черновиков.</p>
        )}
      </section>
      {drafts.length > 0 && (
        <section className="campaign-records">
          <h3 className="paper-group__head">
            Черновики — разобрать <span className="paper-group__count">· {drafts.length}</span>
          </h3>
          <ul className="session-review__drafts">
            {drafts.map((r) => (
              <DraftRow key={r.id} record={r} settingId={settingId} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
