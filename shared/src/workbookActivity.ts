/** Local activity plans: selecting a state never applies its proposed effects to the world. */
export interface ActivityOverview {id:string;name:string;actor:string;state:string;goal:string;action:string;trigger:string;traces:string;missing:boolean}
const string=(value:unknown)=>typeof value==="string"?value:"";
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function activityOverview(value:unknown):ActivityOverview[] {
 if(!Array.isArray(value))return [];
 return value.filter(row=>row&&typeof row==="object").map(row=>{
  const states=Array.isArray(row.states)?row.states:[];
  const state=states.find((s:{_id?:unknown})=>s?._id===row.current);
  return {id:string(row._id),name:string(row.name),actor:string(row.actor),state:string(state?.name),goal:string(state?.goal),action:string(state?.action),trigger:string(state?.trigger),traces:string(state?.traces),missing:!!row.current&&!state};
 });
}

/** Copy a preparation into a new run. Provenance prevents duplicate imports. */
export function copyActivityLines(source:unknown,existing:unknown,sourceUid:string,id:()=>string):Record<string,unknown>[] {
 const previous=Array.isArray(existing)?existing:[];
 const copied=previous.filter(row=>row&&typeof row==="object").map(row=>clone(row));
 for(const row of Array.isArray(source)?source:[]){
  if(!row||typeof row!=="object"||typeof row._id!=="string")continue;
  if(copied.some(r=>r._source_workbook===sourceUid&&r._source_line===row._id))continue;
  const line=clone(row);
  line._source_workbook=sourceUid;line._source_line=row._id;line._id=id();
  line.states=(Array.isArray(line.states)?line.states:[]).map((state:Record<string,unknown>)=>({...state,_id:id()}));
  line.current=line.states[0]?._id??"";line.actual="";
  copied.push(line);
 }
 return copied;
}
