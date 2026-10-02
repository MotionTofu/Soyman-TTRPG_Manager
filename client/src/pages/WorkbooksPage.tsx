import {useRef,useState} from "react";
import {Link,useNavigate} from "react-router-dom";
import {useAction,useResource,write} from "../data/hooks";
import {readOnce} from "../data/imperative";
import {PageFrame} from "../components/PageFrame";
import {Modal} from "../components/Modal";
import {WORKBOOK_AFFECTS,downloadWorkbook,type InstanceSummary,type TemplateSummary} from "../components/workbooks/model";
import type {LibraryDepartment,LibraryShelf,LibraryCatalog} from "../components/mastering/libraryTypes";
import "./workbook.css";

/** Раздел «Тетради» (макет «Пустые состояния», разбор Q13): мои тетради и шаблоны. */
export function WorkbooksPage(){
 const run=useAction(),navigate=useNavigate(),[tab,setTab]=useState<"mine"|"templates">("mine"),[archived,setArchived]=useState(false),[error,setError]=useState("");
 const [creating,setCreating]=useState<number|null|"pick">(null),[placement,setPlacement]=useState<InstanceSummary|null>(null);
 const upload=useRef<HTMLInputElement>(null);
 const templates=useResource<TemplateSummary[]>("/workbooks/templates"),instances=useResource<InstanceSummary[]>(`/workbooks/instances${archived?"?archived=1":""}`);
 // Шаблон — последняя версия каждого ключа; старые версии видны в «Версии шаблонов».
 const latest=(templates.data??[]).filter(t=>!t.archived_at).filter((t,i,all)=>all.findIndex(o=>o.template_key===t.template_key)===i);
 async function importFile(file:File|undefined){if(!file)return;setError("");try{if(file.size>4*1024*1024)throw new Error("Файл шаблона или тетради должен быть до 4 МБ");const text=await file.text();if(/\.md$/i.test(file.name)){await run(()=>write.post("/workbooks/templates",{markdown:text}),{affects:WORKBOOK_AFFECTS,retry:false});setTab("templates");return;}const data=JSON.parse(text);await run(()=>write.post(data.format==="soyman-workbook"?"/workbooks/templates":"/workbooks/import",data),{affects:WORKBOOK_AFFECTS,retry:false});}catch(e){setError((e as Error).message);}}
 const uploadButton=<><button type="button" className="wb-link workbooks-upload" onClick={()=>upload.current?.click()}>Загрузить шаблон из Markdown</button><input ref={upload} className="sr-only" type="file" accept=".md,.json" aria-label="Файл шаблона (.md) или тетради (.json)" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value="";}}/></>;
 const actions=<div className="workbooks-actions"><button type="button" className="primary" disabled={!latest.length} onClick={()=>setCreating("pick")}>Начать тетрадь</button>{uploadButton}</div>;
 return <PageFrame title="Тетради" actions={actions}>
  <Link to="/mastering">← Библиотека</Link>
  {error&&<p role="alert">{error}</p>}{(templates.error||instances.error)&&<p role="alert">{templates.error||instances.error}</p>}
  <div className="workbooks-tabs" role="tablist" aria-label="Тетради и шаблоны">
   <button type="button" role="tab" aria-selected={tab==="mine"} className={tab==="mine"?"primary":""} onClick={()=>setTab("mine")}>Мои тетради</button>
   <button type="button" role="tab" aria-selected={tab==="templates"} className={tab==="templates"?"primary":""} onClick={()=>setTab("templates")}>Шаблоны · {latest.length}</button>
  </div>
  {tab==="mine"?<>
   {instances.data&&!instances.data.length&&!archived?<div className="workbooks-empty"><span className="workbooks-empty__art" aria-hidden="true"/><h2>Тетрадей пока нет</h2><p>{latest.length?"Начни тетрадь по шаблону курса — она пойдёт рядом с книгами полки.":"Сначала загрузи шаблон — рабочую тетрадь курса в Markdown. Потом начни по нему тетрадь."}</p><div className="workbooks-actions">{latest.length>0&&<button type="button" className="primary" onClick={()=>setCreating("pick")}>Начать по шаблону</button>}{uploadButton}</div><p><a href="/workbook-example.md" download>Пример шаблона</a> · <a href="/workbook-author-guide.md" download>Как сделать шаблон</a></p></div>
   :<div className="workbooks-grid">{instances.data?.map(i=>{const p=i.progress??{total:0,filled:0};return <article key={i.id} className="workbook-tile paper-scope">
     <h3><Link to={`/workbooks/${i.id}`}>{i.title}</Link></h3>
     <span className="workbook-tile__meta">{i.template_title} · версия {i.template_version}{i.sheets?` · листов ${i.sheets}`:""}</span>
     <progress className="workbook-tile__bar" max={Math.max(1,p.total)} value={p.filled} aria-label={`Готовность ${p.filled} из ${p.total}`}/>
     <span className="workbook-tile__meta">Готовность {p.filled} из {p.total}</span>
     <div className="workbook-tile__actions">{!archived&&<button type="button" className="wb-link" onClick={()=>setPlacement(i)}>На полку</button>}<button type="button" className="wb-link" onClick={()=>{void run(()=>write.put(`/workbooks/instances/${i.id}`,{revision:i.revision,archived:!archived}),{affects:WORKBOOK_AFFECTS});}}>{archived?"Вернуть из архива":"В архив"}</button></div>
    </article>;})}</div>}
   <label className="row"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Показать архив</label>
  </>:<>
   {latest.length?<div className="workbooks-grid">{latest.map(t=><article key={t.id} className="workbook-tile paper-scope"><h3>{t.title}</h3><span className="workbook-tile__meta">версия {t.version}</span><div className="workbook-tile__actions"><button type="button" className="wb-link" onClick={()=>setCreating(t.id)}>Начать тетрадь</button></div></article>)}</div>
   :<div className="workbooks-empty"><span className="workbooks-empty__art" aria-hidden="true"/><h2>Шаблонов пока нет</h2><p>Шаблон — рабочая тетрадь курса в Markdown, как она написана. Загрузи файл — листы и графы SoyMan найдёт сам.</p>{uploadButton}<p><a href="/workbook-example.md" download>Пример шаблона</a> · <a href="/workbook-author-guide.md" download>Как сделать шаблон</a></p></div>}
   <details><summary>Версии шаблонов и архив</summary>{templates.data?.map(t=><div className="card row" key={t.id}><span>{t.title} · {t.version}{t.archived_at?" · архив":""}</span><button onClick={async()=>{const data=await readOnce(`/workbooks/templates/${t.id}`);downloadWorkbook(`${t.template_key}-v${t.version}.json`,JSON.stringify(data,null,2));}}>Скачать</button><button onClick={()=>{void run(()=>write.put(`/workbooks/templates/${t.id}/archive`,{archived:!t.archived_at}),{affects:WORKBOOK_AFFECTS});}}>{t.archived_at?"Восстановить":"В архив"}</button></div>)}</details>
  </>}
  {creating!==null&&<NewWorkbook templates={latest} initial={creating==="pick"?null:creating} onClose={()=>setCreating(null)} onCreated={id=>navigate(`/workbooks/${id}`)}/>}
  {placement&&<Placement workbook={placement} onClose={()=>setPlacement(null)} onError={setError}/>}
 </PageFrame>;
}

