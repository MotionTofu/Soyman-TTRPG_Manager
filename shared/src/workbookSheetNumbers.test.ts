import {describe,expect,it} from "vitest";
import {PRACTICAL_WORKBOOKS} from "./practicalWorkbooks";
import {sheetNumber,sheetParts,validateWorkbookTemplate,workbookMarkdown,type WorkbookTemplate} from "./workbooks";

const base=(sheets:WorkbookTemplate["sheets"]):WorkbookTemplate=>({format:"soyman-workbook",schemaVersion:1,key:"t",version:1,title:"Т",sheets});
const plain=base([{key:"a",title:"Первый",fields:[{key:"x",type:"line",label:"Икс"}]},{key:"b",title:"Второй",fields:[{key:"y",type:"line",label:"Игрек"}]}]);
const numbered=base([
 {key:"guide",title:"Как вести",fields:[{key:"n",type:"note",label:""}]},
 {key:"promise",title:"Обещание",number:"1",part:"Основа",fields:[{key:"x",type:"line",label:"Икс"}]},
 {key:"place",title:"Место",number:"6",part:"Состояние",fields:[{key:"y",type:"line",label:"Игрек"}]},
 {key:"cards",title:"Карточки",number:"16–21",part:"Состояние",fields:[{key:"z",type:"line",label:"Зет"}]},
]);

describe("номер и часть листа",()=>{
 it("шаблон без номеров нумеруется по порядку и экспортируется как прежде",()=>{
  expect([0,1].map(i=>sheetNumber(plain,i))).toEqual(["01","02"]);
  expect(sheetParts(plain)).toEqual([{part:undefined,sheets:[{sheet:plain.sheets[0],index:0},{sheet:plain.sheets[1],index:1}]}]);
  const md=workbookMarkdown(plain,"Т",{});
  expect(md).toContain("## Первый\n");expect(md).toContain("## Второй\n");
 });
 it("лист без номера среди нумерованных остаётся без номера и не сдвигает остальные",()=>{
  expect(numbered.sheets.map((_,i)=>sheetNumber(numbered,i))).toEqual(["","1","6","16–21"]);
  expect(sheetParts(numbered).map(g=>[g.part,g.sheets.map(s=>s.sheet.key)])).toEqual([[undefined,["guide"]],["Основа",["promise"]],["Состояние",["place","cards"]]]);
  const md=workbookMarkdown(numbered,"Т",{});
  expect(md).toContain("## Как вести\n");expect(md).toContain("## 6. Место\n");expect(md).toContain("## 16–21. Карточки\n");
 });
 it("валидация принимает номер и часть и отклоняет длинные и не строковые",()=>{
  expect(()=>validateWorkbookTemplate(numbered)).not.toThrow();
  const bad=(patch:Record<string,unknown>)=>()=>validateWorkbookTemplate(base([{key:"a",title:"А",fields:[],...patch} as WorkbookTemplate["sheets"][number]]));
  expect(bad({number:6})).toThrow("Некорректный лист");
  expect(bad({number:"1".repeat(21)})).toThrow("Некорректный лист");
  expect(bad({part:"ч".repeat(81)})).toThrow("Некорректный лист");
  expect(bad({part:" "})).toThrow("Некорректный лист");
 });
 it("практические шаблоны номеров и частей пока не задают",()=>{
  for(const t of PRACTICAL_WORKBOOKS)expect(t.sheets.some(s=>s.number!==undefined||s.part!==undefined)).toBe(false);
 });
});
