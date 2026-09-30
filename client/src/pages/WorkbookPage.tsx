import {useCallback,useEffect,useRef,useState} from "react";
import {Link,useParams,useSearchParams} from "react-router-dom";
import {useAfterWrite,useResource,write} from "../data/hooks";
import {readOnce} from "../data/imperative";
import {getCachedUser} from "../api/currentUser";
import {PageFrame} from "../components/PageFrame";
import {LoadErrorCard} from "../components/Loadable";
import {MentionText} from "../components/mentions/MentionText";
import {WorkbookFieldInput} from "../components/workbooks/WorkbookFieldInput";
import {WORKBOOK_AFFECTS,downloadWorkbook,mergeWorkbookAnswers,type WorkbookInstance,type TemplateSummary} from "../components/workbooks/model";
import {workbookProgress,workbookMarkdown,type WorkbookAnswers,type WorkbookTemplate} from "@shared/workbooks";
import {openSecondWindow} from "../electronApi";
import "./workbook.css";

export function WorkbookPage({popout=false}:{popout?:boolean}){const {id}=useParams();return <WorkbookEditor key={id} popout={popout}/>;}
function WorkbookEditor({popout}:{popout:boolean}){
 const {id}=useParams(),[params,setParams]=useSearchParams(),query=useResource<WorkbookInstance>(`/workbooks/instances/${id}`),afterWrite=useAfterWrite();
 const [document,setDocument]=useState<WorkbookInstance|null>(null),[answers,setAnswers]=useState<WorkbookAnswers>({}),[status,setStatus]=useState(""),[error,setError]=useState("");
 const [conflict,setConflict]=useState<{server:WorkbookInstance;merge:ReturnType<typeof mergeWorkbookAnswers>}|null>(null);
 const [upgrade,setUpgrade]=useState(false),[version,setVersion]=useState(""),[mapping,setMapping]=useState("{}");
 const versions=useResource<TemplateSummary[]>(upgrade?"/workbooks/templates":null);
 const nextVersion=useResource<WorkbookTemplate>(version?`/workbooks/templates/${version}`:null);
 const state=useRef({doc:null as WorkbookInstance|null,answers:{} as WorkbookAnswers,base:{} as WorkbookAnswers,dirty:false,generation:0,saving:false,paused:false});
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),after=useRef(afterWrite);after.current=afterWrite;
 const recoveryKey=useRef("");
 const windowKey=useRef(sessionStorage.getItem("workbookDraftWindow")??crypto.randomUUID());
 sessionStorage.setItem("workbookDraftWindow",windowKey.current);
 const remember=()=>{if(!recoveryKey.current)return;if(!state.current.dirty){localStorage.removeItem(recoveryKey.current);return;}try{localStorage.setItem(recoveryKey.current,JSON.stringify({answers:state.current.answers,base:state.current.base,revision:state.current.doc?.revision}));}catch{/* введённые ответы остаются в окне */}};
 const save=useCallback(async()=>{
  const current=state.current;if(!current.doc||!current.dirty||current.saving||current.paused)return;
  const snapshot=structuredClone(current.answers),generation=current.generation,doc=current.doc;current.saving=true;setStatus("Сохраняем…");
  try{const saved=await write.put<WorkbookInstance>(`/workbooks/instances/${id}`,{answers:snapshot,revision:doc.revision});
   current.doc=saved;current.base=snapshot;setDocument(saved);setError("");after.current(WORKBOOK_AFFECTS);
   if(generation===current.generation){current.dirty=false;localStorage.removeItem(recoveryKey.current);setStatus("Сохранено");}else{remember();setStatus("Есть новые изменения");}
  }catch(e){current.paused=true;remember();setError((e as Error).message);setStatus("Изменения в этом окне");
   const payload=(e as Error&{payload?:{current?:WorkbookInstance}}).payload;if(payload?.current)setConflict({server:payload.current,merge:mergeWorkbookAnswers(current.base,current.answers,payload.current.answers)});
  }finally{current.saving=false;if(current.dirty&&!current.paused)timer.current=setTimeout(()=>void save(),600);}
 },[id]);
 useEffect(()=>{
  const incoming=query.data;if(!incoming||state.current.dirty||state.current.saving||state.current.doc&&incoming.revision<state.current.doc.revision)return;
  state.current.doc=incoming;state.current.answers=incoming.answers;state.current.base=incoming.answers;setDocument(incoming);setAnswers(incoming.answers);
  recoveryKey.current=`workbookDraft:${getCachedUser()?.id??"gm"}:${incoming.uid}:${windowKey.current}`;
  try{const cached=JSON.parse(localStorage.getItem(recoveryKey.current)??"null");if(cached){state.current.answers=cached.answers;state.current.base=cached.base;state.current.dirty=true;state.current.generation++;setAnswers(cached.answers);if(cached.revision!==incoming.revision){state.current.paused=true;setConflict({server:incoming,merge:mergeWorkbookAnswers(cached.base,cached.answers,incoming.answers)});setError("Найдены несохранённые ответы. Тетрадь также изменилась в другом окне.");}else timer.current=setTimeout(()=>void save(),600);}}
  catch{/* повреждённая локальная копия не заменяет документ */}
 },[query.data,save]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(state.current.dirty){remember();e.preventDefault();}};window.addEventListener("beforeunload",unload);return()=>{clearTimeout(timer.current);remember();window.removeEventListener("beforeunload",unload);};},[]);
 function change(sheet:string,field:string,value:unknown){const current=state.current,next={...current.answers,[sheet]:{...current.answers[sheet],[field]:value}};current.answers=next;current.dirty=true;current.generation++;setAnswers(next);setStatus("Есть изменения");remember();clearTimeout(timer.current);timer.current=setTimeout(()=>void save(),700);}
 async function retry(){state.current.paused=false;const latest=await readOnce<WorkbookInstance>(`/workbooks/instances/${id}`);if(latest.revision!==state.current.doc?.revision){state.current.paused=true;setConflict({server:latest,merge:mergeWorkbookAnswers(state.current.base,state.current.answers,latest.answers)});return;}void save();}
 function resolve(){if(!conflict)return;const current=state.current;current.doc=conflict.server;current.base=conflict.server.answers;current.answers=conflict.merge.answers;current.generation++;current.dirty=true;current.paused=false;setAnswers(current.answers);setDocument(current.doc);setConflict(null);setError("");remember();void save();}
 async function upgradeVersion(){if(!document||state.current.dirty)return;try{const saved=await write.post<WorkbookInstance>(`/workbooks/instances/${id}/upgrade`,{revision:document.revision,template_id:Number(version),mapping:JSON.parse(mapping)});state.current.doc=null;setUpgrade(false);afterWrite(WORKBOOK_AFFECTS);setDocument(saved);query.reload();}catch(e){setError((e as Error).message);}}
 if(query.error&&!document)return <LoadErrorCard message={query.error} onRetry={query.reload}/>;
 if(!document)return <p>Открываем тетрадь…</p>;
 const template=document.template,index=Math.max(0,template.sheets.findIndex(s=>s.key===params.get("sheet"))),sheet=template.sheets[index],progress=workbookProgress(template,answers);
 const content=<div className={`workbook ${popout?"workbook--popout":""}`}>
 <header className="workbook-toolbar"><div><strong>{document.title}</strong><span className="muted">{progress.filled} / {progress.total} · {status||"Сохранено"} · версия {template.version}</span></div><div className="row"><button onClick={()=>downloadWorkbook(`${document.title}.md`,workbookMarkdown(template,document.title,answers),"text/markdown")}>Экспорт .md</button><button disabled={state.current.dirty||state.current.saving} onClick={async()=>{try{const bundle=await readOnce(`/workbooks/instances/${id}/export`);downloadWorkbook(`${document.title}.workbook.json`,JSON.stringify(bundle,null,2));}catch(e){setError((e as Error).message);}}}>Экспорт с шаблоном</button>{!popout&&<button onClick={()=>openSecondWindow(`/workbook-window/${id}?sheet=${sheet.key}`)}>Отдельное окно</button>}<button disabled={state.current.dirty} onClick={()=>setUpgrade(!upgrade)}>Версии шаблона</button><Link to="/workbooks">Тетради и шаблоны</Link></div></header>
 {document.project_type&&document.project_id&&<Link to={`/${{campaign:"campaigns",setting:"settings",adventure:"adventures"}[document.project_type]}/${document.project_id}`}>Связанный проект →</Link>}
 {error&&<div className="workbook-error" role="alert"><p>{error}</p>{!conflict&&<button onClick={()=>void retry().catch(e=>setError(e.message))}>Повторить сохранение</button>}</div>}
 {conflict&&<div className="card stack"><h2>Объединение ответов</h2><p>Разные поля объединятся автоматически. Для совпадающих выбери ответ.</p>{conflict.merge.conflicts.map(c=><label key={`${c.sheet}/${c.field}`}>{template.sheets.find(s=>s.key===c.sheet)?.fields.find(f=>f.key===c.field)?.label??`${c.sheet}/${c.field}`}<select onChange={e=>{const result=structuredClone(conflict.merge.answers);result[c.sheet][c.field]=e.target.value==="mine"?c.mine:c.theirs;setConflict({...conflict,merge:{...conflict.merge,answers:result}});}}><option value="mine">Из этого окна: {JSON.stringify(c.mine)?.slice(0,150)}</option><option value="theirs">Из другого окна: {JSON.stringify(c.theirs)?.slice(0,150)}</option></select></label>)}<button className="primary" onClick={resolve}>Сохранить объединённые ответы</button><button onClick={()=>downloadWorkbook(`${document.title}-несохранённое.json`,JSON.stringify({template,answers:state.current.answers},null,2))}>Скачать мою копию</button></div>}
 {upgrade&&<div className="card stack"><p>Обновление выполняется только по твоему выбору. Ответы удалённых полей сохранятся в экспорте.</p><select value={version} onChange={e=>setVersion(e.target.value)}><option value="">Выбрать версию</option>{versions.data?.filter(v=>v.template_key===template.key&&v.id!==document.template_id).map(v=><option key={v.id} value={v.id}>{v.title} · {v.version}</option>)}</select>{nextVersion.data&&template.sheets.flatMap(oldSheet=>oldSheet.fields.filter(f=>!nextVersion.data!.sheets.some(s=>s.key===oldSheet.key&&s.fields.some(n=>n.key===f.key))).map(f=><label key={oldSheet.key+f.key}>Перенести ответ «{f.label}»<select value={JSON.parse(mapping)[oldSheet.key+"/"+f.key]??""} onChange={e=>{const m=JSON.parse(mapping);if(e.target.value)m[oldSheet.key+"/"+f.key]=e.target.value;else delete m[oldSheet.key+"/"+f.key];setMapping(JSON.stringify(m));}}><option value="">Сохранить как прежний ответ</option>{nextVersion.data!.sheets.flatMap(ns=>ns.fields.map(nf=><option key={ns.key+nf.key} value={ns.key+"/"+nf.key}>{ns.title} · {nf.label}</option>))}</select></label>))}<button disabled={!version||state.current.dirty} onClick={()=>void upgradeVersion()}>Применить версию</button></div>}
 <div className="workbook-layout"><nav aria-label="Листы тетради">{template.sheets.map(s=><button key={s.key} aria-current={s.key===sheet.key?"page":undefined} onClick={()=>setParams({sheet:s.key})}>{s.title}</button>)}</nav><main className="workbook-sheet"><h2>{sheet.title}</h2>{sheet.instructions&&<details className="workbook-instructions"><summary>Инструкция и исходная форма</summary><MentionText text={sheet.instructions}/></details>}<fieldset className="stack workbook-fields" disabled={!!conflict||!!document.archived_at}>{sheet.fields.map(field=><WorkbookFieldInput key={field.key} field={field} value={answers[sheet.key]?.[field.key]} onChange={v=>change(sheet.key,field.key,v)}/>)}</fieldset><div className="row"><button disabled={index===0} onClick={()=>setParams({sheet:template.sheets[index-1].key})}>← Предыдущий лист</button><button disabled={index===template.sheets.length-1} onClick={()=>setParams({sheet:template.sheets[index+1].key})}>Следующий лист →</button></div></main></div></div>;
 return popout?content:<PageFrame title="Рабочая тетрадь">{content}</PageFrame>;
}
