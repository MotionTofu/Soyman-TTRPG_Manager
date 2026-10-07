import {describe,it,expect} from "vitest";
import {PRACTICAL_WORKBOOKS,ADVENTURE_WORKBOOK} from "./practicalWorkbooks";
import {validateWorkbookTemplate,validateWorkbookAnswers,sheetProgress,workbookMarkdown,type WorkbookField} from "./workbooks";
import {activityOverview,copyActivityLines} from "./workbookActivity";

describe("практические тетради",()=>{
 it("загружает все три шаблона без учебных заданий и готовности курса",()=>{
  for(const template of PRACTICAL_WORKBOOKS){
   expect(()=>validateWorkbookTemplate(template)).not.toThrow();
   expect(template.practical).toBe(true);
   const visit=(fields:WorkbookField[])=>fields.forEach(field=>{
    expect(field.readiness).not.toBe(true);
    expect(field.label).not.toMatch(/занятие|усвоение|домашнее задание|пройдено/i);
    if(field.columns)visit(field.columns);if(field.fields)visit(field.fields);
   });
   template.sheets.forEach(sheet=>visit(sheet.fields));
  }
 });
 it("не считает паспорта, сводки и практические проверки обязательными ответами",()=>{
  const sheet={key:"test",title:"Тест",fields:[
   {key:"passport",label:"Паспорт",type:"profile",entity:"passport"},
   {key:"summary",label:"Сводка",type:"summary",source:"activity/lines"},
   {key:"checks",label:"Проверка",type:"checklist",options:["Путь доступен"],optional:true},
   {key:"notes",label:"Запись",type:"page"},
  ]} as const;
  expect(sheetProgress({...sheet,fields:[...sheet.fields] as WorkbookField[]},{checks:["Путь доступен"]})).toEqual({total:1,filled:0});
 });
 it("сохраняет независимые состояния и вычисляет обзор без копий текста",()=>{
  const lines=[{_id:"a",name:"Беглецы",current:"a-2",states:[{_id:"a-1",name:"Ремонт",goal:"Уехать"},{_id:"a-2",name:"Смена плана",goal:"Бросить карету",action:"Перенести груз",trigger:"Добыли транспорт",traces:"Брошенные вещи"}]},
   {_id:"b",name:"Следователь",current:"b-1",states:[{_id:"b-1",name:"Поиск",action:"Ищет свидетелей"}]}];
  const answers={activity:{lines}};
  expect(()=>validateWorkbookAnswers(ADVENTURE_WORKBOOK,answers)).not.toThrow();
  const before=JSON.stringify(answers);
  const overview=activityOverview(lines);
  expect(overview[0]).toMatchObject({state:"Смена плана",goal:"Бросить карету",action:"Перенести груз"});
  expect(overview[1].state).toBe("Поиск");
  expect(JSON.stringify(answers)).toBe(before);
  expect(activityOverview([{...lines[0],states:[...lines[0].states].reverse()}])[0].state).toBe("Смена плана");
  expect(activityOverview([{...lines[0],states:[]}])[0]).toMatchObject({missing:true,goal:""});
 });
 it("не теряет прежние и вложенные ответы при экспорте",()=>{
  const text=workbookMarkdown(ADVENTURE_WORKBOOK,"Приключение",{old:{lesson:"Сохранить запись"},activity:{lines:[{_id:"x",name:"Сила",states:[{_id:"s",name:"Старт",legacy:"Старое описание"}]}]}});
  expect(text).toContain("Сохранить запись");expect(text).toContain("Старое описание");
 });
 it("начинает новое проведение независимо от заготовки и не дублирует импорт",()=>{
  const source=[{_id:"plan",name:"Сила",current:"last",actual:"Старая игра",states:[{_id:"first",name:"Начало"},{_id:"last",name:"Финал"}]}];
  let count=0;const id=()=>`new-${++count}`;
  const copy=copyActivityLines(source,[],"author-book",id);
  expect(copy[0]).toMatchObject({_id:"new-1",current:"new-2",actual:""});
  expect(source[0]).toMatchObject({current:"last",actual:"Старая игра"});
  expect(copyActivityLines(source,copy,"author-book",id)).toHaveLength(1);
 });
});
