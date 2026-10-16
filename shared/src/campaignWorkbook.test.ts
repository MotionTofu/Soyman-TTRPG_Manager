import {describe,expect,it} from "vitest";
import {ACTIVITY_LINES,ADVENTURE_WORKBOOK,CAMPAIGN_WORKBOOK,SETTING_WORKBOOK} from "./practicalWorkbooks";
import {suggestWorkbookMapping,validateWorkbookTemplate,type WorkbookField,type WorkbookTemplate} from "./workbooks";

const hash=async(t:WorkbookTemplate)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(t))))].map(b=>b.toString(16).padStart(2,"0")).join("");
const field=(sheet:string,key:string)=>CAMPAIGN_WORKBOOK.sheets.find(s=>s.key===sheet)!.fields.find(f=>f.key===key)!;
/** Все пути граф: `лист/графа/вложенная`. */
const paths=(fields:WorkbookField[],prefix:string):string[]=>fields.flatMap(f=>[`${prefix}/${f.key}:${f.type}`,...paths([...(f.columns??[]),...(f.fields??[])],`${prefix}/${f.key}`),...(f.rows??[]).map(r=>`${prefix}/${f.key}#${r.key}`)]);

describe("тетрадь кампании v4",()=>{
 it("проходит проверку шаблона и имеет версию 4",()=>{
  expect(()=>validateWorkbookTemplate(CAMPAIGN_WORKBOOK)).not.toThrow();
  expect(CAMPAIGN_WORKBOOK).toMatchObject({key:"campaign-design",version:4,title:"Тетрадь кампании"});
 });
 it("листы — как в курсе: номера, названия, части",()=>{
  expect(CAMPAIGN_WORKBOOK.sheets.map(s=>[s.key,s.number??"",s.title,s.part??""])).toEqual([
   ["guide","","Как вести",""],
   ["promise","1","Обещание кампании","Основа"],["agreement","2","Соглашение группы","Основа"],["meetings","3","Порядок встреч","Основа"],["heroes","4","Герой и группа","Основа"],
   ["activity","5","Сохраняемое состояние и процессы","Состояние кампании"],["place","6","Место и доступ","Состояние кампании"],["sides","7","Сторона и отношения","Состояние кампании"],
   ["threads","8","Портфель нитей","Состояние кампании"],["knowledge","9","Знание кампании","Состояние кампании"],["versions","10","Версии и их проверка","Состояние кампании"],
   ["time","11","Время, окна, дорога","Состояние кампании"],["project","12","Долгий проект","Состояние кампании"],["commitments","13","Обязательства и договорённости","Состояние кампании"],
   ["prep","14","Подготовка к встрече","Цикл встречи"],["session","15","Лист встречи","Цикл встречи"],["cards","16–21","Карточки за столом","Цикл встречи"],["after","22","После встречи","Цикл встречи"],
   ["rewards","23","Награды и новые возможности","Пересмотр"],["direction","24","Направление и структура игры","Пересмотр"],["health","25","Здоровье кампании","Пересмотр"],["ending","26","Завершение и наследие","Пересмотр"],
  ]);
 });
 it("ключи граф постоянные: латиница, без переименований",()=>{
  const all=CAMPAIGN_WORKBOOK.sheets.flatMap(s=>paths(s.fields,s.key));
  for(const p of all)expect(p).toMatch(/^[a-z0-9_/#:-]+$/);
  // Снимок фиксирует ключи: переименование графы теряет ответы при обновлении, его видно в ревью.
  expect(all).toMatchSnapshot();
 });
 it("лист activity сохраняет ключи v2: перенос планов и единственная живая строка",()=>{
  expect(field("activity","lines")).toEqual(ACTIVITY_LINES);
  const adventureActivity=ADVENTURE_WORKBOOK.sheets.find(s=>s.key==="activity")!.fields;
  expect(field("activity","intersections")).toEqual(adventureActivity.find(f=>f.key==="intersections"));
  const pressure=field("activity","pressure"),old=adventureActivity.find(f=>f.key==="pressure")!;
  expect(pressure.type).toBe("group");
  for(const f of old.fields!)expect(pressure.fields!.find(n=>n.key===f.key)).toMatchObject({type:f.type,...(f.columns?{columns:f.columns}:{}),...(f.source?{source:f.source}:{})});
 });
 it("статус и «кому известно» в таблицах листов 5 и 11 — выбор У / П / Ч и М / Г / И / В",()=>{
  for(const table of [field("activity","state"),field("time","deadlines")]){
   expect(table.columns!.find(c=>c.key==="status")).toMatchObject({type:"choice",options:["У","П","Ч"]});
   expect(table.columns!.find(c=>c.key==="known")).toMatchObject({type:"choice",options:["М","Г","И","В"]});
  }
 });
 it("карточки встреч начинаются ссылкой на сессию, карточка героя — на персонажа",()=>{
  for(const sheet of ["prep","session","after"])expect(field(sheet,"sessions").fields![0]).toMatchObject({key:"session",type:"reference"});
  expect(field("heroes","cards").fields![0]).toMatchObject({key:"character",type:"reference"});
 });
 it("тетради приключения и сеттинга не изменились ни на символ",async()=>{
  expect(await hash(ADVENTURE_WORKBOOK)).toBe("65e15a3bdb46638b909ef2724e5c6a41a46c6a6e763eed1c3ef103876c40cb84");
  expect(await hash(SETTING_WORKBOOK)).toBe("726d199fc723f2532b4af6b6b294b2b3136fbfc88bee6bd1d3d67d91723a1e2d");
 });
 it("сопоставление не направляет два ответа в одну графу",()=>{
  const line=(key:string,label:string):WorkbookField=>({key,label,type:"line"});
  const from:WorkbookTemplate={format:"soyman-workbook",schemaVersion:1,key:"t",version:1,title:"Т",sheets:[{key:"a",title:"А",fields:[line("x","Сессия")]},{key:"b",title:"Б",fields:[line("y","Сессия")]}]};
  const to:WorkbookTemplate={...from,version:2,sheets:[{key:"c",title:"В",fields:[line("z","Сессия")]}]};
  expect(suggestWorkbookMapping(from,to,{a:{x:"1"},b:{y:"2"}})).toEqual({"a/x":"c/z"});
 });
});
