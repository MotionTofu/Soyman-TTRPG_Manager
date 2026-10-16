import {useEffect,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {useResource} from "../../data/hooks";
import {useConfirm} from "../../hooks/useConfirm";
import {MentionText} from "../mentions/MentionText";
import {parseMentions} from "../../mentions";
import {WorkbookFieldInput} from "./WorkbookFieldInput";
import {FormerToRecord} from "./WorkbookCampaignViews";
import {WorkbookScope,WorkbookContext,WorkbookRow,type WorkbookInstance} from "./model";
import {formerAnswers,sheetNotes,sheetNumber,sheetParts,sheetProgress,workbookAnswerless,WORKBOOK_NOTES,type WorkbookAnswers,type WorkbookField,type WorkbookNote,type WorkbookSheet} from "@shared/workbooks";

/** Заметка в связанной книге — тетрадь читает её по ссылке. */
interface BookNote {id:string;sheet_key:string|null;book_id:number;book_title:string;quote:string;body:string;created_at:string}
type Row=Record<string,unknown>&{_id:string};
type Change=(sheet:string,field:string,value:unknown)=>void;

/** «6 · Место и доступ»; лист без номера — одно название. */
const sheetLabel=(n:string,title:string)=>n?`${n} · ${title}`:title;
const filled=(v:unknown)=>v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length>0);
const writable=(f:WorkbookField)=>f.type==="text"||f.type==="line"||f.type==="page";
/** Имя карточки — её первая строка или текст; карточка, начатая ссылкой (на сессию, на героя), названа упомянутым и своей строки-имени не имеет. */
const nameField=(group:WorkbookField)=>group.fields?.[0]?.type==="reference"?undefined:(group.fields??[]).find(f=>f.type==="line"||f.type==="text");
const cardName=(group:WorkbookField,row:Row,i:number)=>{const first=group.fields?.[0],f=first?.type==="reference"?first:nameField(group),v=f&&row[f.key];
 const text=typeof v==="string"?(first?.type==="reference"?parseMentions(v)[0]?.label??v:v).trim():"";return text?text.split("\n")[0]:`${group.label} ${i+1}`;};
const cardProgress=(group:WorkbookField,row:Row)=>{const fields=(group.fields??[]).filter(f=>!workbookAnswerless(f)&&!f.optional);return {filled:fields.filter(f=>filled(row[f.key])).length,total:fields.length};};
const summaryText=(field:WorkbookField,row:Row)=>{
 const value=row[field.key];
 if(field.type==="state"){const rows=row[field.source!];return (Array.isArray(rows)?rows:[]).find(r=>r._id===value)?.name??(value?"Состояние удалено":"—");}
 if(Array.isArray(value))return value.some(v=>v&&typeof v==="object")?`${value.length} записей`:value.join(", ");
 return value==null||value===""?"—":String(value);
};

/**
 * Тетрадь по макету «Разворот · лист 02»: слева форма листа, справа «Записи к этому листу»,
 * язычки листов на кромке. `single` — одна страница (у края читалки и на телефоне):
 * язычки сверху, «Записи» — последней закладкой.
 */
