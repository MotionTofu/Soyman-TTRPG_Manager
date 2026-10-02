import {useCallback,useEffect,useRef,useState} from "react";
import {useAfterWrite,useResource,write} from "../../data/hooks";
import {readOnce} from "../../data/imperative";
import {getCachedUser} from "../../api/currentUser";
import {WORKBOOK_AFFECTS,mergeWorkbookAnswers,type WorkbookInstance} from "./model";
import type {WorkbookAnswers} from "@shared/workbooks";

/** Сохранения в пути по тетрадям. Тетрадь у края пересоздаётся при переходе к другой книге: новая ждёт, пока старая
 *  допишет последние ответы, иначе она пошла бы со старой ревизией и получила бы конфликт. */
const inflight=new Map<string,Promise<unknown>>();

export type WorkbookConflict={server:WorkbookInstance;merge:ReturnType<typeof mergeWorkbookAnswers>};

/** Ответы тетради: автосохранение с ревизией, локальная копия до сохранения, объединение при конфликте.
 *  Один хук на страницу-разворот и на тетрадь у края читалки. */
export function useWorkbookEditor(id:string|number){
 const query=useResource<WorkbookInstance>(`/workbooks/instances/${id}`),afterWrite=useAfterWrite(),reload=query.reload;
 const [document,setDocument]=useState<WorkbookInstance|null>(null),[answers,setAnswers]=useState<WorkbookAnswers>({}),[status,setStatus]=useState(""),[error,setError]=useState("");
 const [conflict,setConflict]=useState<WorkbookConflict|null>(null);
 const state=useRef({doc:null as WorkbookInstance|null,answers:{} as WorkbookAnswers,base:{} as WorkbookAnswers,dirty:false,generation:0,saving:false,paused:false});
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),after=useRef(afterWrite);after.current=afterWrite;
 const recoveryKey=useRef("");
 const windowKey=useRef(sessionStorage.getItem("workbookDraftWindow")??crypto.randomUUID());
 sessionStorage.setItem("workbookDraftWindow",windowKey.current);
 const remember=()=>{if(!recoveryKey.current)return;if(!state.current.dirty){localStorage.removeItem(recoveryKey.current);return;}try{localStorage.setItem(recoveryKey.current,JSON.stringify({answers:state.current.answers,base:state.current.base,revision:state.current.doc?.revision}));}catch{/* введённые ответы остаются в окне */}};
 const save=useCallback(async()=>{
  const current=state.current;if(!current.doc||!current.dirty||current.saving||current.paused)return;
  const snapshot=structuredClone(current.answers),generation=current.generation,doc=current.doc;current.saving=true;setStatus("Сохраняю…");
  const request=write.put<WorkbookInstance>(`/workbooks/instances/${id}`,{answers:snapshot,revision:doc.revision}),settled=request.catch(()=>undefined);inflight.set(String(id),settled);
  try{const saved=await request;
   current.doc=saved;current.base=snapshot;setDocument(saved);setError("");after.current(WORKBOOK_AFFECTS);
   if(generation===current.generation){current.dirty=false;localStorage.removeItem(recoveryKey.current);setStatus("Сохранено");}else{remember();setStatus("Есть новые изменения");}
  }catch(e){current.paused=true;remember();setError((e as Error).message);setStatus("Изменения в этом окне");
   const payload=(e as Error&{payload?:{current?:WorkbookInstance}}).payload;if(payload?.current)setConflict({server:payload.current,merge:mergeWorkbookAnswers(current.base,current.answers,payload.current.answers)});
  }finally{if(inflight.get(String(id))===settled)inflight.delete(String(id));current.saving=false;if(current.dirty&&!current.paused)timer.current=setTimeout(()=>void save(),600);}
 },[id]);
 useEffect(()=>{
  const pending=inflight.get(String(id));if(pending&&!state.current.doc){void pending.then(()=>reload());return;}
  const incoming=query.data;if(!incoming||state.current.dirty||state.current.saving||state.current.doc&&incoming.revision<state.current.doc.revision)return;
  state.current.doc=incoming;state.current.answers=incoming.answers;state.current.base=incoming.answers;setDocument(incoming);setAnswers(incoming.answers);
  recoveryKey.current=`workbookDraft:${getCachedUser()?.id??"gm"}:${incoming.uid}:${windowKey.current}`;
  try{const cached=JSON.parse(localStorage.getItem(recoveryKey.current)??"null");if(cached){state.current.answers=cached.answers;state.current.base=cached.base;state.current.dirty=true;state.current.generation++;setAnswers(cached.answers);if(cached.revision!==incoming.revision){state.current.paused=true;setConflict({server:incoming,merge:mergeWorkbookAnswers(cached.base,cached.answers,incoming.answers)});setError("Найдены несохранённые ответы. Тетрадь также изменилась в другом окне.");}else timer.current=setTimeout(()=>void save(),600);}}
  catch{/* повреждённая локальная копия не заменяет документ */}
 },[query.data,save,id,reload]);
 // Закрывают тетрадь (или переходят к другой книге) — несохранённое уходит сразу, черновик остаётся на случай ошибки.
 useEffect(()=>{const current=state.current,timers=timer;const unload=(e:BeforeUnloadEvent)=>{if(current.dirty){remember();e.preventDefault();}};window.addEventListener("beforeunload",unload);return()=>{clearTimeout(timers.current);remember();if(current.dirty&&!current.paused&&!current.saving)void save();window.removeEventListener("beforeunload",unload);};},[save]);
 /** Ответ графы; `field` — ключ графы или ключ записи в зарезервированном разделе ответов. */
 function change(sheet:string,field:string,value:unknown){const current=state.current,next={...current.answers,[sheet]:{...current.answers[sheet],[field]:value}};if(value===undefined)delete next[sheet][field];current.answers=next;current.dirty=true;current.generation++;setAnswers(next);setStatus("Есть изменения");remember();clearTimeout(timer.current);timer.current=setTimeout(()=>void save(),700);}
 async function retry(){state.current.paused=false;const latest=await readOnce<WorkbookInstance>(`/workbooks/instances/${id}`);if(latest.revision!==state.current.doc?.revision){state.current.paused=true;setConflict({server:latest,merge:mergeWorkbookAnswers(state.current.base,state.current.answers,latest.answers)});return;}void save();}
 function resolve(){if(!conflict)return;const current=state.current;current.doc=conflict.server;current.base=conflict.server.answers;current.answers=conflict.merge.answers;current.generation++;current.dirty=true;current.paused=false;setAnswers(current.answers);setDocument(current.doc);setConflict(null);setError("");remember();void save();}
 /** После обновления версии документ приходит заново целиком. */
 function replace(saved:WorkbookInstance){state.current.doc=null;setDocument(saved);afterWrite(WORKBOOK_AFFECTS);query.reload();}
 return {query,document,answers,status,error,setError,conflict,setConflict,change,retry,resolve,replace,dirty:()=>state.current.dirty||state.current.saving,current:()=>state.current.answers};
}
