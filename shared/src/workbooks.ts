/** Переносимый формат тетради. Ключи полей не зависят от названий и порядка. */
/** «number» и «link» остались от первых шаблонов: разбор Markdown их не порождает, число пишется строкой. */
export type WorkbookPrimitive = "text"|"line"|"page"|"image"|"number"|"choice"|"checklist"|"link";
/** heading и note — текст листа без ответа. */
export type WorkbookStatic = "heading"|"note";
export interface WorkbookField {key:string;label:string;type:WorkbookPrimitive|WorkbookStatic|"table"|"group";hint?:string;options?:string[];columns?:WorkbookField[];fields?:WorkbookField[];required?:boolean;
 /** Заголовок раздела: 2 — «##», 3 — «###». */ level?:2|3;
 /** Строки таблицы, заданные автором (первая колонка); ответ строки хранится с `_id` = ключ строки. */ rows?:{key:string;label:string}[];rowHeader?:string;
 /** Сколько пустых строк или карточек показать сразу. */ minRows?:number;
 /** Чек-лист «Готовность»: по нему считается прогресс листа. */ readiness?:boolean;
 /** Поле канонической модели (`force.want`) и тип сущности карточки — для привязанной тетради. */ bind?:string;entity?:string}
export interface WorkbookSheet {key:string;title:string;instructions?:string;fields:WorkbookField[]}
export interface WorkbookTemplate {format:"soyman-workbook";schemaVersion:1;key:string;version:number;title:string;description?:string;source?:string;sheets:WorkbookSheet[]}
export type WorkbookAnswers=Record<string,Record<string,unknown>>;
const keyPattern=/^[a-z][a-z0-9_-]{0,79}$/;
const dangerous=new Set(["__proto__","prototype","constructor"]);
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function key(value:unknown){return typeof value==="string"&&keyPattern.test(value)&&!dangerous.has(value);}
function text(value:unknown,max=500){return typeof value==="string"&&value.trim().length>0&&value.length<=max;}
export function validateWorkbookTemplate(value:unknown):asserts value is WorkbookTemplate {
 if(!object(value)||value.format!=="soyman-workbook"||value.schemaVersion!==1||!key(value.key)||!Number.isInteger(value.version)||Number(value.version)<1||!text(value.title)||!Array.isArray(value.sheets)||!value.sheets.length||value.sheets.length>200)throw new Error("Некорректный шаблон тетради");
 const sheets=new Set<string>();let count=0;
 const fields=(values:unknown,depth:number)=>{
  if(!Array.isArray(values)||values.length>200||depth>2)throw new Error("Слишком много полей или уровней вложенности");const keys=new Set<string>();
  for(const field of values){if(!object(field)||!key(field.key)||!(field.type==="note"?typeof field.label==="string":text(field.label))||keys.has(String(field.key))||++count>4000)throw new Error("Названия и ключи полей должны быть уникальными");keys.add(String(field.key));
   if(!["text","line","page","image","number","choice","checklist","link","table","group","heading","note"].includes(String(field.type)))throw new Error("Неизвестный тип поля");
   if(field.hint!==undefined&&(typeof field.hint!=="string"||field.hint.length>20000))throw new Error("Слишком длинная подсказка");
   if(field.rows!==undefined){if(field.type!=="table"||!Array.isArray(field.rows)||!field.rows.length||field.rows.length>200)throw new Error("Некорректные строки таблицы");const rows=new Set<string>();for(const row of field.rows){if(!object(row)||!key(row.key)||!text(row.label)||rows.has(String(row.key)))throw new Error("Строки таблицы должны быть уникальными");rows.add(String(row.key));}}
   if(field.minRows!==undefined&&(!Number.isInteger(field.minRows)||Number(field.minRows)<0||Number(field.minRows)>50))throw new Error("Некорректное число строк");
   if(field.level!==undefined&&field.level!==2&&field.level!==3||field.rowHeader!==undefined&&typeof field.rowHeader!=="string"||field.readiness!==undefined&&typeof field.readiness!=="boolean")throw new Error("Некорректное оформление поля");
   if(field.bind!==undefined&&(typeof field.bind!=="string"||!/^[a-z][a-z0-9_.-]{0,79}$/.test(field.bind))||field.entity!==undefined&&!text(field.entity,80))throw new Error("Некорректная привязка поля");
   if(field.type==="choice"||field.type==="checklist"){if(!Array.isArray(field.options)||!field.options.length||field.options.length>100||field.options.some(o=>!text(o,500))||new Set(field.options).size!==field.options.length)throw new Error("Нужны уникальные варианты ответа");}
   if(field.type==="table"){fields(field.columns,depth+1);if((field.columns as WorkbookField[]).some(c=>c.type==="table"||c.type==="group"))throw new Error("Колонки таблицы должны быть простыми полями");}
   if(field.type==="group")fields(field.fields,depth+1);
  }
 };
 for(const sheet of value.sheets){if(!object(sheet)||!key(sheet.key)||sheets.has(String(sheet.key))||!text(sheet.title)||sheet.instructions!==undefined&&(typeof sheet.instructions!=="string"||sheet.instructions.length>200000))throw new Error("Некорректный лист");sheets.add(String(sheet.key));fields(sheet.fields,0);}
 if(JSON.stringify(value).length>2000000)throw new Error("Шаблон слишком большой");
}
export function validateWorkbookAnswers(template:WorkbookTemplate,answers:unknown):asserts answers is WorkbookAnswers {
 if(!object(answers)||JSON.stringify(answers).length>2000000)throw new Error("Ответы слишком большие или имеют неверный формат");
 const safe=(value:unknown,depth=0)=>{if(depth>20)throw new Error("Слишком много уровней ответов");if(Array.isArray(value))value.forEach(v=>safe(v,depth+1));else if(object(value))for(const [k,v] of Object.entries(value)){if(dangerous.has(k))throw new Error("Недопустимый ключ ответа");safe(v,depth+1);}};safe(answers);
 function check(field:WorkbookField,value:unknown){
  if(value===undefined||value===null||value==="")return;
  if(field.type==="heading"||field.type==="note")return;
  if(field.type==="number"){if(typeof value!=="number"||!Number.isFinite(value))throw new Error(`Нужно число: ${field.label}`);}
  else if(field.type==="choice"){if(typeof value!=="string"||!field.options?.includes(value))throw new Error(`Выберите вариант: ${field.label}`);}
  else if(field.type==="checklist"){if(!Array.isArray(value)||value.some(v=>typeof v!=="string"||!field.options?.includes(v))||new Set(value).size!==value.length)throw new Error(`Некорректный список: ${field.label}`);}
  else if(field.type==="table"||field.type==="group"){if(!Array.isArray(value)||value.length>500)throw new Error(`Не больше 500 строк: ${field.label}`);const ids=new Set<string>();for(const row of value){if(!object(row)||typeof row._id!=="string"||!row._id||row._id.length>100||ids.has(row._id))throw new Error("У строк должны быть уникальные постоянные идентификаторы");ids.add(row._id);for(const child of field.columns??field.fields??[])check(child,row[child.key]);}}
  else if(typeof value!=="string"||value.length>100000)throw new Error(`Слишком длинный ответ: ${field.label}`);
 }
 for(const sheet of template.sheets){const values=answers[sheet.key];if(values!==undefined){if(!object(values))throw new Error("Некорректный лист ответов");for(const field of sheet.fields)check(field,values[field.key]);}}
 // Неизвестные ключи сохраняются: ответы исчезнувших полей доступны при экспорте.
}
const filledValue=(v:unknown)=>v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length>0);
const answerless=(field:WorkbookField)=>field.type==="heading"||field.type==="note";
/** Прогресс листа — по чек-листу «Готовность», без него — по заполненным графам. */
export function sheetProgress(sheet:WorkbookSheet,values:Record<string,unknown>={}){
 const ready=sheet.fields.find(f=>f.readiness&&f.type==="checklist");
 if(ready){const v=values[ready.key];return {total:ready.options?.length??0,filled:Array.isArray(v)?v.length:0};}
 let total=0,filled=0;for(const field of sheet.fields)if(!answerless(field)){total++;if(filledValue(values[field.key]))filled++;}return {total,filled};
}
export function workbookProgress(template:WorkbookTemplate,answers:WorkbookAnswers){let total=0,filled=0;for(const sheet of template.sheets){const p=sheetProgress(sheet,answers[sheet.key]);total+=p.total;filled+=p.filled;}return {total,filled};}

