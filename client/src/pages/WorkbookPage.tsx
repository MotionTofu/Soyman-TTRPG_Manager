import {useEffect,useRef,useState} from "react";
import {Link,useParams,useSearchParams} from "react-router-dom";
import {useResource,write} from "../data/hooks";
import {readOnce} from "../data/imperative";
import {PageFrame} from "../components/PageFrame";
import {Modal} from "../components/Modal";
import {LoadErrorCard} from "../components/Loadable";
import {WorkbookBook} from "../components/workbooks/WorkbookBook";
import {useWorkbookEditor} from "../components/workbooks/useWorkbookEditor";
import {downloadWorkbook,type WorkbookInstance,type TemplateSummary} from "../components/workbooks/model";
import {workbookMarkdown,suggestWorkbookMapping,type WorkbookTemplate} from "@shared/workbooks";
import {openSecondWindow} from "../electronApi";
import "./workbook.css";

const PROJECT_PATHS={campaign:"campaigns",setting:"settings",adventure:"adventures"} as Record<string,string>;
const filled=(v:unknown)=>v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length>0);

export function WorkbookPage({popout=false}:{popout?:boolean}){const {id}=useParams();return <WorkbookEditor key={id} id={id!} popout={popout}/>;}
export function EmbeddedWorkbook({id}:{id:number}){return <WorkbookEditor key={id} id={String(id)} popout={false} embedded/>;}
function WorkbookEditor({id,popout,embedded=false}:{id:string;popout:boolean;embedded?:boolean}){
 const [params,setParams]=useSearchParams(),editor=useWorkbookEditor(id);
 // Разворот или одна страница — по месту под тетрадь, а не по окну: боковые панели съедают ширину.
 const box=useRef<HTMLDivElement>(null),[narrow,setNarrow]=useState(false);
 const loaded=!!editor.document;
 useEffect(()=>{const el=box.current;if(!el)return;const ro=new ResizeObserver(([e])=>setNarrow(e.contentRect.width<700));ro.observe(el);return()=>ro.disconnect();},[loaded]);
 const {document,answers,conflict,error,status}=editor;
 const [upgrade,setUpgrade]=useState(false);
 const [importing,setImporting]=useState(false),[source,setSource]=useState("");
 const [binding,setBinding]=useState(false),[bindingBusy,setBindingBusy]=useState(false);
 const sources=useResource<{id:number;title:string;lines:number}[]>(editor.document?.project_type==="campaign"?`/workbooks/instances/${id}/activity-sources`:null);
 if(editor.query.error&&!document)return <LoadErrorCard message={editor.query.error} onRetry={editor.query.reload}/>;
 if(!document)return <p>Открываем тетрадь…</p>;
 const template=document.template,sheetKey=params.get("sheet");
 const saved=status===""||status==="Сохранено";
 async function takePlans(){
  if(editor.dirty()||!source)return;
  setImporting(true);try{const result=await write.post<{added:number;instance:WorkbookInstance}>(`/workbooks/instances/${id}/activity-import`,{revision:document!.revision,source_id:Number(source)});editor.replace(result.instance);setSource("");}
  catch(e){editor.setError((e as Error).message);}finally{setImporting(false);}
 }
 // Шаблон и сохранность — строкой под названием (макет Camp-Workbook), в окне страницы — рядом с действиями.
 const meta=<><span className="wb-template">по шаблону «{template.title}»</span>
  <span className={`wb-status${saved?"":" is-pending"}`}><span aria-hidden="true"/>{status||"Сохранено"}</span></>;
 const actions=<div className="wb-toolbar">
  {!popout&&!embedded&&meta}
  {!popout&&<button type="button" className="d-btn d-btn--sm" onClick={()=>openSecondWindow(`/workbook-window/${id}?sheet=${sheetKey??""}`)}>Отдельное окно</button>}
  <details className="wb-menu"><summary>Ещё</summary><div className="wb-menu__list">
   <button type="button" onClick={()=>downloadWorkbook(`${document.title}.md`,workbookMarkdown(template,document.title,answers,{type:document.project_type,id:document.project_id}),"text/markdown")}>Экспорт в Markdown</button>
   <button type="button" disabled={editor.dirty()} onClick={async()=>{try{const bundle=await readOnce(`/workbooks/instances/${id}/export`);downloadWorkbook(`${document.title}.workbook.json`,JSON.stringify(bundle,null,2));}catch(e){editor.setError((e as Error).message);}}}>Экспорт с шаблоном</button>
   <button type="button" disabled={editor.dirty()||importing||bindingBusy} onClick={()=>setUpgrade(!upgrade)}>Версии шаблона</button>
   <button type="button" disabled={editor.dirty()||importing||bindingBusy||!!document.archived_at} onClick={()=>setBinding(true)}>{document.project_type?"Изменить связанный проект":"Связать с проектом"}</button>
   {document.project_type&&document.project_id&&<Link to={`/${PROJECT_PATHS[document.project_type]}/${document.project_id}`}>Связанный проект</Link>}
  </div></details>
  {!popout&&!embedded&&<Link className="wb-close" to="/workbooks" aria-label="Закрыть тетрадь" title="К тетрадям"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></Link>}
 </div>;
 const content=<div ref={box} className={`workbook${popout?" workbook--popout":""}${embedded?" workbook--embedded":""}`}>
  {(popout||embedded)&&<header className="wb-popout-head"><div><strong>{document.title}</strong><div className="wb-meta">{meta}</div></div>{actions}</header>}
  {error&&<div className="workbook-error" role="alert"><p>{error}</p>{!conflict&&<button onClick={()=>void editor.retry().catch(e=>editor.setError(e.message))}>Повторить сохранение</button>}</div>}
  {conflict&&<div className="card stack"><h2>Объединение ответов</h2><p>Разные поля объединятся автоматически. Для совпадающих выбери ответ.</p>{conflict.merge.conflicts.map(c=><label key={`${c.sheet}/${c.field}`}>{template.sheets.find(s=>s.key===c.sheet)?.fields.find(f=>f.key===c.field)?.label??`${c.sheet}/${c.field}`}<select onChange={e=>{const result=structuredClone(conflict.merge.answers);result[c.sheet][c.field]=e.target.value==="mine"?c.mine:c.theirs;editor.setConflict({...conflict,merge:{...conflict.merge,answers:result}});}}><option value="mine">Из этого окна: {JSON.stringify(c.mine)?.slice(0,150)}</option><option value="theirs">Из другого окна: {JSON.stringify(c.theirs)?.slice(0,150)}</option></select></label>)}<button className="primary" onClick={editor.resolve}>Сохранить объединённые ответы</button><button onClick={()=>downloadWorkbook(`${document.title}-несохранённое.json`,JSON.stringify({template,answers:editor.current()},null,2))}>Скачать мою копию</button></div>}
  {upgrade&&<UpgradePanel doc={document} answers={answers} dirty={editor.dirty()||importing||bindingBusy} onDone={saved=>{setUpgrade(false);editor.replace(saved);}} onError={editor.setError}/>}
  {binding&&<ProjectBinding doc={document} onBusy={setBindingBusy} onClose={()=>setBinding(false)} onDone={saved=>{editor.replace(saved);setBinding(false);setSource("");}}/>}
  {sources.data?.length&&template.sheets.some(s=>s.key==="activity")?<details className="card stack"><summary>Тетради приключений</summary>{sources.data.map(s=><p key={s.id}><Link to={`/workbooks/${s.id}`}>{s.title} →</Link> · линий: {s.lines}</p>)}
   <label>Планы НПЦ<select value={source} onChange={e=>setSource(e.target.value)} disabled={importing}><option value="">Выбрать тетрадь</option>{sources.data.filter(s=>s.lines>0).map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
   <p className="muted">Линии добавятся к этому проведению с начального состояния. Авторская заготовка сохранится.</p>
   <button type="button" disabled={!source||editor.dirty()||importing||bindingBusy||!!document.archived_at||!!conflict} onClick={()=>void takePlans()}>{importing?"Добавляем…":"Взять планы в это проведение"}</button>
  </details>:null}
  <WorkbookBook doc={document} answers={answers} change={editor.change} sheetKey={sheetKey} onSheet={key=>setParams(previous=>{const next=new URLSearchParams(previous);next.set("sheet",key);return next;})} single={narrow} disabled={!!conflict||!!document.archived_at||importing||binding}/>
 </div>;
 return popout||embedded?content:<PageFrame title={document.title} actions={actions} className="workbook-page">{content}</PageFrame>;
}

function ProjectBinding({doc,onBusy,onClose,onDone}:{doc:WorkbookInstance;onBusy:(value:boolean)=>void;onClose:()=>void;onDone:(saved:WorkbookInstance)=>void}) {
 const [type,setType]=useState(doc.project_type??""),[id,setId]=useState(doc.project_id?String(doc.project_id):""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const projects=useResource<{id:number;name:string}[]>(type?`/workbooks/projects/${type}`:null);
 async function save(){setBusy(true);onBusy(true);try{onDone(await write.put<WorkbookInstance>(`/workbooks/instances/${doc.id}`,{revision:doc.revision,project_type:type||null,project_id:type?Number(id):null}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
 return <Modal ariaLabel="Связанный проект" onClose={()=>{if(!busy)onClose();}}><div className="stack"><h2>Для какого проекта эта тетрадь</h2>
  <label>Проект<select value={type} disabled={busy} onChange={e=>{setType(e.target.value);setId("");}}><option value="">Самостоятельная тетрадь</option><option value="setting">Сеттинг</option><option value="adventure">Приключение</option><option value="campaign">Кампания</option></select></label>
  {type&&<label>Название<select value={id} disabled={busy} onChange={e=>setId(e.target.value)}><option value="">Выбрать</option>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
  <p className="muted">Связанные карточки откроются из выбранного проекта. Записи тетради сохранятся.</p>
  {(error||projects.error)&&<p role="alert">{error||projects.error}</p>}<button type="button" className="primary" disabled={busy||!!type&&!id} onClick={()=>void save()}>{busy?"Сохраняем…":"Сохранить связь"}</button>
 </div></Modal>;
}

/** Новая версия шаблона: только заполненные графы, сопоставление подставлено по названиям. */
function UpgradePanel({doc,answers,dirty,onDone,onError}:{doc:WorkbookInstance;answers:WorkbookInstance["answers"];dirty:boolean;onDone:(saved:WorkbookInstance)=>void;onError:(message:string)=>void}){
 const template=doc.template,[version,setVersion]=useState(""),[mapping,setMapping]=useState<Record<string,string>>({});
 const versions=useResource<TemplateSummary[]>("/workbooks/templates"),next=useResource<WorkbookTemplate>(version?`/workbooks/templates/${version}`:null).data;
 useEffect(()=>{if(version&&next)setMapping(suggestWorkbookMapping(template,next,answers));},[version,next,template,answers]);
 const old=template.sheets.flatMap(s=>s.fields.filter(f=>filled(answers[s.key]?.[f.key])).map(f=>({path:`${s.key}/${f.key}`,label:`${s.title} · ${f.label}`})));
 async function apply(){try{onDone(await write.post<WorkbookInstance>(`/workbooks/instances/${doc.id}/upgrade`,{revision:doc.revision,template_id:Number(version),mapping}));}catch(e){onError((e as Error).message);}}
 return <div className="card stack wb-upgrade"><h2>Версии шаблона</h2><p>Обновление — только по твоему выбору. Ответ, которому не нашлось графы, останется на листе в «Прежних графах».</p>
  <label>Версия<select value={version} onChange={e=>setVersion(e.target.value)}><option value="">Выбрать версию</option>{versions.data?.filter(v=>v.template_key===template.key&&v.id!==doc.template_id).map(v=><option key={v.id} value={v.id}>{v.title} · {v.version}</option>)}</select></label>
  {next&&(old.length?<div className="stack">{old.map(o=><label key={o.path}>Ответ «{o.label}»<select value={mapping[o.path]??""} onChange={e=>{const m={...mapping};if(e.target.value)m[o.path]=e.target.value;else delete m[o.path];setMapping(m);}}><option value="">Оставить в «Прежних графах»</option>{next.sheets.flatMap(s=>s.fields.filter(f=>f.type!=="heading"&&f.type!=="note").map(f=><option key={s.key+f.key} value={`${s.key}/${f.key}`}>{s.title} · {f.label}</option>))}</select></label>)}</div>:<p className="muted">Заполненных граф нет — переносить нечего.</p>)}
  <button className="primary" disabled={!version||!next||dirty} onClick={()=>void apply()}>Применить версию</button></div>;
}
