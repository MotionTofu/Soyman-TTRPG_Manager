import {useContext,useId,useState} from "react";
import type {WorkbookField} from "@shared/workbooks";
import {useAction,write} from "../../data/hooks";
import {MentionText} from "../mentions/MentionText";
import {SheetOverlay} from "../sheet/SheetOverlay";
import {WorkbookScope} from "./model";
/** Подсказка курса — Markdown; на форме показываем её простым текстом. */
const plain=(hint:string)=>hint.replace(/\*\*Запись:\*\*\s*_?\[заполнить\]_?/gi,"").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*([^*]+)\*/g,"$1").replace(/^>\s?/gm,"").trim();
type Row=Record<string,unknown>&{_id:string};

const cellText=(v:unknown)=>typeof v==="string"?v:typeof v==="number"?String(v):"";

/** Клетка таблицы: строка или выбор, без подписи — подпись в шапке столбца. */
function Cell({field,value,label,onChange}:{field:WorkbookField;value:unknown;label:string;onChange:(v:unknown)=>void}){
 if(field.type==="choice")return <select aria-label={label} value={cellText(value)} onChange={e=>onChange(e.target.value)}><option value="">—</option>{field.options?.map(o=><option key={o}>{o}</option>)}</select>;
 if(field.type==="checklist")return <WorkbookFieldInput field={field} value={value} onChange={onChange}/>;
 return <textarea className="wb-cell" aria-label={label} rows={1} placeholder="—" maxLength={100000} value={cellText(value)} onChange={e=>onChange(e.target.value)}/>;
}

export function WorkbookFieldInput({field,value,onChange}:{field:WorkbookField;value:unknown;onChange:(v:unknown)=>void}){
 const id=useId();
 if(field.type==="heading")return field.level===3?<h4 className="workbook-heading">{field.label}</h4>:<h3 className="workbook-heading">{field.label}</h3>;
 if(field.type==="note")return <p className="workbook-note muted">{plain(field.hint??"")}</p>;
 if(field.type==="table"&&field.columns){
  const rows=(Array.isArray(value)?value:[]) as Row[],columns=field.columns;
  const hint=field.hint&&<small className="wb-hint">{plain(field.hint)}</small>;
  // Строки, заданные автором, всегда на месте; ответ строки появляется при первом вводе.
  if(field.rows){
   const change=(rowKey:string,key:string,v:unknown)=>onChange(rows.some(r=>r._id===rowKey)?rows.map(r=>r._id===rowKey?{...r,[key]:v}:r):[...rows,{_id:rowKey,[key]:v}]);
   return <div className="wb-table"><span className="wb-label">{field.label}</span>{hint}<table><thead><tr><th scope="col">{field.rowHeader??""}</th>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
    <tbody>{field.rows.map(row=>{const answer=rows.find(r=>r._id===row.key)??{_id:row.key};return <tr key={row.key}><th scope="row">{row.label}</th>{columns.map(c=><td key={c.key} data-label={c.label}><Cell field={c} value={answer[c.key]} label={`${row.label}: ${c.label}`} onChange={v=>change(row.key,c.key,v)}/></td>)}</tr>;})}</tbody></table></div>;
  }
  // Пустые строки из курса видны сразу; запись строки появляется при первом вводе.
  const shown:Row[]=[...rows];while(shown.length<(field.minRows??0))shown.push({_id:`blank-${shown.length}`});
  const change=(index:number,key:string,v:unknown)=>onChange(index<rows.length?rows.map((r,i)=>i===index?{...r,[key]:v}:r):[...rows,{_id:crypto.randomUUID(),[key]:v}]);
  return <div className="wb-table"><span className="wb-label">{field.label}</span>{hint}<table><thead><tr><th scope="col"><span className="sr-only">Номер</span></th>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}<th scope="col"><span className="sr-only">Действия</span></th></tr></thead>
   <tbody>{shown.map((row,index)=>{const saved=index<rows.length;return <tr key={row._id}><th scope="row">{index+1}</th>{columns.map(c=><td key={c.key} data-label={c.label}><Cell field={c} value={row[c.key]} label={`${c.label}, строка ${index+1}`} onChange={v=>change(saved?index:rows.length,c.key,v)}/></td>)}<td>{saved&&<button type="button" className="wb-link" aria-label={`Убрать строку ${index+1}: ${field.label}`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>×</button>}</td></tr>;})}</tbody></table>
   <button type="button" className="wb-link" disabled={rows.length>=500} onClick={()=>onChange([...rows,{_id:crypto.randomUUID()}])}>+ Строка</button></div>;
 }
 if(field.type==="group"||field.type==="table"){
  // Вложенная карточка внутри карточки — редкость; простая форма вместо разворота.
  const rows=(Array.isArray(value)?value:[]) as Row[],fields=field.columns??field.fields??[];
  const change=(index:number,key:string,v:unknown)=>onChange(rows.map((r,i)=>i===index?{...r,[key]:v}:r));
  return <fieldset className="workbook-repeat"><legend>{field.label}</legend>{rows.map((row,index)=><div key={row._id} className="workbook-repeat__row"><div className="workbook-repeat__actions"><strong>{index+1}</strong><button type="button" className="wb-link" onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>Убрать</button></div>{fields.map(child=><WorkbookFieldInput key={child.key} field={child} value={row[child.key]} onChange={v=>change(index,child.key,v)}/>)}</div>)}<button type="button" className="wb-link" disabled={rows.length>=500} onClick={()=>onChange([...rows,{_id:crypto.randomUUID()}])}>+ Карточка</button></fieldset>;
 }
 if(field.type==="checklist")return <fieldset className="workbook-field"><legend className="wb-label">{field.label}</legend>{field.options?.map(option=><label className="workbook-check" key={option}><input type="checkbox" className="wb-check" checked={Array.isArray(value)&&value.includes(option)} onChange={e=>{const selected=Array.isArray(value)?value:[];onChange(e.target.checked?[...selected,option]:selected.filter(v=>v!==option));}}/>{option}</label>)}</fieldset>;
 if(field.type==="page")return <PageField field={field} value={cellText(value)} onChange={onChange}/>;
 if(field.type==="image")return <ImageField field={field} value={cellText(value)} onChange={onChange}/>;
 const text=cellText(value);
 return <label className="workbook-field" htmlFor={id}><span className="wb-label">{field.label}</span>
 {field.hint&&<small className="wb-hint">{plain(field.hint)}</small>}
 {field.type==="choice"?<select id={id} value={text} onChange={e=>onChange(e.target.value)}><option value="">Не выбрано</option>{field.options?.map(o=><option key={o}>{o}</option>)}</select>
 :field.type==="number"?<input id={id} type="number" value={typeof value==="number"?value:""} onChange={e=>onChange(e.target.value===""?null:Number(e.target.value))}/>
 :field.type==="line"||field.type==="link"?<input id={id} className="wb-line" value={text} maxLength={100000} placeholder={field.type==="link"?"Ссылка на книгу, проект или материал":undefined} onChange={e=>onChange(e.target.value)}/>
 :<textarea id={id} className="wb-ruled" rows={Math.max(2,Math.min(12,text.split("\n").length+1))} maxLength={100000} value={text} onChange={e=>onChange(e.target.value)}/>}
 </label>;
}

