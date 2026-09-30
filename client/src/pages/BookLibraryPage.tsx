import {useEffect,useMemo,useRef,useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {Link,useLocation,useNavigate,useSearchParams} from "react-router-dom";
import {readOnce} from "../data/imperative";
import {attemptWithNotice} from "../data/notices";
import {resourceQuery,useAction,useResource,write} from "../data/hooks";
import {getCachedUser} from "../api/currentUser";
import {PageFrame} from "../components/PageFrame";
import {SectionBackground} from "../components/SectionBackground";
import {Modal} from "../components/Modal";
import {NavIcon} from "../components/NavIcons";
import {LoadErrorCard,ListSkeleton} from "../components/Loadable";
import {useConfirm} from "../hooks/useConfirm";
import {MasteringShelf} from "../components/mastering/MasteringShelf";
import {MasteringReader} from "../components/mastering/MasteringReader";
import {MasteringBookForm} from "../components/mastering/MasteringBookForm";
import type {MasteringDraft} from "../components/mastering/masteringTypes";
import {LIBRARY_AFFECTS,type LibraryBook,type LibraryCatalog,type LibraryDepartment,type LibraryShelf} from "../components/mastering/libraryTypes";
import type {MasteringSection,System} from "../types";
import "./mastering-library.css";
import "./book-library.css";

const EMPTY_BOOKS:LibraryBook[]=[],EMPTY_DEPARTMENTS:LibraryDepartment[]=[],EMPTY_SHELVES:LibraryShelf[]=[],EMPTY_SYSTEMS:System[]=[];
const collator=new Intl.Collator("ru",{numeric:true,sensitivity:"base"});
function shelfView(shelf:LibraryShelf):MasteringSection{return {...shelf,category:"prep",system_id:null,created_at:""};}

export function BookLibraryPage(){
 const [params,setParams]=useSearchParams(),navigate=useNavigate(),location=useLocation(),run=useAction();
 const [confirmDialog,confirm]=useConfirm();
 const department=params.get("department")??"room",selectedId=Number(params.get("book"))||null;
 const [query,setQuery]=useState(params.get("q")??"");
 const [format,setFormat]=useState(""),[system,setSystem]=useState(""),[notesOnly,setNotesOnly]=useState(false),[filtersOpen,setFiltersOpen]=useState(false);
 const [pages,setPages]=useState(1),[dragged,setDragged]=useState<number|null>(null);
 const [organization,setOrganization]=useState<{kind:"department"|"shelf";id:number|null;name:string;department:number|null;position:number}|null>(null);
 const [draft,setDraft]=useState<MasteringDraft|null>(null),[draftDepartment,setDraftDepartment]=useState<number|null>(null);
 const [placement,setPlacement]=useState<LibraryBook|null>(null),[placementDepartment,setPlacementDepartment]=useState<number|null>(null),[placementShelf,setPlacementShelf]=useState<number|null>(null),[placementCover,setPlacementCover]=useState("");
 const upload=useRef<HTMLInputElement>(null),order=useRef<number[]>((location.state as {library?:{order:number[]}}|null)?.library?.order??[]),scroll=useRef(0);
 const departmentQuery=useResource<LibraryDepartment[]>("/book-library/departments"),shelfQuery=useResource<LibraryShelf[]>("/book-library/shelves");
 const departments=departmentQuery.data??EMPTY_DEPARTMENTS,shelves=shelfQuery.data??EMPTY_SHELVES,systems=useResource<System[]>("/systems").data??EMPTY_SYSTEMS;
 const filter=new URLSearchParams({limit:"100"});if(query.trim())filter.set("q",query.trim());else if(department!=="room")filter.set("department",department);
 if(format)filter.set("format",format);if(system)filter.set("system",system);if(notesOnly)filter.set("notes","1");
 const first=useResource<LibraryCatalog>(`/book-library/books?${filter}`,{keepPrevious:true});
 const additional=useQueries({queries:Array.from({length:pages-1},(_,i)=>resourceQuery<LibraryCatalog>(`/book-library/books?${filter}&offset=${(i+1)*100}`))});
 const books=useMemo(()=>[...(first.data?.books??EMPTY_BOOKS),...additional.flatMap(page=>page.data?.books??EMPTY_BOOKS)],[first.data,additional]);
 const selection=useResource<LibraryBook>(selectedId?`/book-library/books/${selectedId}`:null);
 const selected=selection.data;
 const neighbors=useResource<{previous:LibraryBook|null;next:LibraryBook|null}>(selectedId?`/book-library/books/${selectedId}/neighbors`:null).data;
 const recent=useResource<LibraryCatalog>(department==="room"&&!query?"/book-library/books?recent=1&limit=12":null).data?.books??EMPTY_BOOKS;
 const pins=useResource<LibraryCatalog>(department==="room"&&!query?"/book-library/books?bookmarked=1&limit=100":null).data?.books??EMPTY_BOOKS;
 const coverBooks=[...books,...pins,...recent];
 const coversNeeded=[...new Set(coverBooks.flatMap(book=>/^soyman:resource\/([0-9a-f-]{36})$/i.exec(book.cover_image??"")?.[1]??[]))];
 const resolved=useResource<{uid:string;file_url:string|null}[]>(coversNeeded.length?`/resources/resolve?uids=${coversNeeded.join(",")}`:null);
 const covers=new Map<string,string>();for(const book of coverBooks){if(!book.cover_image)continue;if(!book.cover_image.startsWith("soyman:"))covers.set(book.cover_image,book.cover_image);else{const image=resolved.data?.find(image=>book.cover_image!.endsWith(image.uid));if(image?.file_url)covers.set(book.cover_image,image.file_url);}}
 
 const bookmarked=new Set([...books,...pins,...recent].filter(book=>book.bookmarked).map(book=>book.id));
 const firstReady=!!first.data,selectionReady=!!selected;
 const currentSelection=useRef(selected);currentSelection.current=selected;
 const redirectContext=useRef({selected,params,books});redirectContext.current={selected,params,books};
 useEffect(()=>{setPages(1);},[department,query,format,system,notesOnly]);
 useEffect(()=>{if(!selectedId||!currentSelection.current)return;void run(()=>write.put(`/book-library/books/${selectedId}/state`,{opened:true}),{affects:[{path:"/book-library/books?recent=1"}],retry:false});},[selectedId,selectionReady,run]);
 useEffect(()=>{
  const {selected,params,books}=redirectContext.current;
  if(selected?.format==="workbook"){navigate(`/workbooks/${selected.source_id}`,{replace:true});return;}
  if(selected?.source_type!=="resource"||selected.format!=="pdf")return;
  const position=selected.position.page;const search=selected.format==="pdf"&&typeof position==="number"?`?page=${position}${params.get("notes")==="1"?"&notes=1":""}`:params.get("notes")==="1"?"?notes=1":"";
  const from=new URLSearchParams(params);from.delete("book");from.delete("notes");
  navigate(`/resources/${selected.source_id}/${selected.format==="pdf"?"read":"markdown-file"}${search}`,{replace:true,state:{from:`/mastering?${from}`,library:{bookId:selected.id,order:order.current.length?order.current:books.filter(b=>b.shelf_id===selected.shelf_id&&b.department_id===selected.department_id).sort((a,b)=>collator.compare(a.title,b.title)).map(b=>b.id),position:selected.position}}});
 },[selected?.id,selected?.source_type,navigate]);
 useEffect(()=>{
  if(!firstReady)return;const user=getCachedUser()?.id??"gm",key=`masteringBookBookmarks:${user}`,marker=`libraryBookmarksImported:${user}`;
  if(localStorage.getItem(marker))return;let ids:unknown;try{ids=JSON.parse(localStorage.getItem(key)??"[]");}catch{return;}
  if(!Array.isArray(ids))return;const source_ids=ids.filter(id=>Number.isInteger(id)&&id>0);let active=true;
  void run(()=>write.post<{imported:string[]}>("/book-library/legacy-bookmarks",{source_ids}),{affects:LIBRARY_AFFECTS,retry:false}).then(result=>{if(active&&result){localStorage.setItem(marker,JSON.stringify(result.imported));}});return()=>{active=false;};
 },[firstReady,run]);
 useEffect(()=>{if(!selectedId)requestAnimationFrame(()=>{const node=document.querySelector<HTMLElement>(".app-content");if(node)node.scrollTop=scroll.current;});},[selectedId]);
 function changeDepartment(value:string){const next=new URLSearchParams();next.set("department",value);setParams(next);setQuery("");}
 function openBook(id:number,ids:number[],notes=false){scroll.current=document.querySelector<HTMLElement>(".app-content")?.scrollTop??0;order.current=ids;const next=new URLSearchParams(params);next.set("book",String(id));if(notes)next.set("notes","1");else next.delete("notes");if(query)next.set("q",query);setParams(next);}
 function closeBook(){selection.reload();const next=new URLSearchParams(params);next.delete("book");next.delete("notes");setParams(next);}
 async function saveOrganization(){if(!organization?.name.trim())return;const endpoint=organization.kind==="department"?"departments":"shelves";const body={name:organization.name.trim(),position:organization.position,...(organization.kind==="shelf"?{department_id:organization.department}:{})};const saved=await run(()=>organization.id?write.put(`/book-library/${endpoint}/${organization.id}`,body):write.post(`/book-library/${endpoint}`,body),{affects:LIBRARY_AFFECTS,retry:false});if(saved!==undefined)setOrganization(null);}
 async function deleteOrganization(){if(!organization?.id||!await confirm({message:`Удалить «${organization.name}»? Книги сохранятся в библиотеке.`,confirmLabel:"Удалить",danger:true}))return;const result=await run(()=>write.del(`/book-library/${organization.kind==="department"?"departments":"shelves"}/${organization.id}`),{affects:LIBRARY_AFFECTS});if(result!==undefined){if(organization.kind==="department")changeDepartment("room");setOrganization(null);}}
 async function moveBook(id:number,shelfId:number|null,departmentId?:number|null){const moved=await run(()=>write.put(`/book-library/books/${id}`,{shelf_id:shelfId,...(departmentId===undefined?{}:{department_id:departmentId})}),{affects:LIBRARY_AFFECTS});if(moved!==undefined)setDragged(null);}
 function newBook(shelf?:LibraryShelf){setDraftDepartment(shelf?.department_id??(department!=="room"&&department!=="none"?Number(department):null));setDraft({category:"prep",title:"",content:"",system_id:null,section_id:shelf?.id??null,cover_image:null});}
 async function saveBook(value:MasteringDraft){const created=await run(()=>write.post<LibraryBook>("/book-library/articles",{...value,department_id:draftDepartment,shelf_id:value.section_id}),{affects:LIBRARY_AFFECTS,retry:false});return created!==undefined;}
 async function importFile(file:File|undefined){if(!file)return;const data=new FormData();data.append("file",file);data.append("name",file.name.replace(/\.(pdf|md|zip)$/i,""));data.append("scope","global");if(/\.(md|zip)$/i.test(file.name))data.append("type","markdown");const created=await run(()=>write.post<{id:number}>(/\.zip$/i.test(file.name)?"/resources/markdown-bundle":"/resources",data,{timeoutMs:120000}),{affects:[{kind:"resource"}],retry:false});if(!created)return;await attemptWithNotice("Разместить загруженную книгу",async()=>{const result=await readOnce<LibraryCatalog>(`/book-library/books?source_type=resource&source_id=${created.id}`);const book=result?.books.find(book=>book.source_type==="resource"&&book.source_id===created.id);if(book&&department!=="room")await moveBook(book.id,null,department==="none"?null:Number(department));});}
 function showPlacement(book:LibraryBook){setPlacement(book);setPlacementDepartment(book.department_id);setPlacementShelf(book.shelf_id);setPlacementCover(book.cover_image??"");}
 async function savePlacement(){if(!placement)return;const result=await run(()=>write.put(`/book-library/books/${placement.id}`,{department_id:placementDepartment,shelf_id:placementShelf,cover_image:placementCover||null}),{affects:LIBRARY_AFFECTS,retry:false});if(result!==undefined)setPlacement(null);}
 async function uploadCover(file:File|undefined){if(!file||!placement)return;const data=new FormData();data.append("file",file);data.append("name",`Обложка · ${placement.title}`);data.append("scope","global");data.append("category","image");const uploaded=await run(()=>write.post<{uid:string}>("/resources",data),{affects:[{kind:"resource"}],retry:false});if(uploaded)setPlacementCover(`soyman:resource/${uploaded.uid}`);}
 const visibleShelves=shelves.filter(shelf=>query.trim()||department==="room"||department==="none"&&shelf.department_id==null||shelf.department_id===Number(department));
 const effectiveOrder=order.current.length?order.current:books.filter(book=>book.shelf_id===selected?.shelf_id&&book.department_id===selected?.department_id).sort((a,b)=>collator.compare(a.title,b.title)).map(book=>book.id);
 const index=selectedId?effectiveOrder.indexOf(selectedId):-1;
 const legacySections=shelves.filter(shelf=>shelf.legacy_section_id!=null).map(shelf=>({...shelfView(shelf),id:shelf.legacy_section_id!}));
 const sectionFormViews=shelves.filter(shelf=>shelf.department_id===draftDepartment).map(shelfView);
 const filtersActive=!!query.trim()||!!format||!!system||notesOnly;
 const shelfProps=(items:LibraryBook[])=>({books:items,search:filtersActive,covers,bookmarked,dragging:dragged,dragOver:false,onDrag:setDragged,onDrop:(shelfId:number|null)=>{if(dragged)void moveBook(dragged,shelfId);},onOpen:(id:number,ids:number[])=>openBook(id,ids),onNotes:(id:number,ids:number[])=>openBook(id,ids,true),onBookSettings:(id:number)=>{const book=[...books,...recent,...pins].find(book=>book.id===id);if(book)showPlacement(book);}});
 return <PageFrame section="mastering" title="Библиотека" className={`mastering-page mastering-library${selectedId?" is-reading":""}`}>
 {confirmDialog}<SectionBackground/>
 {!selectedId&&<>
 <div className="tabs library-departments" aria-label="Подразделы библиотеки"><button className={department==="room"?"active":""} onClick={()=>changeDepartment("room")}>Читальный зал</button>{departments.map(item=><button key={item.id} className={department===String(item.id)?"active":""} onClick={()=>changeDepartment(String(item.id))}>{item.name}</button>)}<button className={department==="none"?"active":""} onClick={()=>changeDepartment("none")}>Без подраздела</button><button aria-label="Создать подраздел" onClick={()=>setOrganization({kind:"department",id:null,name:"",department:null,position:departments.length})}>+</button></div>
 <div className="mastering-toolbar"><label className="mastering-search"><NavIcon name="search"/><input type="search" aria-label="Поиск по всем книгам" placeholder="Найти книгу…" value={query} onChange={event=>setQuery(event.target.value)}/></label><button onClick={()=>setFiltersOpen(!filtersOpen)}>Фильтры</button><button onClick={()=>upload.current?.click()}>Загрузить PDF / .md</button><button onClick={()=>setOrganization({kind:"shelf",id:null,name:"",department:department==="room"||department==="none"?null:Number(department),position:shelves.length})}>+ Полка</button><button className="primary" onClick={()=>newBook()}>+ Книга</button><input ref={upload} type="file" accept=".pdf,.md,.zip" hidden onChange={event=>{void importFile(event.target.files?.[0]);event.target.value="";}}/></div>
 {department!=="room"&&department!=="none"&&<button className="library-department-settings" onClick={()=>{const item=departments.find(item=>item.id===Number(department));if(item)setOrganization({kind:"department",id:item.id,name:item.name,position:item.position,department:null});}}>Настройки подраздела</button>}
 {filtersOpen&&<div className="mastering-filters"><label>Формат<select value={format} onChange={e=>setFormat(e.target.value)}><option value="">Все</option><option value="pdf">PDF</option><option value="markdown">Маркдаун</option><option value="workbook">Тетрадь</option></select></label><label>Система<select value={system} onChange={e=>setSystem(e.target.value)}><option value="">Все</option><option value="none">Без системы</option>{systems.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><input type="checkbox" checked={notesOnly} onChange={e=>setNotesOnly(e.target.checked)}/>С заметками</label><Link to="/resources">Другие материалы</Link><Link to="/workbooks">Тетради и шаблоны</Link></div>}
 {first.error&&<LoadErrorCard message={first.error} onRetry={first.reload}/>} {first.loading&&!first.data&&<ListSkeleton variant="tiles"/>}
 <div className="mastering-shelves">
 {department==="room"&&!filtersActive&&<><div className="library-room-intro"><h2>Продолжить чтение</h2>{recent.length?<button className="primary" onClick={()=>openBook(recent[0].id,recent.map(book=>book.id))}>{recent[0].title} →</button>:<p>Открой книгу — здесь появится место, на котором ты остановился.</p>}</div>{!!pins.length&&<MasteringShelf shelf={null} title="Закладки" shelfKey="pins" {...shelfProps(pins)} onAdd={()=>newBook()}/>} {!!recent.length&&<MasteringShelf shelf={null} title="Недавно открытые" shelfKey="recent" {...shelfProps(recent)} onAdd={()=>newBook()}/>}<h2 className="library-all-label">Все полки</h2></>}
 {visibleShelves.map(shelf=>{const items=books.filter(book=>book.shelf_id===shelf.id);if(filtersActive&&!items.length)return null;return <MasteringShelf key={shelf.id} shelf={shelfView(shelf)} {...shelfProps(items)} categoryLabel={department==="room"?departments.find(d=>d.id===shelf.department_id)?.name:undefined} initialDescending={!!shelf.descending} onSort={descending=>{void run(()=>write.put(`/book-library/shelves/${shelf.id}`,{descending}),{affects:LIBRARY_AFFECTS});}} onAdd={()=>newBook(shelf)} onEditShelf={()=>setOrganization({kind:"shelf",id:shelf.id,name:shelf.name,department:shelf.department_id,position:shelf.position})}/>;})}
 {!!books.filter(book=>book.shelf_id==null).length&&<MasteringShelf shelf={null} {...shelfProps(books.filter(book=>book.shelf_id==null))} onAdd={()=>newBook()}/>}
 {!books.length&&!first.loading&&<p>Здесь пока нет книг. Добавь книгу или загрузи файл.</p>}
 {first.data&&books.length<first.data.total&&<button onClick={()=>setPages(pages+1)}>Загрузить ещё · {first.data.total-books.length}</button>}
 </div>
 </>}
 {selection.error&&<LoadErrorCard message={selection.error} action={<button onClick={closeBook}>На полку</button>}/>}
 {selectedId&&!selected&&!selection.error&&<ListSkeleton variant="paragraph"/>}
 {selected&&!["pdf","workbook"].includes(selected.format)&&<MasteringReader key={selected.key} book={{...selected,id:selected.source_id}} previousBook={books.find(book=>book.id===effectiveOrder[index-1])??neighbors?.previous??undefined} nextBook={books.find(book=>book.id===effectiveOrder[index+1])??neighbors?.next??undefined} onNavigate={id=>openBook(id,effectiveOrder)} sections={legacySections} systems={systems} saved={selected.bookmarked} onBookmark={()=>{void run(()=>write.put(`/book-library/books/${selected.id}/state`,{bookmarked:!selected.bookmarked}),{affects:LIBRARY_AFFECTS});}} onClose={closeBook} onArchive={async()=>{if(!await confirm({message:`Отправить «${selected.title}» в архив?`,confirmLabel:"В архив",danger:true}))return;const archived=await run(()=>write.del(`/${selected.source_type==="mastering"?"mastering":"resources"}/${selected.source_id}`),{affects:LIBRARY_AFFECTS});if(archived!==undefined)closeBook();}} libraryBook={selected} openNotes={params.get("notes")==="1"} onPlacement={()=>showPlacement(selected)}/>}
 {draft&&<MasteringBookForm initial={draft} hideCategory placementOptions={{departments,department:draftDepartment,onChange:setDraftDepartment}} systems={systems} sections={sectionFormViews} onSubmit={saveBook} onClose={()=>setDraft(null)}/>}
 {organization&&<Modal ariaLabel={organization.kind==="department"?"Подраздел библиотеки":"Полка"} onClose={()=>setOrganization(null)}><form className="stack" onSubmit={e=>{e.preventDefault();void saveOrganization();}}><h2>{organization.kind==="department"?"Подраздел":"Полка"}</h2><label>Название<input required value={organization.name} onChange={e=>setOrganization({...organization,name:e.target.value})}/></label>{organization.kind==="shelf"&&<label>Подраздел<select value={organization.department??""} onChange={e=>setOrganization({...organization,department:e.target.value?Number(e.target.value):null})}><option value="">Без подраздела</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}<label>Порядок<input type="number" min="0" value={organization.position} onChange={e=>setOrganization({...organization,position:Number(e.target.value)})}/></label><div className="mastering-form-actions">{organization.id&&<button type="button" onClick={()=>void deleteOrganization()}>Удалить</button>}<button type="button" onClick={()=>setOrganization(null)}>Отмена</button><button className="primary">Сохранить</button></div></form></Modal>}
 {placement&&<Modal ariaLabel="Размещение и обложка" onClose={()=>setPlacement(null)}><form className="stack" onSubmit={e=>{e.preventDefault();void savePlacement();}}><h2>{placement.title}</h2><label>Подраздел<select value={placementDepartment??""} onChange={e=>{setPlacementDepartment(e.target.value?Number(e.target.value):null);setPlacementShelf(null);}}><option value="">Без подраздела</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Полка<select value={placementShelf??""} onChange={e=>setPlacementShelf(e.target.value?Number(e.target.value):null)}><option value="">Без полки</option>{shelves.filter(s=>s.department_id===placementDepartment).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Обложка<input value={placementCover} placeholder="Ссылка на изображение" onChange={e=>setPlacementCover(e.target.value)}/></label><label>Загрузить обложку<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e=>void uploadCover(e.target.files?.[0])}/></label><div className="mastering-form-actions"><button type="button" onClick={()=>setPlacement(null)}>Отмена</button><button className="primary">Сохранить</button></div></form></Modal>}
 </PageFrame>;
}
