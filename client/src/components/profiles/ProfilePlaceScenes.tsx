import { Link } from "react-router-dom";
import type { PlaceHistory } from "../PlaceCard";
import { sessionLabel } from "../../sessionLabel";
import { ProfileBlock } from "./ProfileParts";
import { useState } from "react";
import { useAction, write } from "../../data/hooks";

export const PLACE_REASON_LABELS: Record<string, string> = { scene: "сцена", panel: "пульт", mention: "упоминание" };

export function ProfilePlaceScenes({ history, settingId }: { history?: PlaceHistory | null; settingId: number }) {
  const run = useAction();
  const [passing,setPassing] = useState<number | null>(null);
  const [all,setAll] = useState(false);
  const ahead = all ? history?.ahead : history?.ahead.slice(0,5);
  const visits = all ? history?.visits : history?.visits.slice(0,5);
  async function passed(id:number,campaignId:number) {
    setPassing(id);
    try { await run(() => write.put(`/story/scenes/${id}/state`,{campaign_id:campaignId,status:"done"}),{affects:[{path:"/setting-locations"},{kind:"scene",id}],retry:false}); }
    finally { setPassing(null); }
  }
  return <ProfileBlock title="Сцены здесь" count={(history?.ahead_total ?? 0) + (history?.visits_total ?? 0)}>
    <div className="profile-columns">
      <div><h3 className="d-note">Впереди · {history?.ahead_total ?? 0}</h3>
        {ahead?.length ? ahead.map((s) => <div className="profile-scene" key={`${s.campaign_id}:${s.scene_id}`}><Link to={`/scenes/${s.scene_id}?campaign=${s.campaign_id}`}>{s.scene_name}</Link><small>{s.campaign_name}{s.place_name && ` · ${s.place_name}`}</small>{s.launched_at && <div className="row"><small>запускалась {s.launched_at.slice(0,10)}</small><button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={passing != null} onClick={() => void passed(s.scene_id,s.campaign_id)}>Пройдена</button></div>}</div>) : <p className="muted">Здесь ещё нет запланированных сцен. <Link to={`/settings/${settingId}?tab=Приключения`}>К приключениям ›</Link></p>}
      </div>
      <div><h3 className="d-note">Было · {history?.visits_total ?? 0}</h3>
        {visits?.length ? visits.map((v) => <div className="profile-scene" key={v.session_id}><Link to={`/sessions/${v.session_id}`}>{sessionLabel(v)}</Link><small>{v.campaign_name} · {v.reasons.map((r) => PLACE_REASON_LABELS[r]).join(" · ")}</small></div>) : <p className="muted">Посещений пока нет.</p>}
      </div>
    </div>
    {((history?.ahead.length ?? 0) > 5 || (history?.visits.length ?? 0) > 5) && <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={() => setAll((v) => !v)}>{all ? "Свернуть" : "Показать все"}</button>}
  </ProfileBlock>;
}
