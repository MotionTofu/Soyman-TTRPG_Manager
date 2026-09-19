import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterWizard } from '../../client/src/components/dnd/DndCharacterWizard';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { SaveNotices } from '../../client/src/components/SaveNotices';
import { applyTheme, findTheme } from '../../client/src/themes';
import { emptyDndCharacter } from '@shared/dnd/normalize';
import type { DndCharacterData } from '@shared/dnd/types';
import { listCharacters, getCharacter, createCharacter, saveCharacter, currentCatalog, saveCatalog, getCatalog, parseCharacterContent, type Character } from './repository';
import { selectCharacter } from './transport';
import { parseCatalog } from './catalog.mjs';
import { auditExport } from './export-audit.mjs';
import { portablePayload, renderPortable } from './portable.mjs';
import { Modal } from '../../client/src/components/Modal';
import { DND_CARD_BACK_OPTIONS, loadDndPrefs, saveDndPrefs, type DndCardBack } from '../../client/src/dndPrefs';
import '../../client/src/index.css';
import '../../client/src/dnd-sheet.css';
import '../../client/src/creature-card.css';
import '../../client/src/rich-text.css';
import '../../client/src/statblock.css';
import '../../client/src/zine.css';
import './shell.css';

applyTheme(findTheme('noir'));
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [active, setActive] = useState<Character | null>(null);
  const activeRef = useRef<Character | null>(null);
  const [catalogKey, setCatalogKey] = useState<string | null>(null);
  const [catalogName, setCatalogName] = useState('Справочник ещё не подключён');
  const [serverCatalog, setServerCatalog] = useState(false);
  const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [exportAudit, setExportAudit] = useState<ReturnType<typeof auditExport> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cardBack, setCardBack] = useState<DndCardBack>(() => loadDndPrefs().cardBack);
  const [includeLargeCards, setIncludeLargeCards] = useState(true);
  async function exportHtml() {
    setExporting(true); setError('');
    try {
      const c = activeRef.current; if (!c?.content) return;
      const payload = portablePayload(c, c.catalogKey ? await getCatalog(c.catalogKey) : null);
      const response = await fetch('/standalone-template.html');
      if (!response.ok) throw Error('Не удалось загрузить оболочку автономного чарника.');
      const html = renderPortable(await response.text(), payload);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const link = document.createElement('a'); link.href = url; link.download = `OneShot-${c.id}.html`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }
  async function inspectExport() {
    try {
      const c = activeRef.current; if (!c?.content) return;
      setExportAudit(auditExport(c, c.catalogKey ? await getCatalog(c.catalogKey) : null));
    } catch (e) { setError((e as Error).message); }
  }
  const [name, setName] = useState('');
  const queue = useRef(Promise.resolve()); const revision = useRef(0); const failed = useRef(false);
  const pending = useRef(0);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current || failed.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const importFile = useRef<HTMLInputElement>(null); const restoreFile = useRef<HTMLInputElement>(null);
  async function connectServerCatalog() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/catalog.json', { cache: 'no-store' });
      if (!response.ok) throw Error('Не удалось загрузить общий справочник. Повторите подключение.');
      const catalog = parseCatalog(await response.json());
      const key = await saveCatalog(catalog);
      setCatalogKey(key); setCatalogName(catalog.system.name);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function open(id: number) {
    const c = await getCharacter(id); if (!c) throw Error('Персонаж не найден');
    await selectCharacter(id); revision.current = c.revision; activeRef.current = c; setActive(c); setWizard(!c.content);
    setStatus('Сохранено на устройстве');
  }
  useEffect(() => {
    (async () => {
      setCharacters(await listCharacters()); const key = await currentCatalog(); setCatalogKey(key || null);
      if (key) setCatalogName((await getCatalog(key)).system.name);
      if (!import.meta.env.DEV) {
        try {
          const response = await fetch('/server-config.json', { cache: 'no-store' });
          if (response.ok && (await response.json()).catalog === '/catalog.json') setServerCatalog(true);
        } catch { /* Local characters remain available when the server is unreachable. */ }
      }
      const id = Number(new URLSearchParams(location.search).get('character'));
      if (id) await open(id);
      setReady(true);
    })().catch(e => { setError(e.message); setReady(true); });
  }, []);
  function update(patch: Partial<DndCharacterData>) {
    const old = activeRef.current; if (!old?.content) return;
    const next = { ...old, content: { ...old.content, ...patch } }; activeRef.current = next; setActive(next);
    if (failed.current) { setStatus('Не сохранено'); return; }
    pending.current += 1;
    setStatus('Сохраняем на устройстве…');
    queue.current = queue.current.then(async () => {
      if (failed.current) { pending.current -= 1; return; }
      try {
        const saved = await saveCharacter({ ...next, revision: revision.current }); revision.current = saved.revision;
        if (activeRef.current) activeRef.current.revision = saved.revision;
      } catch (e) { failed.current = true; setStatus('Не сохранено'); setError((e as Error).message); }
      finally { pending.current -= 1; if (!failed.current && !pending.current) setStatus('Сохранено на устройстве'); }
    });
  }
  async function create(blank = false) {
    setBusy(true); setError('');
    try {
      let c = await createCharacter(name.trim() || 'Новый персонаж', catalogKey);
      if (blank) { const content = emptyDndCharacter(); content.characterName = c.name; content.systemId = catalogKey ? 1 : null; c = await saveCharacter({ ...c, content }); }
      location.assign(`/?character=${c.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function backup() {
    try {
      const c = activeRef.current; if (!c?.content) return;
      const catalog = c.catalogKey ? structuredClone(await getCatalog(c.catalogKey)) : null;
      if (catalog && !includeLargeCards) for (const entry of catalog.entries) delete entry.avatar_large_url;
      download({ format: 'soyman-1shot-backup', version: 1, character: { ...c, revision: revision.current }, catalog }, `oneshot-${c.id}.json`);
    } catch (e) { setError((e as Error).message); }
  }
  async function readFile(file: File) { if (file.size > 256 * 1024 * 1024) throw Error('Файл превышает 256 МБ'); return JSON.parse(await file.text()); }
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false }}>
    <header className="oneshot-header"><a href="/" onClick={e => { if (status !== 'Сохранено на устройстве' && active?.content) { e.preventDefault(); setError('Дождитесь сохранения или скачайте резервную копию перед выходом.'); } }}>OneShot SoyMan</a><span className="muted">{active?.name || 'Ваши персонажи'}</span><label className="oneshot-card-back">Рубашка<select value={cardBack} onChange={e => { const next = e.target.value as DndCardBack; setCardBack(next); saveDndPrefs({ ...loadDndPrefs(), cardBack: next }); }}>{DND_CARD_BACK_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><span role="status">{status}</span>{active?.content && <><label className="oneshot-large-cards"><input type="checkbox" checked={includeLargeCards} onChange={e => setIncludeLargeCards(e.target.checked)} /> Большие карты в копии</label><button onClick={() => void backup()}>Скачать резервную копию</button></>}</header>
    {active?.content && <div className="oneshot-export-action"><button disabled={exporting} onClick={() => void exportHtml()}>{exporting ? 'Собираем автономную копию…' : 'Скачать автономный HTML'}</button><button onClick={() => void inspectExport()}>Проверить состав</button></div>}
    {exportAudit && <Modal onClose={() => setExportAudit(null)}>
      <h3>Подготовка автономной копии</h3>
      <p>Найдено {exportAudit.entryCount} связанных с персонажем записей из {exportAudit.totalEntryCount} в справочнике. Остальные заклинания и предметы в этот предварительный срез не включены.</p>
      {exportAudit.problems.length > 0 ? <><strong>Нужно дополнить данные</strong><ul>{exportAudit.problems.map(p => <li key={p}>{p}</li>)}</ul></> : <p>Прямые ссылки персонажа найдены в справочнике.</p>}
      {exportAudit.externalAssets.length > 0 && <p>Есть изображения вне пакета: {exportAudit.externalAssets.length}. Их ещё нужно включить в автономную копию.</p>}
      <p className="muted">HTML содержит интерфейс, портрет и выбранные записи справочника вместе с общими игровыми правилами. Спутники по умениям и заклинаниям поддержаны; отдельные статблоки бестиария и внешние изображения пока не переносятся. Полнота особых классовых механик ещё проверяется.</p>
      <button onClick={() => setExportAudit(null)}>Вернуться к чарнику</button>
    </Modal>}
    {error && <div className="oneshot-error" role="alert">{error}</div>}
    {!ready ? <p className="oneshot-home">Открываем локальные данные…</p> : active?.content ? <div className="oneshot-sheet"><DndCharacterView key={active.id} value={active.content} portraitUrl={active.portrait} onQuickUpdate={update} syncTabToUrl onSheetBack={() => { if (status === 'Сохранено на устройстве') location.assign('/'); }} /></div> : <main className="oneshot-home">
      <p className="muted">D&D 5.5 · настоящий визард и чарник SoyMan</p><h1>Ваш следующий персонаж</h1>
      <p>Создайте героя в привычном визарде или заполните пустой лист вручную. Персонажи сохраняются в этом браузере.</p>
      <section><h2>Справочник</h2><p>{catalogName}</p><p className="muted">Подключите JSON-выгрузку системы из SoyMan. Файл остаётся на устройстве. Новая выгрузка используется для новых персонажей; существующие сохраняют свою версию.</p><button onClick={() => importFile.current?.click()}>Подключить справочник SoyMan</button><input hidden ref={importFile} type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { await saveCatalog(parseCatalog(await readFile(file))); location.reload(); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} /></section>
      {import.meta.env.DEV && <button onClick={async () => { try { const response = await fetch('/__local/catalog'); if (!response.ok) throw Error('Локальная копия справочника ещё не подготовлена'); await saveCatalog(parseCatalog(await response.json())); location.reload(); } catch (e) { setError((e as Error).message); } }}>Подключить справочник этого SoyMan</button>}
      {serverCatalog && <section><h2>Общий справочник сайта</h2><p>Подключите готовый справочник для создания персонажей. Загрузка может занять некоторое время. Уже созданные персонажи сохранят свою версию правил.</p><button disabled={busy} onClick={() => void connectServerCatalog()}>{busy ? 'Загружаем справочник…' : 'Подключить общий справочник'}</button></section>}
      <section><h2>Новый персонаж</h2><label>Имя<input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Как зовут героя?" /></label><div className="row oneshot-actions"><button className="primary" disabled={busy || !catalogKey} onClick={() => void create()}>Создать через визард</button><button disabled={busy} onClick={() => void create(true)}>Открыть пустой лист</button></div>{!catalogKey && <p className="muted">Для выбора класса, вида и остальных опций визарду нужен справочник.</p>}</section>
      <section><h2>Сохранённые персонажи</h2>{!characters.length && <p className="muted">Здесь появятся ваши персонажи и незавершённые черновики.</p>}{characters.map(c => <a className="oneshot-character" key={c.id} href={`/?character=${c.id}`}><strong>{c.content?.characterName || c.name}</strong><span>{c.content ? 'Открыть чарник' : 'Продолжить создание'}</span></a>)}<button onClick={() => restoreFile.current?.click()}>Восстановить из копии</button><input ref={restoreFile} hidden type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const data = await readFile(file); if (data.format !== 'soyman-1shot-backup' || data.version !== 1) throw Error('Нужна резервная копия OneShot'); const content = parseCharacterContent(data.character?.content); const key = data.catalog ? await saveCatalog(parseCatalog(data.catalog)) : null; const c = await createCharacter(content.characterName || 'Восстановленный персонаж', key); const portrait = typeof data.character?.portrait === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.character.portrait) ? data.character.portrait : null; await saveCharacter({ ...c, content, portrait }); location.assign(`/?character=${c.id}`); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} /></section>
      <p className="muted">Можно скачать автономный HTML чарника. Изменения в нём сохраняются скачиванием обновлённой копии. Аккаунты и синхронизация ещё в работе. Резервная копия JSON содержит лист и весь подключённый справочник.</p>
    </main>}
    {wizard && active && <DndCharacterWizard ownerType="character" ownerId={active.id} ownerName={active.name} initialSystemId={active.catalogKey ? 1 : null} onDone={() => location.reload()} onCancel={() => location.assign('/')} />}
    <SaveNotices />
  </DndRuntimeContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
