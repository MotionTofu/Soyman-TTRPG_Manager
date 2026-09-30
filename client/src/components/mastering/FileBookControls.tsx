import {WorkbookLinks} from "../workbooks/WorkbookLinks";
import {useEffect,useRef} from "react";
import {Link,useLocation,useParams} from "react-router-dom";
import {useAction,useResource,write} from "../../data/hooks";
import type {LibraryBook,LibraryCatalog} from "./libraryTypes";

export function FileBookControls({page,ready=false,onRestore}:{page?:number;ready?:boolean;onRestore?:(page:number)=>void}){
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
 useEffect(()=>{if(!bookId||!ready||page==null)return;const timer=setTimeout(()=>{void run(()=>write.put(`/book-library/books/${bookId}/state`,{position:{page},opened:true}),{affects:[{path:`/book-library/books/${bookId}`},{path:"/book-library/books?recent=1"}],retry:false});},500);return()=>clearTimeout(timer);},[bookId,page,ready,run]);
 const from=(location.state as {from?:string}|null)?.from??"/mastering";
 const target=(id:number)=>{const url=new URL(from,window.location.origin);url.pathname="/mastering";url.searchParams.set("book",String(id));return url.pathname+url.search;};
 return <div className="library-file-controls" aria-label="Книги на полке">{bookId&&<WorkbookLinks bookId={bookId}/> }{previous?<Link to={target(previous.id)} title={previous.title} state={{library:{bookId:previous.id,order}}}>← Предыдущая</Link>:<button disabled>← Предыдущая</button>}{next?<Link to={target(next.id)} title={next.title} state={{library:{bookId:next.id,order}}}>Следующая →</Link>:<button disabled>Следующая →</button>}{book&&<button aria-pressed={book.bookmarked} onClick={()=>{void run(()=>write.put(`/book-library/books/${book.id}/state`,{bookmarked:!book.bookmarked}),{affects:[{path:"/book-library"}]});}}>{book.bookmarked?"Убрать закладку":"В закладки"}</button>}</div>;
}
