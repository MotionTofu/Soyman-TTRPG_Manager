/**
 * Разбор тетради из Markdown — той разметки, которой уже написаны курсы.
 *
 * `#` — название тетради (первый) и листы (остальные); `##`/`###` — разделы.
 * Графы узнаются по тому, как их рисует автор курса: `**Метка:**` с линией
 * `____` или `_[заполнить]_`, `**Запись:**` под разделом, `- [ ]`/`□`,
 * таблицы с пустыми клетками, формы в блоках ```text. Привязки и всё, чего нет
 * в обычной разметке, — невидимыми комментариями:
 * `<!-- шаблон: key; версия: 2 -->`, `<!-- карточка: существо -->` перед `##`,
 * `<!-- поле: force.want -->`, `<!-- тип: страница -->` перед графой.
 * Стабильный ключ графы или листа — `{#key}` в конце заголовка или метки,
 * иначе транслит первого названия.
 */
import type {WorkbookField,WorkbookSheet,WorkbookTemplate} from "./workbooks";

const TR:Record<string,string>={а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"};
export function workbookSlug(text:string,max=48){
 const s=text.toLowerCase().replace(/[а-яё]/g,c=>TR[c]??"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,max).replace(/-+$/,"");
 return !s?"field":/^[a-z]/.test(s)?s:`n${s}`;
}
const KEY=/\s*\{#([a-z][a-z0-9_-]{0,79})\}\s*$/;
const PLACEHOLDER=/_?\[заполнить\]_?/i;
const RULE=/^_{5,}$/;
const NUM_RULE=/^(?:\d+[.)]|[-*])\s*_{5,}$/;
const CHECK=/^(?:[-*]\s+)?(?:\[[ xX]?\]|□|☐)\s+(.+)$/;
const READINESS=/готовност|самопроверк/i;
const TYPES:Record<string,WorkbookField["type"]>={страница:"page",картинка:"image",изображение:"image",текст:"text",строка:"line"};

/** Метка без разметки; ключ — из `{#key}`, если автор его поставил. */
function label(raw:string){
 const key=raw.match(KEY)?.[1];
 const text=raw.replace(KEY,"").replace(/\*\*|__/g,"").replace(/^[*_]+|[*_]+$/g,"").replace(/\s+/g," ").replace(/[\s:：]+$/,"").trim();
 return {text:text.slice(0,500)||"Графа",key};
}
function options(raw:string){
 const list=[...new Set(raw.split("/").map(o=>o.replace(/_{2,}/g,"").replace(/[\s:]+$/,"").trim().slice(0,500)).filter(Boolean))];
 // «что находят / как найти / ведёт к тайне» — подсказка формата, а не варианты: вариант короткий.
 return list.length>=2&&list.length<=100&&list.every(o=>o.split(/\s+/).length<=2)?list:null;
}
function cells(line:string){return line.replace(/^\s*\|/,"").replace(/\|\s*$/,"").split("|").map(c=>c.trim());}
const empty=(c:string|undefined)=>!(c??"").replace(/<br>/gi,"").trim();

class Target {
 keys=new Set<string>();
 fields:WorkbookField[];
 constructor(fields:WorkbookField[]){this.fields=fields;}
 key(text:string,explicit?:string){const base=explicit??workbookSlug(text);let key=base,n=2;while(this.keys.has(key))key=`${base}-${n++}`;this.keys.add(key);return key;}
}
type Draft=Omit<WorkbookField,"key">;
type Sheet=WorkbookSheet&{target:Target;prose:string[];started?:boolean};

export interface ParsedWorkbook {template:WorkbookTemplate;explicit:{key:boolean;version:boolean}}

export function parseWorkbookMarkdown(markdown:string):ParsedWorkbook {
 // \s в JS ловит и BOM в начале файла.
 const lines=markdown.replace(/^\s+/,"").split(/\r?\n/).map(l=>l.trimEnd());
 const sheets:Sheet[]=[],sheetKeys=new Target([]),description:string[]=[];
 let title="",templateKey:string|undefined,version:number|undefined;
 let sheet=null as Sheet|null,target=new Target([]),section="",directives:Record<string,string>={},prose:string[]=[];

 const open=(key:string,name:string)=>{const fields:WorkbookField[]=[];sheet={key,title:name,fields,target:new Target(fields),prose:[]};sheets.push(sheet);target=sheet.target;section="";return sheet;};
 // Титул — текст и графы до первого листа. Есть графы (название, автор) — это нулевой лист, нет — описание тетради.
 const current=()=>sheet??open(sheetKeys.key("title"),title);
 function add(draft:Draft,explicitKey?:string){
  const s=current();
  if(!s.started&&target===s.target&&draft.type!=="note")flush();
  s.started=true;
  const field={...draft} as WorkbookField;
  if(field.type!=="heading"&&field.type!=="note"){
   const hint=prose.join("\n").trim();prose=[];
   if(hint)field.hint=field.hint?`${hint}\n\n${field.hint}`:hint;
   const type=TYPES[directives["тип"]??""];if(type)field.type=type;
   if(directives["поле"])field.bind=directives["поле"];
   delete directives["тип"];delete directives["поле"];
  }
  field.key=target.key(field.label||field.type,explicitKey);
  target.fields.push(field);return field;
 }
 function dropTitle(){
  if(sheet?.key!=="title"||sheet.fields.some(f=>f.type!=="heading"&&f.type!=="note"))return;
  description.push(...sheet.prose,...sheet.fields.map(f=>f.type==="heading"?`## ${f.label}`:f.hint??""));sheets.pop();
 }
 /** Текст между графами: до первой графы листа — «О занятии», дальше — подсказка следующей графы или отдельное пояснение. */
 function flush(){
  const text=prose.join("\n").replace(/^\n+|\n+$/g,"");prose=[];if(!text)return;
  const s=current();if(!s.started&&target===s.target)s.prose.push(text);else add({type:"note",label:"",hint:text});
 }
 /** Графа без своей метки («Запись», таблица, чек-лист) забирает заголовок раздела, если он стоит прямо перед ней. */
 function unlabelled(fallback:string){
  current();const last=target.fields[target.fields.length-1];
  if(last?.type==="heading"){target.fields.pop();target.keys.delete(last.key);return {text:last.label,key:last.key};}
  return {text:fallback,key:undefined as string|undefined};
 }

 function table(block:string[]){
  const rows=block.map(cells),head=rows[0],body=rows.slice(2);
  if(!body.length||!rows[1]?.every(c=>/^:?-{3,}:?$/.test(c)))return void prose.push(...block);
  // Сетка «**МЕТКА**<br>_[заполнить]_»: каждая клетка — своя графа.
  if(head.every(c=>empty(c))&&body.flat().some(c=>/^\*\*.+?\*\*\s*<br>/i.test(c))){
   flush();
   for(const cell of body.flat()){
    const m=cell.match(/^\*\*(.+?)\*\*\s*<br>\s*(.*)$/i);if(!m)continue;
    const l=label(m[1]),rest=m[2].trim();
    if(PLACEHOLDER.test(rest)){const tail=rest.replace(PLACEHOLDER,"").trim();add({type:"line",label:l.text,...(tail?{hint:tail}:{})},l.key);continue;}
    const o=options(rest);add(o?{type:"choice",label:l.text,options:o}:{type:"line",label:l.text,...(rest?{hint:rest}:{})},l.key);
   }
   return;
  }
  if(body.every(r=>r.every(c=>!empty(c))))return void prose.push(...block); // справочная таблица без пустых клеток
  let columns=head,data=body;
  if(/^[#№]$/.test(head[0])&&body.every(r=>/^\d*$/.test(r[0]))){columns=head.slice(1);data=body.map(r=>r.slice(1));}
  const cols=new Target([]);
  const column=(raw:string):WorkbookField=>{
   const c=label(raw||"Колонка"),m=c.text.match(/^(.+?):\s*(.+\/.+)$/),o=m&&options(m[2]);
   return o?{key:cols.key(m![1],c.key),label:c.text,type:"choice",options:o}:{key:cols.key(c.text,c.key),label:c.text,type:"line"};
  };
  const l=unlabelled(section||"Таблица");
  // Заполненная первая колонка при пустых остальных — строки заданы автором.
  if(data.every(r=>!empty(r[0]))&&data.some(r=>r.slice(1).every(c=>empty(c)))){
   const rowKeys=new Target([]);
   add({type:"table",label:l.text,rowHeader:label(columns[0]||"").text,rows:data.map(r=>{const rl=label(r[0]);return {key:rowKeys.key(rl.text,rl.key),label:rl.text};}),columns:columns.slice(1).map(column)},l.key);
   return;
  }
  const fields=columns.map(column),minRows=Math.min(data.length,50);
  // Широкая матрица неудобна на развороте: строка становится карточкой с подписанными полями.
  add(fields.length>4?{type:"group",label:l.text,fields,minRows}:{type:"table",label:l.text,columns:fields,minRows},l.key);
 }

 /** Формы курса кампаний внутри ```text: «Метка:», «[ ] вариант», «- подпункт:», пустые «1.»/«-». */
 function form(block:string[]){
  let parent:WorkbookField|null=null;
  for(const raw of block){
   const line=raw.trim();
   if(!line){parent=null;continue;}
   const check=line.match(CHECK);
   if(check){
    const option=check[1].replace(/_{2,}/g,"").replace(/[\s:]+$/,"").trim().slice(0,500);
    if(parent?.type==="line"){parent.type="checklist";parent.options=[];}
    if(parent?.type!=="checklist"){flush();const l=unlabelled(section||"Отметки");parent=add({type:"checklist",label:l.text,options:[]},l.key);}
    if(option&&!parent.options!.includes(option)&&parent.options!.length<100)parent.options!.push(option);
    continue;
   }
   if(/^(?:\d+[.)]|-)$/.test(line)){if(parent?.type==="line")parent.type="text";continue;}
   const sub=line.match(/^-\s+(.+?):\s*(.*)$/);
   if(sub){
    if(parent?.type==="line"||parent?.type==="text"){parent.type="heading";parent.level=3;delete parent.hint;}
    const l=label(sub[1]);add({type:"line",label:l.text,...(sub[2]?{hint:sub[2]}:{})},l.key);continue;
   }
   const field=line.match(/^([^:]{2,200}?):\s*(.*)$/);
   if(field){
    const l=label(field[1]),rest=field[2].replace(/_{3,}/g,"").trim(),o=rest?options(rest):null;
    if(!rest){parent=add({type:"line",label:l.text},l.key);continue;}
    if(o){parent=add({type:"choice",label:l.text,options:o},l.key);continue;}
   }
   parent=null;prose.push(line);
  }
  for(let k=target.fields.length-1;k>=0;k--){const f=target.fields[k];if(f.type==="checklist"&&!f.options!.length){target.fields.splice(k,1);target.keys.delete(f.key);}}
 }

 for(let i=0;i<lines.length;i++){
  const line=lines[i],trim=line.trim();
  if(trim.startsWith("<!--")){
   let body=trim.slice(4);while(!body.includes("-->")&&i+1<lines.length)body+="\n"+lines[++i];
   for(const part of body.replace(/-->[\s\S]*$/,"").split(/[;\n]/)){
    const [k,...v]=part.split(":"),name=k.trim().toLowerCase(),value=v.join(":").trim();if(!name)continue;
    if(name==="шаблон")templateKey=value;else if(name==="версия")version=Number(value);else directives[name]=value;
   }
   continue;
  }
  const h=trim.match(/^(#{1,3})\s+(.*)$/);
  if(h){
   const l=label(h[2]);
   if(h[1]==="#"){
    if(!title){title=l.text;continue;}
    flush();
    dropTitle();
    open(sheetKeys.key(l.text,l.key),l.text);directives={};continue;
   }
   if(!title)continue;
   flush();current();
   if(h[1]==="##"){
    target=sheet!.target;section=l.text;
    if("карточка" in directives){
     const group=add({type:"group",label:l.text,fields:[],...(directives["карточка"]?{entity:directives["карточка"]}:{})},l.key);
     delete directives["карточка"];target=new Target(group.fields!);continue;
    }
   }else section=l.text;
   add({type:"heading",label:l.text,level:h[1]==="##"?2:3},l.key);continue;
  }
  if(!title)continue;
  if(trim.startsWith("```")){const block:string[]=[];while(++i<lines.length&&!lines[i].trim().startsWith("```"))block.push(lines[i]);form(block);continue;}
  if(trim.startsWith("|")){const block=[line];while(i+1<lines.length&&lines[i+1].trim().startsWith("|"))block.push(lines[++i]);table(block);continue;}
  if(CHECK.test(trim)){
   const opts=new Set<string>();i--;
   while(i+1<lines.length&&CHECK.test(lines[i+1].trim()))opts.add(lines[++i].trim().match(CHECK)![1].trim().slice(0,500));
   const l=unlabelled(section||"Отметки");
   add({type:"checklist",label:l.text,options:[...opts].slice(0,100),...(READINESS.test(l.text)||READINESS.test(section)?{readiness:true}:{})},l.key);continue;
  }
  const bold=trim.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  const ruled=()=>{let j=i+1;while(j<lines.length&&!lines[j].trim())j++;return RULE.test(lines[j]?.trim()??"")||NUM_RULE.test(lines[j]?.trim()??"");};
  if(bold&&(/[:：]\s*$/.test(bold[1].replace(KEY,""))||!bold[2].trim()&&ruled())){
   const l=label(bold[1]),rest=bold[2].trim();
   if(PLACEHOLDER.test(rest)){
    const tail=rest.replace(PLACEHOLDER,"").trim(),hint=tail?{hint:tail}:{};
    if(l.text.toLowerCase()==="запись"){const u=unlabelled(section||"Запись");add({type:"text",label:u.text,...hint},u.key);}
    else add({type:"line",label:l.text,...hint},l.key);
    continue;
   }
   if(RULE.test(rest)){add({type:"line",label:l.text},l.key);continue;}
   if(!rest){
    let j=i+1;while(j<lines.length&&!lines[j].trim())j++;
    let count=0,numbered=false;
    for(;j<lines.length;j++){
     const next=lines[j].trim();
     if(RULE.test(next)||NUM_RULE.test(next)){count++;if(NUM_RULE.test(next))numbered=true;}
     else if(!(next===""&&count&&NUM_RULE.test(lines[j+1]?.trim()??"")))break;
    }
    if(count){add({type:count>1||numbered?"text":"line",label:l.text},l.key);i=j-1;continue;}
    flush();add({type:"heading",label:l.text,level:3},l.key);section=l.text;continue;
   }
  }
  if(RULE.test(trim)||NUM_RULE.test(trim)||/^-{3,}$/.test(trim))continue;
  if(!trim){if(prose.length&&prose[prose.length-1]!=="")prose.push("");continue;}
  prose.push(line);
 }
 flush();
 dropTitle();
 const template:WorkbookTemplate={
  format:"soyman-workbook",schemaVersion:1,key:templateKey||workbookSlug(title||"workbook"),
  version:version&&Number.isInteger(version)&&version>0?version:1,title:title||"Тетрадь",
  ...(description.length?{description:description.join("\n\n")}:{}),
  sheets:sheets.map(s=>({key:s.key,title:s.title,...(s.prose.length?{instructions:s.prose.join("\n\n")}:{}),fields:s.fields})),
 };
 return {template,explicit:{key:!!templateKey,version:!!version}};
}
