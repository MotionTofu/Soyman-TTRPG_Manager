// Дымовая проверка листа и визарда в настоящем браузере (аудит 2026-09-26).
//
// Нужен запущенный OneShot (npm start, порт 4318) и Chrome. В чистом профиле
// визардом создаются персонажи (класс и уровень — ниже), затем обходятся все
// вкладки листа на ПК (1440) и телефоне (390). Падает на:
//   — исключениях и ошибках консоли (в том числе React: повтор ключа),
//   — горизонтальной прокрутке и элементах за краем экрана,
//   — кнопках без подписи, полях без подписи, картинках без alt.
// Мелкие цели касания на телефоне — только в отчёт.
//
//   node tests/ui-smoke.mjs                       — Жрец, Артефактор, Волшебник 5 ур.
//   UI_CLASSES=Воин UI_LEVEL=1 node tests/ui-smoke.mjs
//   CHROME=… UI_URL=http://127.0.0.1:4318/ …
//
// Не входит в `npm test`: без сервера и браузера ему нечего проверять.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.UI_URL || 'http://127.0.0.1:4318/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CLASSES = (process.env.UI_CLASSES || 'Жрец,Артефактор,Волшебник').split(',').map((s) => s.trim()).filter(Boolean);
const LEVEL = Number(process.env.UI_LEVEL || 5);
const PORT = 9400 + Math.floor(Math.random() * 400);
const TABS = ['Карта', 'Действия', 'Магия', 'Снаряжение', 'Навыки', 'Особенности', 'Ресурсы', 'Досье'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'oneshot-ui-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* браузер ещё поднимается */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { chrome.kill(); throw Error('Chrome не поднялся: ' + CHROME); }
// Подписка на open — сразу при создании, иначе событие проходит мимо.
const ws = await new Promise((resolve, reject) => { const s = new WebSocket(wsUrl); s.onopen = () => resolve(s); s.onerror = reject; });
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description?.slice(0, 300) ?? 'exception');
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push(d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
};
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function run(fn, arg) {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
}
async function size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }); await sleep(1200); }
async function go(url, wait = 15000) { await send('Page.navigate', { url }); await sleep(wait); }
await send('Page.enable'); await send('Runtime.enable');

// ——— в странице ———
const HELPERS = `const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const R=(re)=>[...document.querySelectorAll('button')].find(b=>re.test((b.getAttribute('aria-label')||'')+'|'+b.textContent));`;
// Кнопки ниже уводят страницу со старого контекста: ответа от клика нет,
// результат читается отдельным вызовом после паузы.
const openWizard = `async()=>{${HELPERS} const b=R(/через визард/i); if(!b) return 'нет кнопки визарда'; setTimeout(()=>b.click(),0); return 'ok'}`;
const walkWizard = `async({cls,level})=>{${HELPERS}
  const fill=async()=>{for(let k=0;k<80;k++){const sec=[...document.querySelectorAll('.wz-step section')].find(s=>{const c=s.querySelector('.wz-count');return c&&!c.classList.contains('is-done')&&s.querySelector('.wz-row-check[aria-pressed="false"]:not([disabled])')}); if(!sec) return; sec.querySelector('.wz-row-check[aria-pressed="false"]:not([disabled])').click(); await W(250);}};
  const title=()=>document.querySelector('.wz-stage-title')?.textContent||'';
  for(let i=0;i<24;i++){ const t=title(); if(t==='Обзор') return 'ok';
    const tc=[...document.querySelectorAll('.wz-tile-card')]; if(tc.length){ (tc.find(b=>b.textContent.includes(cls))||tc[0]).click(); await W(1800);}
    if(t==='Класс'){ const up=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Уровень +1'); for(let k=1;k<level&&up;k++){ up.click(); await W(400);} await W(1500); for(let k=0;k<2;k++){ R(/^\\|Выбрать$/)?.click(); await W(2000);} }
    if(t==='Предыстория'){ document.querySelector('.wz-row .wz-row-check')?.click(); await W(1500); }
    if(t==='Снаряжение'){ const b=[...document.querySelectorAll('button,[role=radio],label')].filter(x=>/Сундук/.test(x.textContent)); b[b.length-1]?.click(); await W(1500); }
    R(/^\\|Выбрать$/)?.click(); await W(1200); await fill();
    const n=R(/^\\|Далее$/); if(!n||n.disabled) return 'визард встал на «'+t+'»: '+(document.querySelector('.wz-foot-hint')?.textContent||''); n.click(); await W(1800); }
  return 'визард не дошёл до «Обзора»'}`;
