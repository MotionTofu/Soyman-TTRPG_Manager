import {useResource} from "../../data/hooks";
import type {InstanceSummary} from "./model";

export type ShelfWorkbook={instance_id:number;instance_title:string}|null;

/** «Тетрадь полки» в окне полки: открывается у края читалки у книг без своей связи. undefined — не трогали. */
export function ShelfWorkbookSelect({shelfId,value,onChange}:{shelfId:number|null;value:number|null|undefined;onChange:(id:number|null)=>void}){
 const current=useResource<ShelfWorkbook>(shelfId?`/workbooks/shelves/${shelfId}`:null),instances=useResource<InstanceSummary[]>("/workbooks/instances");
 const selected=value!==undefined?value:current.data?.instance_id??null;
 return <label>Тетрадь полки<select value={selected??""} onChange={e=>onChange(e.target.value?Number(e.target.value):null)}><option value="">Без тетради</option>{instances.data?.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label>;
}
