import {useId} from "react";
import type {WorkbookField} from "@shared/workbooks";
export function WorkbookFieldInput({field,value,onChange}:{field:WorkbookField;value:unknown;onChange:(v:unknown)=>void}){
 const id=useId();
 if(field.type==="group"||field.type==="table"){
  const rows=(Array.isArray(value)?value:[]) as Record<string,unknown>[];
  const fields=field.columns??field.fields??[];
  const change=(index:number,key:string,v:unknown)=>onChange(rows.map((r,i)=>i===index?{...r,[key]:v}:r));
  const move=(index:number,delta:number)=>{const next=[...rows];[next[index],next[index+delta]]=[next[index+delta],next[index]];onChange(next);};
  return <fieldset className={`workbook-repeat workbook-repeat--${field.type}`}><legend>{field.label}</legend>{rows.map((row,index)=><div key={String(row._id)} className="workbook-repeat__row"><div className="workbook-repeat__actions"><strong>{index+1}</strong><button type="button" disabled={index===0} aria-label={`Поднять строку ${index+1}: ${field.label}`} onClick={()=>move(index,-1)}>↑</button><button type="button" disabled={index===rows.length-1} aria-label={`Опустить строку ${index+1}: ${field.label}`} onClick={()=>move(index,1)}>↓</button><button type="button" onClick={()=>onChange(rows.filter((_,i)=>i!==index))}>Убрать строку</button></div><div className={field.type==="table"?"workbook-table-row":"stack"}>{fields.map(child=><WorkbookFieldInput key={child.key} field={child} value={row[child.key]} onChange={v=>change(index,child.key,v)}/>)}</div></div>)}<button type="button" disabled={rows.length>=500} onClick={()=>onChange([...rows,{_id:crypto.randomUUID()}])}>+ {field.type==="table"?"Строка":"Карточка"}</button></fieldset>;
 }
 if(field.type==="checklist")return <fieldset className="workbook-field"><legend>{field.label}</legend>{field.options?.map(option=><label className="workbook-check" key={option}><input type="checkbox" checked={Array.isArray(value)&&value.includes(option)} onChange={e=>{const selected=Array.isArray(value)?value:[];onChange(e.target.checked?[...selected,option]:selected.filter(v=>v!==option));}}/>{option}</label>)}</fieldset>;
 return <label className="workbook-field" htmlFor={id}>{field.label}
 {field.hint&&<small className="muted">{field.hint.replace(/\*\*Запись:\*\*\s*_?\[заполнить\]_?/gi,"").replace(/\*([^*]+)\*/g,"$1").trim()}</small>}
 {field.type==="choice"?<select id={id} value={typeof value==="string"?value:""} onChange={e=>onChange(e.target.value)}><option value="">Не выбрано</option>{field.options?.map(o=><option key={o}>{o}</option>)}</select>:field.type==="number"?<input id={id} type="number" value={typeof value==="number"?value:""} onChange={e=>onChange(e.target.value===""?null:Number(e.target.value))}/>:field.type==="link"?<input id={id} value={typeof value==="string"?value:""} placeholder="Ссылка на книгу, проект или материал" onChange={e=>onChange(e.target.value)}/>:<textarea id={id} rows={4} maxLength={100000} value={typeof value==="string"?value:""} onChange={e=>onChange(e.target.value)}/>}
 </label>;
}
