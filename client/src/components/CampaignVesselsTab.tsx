import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import {
  VESSEL_AFFECTS,
  crewText,
  hpText,
  vesselPaths,
  type Vessel,
  type VesselBase,
  type VesselSummary,
} from "../data/campaignVessels";
import { isSafeImageUrl } from "../utils/safeUrl";
import { EmptyState } from "./EmptyState";

// Вкладка кампании «Транспорт» (спека profiles-paper-2, «Корабль кампании»;
// доска 38): корабли партии строками, «+ Корабль» — судно из компендиума
// системы кампании и имя. Потопленные и проданные — в свёртке «В архиве».
export function CampaignVesselsTab({ campaignId }: { campaignId: number }) {
  const list = useResource<VesselSummary[]>(vesselPaths.list(campaignId));
  const [adding, setAdding] = useState(false);
  const run = useAction();
  const active = (list.data ?? []).filter((v) => !v.archived_at);
  const archived = (list.data ?? []).filter((v) => v.archived_at);

  return (
    <section className="paper-scope paper-sheet vessels-tab">
      <h2 className="paper-group__head">
        Транспорт <span className="paper-group__count">· {active.length}</span>
      </h2>
      {list.data && active.length === 0 && !adding && (
        <EmptyState title="Кораблей пока нет" hint="Корабль кампании заводится на основе судна из компендиума: посты и чертёж — его, экипаж и груз — свои." />
      )}
      {active.length > 0 && (
        <ul className="vessels-tab__rows">
          {active.map((v) => (
            <VesselRow key={v.id} campaignId={campaignId} vessel={v} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddVessel campaignId={campaignId} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="editable-card-add" onClick={() => setAdding(true)}>
          + Корабль
        </button>
      )}
      {archived.length > 0 && (
        <details className="paper-fold">
          <summary>
            В архиве <span className="paper-fold__count">· {archived.length}</span>
          </summary>
          <div className="paper-fold__body">
            <ul className="paper-rows">
              {archived.map((v) => (
                <li key={v.id}>
                  <span className="paper-rows__main">
                    <Link to={`/campaigns/${campaignId}/vessels/${v.id}`}>{v.name}</Link>
                  </span>
                  <span className="paper-rows__sub">{v.base?.name ?? "основа удалена"}</span>
                  <button
                    type="button"
                    className="comp-mini"
                    onClick={() => void run(() => write.post(`${vesselPaths.detail(v.id)}/restore`, {}), { affects: VESSEL_AFFECTS })}
                  >
                    Вернуть
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}

function VesselRow({ campaignId, vessel: v }: { campaignId: number; vessel: VesselSummary }) {
  const img = v.image_url && isSafeImageUrl(v.image_url) ? v.image_url : null;
  const down = v.hull.max != null && v.hull.hp != null && v.hull.hp <= 0;
  return (
    <li className="vessels-tab__row">
      <Link className="vessels-tab__thumb" to={`/campaigns/${campaignId}/vessels/${v.id}`} tabIndex={-1} aria-hidden="true">
        {img ? <img src={img} alt="" /> : <span />}
      </Link>
      <span className="vessels-tab__name">
        <Link to={`/campaigns/${campaignId}/vessels/${v.id}`}>{v.name}</Link>
        <span className="paper-rows__sub">
          {[v.base?.category, v.base?.name].filter(Boolean).join(" · ") || "основа удалена"}
        </span>
      </span>
      <span className="vessels-tab__lead">
        {v.lead ? `${v.lead.post.toLowerCase()} — ${v.lead.names.join(", ")}` : "—"}
        {v.broken_posts.length > 0 && <span className="vessel-post__broken">разбито: {v.broken_posts.join(", ")}</span>}
      </span>
      <span className="vessels-tab__stat">
        <span className="paper-label">Корпус</span>
        <span className={`vessel-hp${down ? " is-down" : ""}`}>{hpText(v.hull)}</span>
      </span>
      <span className="vessels-tab__stat">
        <span className="paper-label">Экипаж</span>
        <span>{crewText(v.crew_total)}</span>
      </span>
    </li>
  );
}

function AddVessel({ campaignId, onDone }: { campaignId: number; onDone: () => void }) {
  const bases = useResource<VesselBase[]>(vesselPaths.bases(campaignId)).data;
  const [entryId, setEntryId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const run = useAction();
  const navigate = useNavigate();
  const base = bases?.find((b) => b.id === entryId);

  async function create() {
    if (entryId == null) return;
    const created = await run(() => write.post<Vessel>(vesselPaths.list(campaignId), { entry_id: entryId, name: name.trim() }), {
      affects: VESSEL_AFFECTS,
      // Без «Повторить»: ответ мог потеряться после записи — повтор завёл бы второй корабль.
      retry: false,
    });
    if (!created) return;
    onDone();
    navigate(`/campaigns/${campaignId}/vessels/${created.id}`);
  }

  return (
    <form
      className="vessels-tab__add"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <span className="paper-label">Новый корабль</span>
      {bases && bases.length === 0 ? (
        <p className="muted">
          В компендиуме системы кампании нет судов. Заведите судно в разделе «Транспорт» системы — корабль кампании строится на его основе.
        </p>
      ) : (
        <>
          <label>
            <span className="paper-label">Судно из компендиума</span>
            <select value={entryId ?? ""} onChange={(e) => setEntryId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— выберите —</option>
              {(bases ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.category ? ` · ${b.category}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="paper-label">Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={base?.name ?? "Чайка"} />
          </label>
        </>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={entryId == null}>
          Завести
        </button>
        <button type="button" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}
