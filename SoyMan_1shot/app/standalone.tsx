import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../client/src/data/queryClient';
import { DndCharacterView } from '../../client/src/components/dnd/DndCharacterForm';
import { DndRuntimeContext } from '../../client/src/components/dnd/DndRuntime';
import { applyTheme, findTheme } from '../../client/src/themes';
import { snapshot } from './standalone-transport';
import { normalizeDndCharacter } from '@shared/dnd/normalize';
import '../../client/src/index.css';
import '../../client/src/dnd-sheet.css';
import '../../client/src/creature-card.css';
import '../../client/src/rich-text.css';
import '../../client/src/statblock.css';
import '../../client/src/zine.css';
import './shell.css';

applyTheme(findTheme('noir'));
const template = document.documentElement.cloneNode(true) as HTMLElement;
template.querySelector('#root')!.replaceChildren();
function App() {
  const [value, setValue] = useState(() => normalizeDndCharacter(snapshot.character.content));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [status, setStatus] = useState('Изменения хранятся до закрытия страницы. Скачайте обновлённую копию после игры.');
  function save() {
    const html = template.cloneNode(true) as HTMLElement;
    html.querySelector('#oneshot-payload')!.textContent = JSON.stringify({ ...snapshot, character: { ...snapshot.character, content: value } }).replaceAll('<', '\\u003c');
    const url = URL.createObjectURL(new Blob(['<!doctype html>\n' + html.outerHTML], { type: 'text/html' }));
    const link = document.createElement('a'); link.href = url; link.download = 'OneShot-персонаж.html'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus('Скачивание запрошено. Убедитесь, что файл сохранён, прежде чем закрыть страницу.');
  }
  return <DndRuntimeContext.Provider value={{ allowDiceRolls: false, campaignConnected: false, detached: true }}>
    <header className="oneshot-header"><strong>OneShot SoyMan · автономная копия</strong><button onClick={save}>Скачать обновлённую копию</button><span role="status">{status}</span></header>
    <div className="oneshot-sheet"><DndCharacterView value={value} portraitUrl={snapshot.character.portrait} onQuickUpdate={patch => { setDirty(true); setValue(v => ({ ...v, ...patch })); setStatus('Есть изменения — скачайте обновлённую копию перед закрытием.'); }} /></div>
    <details><summary>Источники правил</summary><p>This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.</p><p>Тексты и переводы импортированного справочника сохраняют условия своих источников.</p></details>
  </DndRuntimeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);
