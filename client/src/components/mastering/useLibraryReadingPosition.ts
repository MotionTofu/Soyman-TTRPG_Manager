import {useEffect,useRef,type RefObject} from "react";
import {useAction,write} from "../../data/hooks";
import type {LibraryBook} from "./libraryTypes";

export function useLibraryReadingPosition(book:LibraryBook|undefined,ready:boolean,prose:RefObject<HTMLDivElement|null>){
 const run=useAction();
 const current=useRef(book);current.current=book;const bookId=book?.id;
 useEffect(()=>{
  const book=current.current;
  const root=prose.current,source=root?.closest<HTMLElement>(".app-content");if(!book||!ready||!root||!source)return;
  let timer=0,restoring=true,frame=0;const headings=()=>Array.from(root.querySelectorAll<HTMLElement>(".rt-h"));
  frame=requestAnimationFrame(()=>{
   const position=book.position,node=typeof position.heading==="string"?headings().find(node=>node.textContent===position.heading):undefined;
   if(node){const top=node.getBoundingClientRect().top;source.scrollTop+=top-160+Number(position.headingOffset??0);}
   else if(typeof position.ratio==="number")source.scrollTop=Math.max(0,Math.min(1,position.ratio))*(source.scrollHeight-source.clientHeight);
   restoring=false;
  });
  const save=()=>{if(restoring)return;const nodes=headings();const node=[...nodes].reverse().find(node=>node.getBoundingClientRect().top<160)??nodes[0];
   const position={ratio:source.scrollTop/Math.max(1,source.scrollHeight-source.clientHeight),heading:node?.textContent??null,headingOffset:node?160-node.getBoundingClientRect().top:0};
   void run(()=>write.put(`/book-library/books/${book.id}/state`,{position,opened:true}),{affects:[{path:`/book-library/books/${book.id}`},{path:"/book-library/books?recent=1"}],retry:false});
  };
  const schedule=()=>{clearTimeout(timer);timer=window.setTimeout(save,750);};source.addEventListener("scroll",schedule,{passive:true});
  return()=>{cancelAnimationFrame(frame);clearTimeout(timer);save();source.removeEventListener("scroll",schedule);};
 },[bookId,ready,prose,run]);
}
