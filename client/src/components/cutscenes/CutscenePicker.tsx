import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { cutscenePaths, cutsceneRoute, type CutsceneSummary } from "../../data/cutscenes";
import type { CutsceneBindingContext } from "../../data/cutsceneBindings";
import { Modal } from "../Modal";
import { LoadErrorCard, ListSkeleton } from "../Loadable";
import { CutsceneCover } from "./CutsceneCover";
import { CutsceneLaunchActions } from "./CutsceneLaunchActions";
import "../../pages/cutscenes.css";
import "./cutscene-bindings.css";

/** One global catalogue for both a collection and a session plan; campaign membership is not a filter. */
export function CutscenePicker({ context, mode, existingIds=[], onAdd, onClose }: {
  context: CutsceneBindingContext; mode: "add"|"launch"; existingIds?: readonly number[];
  onAdd?: (id:number)=>Promise<boolean>; onClose:()=>void;
}) {
  const [search,setSearch]=useState(''),[busy,setBusy]=useState<number|null>(null);
  const list=useResource<CutsceneSummary[]>(cutscenePaths.catalog({search,campaignId:null,archive:'active',sort:'name',order:'asc'}));
  const title=mode==='launch'?'Другая катсцена':context.kind==='campaign'?'Добавить в подборку':'Добавить в план';
  async function add(id:number){setBusy(id);try{if(await onAdd?.(id))onClose();}finally{setBusy(null);}}
  return <Modal ariaLabel={title} className="cs-picker" closeOnBackdropClick={false} onClose={()=>{if(busy===null)onClose();}}>
    <h2>{title}</h2><p className="reading-text">{mode==='launch'?'Выберите материал из общей мастерской. Запуск не добавляет его в план.':'Добавляется ссылка на общий оригинал. Подборка кампании и план сессии независимы.'}</p>
    <label>Поиск катсцен<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Название или описание…" /></label>
    {list.error&&<LoadErrorCard message={`Не удалось загрузить катсцены: ${list.error}`} onRetry={list.reload}/>}
    {list.loading?<ListSkeleton variant="rows"/>:<ul className="cs-bindings__list">{list.data?.map(item=>{
      const exists=existingIds.includes(item.id);
      return <li key={item.id}><CutsceneCover id={item.id} savedVersion={item.savedVersion}/><div className="cs-bindings__copy"><strong>{item.name}</strong>{item.description&&<p>{item.description}</p>}
        <Link to={cutsceneRoute(item.id)} onClick={onClose}>Открыть в мастерской</Link></div><div className="cs-bindings__actions">
        {mode==='launch'?<CutsceneLaunchActions id={item.id} name={item.name} context={context} onStarted={onClose}/>
          :<button type="button" disabled={exists||busy!==null} aria-label={exists?`Катсцена «${item.name}» уже добавлена`:`Добавить катсцену «${item.name}»`} onClick={()=>void add(item.id)}>{exists?'Уже добавлена':busy===item.id?'Добавление…':'Добавить'}</button>}
      </div></li>;
    })}</ul>}
    {!list.loading&&!list.error&&!list.data?.length&&<p className="muted">Катсцен по этому запросу нет.</p>}
    <button type="button" disabled={busy!==null} onClick={onClose}>Закрыть</button>
  </Modal>;
}
