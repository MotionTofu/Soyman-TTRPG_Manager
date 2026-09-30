import {useState} from "react";
import {Link} from "react-router-dom";
import {useAction,useResource,write} from "../../data/hooks";
import {Modal} from "../Modal";
import {openSecondWindow} from "../../electronApi";
import {WORKBOOK_AFFECTS,type InstanceSummary,type TemplateSummary,type WorkbookInstance} from "./model";
import type {WorkbookTemplate} from "@shared/workbooks";
type BookLink={template_key:string;sheet_key:string|null;instance_id:number|null;instance_title:string|null;instance_archived:string|null};
export function WorkbookLinks({bookId}:{bookId:number}){
 const run=useAction(),[open,setOpen]=useState(false),[templateId,setTemplateId]=useState(""),[instanceId,setInstanceId]=useState(""),[sheet,setSheet]=useState(""),[title,setTitle]=useState("");
 const links=useResource<BookLink[]>(`/workbooks/books/${bookId}`),templates=useResource<TemplateSummary[]>(open?"/workbooks/templates":null),template=useResource<WorkbookTemplate>(templateId?`/workbooks/templates/${templateId}`:null);
 const instances=useResource<InstanceSummary[]>(template.data?`/workbooks/instances?template=${template.data.key}`:null);
 const selectedInstance=useResource<WorkbookInstance>(instanceId?`/workbooks/instances/${instanceId}`:null);
 const sheets=(instanceId?selectedInstance.data?.template:template.data)?.sheets??[];
 async function attach(){if(!template.data)return;let selected=Number(instanceId)||null;if(!selected){if(!title.trim())return;const created=await run(()=>write.post<{id:number}>("/workbooks/instances",{template_id:Number(templateId),title:title.trim()}),{affects:WORKBOOK_AFFECTS,retry:false});if(!created)return;selected=created.id;setInstanceId(String(selected));}
 const result=await run(()=>write.put(`/workbooks/books/${bookId}`,{template_key:template.data!.key,sheet_key:sheet||null,instance_id:selected}),{affects:WORKBOOK_AFFECTS,retry:false});if(result!==undefined)setOpen(false);}
 return <><button onClick={()=>setOpen(true)}>Рабочая тетрадь{links.data?.filter(l=>l.instance_id).length?` · ${links.data.filter(l=>l.instance_id).length}`:""}</button>{open&&<Modal ariaLabel="Связь с рабочей тетрадью" onClose={()=>setOpen(false)}><div className="stack"><h2>Тетрадь рядом с книгой</h2>{links.data?.filter(l=>l.instance_id).map(link=><div key={link.template_key} className="card stack"><strong>{link.instance_title??link.template_key}{link.instance_archived?" · в архиве":""}</strong>{link.instance_id&&!link.instance_archived&&<div className="row"><Link to={`/workbooks/${link.instance_id}?sheet=${link.sheet_key??""}`}>Открыть</Link><button onClick={()=>openSecondWindow(`/workbook-window/${link.instance_id}?sheet=${link.sheet_key??""}`)}>Отдельное окно</button></div>}<button onClick={()=>{void run(()=>write.put(`/workbooks/books/${bookId}`,{template_key:link.template_key,remove:true}),{affects:WORKBOOK_AFFECTS});}}>Отвязать мою тетрадь</button></div>)}
 <label>Шаблон<select value={templateId} onChange={e=>{setTemplateId(e.target.value);setInstanceId("");setSheet("");}}><option value="">Выбрать</option>{templates.data?.filter(t=>!t.archived_at).map(t=><option key={t.id} value={t.id}>{t.title} · версия {t.version}</option>)}</select></label>
 {template.data&&<><label>Экземпляр<select value={instanceId} onChange={e=>{setInstanceId(e.target.value);setSheet("");}}><option value="">Создать новую тетрадь</option>{instances.data?.map(i=><option key={i.id} value={i.id}>{i.title} · версия {i.template_version}</option>)}</select></label>{!instanceId&&<label>Название новой тетради<input value={title} onChange={e=>setTitle(e.target.value)}/></label>}<label>Лист для этой книги<select value={sheet} onChange={e=>setSheet(e.target.value)}><option value="">С начала</option>{sheets.map(s=><option key={s.key} value={s.key}>{s.title}</option>)}</select></label><button className="primary" disabled={!!instanceId&&!selectedInstance.data||!instanceId&&!title.trim()} onClick={()=>void attach()}>Связать с книгой</button></>}
 <Link to="/workbooks">Тетради и шаблоны →</Link></div></Modal>}</>;
}
