// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {WorkbookPage} from "./WorkbookPage";
import type {WorkbookInstance} from "../components/workbooks/model";
const mocks=vi.hoisted(()=>({data:null as unknown,put:vi.fn(),after:vi.fn(),reload:vi.fn()}));
vi.mock('../data/hooks',()=>({useResource:()=>({data:mocks.data,reload:mocks.reload,error:null}),useAfterWrite:()=>mocks.after,write:{put:mocks.put}}));
vi.mock('../components/PageFrame',()=>({PageFrame:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('../components/mentions/MentionText',()=>({MentionText:({text}:{text:string})=><span>{text}</span>}));
vi.mock('../api/currentUser',()=>({getCachedUser:()=>({id:1})}));
let initial:WorkbookInstance;
const mount=()=>render(<MemoryRouter initialEntries={['/workbooks/1']}><Routes><Route path="/workbooks/:id" element={<WorkbookPage popout/>}/></Routes></MemoryRouter>);
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();sessionStorage.clear();initial={id:1,uid:'a-stable-instance',title:'Тетрадь',template_id:1,revision:1,project_type:null,project_id:null,archived_at:null,answers:{sheet:{goal:'Исходный',second:'Старый'}},template:{format:'soyman-workbook',schemaVersion:1,key:'generic',version:1,title:'Обычная тетрадь',sheets:[{key:'sheet',title:'Лист',fields:[{key:'goal',label:'Цель',type:'text'},{key:'second',label:'Второе поле',type:'text'}]}]}};mocks.data=initial;});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('редактор рабочей тетради',()=>{
 it('сохраняет ввод с ревизией и не заменяет его фоновым устаревшим ответом',async()=>{
  mocks.put.mockImplementation(async(_path:string,body:{answers:WorkbookInstance['answers']})=>({...initial,answers:body.answers,revision:2}));const ui=mount();fireEvent.change(screen.getByRole('textbox',{name:'Цель'}),{target:{value:'Моя цель'}});
  mocks.data={...initial,answers:{sheet:{goal:'Фоновый ответ'}}};ui.rerender(<MemoryRouter initialEntries={['/workbooks/1']}><Routes><Route path="/workbooks/:id" element={<WorkbookPage popout/>}/></Routes></MemoryRouter>);expect((screen.getByRole('textbox',{name:'Цель'}) as HTMLTextAreaElement).value).toBe('Моя цель');
  await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect(mocks.put).toHaveBeenCalledWith('/workbooks/instances/1',{revision:1,answers:{sheet:{goal:'Моя цель',second:'Старый'}}});expect(screen.getByText(/Сохранено/)).toBeTruthy();expect(localStorage.getItem([...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).find(k=>k?.startsWith('workbookDraft:'))??'missing')).toBeNull();
 });
 it('оставляет ввод при конфликте и сохраняет выбранное объединение',async()=>{
  const server={...initial,revision:2,answers:{sheet:{goal:'Из другого окна',second:'Другой ответ'}}};mocks.put.mockRejectedValueOnce(Object.assign(new Error('Конфликт'),{status:409,payload:{current:server}})).mockImplementation(async(_path:string,body:{answers:WorkbookInstance['answers']})=>({...initial,answers:body.answers,revision:3}));
  mount();fireEvent.change(screen.getByRole('textbox',{name:'Цель'}),{target:{value:'Мой ответ'}});await act(async()=>{await vi.advanceTimersByTimeAsync(800);});expect((screen.getByRole('textbox',{name:'Цель'}) as HTMLTextAreaElement).value).toBe('Мой ответ');expect(screen.getByText('Объединение ответов')).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Сохранить объединённые ответы'}));});expect(mocks.put).toHaveBeenLastCalledWith('/workbooks/instances/1',{revision:2,answers:{sheet:{goal:'Мой ответ',second:'Другой ответ'}}});
 });
});
