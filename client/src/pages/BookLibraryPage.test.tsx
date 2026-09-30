// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {BookLibraryPage} from './BookLibraryPage';
import type {LibraryBook} from '../components/mastering/libraryTypes';
const mock=vi.hoisted(()=>({read:vi.fn(),post:vi.fn(),put:vi.fn()}));
vi.mock('../data/hooks',()=>({useResource:(p:string|null)=>({data:mock.read(p),error:null,loading:false,reload:vi.fn()}),resourceQuery:(p:string)=>({queryKey:[p],queryFn:async()=>[]}),useAction:()=>async(a:()=>Promise<unknown>)=>a(),write:{post:mock.post,put:mock.put}}));
vi.mock('../api/currentUser',()=>({getCachedUser:()=>({id:1})}));
vi.mock('../hooks/useConfirm',()=>({useConfirm:()=>[null,vi.fn()]}));
vi.mock('../components/PageFrame',()=>({PageFrame:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('../components/SectionBackground',()=>({SectionBackground:()=>null}));
vi.mock('../components/mentions/MentionTextarea',()=>({MentionTextarea:({value,onChange}:{value:string;onChange:(v:string)=>void})=><textarea aria-label="Текст" value={value} onChange={e=>onChange(e.target.value)}/>}));
vi.mock('../components/mastering/MasteringReader',()=>({MasteringReader:({libraryBook,book,onClose}:{libraryBook:LibraryBook;book:LibraryBook;onClose:()=>void})=><div>Читаем {libraryBook.key}, источник {book.id}<button onClick={onClose}>На полку</button></div>}));
let books:LibraryBook[];
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();localStorage.setItem('libraryLegacyPinsMigrated:1','1');
 books=Array.from({length:20},(_,i)=>({id:i+101,key:`${i%2?'resource':'mastering'}:uid-${i}`,uid:`uid-${i}`,source_type:i%2?'resource':'mastering',source_id:Math.floor(i/2)+1,department_id:1,department_name:'Любые книги',shelf_id:1,section_id:1,section_name:'Большая полка',title:`Книга ${20-i}`,format:'markdown',category:'prep',system_id:null,created_at:'2026-09-30',cover_image:null,reading_minutes:0,note_count:i===0?2:0,bookmarked:false,last_opened:null,mode:null,archived_at:null,position:{}} as LibraryBook));
 mock.read.mockImplementation((p:string|null)=>{
  if(p==='/book-library/departments')return [{id:1,name:'Любые книги',position:0}];
  if(p==='/book-library/shelves')return [{id:1,name:'Большая полка',department_id:1,position:0,descending:0}];
  if(p==='/systems')return [];
  if(p?.startsWith('/book-library/books?'))return {books:p.includes('recent=')||p.includes('bookmarked=')?[]:books,total:books.length};
  if(/^\/book-library\/books\/\d+$/.test(p??''))return books.find(b=>b.id===Number(p!.split('/').pop()));
  return undefined;
 });mock.post.mockResolvedValue({id:301});mock.put.mockResolvedValue({});
 HTMLElement.prototype.scrollTo=vi.fn();HTMLElement.prototype.scrollBy=vi.fn();HTMLElement.prototype.scrollIntoView=vi.fn();
 Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:true})});
 vi.stubGlobal('ResizeObserver',class {cb:()=>void;constructor(cb:()=>void){this.cb=cb;} observe(n:HTMLElement){Object.defineProperty(n,'clientWidth',{configurable:true,value:500});Object.defineProperty(n,'scrollWidth',{configurable:true,value:4000});this.cb();}disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(){return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BookLibraryPage/></MemoryRouter></QueryClientProvider>);}
describe('общая библиотека',()=>{
 it('открывает Читальный зал, сортирует 20 смешанных книг и не смешивает одинаковые ID источников',async()=>{
  mount();expect(screen.getByRole('button',{name:'Читальный зал'})).toBeTruthy();
  const shelf=screen.getByRole('region',{name:'Большая полка'});
  const names=()=>within(shelf).getAllByRole('button',{name:/Открыть книгу:/}).map(b=>b.getAttribute('aria-label'));
  expect(names()[0]).toBe('Открыть книгу: Книга 1');fireEvent.click(within(shelf).getByRole('button',{name:'Сортировка А–Я: Большая полка'}));expect(names()[0]).toBe('Открыть книгу: Книга 20');
  expect(within(shelf).getByText('Заметки · 2')).toBeTruthy();fireEvent.click(within(shelf).getByRole('button',{name:'Заметки к книге: Книга 20'}));expect(await screen.findByText('Читаем mastering:uid-0, источник 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'На полку'}));fireEvent.click(screen.getByRole('button',{name:'Открыть книгу: Книга 19'}));expect(await screen.findByText('Читаем resource:uid-1, источник 1')).toBeTruthy();
 });
 it('создаёт книгу и её размещение одним запросом',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Добавить книгу на полку Большая полка'}));fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Новые правила'}});
  fireEvent.click(within(screen.getByRole('dialog',{name:'Новая книга'})).getByRole('button',{name:'Добавить книгу'}));
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/book-library/articles',expect.objectContaining({title:'Новые правила',department_id:1,shelf_id:1})));
 });
});
