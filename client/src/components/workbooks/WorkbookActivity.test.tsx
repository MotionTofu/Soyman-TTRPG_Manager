// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {WorkbookActivitySummary,WorkbookState} from "./WorkbookActivity";
import {WorkbookContext,WorkbookRow,type WorkbookInstance} from "./model";
import {ADVENTURE_WORKBOOK} from "@shared/practicalWorkbooks";
vi.mock('../mentions/MentionText',()=>({MentionText:({text}:{text:string})=><span>{text}</span>}));
afterEach(cleanup);
describe('часы в тетради',()=>{
 it('выбирает постоянный ID состояния и показывает удалённое состояние явно',()=>{
  const change=vi.fn(),field={key:'current',label:'Состояние',type:'state' as const,source:'states'};
  const ui=render(<WorkbookRow.Provider value={{states:[{_id:'later',name:'Позже'},{_id:'start',name:'Начало'}]}}><WorkbookState field={field} value="start" onChange={change}/></WorkbookRow.Provider>);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('start');
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'later'}});expect(change).toHaveBeenCalledWith('later');
  ui.rerender(<WorkbookRow.Provider value={{states:[]}}><WorkbookState field={field} value="start" onChange={change}/></WorkbookRow.Provider>);
  expect(screen.getByRole('option',{name:'Состояние удалено — выберите другое'})).toBeTruthy();
 });
 it('обновляет обзор из выбранной строки и открывает лист исходных линий',()=>{
  const doc={id:1,uid:'book',template:ADVENTURE_WORKBOOK} as WorkbookInstance,onSheet=vi.fn();
  const lines=[{_id:'line',name:'Беглец',current:'start',states:[{_id:'start',name:'Ремонт',goal:'Починить карету',action:'Ищет колесо'},{_id:'next',name:'Побег',goal:'Уйти пешком',action:'Бросает карету'}]}];
  const field={key:'summary',label:'Деятельность',type:'summary' as const,source:'activity/lines'};
  const ui=render(<WorkbookContext.Provider value={{document:doc,answers:{activity:{lines}},onSheet}}><WorkbookActivitySummary field={field}/></WorkbookContext.Provider>);
  expect(screen.getByText('Ищет колесо')).toBeTruthy();
  ui.rerender(<WorkbookContext.Provider value={{document:doc,answers:{activity:{lines:[{...lines[0],current:'next'}]}},onSheet}}><WorkbookActivitySummary field={field}/></WorkbookContext.Provider>);
  expect(screen.getByText('Бросает карету')).toBeTruthy();expect(screen.queryByText('Ищет колесо')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Открыть линии →'}));expect(onSheet).toHaveBeenCalledWith('activity');
 });
});
