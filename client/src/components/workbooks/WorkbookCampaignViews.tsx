import { Link } from "react-router-dom";
import { useEntity, useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { beingAffects } from "../../data/settingEntities";
import { sessionPaths } from "../../data/sessions";
import {
  RECORD_ASPECTS,
} from "../../entityRecords";
import type { CampaignDetail, LiveSession, SessionSummary, SettingBeingDetail } from "../../types";
import { CampaignWorldTab, type WorldEntity, type WorldType } from "../campaign/CampaignWorldTab";
import { CampaignRecords } from "../campaign/CampaignProfileParts";
import { CampaignMove } from "../campaign/CampaignMove";
import { useOwnerRecords } from "../campaign/campaignProfile";

// Виды листов тетради кампании v4 (спека .scratch/workbook-rework): тетрадь
// — вид на данные кампании, а не второе хранилище. Здесь только сборка
// готовых частей «Мира кампании» и профиля в контексте кампании.

const PLACES: readonly WorldType[] = ["location"];
const SIDES: readonly WorldType[] = ["being", "community"];
const PROFILE_PATHS: Record<WorldType, string> = { being: "/beings", community: "/communities", location: "/locations" };
const NO_SESSIONS: SessionSummary[] = [];

/** Лист 6 «Место и доступ», лист 7 «Сторона и отношения»: список + раскрытая карточка сущности. */
export function CampaignEntitiesView({ campaignId, view, title }: { campaignId: number; view: "places" | "sides"; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const sessions = useResource<SessionSummary[]>(campaignPaths.sessions(campaignId)).data ?? NO_SESSIONS;
  if (!campaign) return <p className="muted">Открываем кампанию…</p>;
  return (
    <section className="wb-profile">
      <h3>{title}</h3>
      <CampaignWorldTab
        campaignId={campaignId}
        settingId={campaign.setting_id}
        sessions={sessions}
        types={view === "places" ? PLACES : SIDES}
        expand={(e) => <EntityCard campaignId={campaignId} settingId={campaign.setting_id} entity={e} />}
      />
    </section>
  );
}

function EntityCard({ campaignId, settingId, entity }: { campaignId: number; settingId: number | null; entity: WorldEntity }) {
  const { entity_type: type, entity_id: id } = entity;
  const records = useOwnerRecords(campaignId, type, id);
  const aspects = RECORD_ASPECTS[type].map((a) => a.key);
  return (
    <>
      {type === "being" && <BeingMove campaignId={campaignId} beingId={id} />}
      <CampaignRecords
        campaignId={campaignId}
        settingId={settingId}
        ownerType={type}
        ownerId={id}
        chains={records}
        title="Записи в кампании"
        aspects={aspects}
        // У места графы — словарь листа; у стороны основа силы правится в профиле.
        emptyKeys={type === "location" ? aspects.filter((k) => k !== "note") : []}
      />
      <Link className="paper-more" to={`${PROFILE_PATHS[type]}/${id}?campaign=${campaignId}`}>
        Профиль ›
      </Link>
    </>
  );
}

function BeingMove({ campaignId, beingId }: { campaignId: number; beingId: number }) {
  const being = useEntity<SettingBeingDetail>("being", beingId).data;
  const live = useResource<LiveSession | null>(sessionPaths.live()).data ?? null;
  if (!being) return null;
  return <CampaignMove being={being} campaignId={campaignId} live={live?.campaign_id === campaignId} affects={beingAffects(beingId)} />;
}

