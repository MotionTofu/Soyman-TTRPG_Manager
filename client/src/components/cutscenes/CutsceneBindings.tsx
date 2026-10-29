import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentUser } from "../../api/currentUser";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useResource } from "../../data/hooks";
import { cutsceneBindings, cutsceneBindingsPath, type CutsceneBindingContext } from "../../data/cutsceneBindings";
import { CUTSCENE_CATALOG_ROUTE, cutsceneRoute, type CutsceneSummary } from "../../data/cutscenes";
import { useCutsceneAction } from "../../cutscenes/useCutsceneAction";
import { LoadErrorCard, ListSkeleton } from "../Loadable";
import { CutsceneCover } from "./CutsceneCover";
import { CutsceneLaunchActions } from "./CutsceneLaunchActions";
import { CutscenePicker } from "./CutscenePicker";
import "../../pages/cutscenes.css";
import "./cutscene-bindings.css";

// brief — блок подготовки сессии «Д» (макет Roll-Prep): плашка и «+ В план», без пояснения и ссылки на мастерскую.
function Bindings({context,mode='edit',brief}:{context:CutsceneBindingContext;mode?:'edit'|'launch';brief?:boolean}){
  const mobile=useIsMobile(),run=useCutsceneAction(),list=useResource<CutsceneSummary[]>(cutsceneBindingsPath(context));
  const [picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[drag,setDrag]=useState<number|null>(null);
  const rows=list.data??[],session=context.kind==='session',editable=mode==='edit'&&!mobile;
  // An empty session plan at the table falls back to the campaign collection; the data stay independent.
  const collection=useResource<CutsceneSummary[]>(mode==='launch'&&session&&list.data&&!list.data.length&&context.campaignId?cutsceneBindingsPath({kind:'campaign',campaignId:context.campaignId}):null);
  const fallback=collection.data??[];
  const title=session?'План катсцен':'Катсцены кампании';
  async function action(label:string,apply:()=>Promise<unknown>){setBusy(true);try{return await run(label,async()=>{await apply();return true;})===true;}finally{setBusy(false);}}
  const move=(id:number,target:number)=>action('Переставить катсцену',()=>cutsceneBindings.move(context,id,target));
  return <section className={`cs-bindings stack${mode==='launch'?' cs-bindings--pult':''}`} aria-label={title}>
    {brief?<header className="d-plate-row"><h2 className="d-plate">{title}</h2>
      {!mobile&&<button type="button" className="d-btn d-btn--sm d-end" disabled={busy||list.loading} onClick={()=>setPicker(true)}>+ В план</button>}</header>
    :<header className="cs-bindings__header">{mode==='launch'?<h3>{title}</h3>:<h2>{title}</h2>}
      <div className="cs-bindings__actions">{!mobile&&<button type="button" disabled={busy||list.loading} onClick={()=>setPicker(true)}>{mode==='launch'?'Другая катсцена':session?'Добавить в план':'Добавить катсцену'}</button>}
      <Link to={CUTSCENE_CATALOG_ROUTE}>Мастерская катсцен</Link></div></header>}
    {mode==='edit'&&!brief&&<p className="reading-text">{session?'Необязательный план быстрого запуска. Порядок задаётся вручную; следующая катсцена сама не начнётся.':'Общие оригиналы этой кампании. Их правки используются при следующем запуске.'}</p>}
    {list.error&&<LoadErrorCard message={`Не удалось загрузить ${session?'план катсцен':'подборку'}: ${list.error}`} onRetry={list.reload}/>}
    {list.loading?<ListSkeleton variant="rows"/>:<ol className="cs-bindings__list">{rows.map((item,index)=><li key={item.id} draggable={editable&&session&&!busy}
      onDragStart={()=>setDrag(item.id)} onDragEnd={()=>setDrag(null)} onDragOver={event=>{if(editable&&session&&!busy)event.preventDefault();}}
      onDrop={event=>{event.preventDefault();if(editable&&session&&!busy&&drag!==null){void move(drag,item.id);setDrag(null);}}}>
      <CutsceneCover id={item.id} savedVersion={item.savedVersion}/><div className="cs-bindings__copy"><Link to={cutsceneRoute(item.id)}><strong>{session?`${index+1}. `:''}{item.name}</strong></Link>
        {item.description&&<p>{item.description}</p>}{item.archivedAt&&<span className="muted">В архиве</span>}</div>
      <div className="cs-bindings__actions">{!mobile&&<CutsceneLaunchActions id={item.id} name={item.name} context={context}/>}
        {editable&&session&&<><button type="button" disabled={busy||index===0} aria-label={`Катсцена «${item.name}» выше`} onClick={()=>void move(item.id,rows[index-1].id)}>↑</button>
          <button type="button" disabled={busy||index===rows.length-1} aria-label={`Катсцена «${item.name}» ниже`} onClick={()=>void move(item.id,rows[index+1].id)}>↓</button></>}
        {editable&&<button type="button" disabled={busy} aria-label={`Убрать катсцену «${item.name}» ${session?'из плана':'из подборки'}`} onClick={()=>void action('Убрать ссылку на катсцену',()=>cutsceneBindings.remove(context,item.id))}>{session?'Убрать из плана':'Убрать из подборки'}</button>}
      </div>
    </li>)}</ol>}
    {!list.loading&&!list.error&&!rows.length&&<p className="muted">{mode==='launch'&&fallback.length?'В плане этой сессии катсцен нет.':session?'План пока пуст. Можно запускать любую катсцену из общей мастерской.':'Подборка пока пуста.'}</p>}
    {!rows.length&&!!fallback.length&&<><h4 className="cs-bindings__group">Из подборки кампании</h4><ol className="cs-bindings__list">{fallback.map(item=><li key={item.id}>
      <CutsceneCover id={item.id} savedVersion={item.savedVersion}/><div className="cs-bindings__copy"><Link to={cutsceneRoute(item.id)}><strong>{item.name}</strong></Link>{item.description&&<p>{item.description}</p>}</div>
      <div className="cs-bindings__actions">{!mobile&&<CutsceneLaunchActions id={item.id} name={item.name} context={context}/>}</div></li>)}</ol></>}
    {busy&&<p role="status">Сохраняется…</p>}
    {picker&&!mobile&&<CutscenePicker context={context} mode={mode==='launch'?'launch':'add'} existingIds={rows.map(row=>row.id)} onClose={()=>setPicker(false)}
      onAdd={id=>action('Добавить ссылку на катсцену',()=>cutsceneBindings.add(context,id))}/>}
  </section>;
}

/** No private collection reads for a player account, even if embedded outside the normal GM route. */
export function CutsceneBindings(props:{context:CutsceneBindingContext;mode?:'edit'|'launch';brief?:boolean}){
  const {user}=useCurrentUser();if(user?.role!=='gm')return null;return <Bindings key={cutsceneBindingsPath(props.context)} {...props}/>;
}
