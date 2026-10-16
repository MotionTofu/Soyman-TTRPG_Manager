import { useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { readOnce } from "../../data/imperative";
import { syncMentionLinks } from "../../mentions";
import { PASSPORT_FIELDS, PASSPORT_NOT_THIS } from "../../settingWorld";
import type { CampaignDetail, Setting, StoryArcDetail } from "../../types";
import { PaperFieldsCard } from "../PaperFieldsCard";
import { CampaignPassport } from "../campaign/CampaignPassport";
import { AdventureHead, AdventureParticipants, PassportCard } from "../adventure/AdventureDossier";
import { SettingWorldTab } from "../setting/SettingWorldTab";
import {CampaignSecrets} from "../CampaignSecrets";
import {MentionText} from "../mentions/MentionText";
import { WorkbookContext } from "./model";
import { CampaignEntitiesView, CampaignHeroesView, CampaignKnowledgeView, CampaignSessionReviewView, GroupGroundsView, WorldMomentView } from "./WorkbookCampaignViews";
import type { WorkbookField } from "@shared/workbooks";
import "../../pages/setting-profile.css";


/** The notebook opens the existing model editors; it never copies profile data into answers. */
export function WorkbookProfile({field}:{field:WorkbookField}) {
  const context=useContext(WorkbookContext),doc=context?.document;
  const categories=useMemo(()=>[field.entity!],[field.entity]);
  // У вида тетради кампании подсказка листа — над живыми данными (например, как отмечать интерес игрока).
  const withHint=(view:ReactNode)=><>{field.hint&&<small className="wb-hint">{field.hint}</small>}{view}</>;
  if(!doc?.project_type||!doc.project_id)return <p className="muted">Свяжите тетрадь с проектом, чтобы открыть {field.label.toLowerCase()}.</p>;
  // Виды тетради кампании v4 (спека workbook-rework): живые данные кампании, копии в ответах нет.
  if(field.entity==="places"||field.entity==="sides")return doc.project_type==="campaign"?withHint(<CampaignEntitiesView campaignId={doc.project_id} view={field.entity} title={field.label}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="heroes")return doc.project_type==="campaign"?withHint(<CampaignHeroesView campaignId={doc.project_id} title={field.label}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="group_grounds")return doc.project_type==="campaign"?withHint(<GroupGroundsView campaignId={doc.project_id} title={field.label}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="knowledge")return doc.project_type==="campaign"?withHint(<CampaignKnowledgeView campaignId={doc.project_id} title={field.label}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="world_moment")return doc.project_type==="campaign"?withHint(<WorldMomentView campaignId={doc.project_id} title={field.label}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="session_review")return doc.project_type==="campaign"?withHint(<CampaignSessionReviewView campaignId={doc.project_id}/>):<p className="muted">Этот раздел — в тетради кампании.</p>;
  if(field.entity==="passport")return <ProjectPassport type={doc.project_type} id={doc.project_id}/>;
  if(field.entity==="information")return <Information type={doc.project_type} id={doc.project_id}/>;
  if(field.entity==="participants")return doc.project_type==="adventure"?<Participants id={doc.project_id}/>:<p className="muted">Участия сил открываются из профиля приключения.</p>;
  if(doc.project_type!=="setting")return <p className="muted">Записи мира доступны в тетради сеттинга.</p>;
  return <section className="wb-profile"><h3>{field.label}</h3><SettingWorldTab settingId={doc.project_id} categories={categories}/></section>;
}

function Information({type,id}:{type:string;id:number}) {
 const query=useResource<CampaignDetail|StoryArcDetail>(type==="adventure"?`/story/arcs/${id}`:type==="campaign"?`/campaigns/${id}`:null);
 if(query.error)return <p role="alert">{query.error}</p>;
 if(!query.data)return <p className="muted">Открываем информацию…</p>;
 if(type==="campaign")return <CampaignSecrets campaignId={id} settingId={(query.data as CampaignDetail).setting_id}/>;
 const arc=query.data as StoryArcDetail;
 return <section className="wb-profile"><h3>Тайны приключения</h3><ul className="paper-rows">{arc.secrets.map(secret=><li key={secret.id}><strong>{secret.title}</strong>{secret.content&&<MentionText text={secret.content}/>}</li>)}</ul>
  <Link className="paper-more" to={`/adventures/${id}`}>Открыть профиль приключения и редактировать тайны →</Link>
 </section>;
}

function Participants({id}:{id:number}) {
  const query=useResource<StoryArcDetail>(`/story/arcs/${id}`);
  if(query.error)return <p role="alert">{query.error}</p>;
  return query.data?<AdventureParticipants arcId={id} settingId={query.data.setting_id}/>:<p>Открываем участников…</p>;
}

function ProjectPassport({type,id}:{type:string;id:number}) {
  const path=type==="adventure"?`/story/arcs/${id}`:`/${type==="campaign"?"campaigns":"settings"}/${id}`;
  const query=useResource<CampaignDetail|Setting|StoryArcDetail>(path),run=useAction();
  const [saveError,setSaveError]=useState("");
  const value=query.data;
  if(query.error)return <p role="alert">{query.error}</p>;
  if(!value)return <p>Открываем паспорт…</p>;
  if(type==="campaign")return <CampaignPassport campaign={value as CampaignDetail}/>;
  const passport:Record<string,string>=Object.fromEntries(Object.entries(value.passport??{}).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
  async function save(patch:Record<string,unknown>) {
   setSaveError("");try{
    // Preserve fields that another profile editor updated while this sheet was open.
    const current=await readOnce<Setting|StoryArcDetail>(path);
    const changes:Record<string,string>={};
    for(const [key,value] of Object.entries((patch.passport??{}) as Record<string,string>)){
      if(value===(passport[key]??""))continue;
      const live=(current.passport as Record<string,unknown>|undefined)?.[key]??"";
      if(live!==(passport[key]??"")&&live!==value)throw new Error("Это поле паспорта изменилось в другом окне. Ваш текст остаётся в редакторе.");
      changes[key]=value;
    }
    const header:Record<string,unknown>={};
    if(type==="adventure")for(const key of ["recommended_level","player_count","duration"] as const){
      const original=(value as StoryArcDetail)[key],live=(current as StoryArcDetail)[key],desired=patch[key];
      if(desired===undefined||desired===original)continue;
      if(live!==original&&live!==desired)throw new Error("Это поле приключения изменилось в другом окне. Ваш текст остаётся в редакторе.");
      header[key]=desired;
    }
    const next={...header,passport:{...current.passport,...changes}};
    const done=await run(()=>write.put(path,type==="setting"?{passport:next.passport}:next).then(()=>true),{
      affects:[{kind:type==="setting"?"setting":"adventure",id},{path}],
    });
    if(!done)throw new Error("Паспорт не сохранился");
    if(type==="setting")void syncMentionLinks("setting",id,Object.values(current.passport??{}).flat().join("\n"),Object.values(next.passport).flat().join("\n"));
   }catch(e){setSaveError((e as Error).message);throw e;}
  }
  return <section className="wb-profile">
    {saveError&&<p role="alert">{saveError}</p>}
    <Link className="paper-more" to={`/${type==="setting"?"settings":"adventures"}/${id}`}>Профиль «{value.name}» ›</Link>
    {type==="setting"?<PaperFieldsCard label="Паспорт" fields={[...PASSPORT_FIELDS,PASSPORT_NOT_THIS]} values={passport} empty="Запишите обещание и исходную ситуацию" mentionSettingId={id} onSave={next=>save({passport:next})}/>
      :<><AdventureHead arc={value as StoryArcDetail} passport={passport} inCampaign={false} onSave={save}/><PassportCard passport={passport} onSave={save}/></>}
  </section>;
}