const createCharacter = `async()=>{${HELPERS} const b=R(/Создать персонажа/); if(!b||b.disabled) return 'кнопка «Создать» недоступна'; setTimeout(()=>b.click(),0); return 'ok'}`;
const openTab = `async({tab,mobile})=>{${HELPERS}
  let b; if(mobile){ R(/^Дополнительные действия\\|/)?.click(); await W(800); document.querySelector('.oneshot-menu-deck')?.click(); await W(1500);
    b=[...document.querySelectorAll('.dnd-deck-fan-card')].find(c=>((c.getAttribute('aria-label')||'')+c.textContent).includes(tab)); }
  else b=R(new RegExp('^\\\\|'+tab+'$'));
  if(!b) return false; b.click(); await W(2200); window.scrollTo(0,0); await W(300); return true}`;
const measure = `()=>{
  const sig=(el)=>el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+'«'+(el.textContent||'').trim().slice(0,30)+'»';
  const vw=innerWidth; const over=new Set();
  for(const el of document.querySelectorAll('body *')){ const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue; const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.position==='fixed') continue;
    if(r.right>vw+1||r.left<-1){ let p=el.parentElement, clipped=false; while(p&&p!==document.body){ if(/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)){clipped=true;break;} p=p.parentElement;} if(!clipped) over.add(sig(el)); } }
  const inter=[...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab]')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';});
  return {
    scrollX: document.documentElement.scrollWidth-vw,
    over:[...over].slice(0,5),
    unnamed: inter.filter(e=>(e.tagName==='BUTTON'||e.getAttribute('role')==='button')&&!(e.textContent||'').trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML.slice(0,90)).slice(0,5),
    unlabeled: inter.filter(e=>/INPUT|SELECT|TEXTAREA/.test(e.tagName)&&!['checkbox','radio','button','submit','file'].includes(e.type)&&!e.getAttribute('aria-label')&&!e.getAttribute('placeholder')&&!e.closest('label')&&!(e.id&&document.querySelector('label[for="'+e.id+'"]'))).map(e=>e.outerHTML.slice(0,90)).slice(0,5),
    noAlt: [...document.querySelectorAll('img:not([alt])')].map(i=>i.src.slice(-50)).slice(0,5),
    smallTargets: inter.filter(e=>{const r=e.getBoundingClientRect(); return (r.width<24||r.height<24)&&!['checkbox','radio'].includes(e.type);}).length,
  };}`;

// ——— прогон ———
const failures = []; const notes = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);
function takeErrors(where) { for (const e of pageErrors.splice(0)) fail(where, 'консоль: ' + e); }
try {
  for (const cls of CLASSES) {
    await size(1440, 900);
    await go(BASE, 20000);
    const opened = await run(openWizard); if (opened !== 'ok') { fail(cls, opened); continue; }
    await sleep(12000);
    const walked = await run(walkWizard, { cls, level: LEVEL }); takeErrors(`${cls}, визард`);
    if (walked !== 'ok') { fail(cls, walked); continue; }
    const created = await run(createCharacter);
    if (created !== 'ok') { fail(cls, created); continue; }
    await sleep(8000);
    const search = await run('()=>location.search');
    if (!String(search).includes('character=')) { fail(cls, 'персонаж не открылся после «Создать»'); continue; }
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      await size(w, h); await go(BASE + search);
      for (const tab of TABS) {
        const where = `${cls} ${LEVEL}, ${mobile ? 'телефон' : 'ПК'}, «${tab}»`;
        if (!(await run(openTab, { tab, mobile }))) { fail(where, 'вкладка не открылась'); continue; }
        const m = await run(measure); takeErrors(where);
        if (m.scrollX > 0) fail(where, `горизонтальная прокрутка ${m.scrollX}px`);
        if (m.over.length) fail(where, 'за краем экрана: ' + m.over.join(', '));
        if (m.unnamed.length) fail(where, 'кнопки без подписи: ' + m.unnamed.join(' | '));
        if (m.unlabeled.length) fail(where, 'поля без подписи: ' + m.unlabeled.join(' | '));
        if (m.noAlt.length) fail(where, 'картинки без alt: ' + m.noAlt.join(', '));
        if (mobile && m.smallTargets > 0) notes.push(`${where}: мелких целей касания — ${m.smallTargets}`);
      }
    }
  }
} finally {
  ws.close(); chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome ещё держит файлы */ }
}
for (const n of notes) console.log('· ' + n);
if (failures.length) {
  console.error(`\n✖ ${failures.length} проблем:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`\n✔ ${CLASSES.join(', ')} ${LEVEL} ур.: визард и ${TABS.length} вкладок на ПК и телефоне без ошибок`);