/** Подписи прежних граф, которые обновление шаблона сохранило в ответах. */
export const FORMER_LABELS="_former";
/** Свои записи к листам: `answers._notes[sheetKey]`. Заметки в книгах сюда не копируются — их тетрадь читает по ссылке. */
export const WORKBOOK_NOTES="_notes";
export interface WorkbookNote {id:string;body:string;at:string}
const reserved=(key:string)=>key===FORMER_LABELS||key===WORKBOOK_NOTES;
export function sheetNotes(answers:WorkbookAnswers,sheetKey:string):WorkbookNote[]{const list=(answers[WORKBOOK_NOTES] as Record<string,unknown>|undefined)?.[sheetKey];return Array.isArray(list)?list.filter((n):n is WorkbookNote=>object(n)&&typeof n.id==="string"&&typeof n.body==="string"):[];}
/** «Прежние графы»: ответы, которым в текущем шаблоне нет графы. Ничего не удаляется — их можно перенести вручную. */
export function formerAnswers(template:WorkbookTemplate,answers:WorkbookAnswers){
 const labels=(answers[FORMER_LABELS]??{}) as Record<string,string>,out:{path:string;label:string;value:unknown}[]=[];
 for(const [sheetKey,values] of Object.entries(answers)){
  if(reserved(sheetKey)||!object(values))continue;
  const sheet=template.sheets.find(s=>s.key===sheetKey);
  for(const [fieldKey,value] of Object.entries(values))if(filledValue(value)&&!sheet?.fields.some(f=>f.key===fieldKey&&!answerless(f)))out.push({path:`${sheetKey}/${fieldKey}`,label:labels[`${sheetKey}/${fieldKey}`]??fieldKey,value});
 }
 return out;
}
const norm=(s:string)=>s.toLowerCase().replace(/ё/g,"е").replace(/[^\p{L}\p{N}]+/gu," ").trim();
/** Значение старой графы в новой, если тип позволяет; число становится строкой. */
export function convertAnswer(field:WorkbookField,value:unknown):unknown{
 if(["text","line","page","image","link"].includes(field.type))return typeof value==="string"?value:typeof value==="number"?String(value):undefined;
 if(field.type==="number")return typeof value==="number"?value:undefined;
 if(field.type==="choice")return typeof value==="string"&&field.options?.includes(value)?value:undefined;
 if(field.type==="checklist")return Array.isArray(value)&&value.every(v=>typeof v==="string"&&field.options?.includes(v))?value:undefined;
 if(field.type==="table"||field.type==="group")return Array.isArray(value)?value:undefined;
 return undefined;
}
/** Сопоставление ответов старой версии с новой: тот же ключ, иначе тот же лист по названию и графа по названию. */
export function suggestWorkbookMapping(from:WorkbookTemplate,to:WorkbookTemplate,answers:WorkbookAnswers){
 const mapping:Record<string,string>={};
 for(const sheet of from.sheets)for(const field of sheet.fields){
  const value=answers[sheet.key]?.[field.key];if(!filledValue(value))continue;
  const target=to.sheets.find(s=>s.key===sheet.key&&norm(s.title)===norm(sheet.title))??to.sheets.find(s=>norm(s.title)===norm(sheet.title));
  const fits=(f:WorkbookField)=>!answerless(f)&&convertAnswer(f,value)!==undefined;
  let match=target?.fields.find(f=>f.key===field.key&&norm(f.label)===norm(field.label)&&fits(f))??target?.fields.find(f=>norm(f.label)===norm(field.label)&&fits(f));
  let sheetKey=target?.key;
  if(!match){const all=to.sheets.flatMap(s=>s.fields.filter(f=>norm(f.label)===norm(field.label)&&fits(f)).map(f=>({s,f})));if(all.length===1){match=all[0].f;sheetKey=all[0].s.key;}}
  if(match&&sheetKey)mapping[`${sheet.key}/${field.key}`]=`${sheetKey}/${match.key}`;
 }
 return mapping;
}
const notesMarkdown=(notes:WorkbookNote[])=>notes.length?"\n\n### Записи\n\n"+notes.map(n=>`- ${n.body.replace(/\s*\n\s*/g," ")}`).join("\n"):"";
export function workbookMarkdown(template:WorkbookTemplate,title:string,answers:WorkbookAnswers){
 const format=(field:WorkbookField,value:unknown):string=>{if(value==null)return "";if(Array.isArray(value)&&["table","group"].includes(field.type))return value.map((row,i)=>`\n#### ${field.label} ${i+1}\n`+(field.columns??field.fields??[]).map(c=>`**${c.label}:** ${format(c,(row as Record<string,unknown>)[c.key])}`).join("\n\n")).join("\n");return Array.isArray(value)?value.join(", "):String(value);};
 const known=new Set(template.sheets.flatMap(s=>s.fields.map(f=>`${s.key}/${f.key}`)));
 const old=Object.entries(answers).filter(([sheet])=>!reserved(sheet)).flatMap(([sheet,values])=>Object.entries(values).filter(([field])=>!known.has(`${sheet}/${field}`)).map(([field,value])=>`- ${sheet}/${field}: ${JSON.stringify(value)}`));
 const nested=(fields:WorkbookField[],values:Record<string,unknown>,path:string)=>{
  for(const field of fields){const rows=values[field.key],children=field.columns??field.fields;if(!children||!Array.isArray(rows))continue;
   for(const row of rows){if(!object(row))continue;const rowPath=`${path}/${field.key}/${String(row._id)}`;
    for(const [key,value] of Object.entries(row))if(key!=="_id"&&!children.some(c=>c.key===key))old.push(`- ${rowPath}/${key}: ${JSON.stringify(value)}`);
    nested(children,row,rowPath);
   }
  }
 };
 for(const sheet of template.sheets)nested(sheet.fields,answers[sheet.key]??{},sheet.key);
 return `# ${title}\n\nШаблон: ${template.title}, версия ${template.version}\n\n`+template.sheets.map(s=>`## ${s.title}\n\n${s.instructions??""}\n\n`+s.fields.map(f=>f.type==="note"?f.hint??"":f.type==="heading"?`${f.level===3?"####":"###"} ${f.label}`:`**${f.label}:** ${format(f,answers[s.key]?.[f.key])}`).join("\n\n")+notesMarkdown(sheetNotes(answers,s.key))).join("\n\n")+(old.length?`\n\n## Сохранённые ответы прежних полей\n\n${old.join("\n")}`:"");
}