type BookProps={doc:WorkbookInstance;answers:WorkbookAnswers;change:Change;sheetKey:string|null;onSheet:(key:string)=>void;single:boolean;disabled:boolean;notesVersion?:number};
export function WorkbookBook(props:BookProps){return <WorkbookContext.Provider value={{document:props.doc,answers:props.answers,onSheet:props.onSheet,disabled:props.disabled}}><WorkbookBookView {...props}/></WorkbookContext.Provider>;}
function WorkbookBookView({doc,answers,change,sheetKey,onSheet,single,disabled,notesVersion=0}:BookProps){
 const template=doc.template,index=Math.max(0,template.sheets.findIndex(s=>s.key===sheetKey)),sheet=template.sheets[index];
 const [page,setPage]=useState<"form"|"notes">("form"),[card,setCard]=useState<{field:string;row:string}|null>(null),[contents,setContents]=useState(false);
 const bookNotes=useResource<BookNote[]>(`/workbooks/instances/${doc.id}/notes`);
 const reloadNotes=bookNotes.reload,bookList=Array.isArray(bookNotes.data)?bookNotes.data:[];
 useEffect(()=>{if(notesVersion)reloadNotes();},[notesVersion,reloadNotes]);
 useEffect(()=>{setCard(null);setContents(false);},[sheet.key]);
 // Открытый лист — на виду в полосе язычков: у тетради кампании их больше, чем помещается на телефоне.
 const tabsRef=useRef<HTMLElement>(null);
 useEffect(()=>{const nav=tabsRef.current,tab=nav?.querySelector<HTMLElement>(".wb-tab.is-active");if(!nav||!tab)return;const n=nav.getBoundingClientRect(),t=tab.getBoundingClientRect();
  nav.scrollLeft+=t.left-n.left-(n.width-t.width)/2;nav.scrollTop+=t.top-n.top-(n.height-t.height)/2;},[index,single]);
 const go=(key:string)=>{onSheet(key);setPage("form");};
 const notesHere=bookList.filter(n=>n.sheet_key===sheet.key).length+sheetNotes(answers,sheet.key).length;
 const group=card&&sheet.fields.find(f=>f.key===card.field);
 const tabs=<nav ref={tabsRef} className="wb-tabs" aria-label="Листы тетради">
  <button type="button" className="wb-tab" aria-label="Все листы" aria-expanded={contents} onClick={()=>setContents(!contents)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  {template.sheets.map((s,i)=>{const p=sheetProgress(s,answers[s.key]),done=!template.practical&&p.total>0&&p.filled===p.total,active=i===index&&(!single||page==="form"),n=sheetNumber(template,i);return <button type="button" key={s.key} className={`wb-tab${active?" is-active":""}`} aria-current={active?"page":undefined} title={sheetLabel(n,s.title)} aria-label={`${n?`Лист ${n}: `:""}${s.title}${done?", готов":""}`} onClick={()=>go(s.key)}><span className="wb-tab__num">{n||<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>}</span><span className="wb-tab__title">{s.title||n}</span>{done&&<span aria-hidden="true"> ✓</span>}</button>;})}
  {single&&<button type="button" className={`wb-tab wb-tab--notes${page==="notes"?" is-active":""}`} aria-pressed={page==="notes"} onClick={()=>setPage(page==="notes"?"form":"notes")}>Записи{notesHere?` · ${notesHere}`:""}</button>}
 </nav>;
 const progress=sheetProgress(sheet,answers[sheet.key]),ready=sheet.fields.some(f=>f.readiness);
 const prev=template.sheets[index-1],next=template.sheets[index+1],here=sheetNumber(template,index);
 const step=(i:number,s:WorkbookSheet)=>{const n=sheetNumber(template,i);return single?n||s.title:sheetLabel(n,s.title);};
 const lastNumber=[...template.sheets].reverse().find(s=>s.number)?.number;
 const footer=<footer className="wb-footer">
  {prev?<button type="button" onClick={()=>go(prev.key)}>← {step(index-1,prev)}</button>:<span/>}
  {template.practical?<span className="wb-footer__progress">{lastNumber?here&&`${here} / ${lastNumber}`:`${here} / ${template.sheets.length}`}</span>:<span className="wb-footer__progress"><span className={`wb-num ${progress.total&&progress.filled===progress.total?"wb-num--filled":progress.filled?"wb-num--current":"wb-num--empty"}`} aria-hidden="true"/>{ready?"Готовность":"Заполнено"} {progress.filled} из {progress.total}</span>}
  {next?<button type="button" className="wb-next" onClick={()=>go(next.key)}>{step(index+1,next)} →</button>:<span/>}
 </footer>;
 const contentsList=contents&&<div className="wb-contents" role="dialog" aria-label="Все листы">{sheetParts(template).map((g,j)=><section key={j} aria-label={g.part}>{g.part&&<div className="wb-contents__part">{g.part}</div>}<ol>{g.sheets.map(({sheet:s,index:i})=>{const p=sheetProgress(s,answers[s.key]);return <li key={s.key}><button type="button" aria-current={i===index?"page":undefined} onClick={()=>go(s.key)}><b>{sheetNumber(template,i)}</b><span>{s.title}</span><small>{p.filled} / {p.total}</small></button></li>;})}</ol></section>)}</div>;
 const form=<WorkbookScope.Provider value={`${doc.uid}/${sheet.key}`}><SheetForm sheet={sheet} index={index} template={template} answers={answers} change={change} disabled={disabled} onCard={(field,row)=>setCard({field,row})}/></WorkbookScope.Provider>;
 const notes=<SheetNotes sheet={sheet} sheets={template.sheets} answers={answers} change={change} bookNotes={bookList} disabled={disabled}/>;
 if(group&&group.type==="group")return <div className={`wb-book wb-book--card${single?" wb-book--single":""}`}>
  <WorkbookScope.Provider value={`${doc.uid}/${sheet.key}/${card!.row}`}><CardSheet sheet={sheet} group={group} rowId={card!.row} answers={answers} change={change} disabled={disabled} onRow={row=>setCard(row?{field:group.key,row}:null)}/></WorkbookScope.Provider>
 </div>;
 if(single)return <div className="wb-book wb-book--single paper-scope">{tabs}{contentsList}<div className="wb-page">{page==="form"?form:notes}</div>{footer}</div>;
 return <div className="wb-spread">
  <div className="wb-book">
   <div className="wb-pages paper-scope">
    <div className="wb-page wb-page--form">{form}</div>
    <div className="wb-spine" aria-hidden="true"/>
    <div className="wb-page wb-page--notes">{notes}</div>
   </div>
   {tabs}{contentsList}
  </div>
  {footer}
 </div>;
}

function SheetForm({sheet,index,template,answers,change,disabled,onCard}:{sheet:WorkbookSheet;index:number;template:WorkbookInstance["template"];answers:WorkbookAnswers;change:Change;disabled:boolean;onCard:(field:string,row:string)=>void}){
 const values=answers[sheet.key]??{},former=formerAnswers(template,answers);
 // Ответ без своей графы показываем на листе, откуда он пришёл; лист исчез — на первом.
 const here=former.filter(f=>f.path.startsWith(`${sheet.key}/`)||f.label.startsWith(`${sheet.title} · `)||index===0&&!template.sheets.some(s=>f.path.startsWith(`${s.key}/`)||f.label.startsWith(`${s.title} · `)));
 return <>
  <header className="wb-sheet-head">{(sheetNumber(template,index)||sheet.part)&&<div className="paper-label">{[sheetNumber(template,index)&&`Лист ${sheetNumber(template,index)}`,sheet.part].filter(Boolean).join(" · ")}</div>}<h2>{sheet.title}</h2>{sheet.instructions&&<details className="wb-about"><summary>О листе</summary><MentionText text={sheet.instructions}/></details>}</header>
  <fieldset className="wb-fields" disabled={disabled}>{sheet.fields.map(field=>field.type==="group"
   ?<CardList key={field.key} field={field} rows={(Array.isArray(values[field.key])?values[field.key]:[]) as Row[]} disabled={disabled} onOpen={row=>onCard(field.key,row)} onAdd={()=>{const id=crypto.randomUUID(),rows=(Array.isArray(values[field.key])?values[field.key]:[]) as Row[];change(sheet.key,field.key,[...rows,{_id:id}]);onCard(field.key,id);}}/>
   :<WorkbookFieldInput key={field.key} field={field} value={values[field.key]} onChange={v=>change(sheet.key,field.key,v)}/>)}</fieldset>
  {here.length>0&&<details className="workbook-former"><summary>Прежние графы · {here.length}</summary>{here.map(f=><div key={f.path}><strong>{f.label}</strong><p className="muted">{typeof f.value==="string"?f.value:JSON.stringify(f.value)}</p><FormerToRecord value={f.value}/></div>)}</details>}
 </>;
}

/** Повторяемая карточка на листе — кнопка с именем и заполненностью; открывается на весь разворот. */
function CardList({field,rows,disabled,onOpen,onAdd}:{field:WorkbookField;rows:Row[];disabled:boolean;onOpen:(row:string)=>void;onAdd:()=>void}){
 const [summary,setSummary]=useState(false),children=(field.fields??[]).filter(f=>!workbookAnswerless(f));
 return <section className="wb-cards">
  <div className="wb-cards__head"><span className="wb-label">{field.label}</span>{rows.length>0&&<button type="button" className="wb-link" aria-pressed={summary} onClick={()=>setSummary(!summary)}>Сводка ⤢</button>}</div>
  {field.hint&&<small className="wb-hint">{field.hint.replace(/\*+/g,"")}</small>}
  {summary?<div className="wb-summary"><table><thead><tr>{children.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r._id}>{children.map(c=><td key={c.key}><MentionText text={summaryText(c,r)}/></td>)}</tr>)}</tbody></table></div>
  :<div className="wb-cards__grid">{rows.map((r,i)=>{const p=cardProgress(field,r);return <button type="button" key={r._id} className="wb-card-button" onClick={()=>onOpen(r._id)}><span className="wb-card-button__name">{cardName(field,r,i)}</span><span className="wb-card-button__meta">{p.filled} из {p.total} граф</span></button>;})}
   <button type="button" className="wb-card-add" disabled={disabled||rows.length>=500} onClick={onAdd}>+ {field.entity?field.entity[0].toUpperCase()+field.entity.slice(1):"Карточка"}</button></div>}
 </section>;
}

