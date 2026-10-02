import {createContext} from "react";
import type {WorkbookTemplate,WorkbookAnswers} from "@shared/workbooks";
export interface WorkbookInstance {id:number;uid:string;title:string;template_id:number;template:WorkbookTemplate;answers:WorkbookAnswers;revision:number;project_type:string|null;project_id:number|null;archived_at:string|null}
export interface TemplateSummary {id:number;template_key:string;version:number;title:string;archived_at:string|null}
export interface InstanceSummary {id:number;uid:string;title:string;template_id:number;revision:number;template_title:string;template_version:number;archived_at:string|null;sheets?:number;progress?:{total:number;filled:number}}
export const WORKBOOK_AFFECTS=[{path:"/workbooks"},{path:"/book-library"}] as const;
export function downloadWorkbook(name:string,contents:string,type="application/json"){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement("a");a.href=url;a.download=name.replace(/[<>:"/\\|?*]/g,"_");a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function mergeWorkbookAnswers(base:WorkbookAnswers,mine:WorkbookAnswers,theirs:WorkbookAnswers){
 const answers:WorkbookAnswers=structuredClone(theirs),conflicts:{sheet:string;field:string;mine:unknown;theirs:unknown}[]=[];
 for(const sheet of new Set([...Object.keys(base),...Object.keys(mine),...Object.keys(theirs)])){
  answers[sheet]??={};for(const field of new Set([...Object.keys(base[sheet]??{}),...Object.keys(mine[sheet]??{}),...Object.keys(theirs[sheet]??{})])){const b=base[sheet]?.[field],m=mine[sheet]?.[field],t=theirs[sheet]?.[field];if(JSON.stringify(m)===JSON.stringify(b))continue;if(JSON.stringify(t)!==JSON.stringify(b)&&JSON.stringify(t)!==JSON.stringify(m))conflicts.push({sheet,field,mine:m,theirs:t});if(m===undefined)delete answers[sheet][field];else answers[sheet][field]=m;}
 }return {answers,conflicts};
}
/** Где лежит графа (тетрадь/лист/карточка) — ключ черновика свободной страницы. */
export const WorkbookScope=createContext("workbook");
