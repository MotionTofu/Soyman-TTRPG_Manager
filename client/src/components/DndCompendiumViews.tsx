import { Fragment, useState, type ReactNode } from "react";
import { stripMentions } from "../mentions";
import { extractEnglishName } from "../compendium";
import type { CompendiumEntry } from "../types";
import { entryValue, featBenefitSummary } from "./compendiumArticleData";

function registerColumns(kind:string) {
  if (kind === "equipment") return ["Урон / КЗ","Свойства","Мастерство","Цена","Вес"];
  if (kind === "feat") return ["Категория","Требование","Даёт"];
  if (kind === "magic_item") return ["Тип","Редкость","Настройка","Цена"];
  if (kind === "background") return ["Характеристики","Навыки","Умение"];
  if (kind === "vehicle") return ["Категория","Размер","КЗ / хиты","Цена"];
  return ["Категория","Кратко"];
}
function names(value:unknown) { return Array.isArray(value) ? value.map((item)=>extractEnglishName(typeof item === "string" ? item : item?.name ?? "").name).filter(Boolean).join(", ") : ""; }
function registerValues(entry:CompendiumEntry) {
  const str = (key:string)=>entryValue(entry,key);
  if(entry.kind === "equipment") return [str("damage") || str("ac"),names(entry.data.weapon_properties),names([entry.data.weapon_mastery]),str("cost"),str("weight")];
  if(entry.kind === "feat") return [str("category"),str("prerequisite"),featBenefitSummary(entry) || names(entry.data.abilities) || stripMentions(entry.description).split("\n")[0]];
  if(entry.kind === "magic_item") return [str("item_type"),str("rarity"),entry.data.attunement ? "Требуется" : "—",str("cost")];
  if(entry.kind === "background") return [names(entry.data.abilities),names(entry.data.skills),names([entry.data.origin_feat]) || str("feature")];
  if(entry.kind === "vehicle") return [str("category"),str("size"),[str("ac"),str("hp")].filter(Boolean).join(" / "),str("cost")];
  return [str("category"),stripMentions(entry.description).split("\n")[0]];
}

/** Настоящая таблица: статья и прежний редактор занимают всю строку. */
export function DndRegister({entries,kind,grouping,groupField,expanded,editingId,focusEntryId,manual,onToggle,onDrag,onDrop,renderArticle}: {
  entries:CompendiumEntry[];kind:string;grouping:"alpha"|"category"|"manual";
  groupField?:string;
  expanded:Set<number>;editingId?:number;focusEntryId?:number;manual:boolean;
  onToggle:(id:number)=>void;onDrag?:(id:number)=>void;onDrop?:(group:CompendiumEntry[],drag:number,target:number)=>void;
  renderArticle:(entry:CompendiumEntry)=>ReactNode;
}) {
  const columns=registerColumns(kind);
  const groups=new Map<string,CompendiumEntry[]>();
  for(const entry of entries){const key=grouping === "alpha" ? (entry.name[0] ?? "—").toLocaleUpperCase("ru") : grouping === "category" ? entryValue(entry,groupField ?? (kind === "magic_item" ? "item_type" : "category")) || "Без категории" : "Все записи";if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(entry);}
  return <div className={`dnd-register dnd-register--${kind}`}>{[...groups].map(([group,list],index)=><details className="dnd-register__group" key={group} open={list.some((entry)=>entry.id === focusEntryId) || index === 0 || grouping === "manual"}>
    <summary><span>{group}</span><b>{list.length}</b><small>▾</small></summary>
    <table><thead><tr><th scope="col">Название</th>{columns.map((column)=><th key={column} scope="col">{column}</th>)}<th aria-label="Раскрыть" /></tr></thead>
      <tbody>{list.map((entry)=>{const open=expanded.has(entry.id)||editingId===entry.id;return <Fragment key={entry.id}>
        <tr className={open ? "is-open" : ""} onClick={(event)=>{if(!(event.target as Element).closest("button,a,input"))onToggle(entry.id);}} onDragOver={(event)=>{if(manual)event.preventDefault();}} onDrop={(event)=>{if(!manual)return;event.preventDefault();onDrop?.(list,Number(event.dataTransfer.getData("text/plain")),entry.id);}}>
          <th scope="row">{manual && <span className="comp-drag-handle" draggable role="button" aria-label={`Перетащить ${entry.name}`} onDragStart={(event)=>{event.dataTransfer.setData("text/plain",String(entry.id));onDrag?.(entry.id);}}>⠿</span>}<button type="button" aria-expanded={open} onClick={()=>onToggle(entry.id)}>{entry.name}</button>{entry.name_original && <small>{entry.name_original}</small>}</th>
          {registerValues(entry).map((value,i)=><td key={i} title={value}>{value || "—"}</td>)}<td>{open ? "▴" : "▾"}</td>
        </tr>
        {open && <tr className="dnd-register__article"><td colSpan={columns.length+2}>{renderArticle(entry)}</td></tr>}
      </Fragment>;})}</tbody>
    </table>
  </details>)}</div>;
}

export function DndGroupIndex({groups,entries,onSelect}: {groups:CompendiumEntry[];entries:CompendiumEntry[];onSelect:(id:number)=>void}) {
  const [all,setAll]=useState(false);
  const count=(id:number)=>{const seen=new Set<number>();const queue=[id];while(queue.length){const parent=queue.pop()!;for(const entry of entries){if(entry.parent_id===parent && !seen.has(entry.id)){seen.add(entry.id);queue.push(entry.id);}}}return seen.size;};
  const sorted=groups.map((group)=>({group,count:count(group.id)})).sort((a,b)=>b.count-a.count||a.group.name.localeCompare(b.group.name,"ru"));
  return <nav className="dnd-group-index" aria-label="Указатель групп">{(all ? sorted : sorted.slice(0,20)).map(({group,count})=><button type="button" key={group.id} onClick={()=>onSelect(group.id)}>{group.name} <small>{count}</small></button>)}{sorted.length>20 && <button type="button" onClick={()=>setAll(!all)}>{all ? "Скрыть" : `ещё ${sorted.length-20} групп ▾`}</button>}</nav>;
}
