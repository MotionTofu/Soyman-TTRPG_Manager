import {useEffect} from "react";
import {Link} from "react-router-dom";
import {useResource} from "../../data/hooks";
import {openSecondWindow} from "../../electronApi";
import {WorkbookBook} from "./WorkbookBook";
import {WorkbookLinks} from "./WorkbookLinks";
import type {ShelfWorkbook} from "./ShelfWorkbookSelect";
import {useWorkbookEditor} from "./useWorkbookEditor";
import "../../pages/workbook.css";

type BookLink={template_key:string;sheet_key:string|null;instance_id:number|null;instance_title:string|null;instance_archived:string|null};
const close=<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>;

/** Открытая тетрадь: какая и на каком листе. Живёт выше читалки — при переходе к другой книге полки не меняется. */
export type WorkbookDockState={instanceId:number|null;sheet:string|null};

/** Тетрадь у края читалки (макет «Прикреплено к краю»). Открытая — та же тетрадь и тот же лист при смене книги;
 *  при открытии — тетрадь, связанная с книгой, иначе тетрадь полки. */
export function WorkbookDock({bookId,shelfId,state,onState,notesVersion,onClose}:{bookId:number;shelfId:number|null;state:WorkbookDockState;onState:(state:WorkbookDockState)=>void;notesVersion:number;onClose:()=>void}){
 const pinned=state.instanceId!=null;
 const links=useResource<BookLink[]>(pinned?null:`/workbooks/books/${bookId}`),shelf=useResource<ShelfWorkbook>(!pinned&&shelfId?`/workbooks/shelves/${shelfId}`:null);
 const link=links.data?.find(l=>l.instance_id&&!l.instance_archived);
 const found=link?{instanceId:link.instance_id,sheet:link.sheet_key}:shelf.data?{instanceId:shelf.data.instance_id,sheet:null}:null;
 const resolved=!!links.data&&(!shelfId||shelf.data!==undefined);
 const foundId=found?.instanceId??null,foundSheet=found?.sheet??null;
 useEffect(()=>{if(!pinned&&foundId!=null)onState({instanceId:foundId,sheet:foundSheet});},[pinned,foundId,foundSheet,onState]);
 if(pinned)return <DockedWorkbook key={state.instanceId} id={state.instanceId!} sheet={state.sheet} onSheet={sheet=>onState({...state,sheet})} bookId={bookId} notesVersion={notesVersion} onClose={onClose}/>;
 if(resolved&&!found)return <aside className="workbook-dock paper-scope" aria-label="Тетрадь">
  <div className="workbook-dock__head"><strong>Тетрадь</strong><span/><button type="button" aria-label="Закрыть тетрадь" onClick={onClose}>{close}</button></div>
  <div className="wb-page"><div className="wb-empty-notes"><span className="wb-empty-notes__art" aria-hidden="true"/><p><b>Эта книга ещё не связана с тетрадью</b></p><p className="muted">Выбери тетрадь и лист — он будет открываться рядом с книгой.</p><WorkbookLinks bookId={bookId}/></div></div>
 </aside>;
 return <aside className="workbook-dock paper-scope" aria-label="Тетрадь" aria-busy="true"/>;
}

function DockedWorkbook({id,sheet,onSheet,bookId,notesVersion,onClose}:{id:number;sheet:string|null;onSheet:(sheet:string|null)=>void;bookId:number;notesVersion:number;onClose:()=>void}){
 const editor=useWorkbookEditor(id);
 const doc=editor.document,saved=editor.status===""||editor.status==="Сохранено";
 return <aside className="workbook-dock" aria-label={`Тетрадь «${doc?.title??""}»`}>
  <div className="workbook-dock__head">
   <strong>{doc?.title??"Тетрадь"}</strong>
   <span className={`wb-status${saved?"":" is-pending"}`}><span aria-hidden="true"/>{editor.status||"Сохранено"}</span>
   <WorkbookLinks bookId={bookId}/>
   <Link to={`/workbooks/${id}?sheet=${sheet??""}`} aria-label="Открыть разворотом" title="Открыть разворотом"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14"/></svg></Link>
   <button type="button" aria-label="Отдельное окно" title="Отдельное окно" onClick={()=>openSecondWindow(`/workbook-window/${id}?sheet=${sheet??""}`)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button>
   <button type="button" aria-label="Закрыть тетрадь" onClick={onClose}>{close}</button>
  </div>
  {editor.error&&<div className="workbook-error" role="alert"><p>{editor.error}</p>{editor.conflict&&<Link to={`/workbooks/${id}`}>Объединить ответы на развороте</Link>}</div>}
  {doc&&<WorkbookBook doc={doc} answers={editor.answers} change={editor.change} sheetKey={sheet} onSheet={onSheet} single disabled={!!editor.conflict||!!doc.archived_at} notesVersion={notesVersion}/>}
 </aside>;
}
