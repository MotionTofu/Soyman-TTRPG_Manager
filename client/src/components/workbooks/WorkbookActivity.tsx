import {useContext} from "react";
import type {WorkbookField} from "@shared/workbooks";
import {activityOverview} from "@shared/workbookActivity";
import {MentionText} from "../mentions/MentionText";
import {WorkbookContext,WorkbookRow} from "./model";

export function WorkbookState({field,value,onChange}:{field:WorkbookField;value:unknown;onChange:(value:unknown)=>void}) {
 const row=useContext(WorkbookRow),states=row?.[field.source!];
 const options=(Array.isArray(states)?states:[]) as {_id:string;name?:string}[];
 const current=typeof value==="string"?value:"",missing=!!current&&!options.some(s=>s._id===current);
 return <label className="workbook-field"><span className="wb-label">{field.label}</span><select value={current} onChange={e=>onChange(e.target.value)}>
  <option value="">Не выбрано</option>{missing&&<option value={current}>Состояние удалено — выберите другое</option>}
  {options.map((s,i)=><option key={s._id} value={s._id}>{s.name||`Состояние ${i+1}`}</option>)}
 </select><small className="wb-hint">Выбор состояния хранится в этой тетради. Изменения мира фиксируются отдельно.</small></label>;
}

export function WorkbookActivitySummary({field}:{field:WorkbookField}) {
 const context=useContext(WorkbookContext),[sheet,key]=(field.source??"").split("/");
 const rows=activityOverview(context?.answers[sheet]?.[key]);
 return <section className="wb-table"><span className="wb-label">{field.label}</span>
  {rows.length?<table><thead><tr>{["Сила / линия","Состояние","Цель сейчас","Действие без героев","Условие перехода","Следы"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
  <tbody>{rows.map((r,i)=><tr key={r.id}><th scope="row"><MentionText text={r.actor||r.name||`Линия ${i+1}`}/></th>
   {[r.missing?"Состояние удалено":r.state,r.goal,r.action,r.trigger,r.traces].map((value,j)=><td key={j} data-label={["Состояние","Цель сейчас","Действие без героев","Условие перехода","Следы"][j]}><MentionText text={value||"—"}/></td>)}</tr>)}</tbody></table>
   :<p className="muted">Добавьте линии и выберите их текущие состояния в «Движении мира».</p>}
  <button type="button" className="wb-link" onClick={()=>context?.onSheet(sheet)}>Открыть линии →</button>
 </section>;
}
