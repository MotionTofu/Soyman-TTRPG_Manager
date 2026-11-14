import {WorkbookLinks} from "../workbooks/WorkbookLinks";
import {useEffect,useRef,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {Link,useLocation,useParams} from "react-router-dom";
import {useAction,useResource,write} from "../../data/hooks";
import type {LibraryBook,LibraryCatalog} from "./libraryTypes";

export function FileBookControls({page,pageCount,ready=false,onRestore,readerHeader}:{page?:number;pageCount?:number;ready?:boolean;onRestore?:(page:number)=>void;readerHeader?:{actions:HTMLElement|null;bookmarkIcon:ReactNode;metadata:HTMLElement|null}}){
 const location=useLocation(),{id}=useParams(),run=useAction();
 const context=(location.state as {library?:{bookId:number;order:number[]};from?:string}|null)?.library;
 const listing=useResource<LibraryCatalog>(context?null:`/book-library/books?source_id=${id}&source_type=resource`);
 const bookId=context?.bookId??listing.data?.books.find(book=>book.source_type==="resource"&&book.source_id===Number(id))?.id;
 const book=useResource<LibraryBook>(bookId?`/book-library/books/${bookId}`:null).data;
 const restored=useRef<number|null>(null),restore=useRef(onRestore);restore.current=onRestore;
 useEffect(()=>{if(!book||!ready||restored.current===book.id)return;restored.current=book.id;if(!new URLSearchParams(location.search).has('page')&&typeof book.position.page==='number')restore.current?.(book.position.page);},[book,ready,location.search]);
 const order=context?.order??[],index=bookId?order.indexOf(bookId):-1;
 const before=index>0?order[index-1]:null,after=index>=0&&index<order.length-1?order[index+1]:null;
 const neighbors=useResource<{previous:LibraryBook|null;next:LibraryBook|null}>(bookId?`/book-library/books/${bookId}/neighbors`:null).data;
 const previous=useResource<LibraryBook>(before?`/book-library/books/${before}`:null).data??neighbors?.previous,next=useResource<LibraryBook>(after?`/book-library/books/${after}`:null).data??neighbors?.next;
 useEffect(()=>{
  if(!bookId||!book||!ready||page==null||!pageCount)return;
  const stored=book.position;
  if(stored.page===page&&stored.pageCount===pageCount&&book.last_opened)return;
  const timer=setTimeout(()=>{void run(()=>write.put(`/book-library/books/${bookId}/state`,{position:{page,pageCount},opened:true}),{affects:[{path:`/book-library/books/${bookId}`},{path:"/book-library/books?recent=1"}],retry:false});},500);return()=>clearTimeout(timer);},[bookId,book,page,pageCount,ready,run]);
 const from=(location.state as {from?:string}|null)?.from??"/mastering";
 const target=(id:number)=>{const url=new URL(from,window.location.origin);url.pathname="/mastering";url.searchParams.set("book",String(id));return url.pathname+url.search;};
 const bookmarkLabel=book?.bookmarked?"Убрать закладку":"В закладки";
 const bookmark=book&&<button type="button" className={readerHeader?"d-btn pdf-reader__icon-button":undefined}
  aria-label={bookmarkLabel} title={bookmarkLabel} aria-pressed={book.bookmarked}
  onClick={()=>{void run(()=>write.put(`/book-library/books/${book.id}/state`,{bookmarked:!book.bookmarked}),{affects:[{path:"/book-library"}]});}}>
  {readerHeader?.bookmarkIcon??bookmarkLabel}</button>;
 return <>
  {readerHeader?.actions&&createPortal(bookmark,readerHeader.actions)}
  {book&&readerHeader?.metadata&&createPortal(
   [book.department_name,book.section_name].filter(Boolean).map(name=>` · ${name}`).join(""),
   readerHeader.metadata,
  )}
  <div className="library-file-controls" aria-label="Книги на полке">
   {bookId&&<WorkbookLinks bookId={bookId}/>}
   {previous?<Link to={target(previous.id)} title={previous.title} state={{library:{bookId:previous.id,order}}}>← Предыдущая</Link>:<button disabled>← Предыдущая</button>}
   {next?<Link to={target(next.id)} title={next.title} state={{library:{bookId:next.id,order}}}>Следующая →</Link>:<button disabled>Следующая →</button>}
   {!readerHeader&&bookmark}
  </div>
 </>;
}