/** Карточка на весь разворот: имя крупно, графы сеткой, соседние карточки стрелками. */
function CardSheet({sheet,group,rowId,answers,change,disabled,onRow}:{sheet:WorkbookSheet;group:WorkbookField;rowId:string;answers:WorkbookAnswers;change:Change;disabled:boolean;onRow:(row:string|null)=>void}){
 const [confirmDialog,confirm]=useConfirm();
 const rows=(Array.isArray(answers[sheet.key]?.[group.key])?answers[sheet.key][group.key]:[]) as Row[];
 const i=rows.findIndex(r=>r._id===rowId);
 useEffect(()=>{if(i<0)onRow(null);},[i,onRow]);
 if(i<0)return null;
 const row=rows[i],name=nameField(group),p=cardProgress(group,row),prev=rows[i-1],next=rows[i+1];
 const set=(key:string,v:unknown)=>change(sheet.key,group.key,rows.map(r=>r._id===rowId?{...r,[key]:v}:r));
 return <article className="wb-card paper-scope" aria-label={`${group.label}: ${cardName(group,row,i)}`}>
  <div className="wb-card__nav">
   <button type="button" className="wb-link" onClick={()=>onRow(null)}>← К листу</button>
   <span className="paper-label">{group.label} · {i+1} из {rows.length}</span>
   <span className="wb-card__siblings">{prev&&<button type="button" className="wb-link" onClick={()=>onRow(prev._id)}>‹ {cardName(group,prev,i-1)}</button>}{next&&<button type="button" className="wb-link" onClick={()=>onRow(next._id)}>{cardName(group,next,i+1)} ›</button>}</span>
  </div>
  <fieldset className="wb-fields" disabled={disabled}>
   <div className="wb-card__title">{name?<input aria-label={name.label} placeholder={name.label} value={typeof row[name.key]==="string"?String(row[name.key]):""} onChange={e=>set(name.key,e.target.value)}/>:<h2>{cardName(group,row,i)}</h2>}<span>{p.filled} из {p.total} граф</span></div>
   <WorkbookRow.Provider value={row}><div className="wb-card__grid">{(group.fields??[]).filter(f=>f!==name).map(f=><WorkbookFieldInput key={f.key} field={f} value={row[f.key]} onChange={v=>set(f.key,v)}/>)}</div></WorkbookRow.Provider>
   <div className="wb-card__actions">
    <button type="button" className="wb-card-add" onClick={()=>{const id=crypto.randomUUID();change(sheet.key,group.key,[...rows,{_id:id}]);onRow(id);}}>+ {group.entity?group.entity[0].toUpperCase()+group.entity.slice(1):"Карточка"}</button>
    <button type="button" className="wb-link" onClick={async()=>{if(!await confirm({message:`Удалить карточку «${cardName(group,row,i)}»?`,confirmLabel:"Удалить",danger:true}))return;change(sheet.key,group.key,rows.filter(r=>r._id!==rowId));onRow(next?._id??prev?._id??null);}}>Удалить карточку</button>
   </div>
  </fieldset>
  {confirmDialog}
 </article>;
}