/** Свободная страница — лист «Листа» (CM6), на форме — начало текста. */
function PageField({field,value,onChange}:{field:WorkbookField;value:string;onChange:(v:unknown)=>void}){
 const [open,setOpen]=useState(false),scope=useContext(WorkbookScope);
 return <div className="workbook-field"><span className="wb-label">{field.label}</span>{field.hint&&<small className="wb-hint">{plain(field.hint)}</small>}
  <button type="button" className="wb-page-preview" onClick={()=>setOpen(true)}>{value.trim()?<MentionText text={value.length>600?value.slice(0,600)+"…":value}/>:<span className="muted">Открыть страницу и писать</span>}</button>
  {open&&<SheetOverlay docKey={`workbook:${scope}/${field.key}`} caption={field.label} value={value} initialMode={value.trim()?"reading":"hybrid"} onSave={async v=>onChange(v)} onClose={()=>setOpen(false)}/>}
 </div>;
}

/** Картинка — загруженный файл (ресурс) или ссылка. */
function ImageField({field,value,onChange}:{field:WorkbookField;value:string;onChange:(v:unknown)=>void}){
 const run=useAction(),[busy,setBusy]=useState(false),id=useId();
 async function upload(file:File|undefined){if(!file)return;setBusy(true);try{const data=new FormData();data.append("file",file);data.append("name",`Тетрадь · ${field.label}`);data.append("scope","global");data.append("category","image");data.append("type","image");
  const uploaded=await run(()=>write.post<{uid:string}>("/resources",data,{timeoutMs:120_000}),{affects:[{kind:"resource"}],retry:false});if(uploaded)onChange(`soyman:resource/${uploaded.uid}`);}finally{setBusy(false);}}
 return <div className="workbook-field"><span className="wb-label">{field.label}</span>{field.hint&&<small className="wb-hint">{plain(field.hint)}</small>}
  {value&&<div className="wb-image"><MentionText text={`![${field.label}](${value})`}/></div>}
  <div className="wb-image__actions"><label className="wb-link" htmlFor={id}>{busy?"Загрузка…":value?"Заменить картинку":"Загрузить картинку"}</label><input id={id} className="sr-only" type="file" accept="image/*" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value="";}}/>{value&&<button type="button" className="wb-link" onClick={()=>onChange("")}>Убрать</button>}</div>
 </div>;
}
