import { useState } from "react";
import { Link } from "react-router-dom";
import { useEntity, useResource } from "../../data/hooks";
import { campaignPaths } from "../../data/campaigns";
import { beingAffects } from "../../data/settingEntities";
import { sessionPaths } from "../../data/sessions";
import {
  RECORD_ASPECTS,
} from "../../entityRecords";
import { mentionTone } from "../../mentions";
import type { CampaignDetail, Character, LiveSession, SessionSummary, SettingBeingDetail } from "../../types";
import { CampaignParticipation } from "../CharacterDossier";
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

const NO_CHARACTERS: Character[] = [];
const CHARACTER_ASPECTS = RECORD_ASPECTS.character.map((a) => a.key);
const GROUND_ASPECTS = ["group_ties", "open_goals", "disputes", "needs_agreement", "goal_conflict"] as const;

/** Лист 4: персонажи игроков кампании; карточка — участие и записи персонажа по графам. */
export function CampaignHeroesView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const characters = useResource<Character[]>(campaignPaths.characters(campaignId)).data;
  const [open, setOpen] = useState<number | null>(null);
  if (!campaign || !characters) return <p className="muted">Открываем героев…</p>;
  return (
    <section className="wb-profile campaign-world">
      <h3>{title}</h3>
      {characters.length === 0 ? (
        <p className="muted">В кампании пока нет персонажей игроков — они появляются на вкладке «Персонажи игроков».</p>
      ) : (
        <ul className="paper-rows">
          {(characters ?? NO_CHARACTERS).map((c) => (
            <li key={c.id} className={open === c.id ? "campaign-world__open" : undefined}>
              <span className="paper-rows__main">
                <Link className={`mention-link mention--${mentionTone("character", c.id)}`} to={`/characters/${c.id}`}>
                  {c.character_name}
                </Link>
                {c.player_name && <span className="paper-rows__sub"> · {c.player_name}</span>}
                {" · "}
                <button type="button" className="wb-link" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {open === c.id ? "Свернуть" : "Участие и записи"}
                </button>
              </span>
              {open === c.id && (
                <div className="campaign-world__card">
                  <HeroCard campaignId={campaignId} campaign={campaign} character={c} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HeroCard({ campaignId, campaign, character }: { campaignId: number; campaign: CampaignDetail; character: Character }) {
  const records = useOwnerRecords(campaignId, "character", character.id);
  return (
    <>
      <CampaignParticipation characterId={character.id} campaignId={campaignId} campaignName={campaign.name} />
      <CampaignRecords
        campaignId={campaignId}
        settingId={campaign.setting_id}
        ownerType="character"
        ownerId={character.id}
        chains={records}
        title="Записи персонажа"
        aspects={CHARACTER_ASPECTS}
        emptyKeys={CHARACTER_ASPECTS.filter((k) => k !== "note")}
      />
    </>
  );
}

/** Лист 4: общие основания группы — записи кампании по пяти графам. */
export function GroupGroundsView({ campaignId, title }: { campaignId: number; title: string }) {
  const campaign = useResource<CampaignDetail>(campaignPaths.detail(campaignId)).data;
  const records = useOwnerRecords(campaignId, "campaign", campaignId);
  if (!campaign) return <p className="muted">Открываем кампанию…</p>;
  return (
    <section className="wb-profile">
      <CampaignRecords
        campaignId={campaignId}
        settingId={campaign.setting_id}
        ownerType="campaign"
        ownerId={campaignId}
        chains={records}
        title={title}
        aspects={GROUND_ASPECTS}
        emptyKeys={GROUND_ASPECTS}
      />
    </section>
  );
}

