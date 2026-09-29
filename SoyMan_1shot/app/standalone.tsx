import './legacy-polyfills';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { applyTheme, findTheme } from '../../client/src/themes';
import { applyCanvasPaletteVars } from '../../client/src/canvasPalette';
import { snapshot } from './standalone-transport';
import { refreshMentionIndex } from '../../client/src/mentions';
import { MentionPreviewRoot } from '../../client/src/components/mentions/MentionPreviewRoot';
import { normalizeDndCharacter } from '@shared/dnd/normalize';
import { portableNotes } from '../../shared/src/portable/parse';
import { OneShotNotes } from './notes';
import '../../client/src/index.css';
import '../../client/src/dnd-sheet.css';
import '../../client/src/creature-card.css';
import '../../client/src/rich-text.css';
import '../../client/src/statblock.css';
import '../../client/src/zine.css';
import '../../client/src/fantasy-punk-skin.css';
import './tokens.css';
import './shell.css';
import './components.css';
import './sheet.css';
import './modals.css';

applyTheme(findTheme('noir'));
// Цвета типов сущностей — маркер упоминаний (index.css, .mention--*).
applyCanvasPaletteVars();
const template = document.documentElement.cloneNode(true) as HTMLElement;
template.querySelector('#root')!.replaceChildren();
function App() {
  // Заметки игрока из файла — только чтение: копия ничего не сохраняет, а
  // Мастер их читает (гриллинг 2026-09-28, Q31).
  const [notes] = useState(() => portableNotes((snapshot.character as { notes?: unknown }).notes));
  const [value, setValue] = useState(() => normalizeDndCharacter(snapshot.character.content));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // Подсказка «открыто в предпросмотре» лежит в самом HTML и уходит, только
  // когда лист смонтировался: если скрипт упал, игрок видит её, а не пустоту.
  useEffect(() => { document.getElementById('oneshot-nojs')?.remove(); }, []);
  // В шапке — одна кнопка «Внимание» (решение владельца 2026-09-28): изменения
  // в автономной копии не сохраняются, персонажа ведут на сайте после импорта;
  // скачивание копии с изменениями — запасной выход для тех, кто уже играл здесь.
  const [noteOpen, setNoteOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  function save() {
    const html = template.cloneNode(true) as HTMLElement;
    // Round-trip contract (phase B1.2): only the runtime content is swapped.
    // Top-level identity (and catalog) survive every re-save untouched — the
    // standalone never mints a new characterUid.
    html.querySelector('#oneshot-payload')!.textContent = JSON.stringify({ ...snapshot, character: { ...snapshot.character, content: value } }).replaceAll('<', '\\u003c');
    const url = URL.createObjectURL(new Blob(['<!doctype html>\n' + html.outerHTML], { type: 'text/html' }));
    const link = document.createElement('a'); link.href = url; link.download = 'OneShot-персонаж.html'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setDownloaded(true);
  }
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false, detached: true }}>
    <header className="oneshot-header oneshot-standalone-header"><strong>OneShot SoyMan</strong><span className="oneshot-standalone-label">Автономная копия</span>
      <button type="button" className="oneshot-standalone-note-toggle" aria-expanded={noteOpen} aria-controls="oneshot-standalone-note" aria-label={dirty ? 'Внимание — есть несохранённые изменения' : undefined} onClick={() => setNoteOpen(v => !v)}>Внимание{dirty && <span className="oneshot-standalone-dirty" aria-hidden="true" />}</button>
      <div id="oneshot-standalone-note" className="oneshot-standalone-note" hidden={!noteOpen}>
        <p><b>Изменения здесь не сохраняются.</b></p>
        <p>Это автономная копия: всё, что вы меняете, пропадёт, когда вы закроете страницу.</p>
        <p>Чтобы вести персонажа дальше, откройте <b>soyman-1shot.vercel.app</b> → «Импорт» → «Импортировать персонажа» и выберите этот файл. Там все изменения сохраняются сами.</p>
        <p>Уже что-то поменяли здесь? Сначала скачайте копию с изменениями и импортируйте её.</p>
        <button type="button" onClick={save}>Скачать копию с изменениями</button>
        <p className="oneshot-standalone-saved" aria-live="polite">{downloaded ? 'Скачивание запрошено — проверьте, что файл сохранился, прежде чем закрыть страницу.' : ''}</p>
      </div>
    </header>
    <div className="oneshot-sheet"><div className="fp-page-backdrop" aria-hidden="true" /><DndCharacterView value={value} portraitUrl={snapshot.character.portrait} onQuickUpdate={patch => { setDirty(true); setValue(v => ({ ...v, ...patch })); }} sideColumn={notes.length ? <OneShotNotes notes={notes} /> : undefined} /><MentionPreviewRoot /></div>
    <details className="oneshot-sources"><summary>Источники правил</summary><p>This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.</p><p>Тексты и переводы импортированного справочника сохраняют условия своих источников.</p></details>
  </DndRuntimeContext.Provider>;
}
void refreshMentionIndex();
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);