function NewWorkbook({templates,initial,onClose,onCreated}:{templates:TemplateSummary[];initial:number|null;onClose:()=>void;onCreated:(id:number)=>void}){
 const run=useAction(),[templateId,setTemplateId]=useState(initial?String(initial):templates.length===1?String(templates[0].id):""),[title,setTitle]=useState("");
 const [projectType,setProjectType]=useState(""),[projectId,setProjectId]=useState("");
 const projects=useResource<{id:number;name:string}[]>(projectType?`/workbooks/projects/${projectType}`:null);
 async function create(){const result=await run(()=>write.post<{id:number}>("/workbooks/instances",{template_id:Number(templateId),title:title.trim(),project_type:projectType||null,project_id:projectId?Number(projectId):null}),{affects:WORKBOOK_AFFECTS,retry:false});if(result)onCreated(result.id);}
 return <Modal ariaLabel="Новая тетрадь" onClose={onClose}><div className="stack"><h2>Новая тетрадь</h2>
  <label>Шаблон<select value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">Выбрать</option>{templates.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
  <label>Название<input value={title} placeholder="Например, Ваншот «Маяк»" onChange={e=>setTitle(e.target.value)}/></label>
  <label>Для чего<select value={projectType} onChange={e=>{setProjectType(e.target.value);setProjectId("");}}><option value="">Просто тетрадь</option><option value="campaign">Кампания</option><option value="setting">Сеттинг</option><option value="adventure">Приключение</option></select></label>
  {projectType&&<select aria-label="Проект" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Выбрать</option>{projects.data?.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>}
  <button className="primary" disabled={!title.trim()||!templateId||!!projectType&&!projectId} onClick={()=>void create()}>Начать</button>
 </div></Modal>;
}

function Placement({workbook,onClose,onError}:{workbook:InstanceSummary;onClose:()=>void;onError:(message:string)=>void}){
 const run=useAction(),[department,setDepartment]=useState(""),[shelf,setShelf]=useState("");
 const departments=useResource<LibraryDepartment[]>("/book-library/departments"),shelves=useResource<LibraryShelf[]>("/book-library/shelves");
 async function place(){try{const result=await readOnce<LibraryCatalog>(`/book-library/books?source_type=workbook&source_id=${workbook.id}&include_unplaced=1`);const book=result.books[0];if(!book)throw new Error("Тетрадь не найдена");const saved=await run(()=>write.put(`/book-library/books/${book.id}`,{department_id:department?Number(department):null,shelf_id:shelf?Number(shelf):null}),{affects:WORKBOOK_AFFECTS});if(saved!==undefined)onClose();}catch(e){onError((e as Error).message);}}
 return <Modal ariaLabel="Тетрадь на полке" onClose={onClose}><div className="stack"><h2>{workbook.title} — на полку</h2>
  <label>Подраздел<select value={department} onChange={e=>{setDepartment(e.target.value);setShelf("");}}><option value="">Без подраздела</option>{departments.data?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  <label>Полка<select value={shelf} onChange={e=>setShelf(e.target.value)}><option value="">Без полки</option>{shelves.data?.filter(s=>s.department_id===(department?Number(department):null)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  <button className="primary" onClick={()=>void place()}>Поставить</button>
 </div></Modal>;
}
