import example from "../../client/public/workbook-example.md?raw";
import {describe,expect,it} from "vitest";
import {parseWorkbookMarkdown} from "./workbookMarkdown";
import {formerAnswers,sheetProgress,suggestWorkbookMapping,validateWorkbookTemplate,type WorkbookTemplate} from "./workbooks";

describe("тетрадь из Markdown",()=>{
 const {template,explicit}=parseWorkbookMarkdown(example);
 const [title,first,second]=template.sheets;
 const field=(key:string)=>first.fields.find(f=>f.key===key)!;
 it("понимает разметку курса и проходит проверку модели",()=>{
  expect(()=>validateWorkbookTemplate(template)).not.toThrow();
  expect(explicit).toEqual({key:true,version:true});
  expect(template).toMatchObject({key:"travel-journal",version:1,title:"Журнал путешествия"});
  expect(title.fields.map(f=>[f.label,f.type])).toEqual([["Название похода","line"]]);
  expect(first.key).toBe("sbory");
  expect(first.instructions).toContain("РЕЗУЛЬТАТ ЛИСТА");
  expect(field("kuda")).toMatchObject({type:"line"});
  expect(field("dney-v-puti")).toMatchObject({type:"line",hint:"дней"});
  expect(field("sezon")).toMatchObject({type:"choice",options:["весна","лето","осень","зима"]});
  expect(field("zachem-idem")).toMatchObject({type:"text",label:"ЗАЧЕМ ИДЁМ"});
  expect(field("zachem-idem").hint).toContain("Курсив под заголовком");
  expect(field("provodnik").type).toBe("line");
  expect(field("chego-opasaemsya").type).toBe("text");
  expect(field("snaryazhenie")).toMatchObject({type:"checklist",options:["Вода","Верёвка","Карта"]});
  expect(field("dni-puti")).toMatchObject({type:"table",rowHeader:"День",rows:[{key:"pervyy",label:"Первый"},{key:"vtoroy",label:"Второй"}]});
  expect(field("vstrechi")).toMatchObject({type:"group",minRows:2});
  expect(field("vstrechi").fields!.at(-1)).toMatchObject({type:"choice",options:["друг","враг","неясно"]});
  expect(field("poputchik")).toMatchObject({type:"group",entity:"существо"});
  expect(field("poputchik").fields!.map(f=>[f.key,f.bind])).toEqual([["hochet","force.want"],["boitsya",undefined]]);
  expect(field("gotovnost")).toMatchObject({type:"checklist",readiness:true});
  expect(second.fields.map(f=>`${f.label}:${f.type}`)).toEqual(["Погода:line","Решение:choice","Что видели:text","Записки в дороге:page","Набросок карты:image"]);
 });
 it("считает прогресс листа по «Готовности»",()=>{
  expect(sheetProgress(first,{gotovnost:["Маршрут известен."],kuda:"Север"})).toEqual({total:2,filled:1});
  expect(sheetProgress(second,{pogoda:"Ясно"})).toEqual({total:5,filled:1});
 });
 it("переносит ответы старой версии по названиям и оставляет прочее «прежними графами»",()=>{
  const old:WorkbookTemplate={...template,version:0,sheets:[{key:"lesson-1",title:"Лист 1. Сборы",fields:[{key:"f-1",label:"Куда",type:"text"},{key:"f-2",label:"Дней в пути",type:"number"},{key:"f-3",label:"Исчезнувшая графа",type:"text"}]}]};
  const answers={"lesson-1":{"f-1":"Север","f-2":4,"f-3":"Старое"}};
  expect(suggestWorkbookMapping(old,template,answers)).toEqual({"lesson-1/f-1":"sbory/kuda","lesson-1/f-2":"sbory/dney-v-puti"});
  expect(formerAnswers(template,{...answers,_former:{"lesson-1/f-3":"Исчезнувшая графа"}})).toContainEqual({path:"lesson-1/f-3",label:"Исчезнувшая графа",value:"Старое"});
 });
});