/** «Записи к этому листу»: заметки из связанных книг (ссылка) и свои записи листа. «→ в графу» копирует текст. */
function SheetNotes({sheet,sheets,answers,change,bookNotes,disabled}:{sheet:WorkbookSheet;sheets:WorkbookSheet[];answers:WorkbookAnswers;change:Change;bookNotes:BookNote[];disabled:boolean}){
 const [draft,setDraft]=useState(""),[all,setAll]=useState(false);
 const own=sheetNotes(answers,sheet.key),books=bookNotes.filter(n=>n.sheet_key===sheet.key);
 const total=bookNotes.length+sheets.reduce((n,s)=>n+sheetNotes(answers,s.key).length,0);
 const targets=sheet.fields.filter(writable);
 const paste=(text:string,fieldKey:string)=>{const before=answers[sheet.key]?.[fieldKey];change(sheet.key,fieldKey,typeof before==="string"&&before.trim()?`${before}\n\n${text}`:text);};
 const toField=(text:string)=>targets.length>0&&<select className="wb-to-field" aria-label="Вставить в графу" value="" disabled={disabled} onChange={e=>{if(e.target.value)paste(text,e.target.value);}}><option value="">→ в графу</option>{targets.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select>;
 const add=()=>{const body=draft.trim();if(!body)return;const note:WorkbookNote={id:crypto.randomUUID(),body,at:new Date().toISOString()};change(WORKBOOK_NOTES,sheet.key,[...own,note]);setDraft("");};
 if(all)return <>
  <header className="wb-sheet-head"><div className="paper-label">Вся тетрадь</div><h2>Все записи</h2><button type="button" className="wb-link" onClick={()=>setAll(false)}>← К этому листу</button></header>
  {sheets.map((s,i)=>{const list=[...bookNotes.filter(n=>n.sheet_key===s.key).map(n=>n.body||n.quote),...sheetNotes(answers,s.key).map(n=>n.body)];return list.length>0&&<section key={s.key} className="wb-notes-group"><div className="paper-label">{sheetLabel(sheetNumber({sheets},i),s.title)}</div>{list.map((text,j)=><p key={j} className="wb-note">{text}</p>)}</section>;})}
  {total===0&&<p className="muted">В тетради пока нет записей.</p>}
 </>;
 return <>
  <header className="wb-sheet-head"><div className="paper-label">К этому листу</div><h2>Записи</h2></header>
  {books.map(n=><article key={n.id} className="wb-note wb-note--taped">
   <p>{n.quote&&<q>{n.quote}</q>}{n.quote&&n.body&&" — "}{n.body}</p>
   <div className="wb-note__meta"><Link to={`/mastering?book=${n.book_id}`}>↗ {n.book_title}</Link>{toField(n.body||n.quote)}</div>
  </article>)}
  {own.map(n=><article key={n.id} className="wb-note">
   <p>{n.body}</p>
   <div className="wb-note__meta"><button type="button" className="wb-link" disabled={disabled} onClick={()=>change(WORKBOOK_NOTES,sheet.key,own.filter(o=>o.id!==n.id))}>Убрать</button>{toField(n.body)}</div>
  </article>)}
  {books.length+own.length===0&&<div className="wb-empty-notes"><span className="wb-empty-notes__art" aria-hidden="true"/><p><b>К этому листу записей пока нет</b></p><p className="muted">Выдели фразу в связанной книге и добавь заметку — она появится здесь. Или пиши сразу.</p></div>}
  <label className="wb-new-note"><span className="sr-only">Новая запись</span><textarea className="wb-ruled" rows={3} placeholder="+ Новая запись" value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();add();}}}/></label>
  {draft.trim()&&<button type="button" className="wb-next" onClick={add}>Записать</button>}
  {total>0&&<button type="button" className="wb-link wb-all-notes" onClick={()=>setAll(true)}>Все записи тетради · {total}</button>}
 </>;
}

