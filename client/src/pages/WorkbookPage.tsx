import {useEffect,useRef,useState} from "react";
import {Link,useParams,useSearchParams} from "react-router-dom";
import {useResource,write} from "../data/hooks";
import {readOnce} from "../data/imperative";
import {PageFrame} from "../components/PageFrame";
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
function WorkbookEditor({id,popout}:{id:string;popout:boolean}){
 const [params,setParams]=useSearchParams(),editor=useWorkbookEditor(id);
 // Разворот или одна страница — по месту под тетрадь, а не по окну: боковые панели съедают ширину.
 const box=useRef<HTMLDivElement>(null),[narrow,setNarrow]=useState(false);
 const loaded=!!editor.document;
 useEffect(()=>{const el=box.current;if(!el)return;const ro=new ResizeObserver(([e])=>setNarrow(e.contentRect.width<880));ro.observe(el);return()=>ro.disconnect();},[loaded]);
 const {document,answers,conflict,error,status}=editor;
 const [upgrade,setUpgrade]=useState(false);
 if(editor.query.error&&!document)return <LoadErrorCard message={editor.query.error} onRetry={editor.query.reload}/>;
 if(!document)return <p>Открываем тетрадь…</p>;
 const template=document.template,sheetKey=params.get("sheet");
 const saved=status===""||status==="Сохранено";
 const actions=<div className="wb-toolbar">
  <span className="wb-template">по шаблону «{template.title}»</span>
  <span className={`wb-status${saved?"":" is-pending"}`}><span aria-hidden="true"/>{status||"Сохранено"}</span>
  {!popout&&<button type="button" onClick={()=>openSecondWindow(`/workbook-window/${id}?sheet=${sheetKey??""}`)}>Отдельное окно</button>}
  <details className="wb-menu"><summary>Ещё</summary><div className="wb-menu__list">
   <button type="button" onClick={()=>downloadWorkbook(`${document.title}.md`,workbookMarkdown(template,document.title,answers),"text/markdown")}>Экспорт в Markdown</button>
   <button type="button" disabled={editor.dirty()} onClick={async()=>{try{const bundle=await readOnce(`/workbooks/instances/${id}/export`);downloadWorkbook(`${document.title}.workbook.json`,JSON.stringify(bundle,null,2));}catch(e){editor.setError((e as Error).message);}}}>Экспорт с шаблоном</button>
   <button type="button" disabled={editor.dirty()} onClick={()=>setUpgrade(!upgrade)}>Версии шаблона</button>
   {document.project_type&&document.project_id&&<Link to={`/${PROJECT_PATHS[document.project_type]}/${document.project_id}`}>Связанный проект</Link>}
  </div></details>
  {!popout&&<Link className="wb-close" to="/workbooks" aria-label="Закрыть тетрадь" title="К тетрадям"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></Link>}
 </div>;
 const content=<div ref={box} className={`workbook${popout?" workbook--popout":""}`}>
  {popout&&<header className="wb-popout-head"><strong>{document.title}</strong>{actions}</header>}
  {error&&<div className="workbook-error" role="alert"><p>{error}</p>{!conflict&&<button onClick={()=>void editor.retry().catch(e=>editor.setError(e.message))}>Повторить сохранение</button>}</div>}
  {conflict&&<div className="card stack"><h2>Объединение ответов</h2><p>Разные поля объединятся автоматически. Для совпадающих выбери ответ.</p>{conflict.merge.conflicts.map(c=><label key={`${c.sheet}/${c.field}`}>{template.sheets.find(s=>s.key===c.sheet)?.fields.find(f=>f.key===c.field)?.label??`${c.sheet}/${c.field}`}<select onChange={e=>{const result=structuredClone(conflict.merge.answers);result[c.sheet][c.field]=e.target.value==="mine"?c.mine:c.theirs;editor.setConflict({...conflict,merge:{...conflict.merge,answers:result}});}}><option value="mine">Из этого окна: {JSON.stringify(c.mine)?.slice(0,150)}</option><option value="theirs">Из другого окна: {JSON.stringify(c.theirs)?.slice(0,150)}</option></select></label>)}<button className="primary" onClick={editor.resolve}>Сохранить объединённые ответы</button><button onClick={()=>downloadWorkbook(`${document.title}-несохранённое.json`,JSON.stringify({template,answers:editor.current()},null,2))}>Скачать мою копию</button></div>}
  {upgrade&&<UpgradePanel doc={document} answers={answers} dirty={editor.dirty()} onDone={saved=>{setUpgrade(false);editor.replace(saved);}} onError={editor.setError}/>}
  <WorkbookBook doc={document} answers={answers} change={editor.change} sheetKey={sheetKey} onSheet={key=>setParams({sheet:key})} single={narrow} disabled={!!conflict||!!document.archived_at}/>
 </div>;
 return popout?content:<PageFrame title={document.title} actions={actions} className="workbook-page">{content}</PageFrame>;
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
