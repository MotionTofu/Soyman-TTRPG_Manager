/** Переносимый формат тетради. Ключи полей не зависят от названий и порядка. */
export type WorkbookPrimitive = "text"|"number"|"choice"|"checklist"|"link";
export interface WorkbookField {key:string;label:string;type:WorkbookPrimitive|"table"|"group";hint?:string;options?:string[];columns?:WorkbookField[];fields?:WorkbookField[];required?:boolean}
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
  for(const field of values){if(!object(field)||!key(field.key)||!text(field.label)||keys.has(String(field.key))||++count>4000)throw new Error("Названия и ключи полей должны быть уникальными");keys.add(String(field.key));
   if(!["text","number","choice","checklist","link","table","group"].includes(String(field.type)))throw new Error("Неизвестный тип поля");
   if(field.hint!==undefined&&(typeof field.hint!=="string"||field.hint.length>20000))throw new Error("Слишком длинная подсказка");
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
  if(field.type==="number"){if(typeof value!=="number"||!Number.isFinite(value))throw new Error(`Нужно число: ${field.label}`);}
  else if(field.type==="choice"){if(typeof value!=="string"||!field.options?.includes(value))throw new Error(`Выберите вариант: ${field.label}`);}
  else if(field.type==="checklist"){if(!Array.isArray(value)||value.some(v=>typeof v!=="string"||!field.options?.includes(v))||new Set(value).size!==value.length)throw new Error(`Некорректный список: ${field.label}`);}
  else if(field.type==="table"||field.type==="group"){if(!Array.isArray(value)||value.length>500)throw new Error(`Не больше 500 строк: ${field.label}`);const ids=new Set<string>();for(const row of value){if(!object(row)||typeof row._id!=="string"||!row._id||row._id.length>100||ids.has(row._id))throw new Error("У строк должны быть уникальные постоянные идентификаторы");ids.add(row._id);for(const child of field.columns??field.fields??[])check(child,row[child.key]);}}
  else if(typeof value!=="string"||value.length>100000)throw new Error(`Слишком длинный ответ: ${field.label}`);
 }
 for(const sheet of template.sheets){const values=answers[sheet.key];if(values!==undefined){if(!object(values))throw new Error("Некорректный лист ответов");for(const field of sheet.fields)check(field,values[field.key]);}}
 // Неизвестные ключи сохраняются: ответы исчезнувших полей доступны при экспорте.
}
export function workbookProgress(template:WorkbookTemplate,answers:WorkbookAnswers){let total=0,filled=0;for(const sheet of template.sheets)for(const field of sheet.fields){total++;const v=answers[sheet.key]?.[field.key];if(v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length))filled++;}return {total,filled};}
export function workbookMarkdown(template:WorkbookTemplate,title:string,answers:WorkbookAnswers){
 const format=(field:WorkbookField,value:unknown):string=>{if(value==null)return "";if(Array.isArray(value)&&["table","group"].includes(field.type))return value.map((row,i)=>`\n#### ${field.label} ${i+1}\n`+(field.columns??field.fields??[]).map(c=>`**${c.label}:** ${format(c,(row as Record<string,unknown>)[c.key])}`).join("\n\n")).join("\n");return Array.isArray(value)?value.join(", "):String(value);};
 const known=new Set(template.sheets.flatMap(s=>s.fields.map(f=>`${s.key}/${f.key}`)));
 const old=Object.entries(answers).flatMap(([sheet,values])=>Object.entries(values).filter(([field])=>!known.has(`${sheet}/${field}`)).map(([field,value])=>`- ${sheet}/${field}: ${JSON.stringify(value)}`));
 const nested=(fields:WorkbookField[],values:Record<string,unknown>,path:string)=>{
  for(const field of fields){const rows=values[field.key],children=field.columns??field.fields;if(!children||!Array.isArray(rows))continue;
   for(const row of rows){if(!object(row))continue;const rowPath=`${path}/${field.key}/${String(row._id)}`;
    for(const [key,value] of Object.entries(row))if(key!=="_id"&&!children.some(c=>c.key===key))old.push(`- ${rowPath}/${key}: ${JSON.stringify(value)}`);
    nested(children,row,rowPath);
   }
  }
 };
 for(const sheet of template.sheets)nested(sheet.fields,answers[sheet.key]??{},sheet.key);
 return `# ${title}\n\nШаблон: ${template.title}, версия ${template.version}\n\n`+template.sheets.map(s=>`## ${s.title}\n\n${s.instructions??""}\n\n`+s.fields.map(f=>`### ${f.label}\n\n${format(f,answers[s.key]?.[f.key])}`).join("\n\n")).join("\n\n")+(old.length?`\n\n## Сохранённые ответы прежних полей\n\n${old.join("\n")}`:"");
}
