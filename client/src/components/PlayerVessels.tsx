import { useResource } from "../data/hooks";
import { crewText, hpText, vesselPaths, type Vessel } from "../data/campaignVessels";
import { VesselCrewPlan } from "./VesselCrewPlan";

// Корабли партии у игрока (спека profiles-paper-2, «Корабль кампании»):
// вкладка «Группа», под составом, только чтение — имя, чертёж с экипажем,
// прочность. Заметок Мастера сервер не отдаёт.
export function PlayerVessels({ campaignId }: { campaignId: number }) {
  const vessels = useResource<Vessel[]>(vesselPaths.player(campaignId)).data ?? [];
  if (vessels.length === 0) return null;
  return (
    <section className="paper-scope paper-sheet vessels-tab">
      <h2 className="paper-group__head">
        Транспорт <span className="paper-group__count">· {vessels.length}</span>
      </h2>
      {vessels.map((v) => {
        const broken = v.posts.filter((p) => p.broken).map((p) => p.name);
        return (
          <article key={v.id} className="player-vessel">
            <header className="player-vessel__head">
              <strong>{v.name}</strong>
              <span className="paper-rows__sub">{[v.base?.category, v.base?.name].filter(Boolean).join(" · ")}</span>
            </header>
            <dl className="vehicle-head__stats player-vessel__stats">
              <div>
                <dt className="paper-label">Корпус</dt>
                <dd className={`vehicle-head__value vessel-hp${v.hull.hp === 0 ? " is-down" : ""}`}>{hpText(v.hull)}</dd>
              </div>
              <div>
                <dt className="paper-label">Экипаж</dt>
                <dd className="vehicle-head__value">{crewText(v.crew_total)}</dd>
              </div>
            </dl>
            {broken.length > 0 && <p className="vessel-post__broken">Выведены из строя: {broken.join(", ")}</p>}
            <VesselCrewPlan vessel={v} large />
          </article>
        );
      })}
    </section>
  );
}
